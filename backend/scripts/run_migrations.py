#!/usr/bin/env python3
"""Run Alembic migrations with resilience for startup race conditions."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.config import settings  # noqa: E402
from core.models import Base  # noqa: E402

DEFAULT_ATTEMPTS = 15
DEFAULT_DELAY_SECONDS = 2.0
MISSING_REVISION_RE = re.compile(r"Can't locate revision identified by ['\"](?P<revision>[^'\"]+)['\"]")


def _run_alembic_command(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["alembic", *args],
        check=False,
        capture_output=True,
        text=True,
    )


def _run_alembic_upgrade(target: str) -> subprocess.CompletedProcess[str]:
    return _run_alembic_command("upgrade", target)


def _run_alembic_heads() -> subprocess.CompletedProcess[str]:
    return _run_alembic_command("heads")


def _run_alembic_merge(heads: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return _run_alembic_command(
        "merge",
        "-m",
        "auto-merge concurrent heads",
        *heads,
    )


def _parse_head_revisions(heads_stdout: str) -> list[str]:
    revisions: list[str] = []
    for line in heads_stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        revision = stripped.split(" ", 1)[0]
        revisions.append(revision)
    return revisions


def _parse_missing_revision(stderr: str) -> str | None:
    match = MISSING_REVISION_RE.search(stderr)
    if not match:
        return None
    return match.group("revision")


def _sync_database_url(database_url: str) -> str:
    if "asyncpg" in database_url:
        return database_url.replace("asyncpg", "psycopg2")
    if "aiosqlite" in database_url:
        return database_url.replace("+aiosqlite", "")
    return database_url


def _include_autogenerate_object(
    object_: object,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: object | None,
) -> bool:
    del object_, reflected, compare_to
    return not (type_ == "table" and name == "alembic_version")


def _database_schema_diffs() -> list[object]:
    """Return Alembic autogenerate diffs between the DB and current models."""

    engine = create_engine(_sync_database_url(settings.DATABASE_URL))
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={
                    "target_metadata": Base.metadata,
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": _include_autogenerate_object,
                    "version_table": "alembic_version",
                },
            )
            return list(compare_metadata(context, Base.metadata))
    finally:
        engine.dispose()


def _stamp_database_versions(revisions: Sequence[str]) -> None:
    """Replace alembic_version rows with the supplied local revision ids."""

    engine = create_engine(_sync_database_url(settings.DATABASE_URL))
    try:
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM alembic_version"))
            for revision in revisions:
                connection.execute(
                    text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                    {"revision": revision},
                )
    finally:
        engine.dispose()


def _repair_missing_metadata_only_revision(missing_revision: str, local_heads: Sequence[str]) -> bool:
    """
    Revert an Alembic metadata-only artifact to local heads when schema is unchanged.

    This only changes the Alembic version table after autogenerate confirms the
    live database schema already matches the current SQLAlchemy models. If there
    are any schema diffs, the missing revision may have represented real DDL and
    must be handled manually.
    """

    if not local_heads:
        return False

    diffs = _database_schema_diffs()
    if diffs:
        print(
            "Missing Alembic revision was not auto-reverted because the database schema differs "
            f"from the current models ({len(diffs)} difference(s) detected).",
            file=sys.stderr,
        )
        return False

    _stamp_database_versions(local_heads)
    print(
        "WARNING: Database alembic_version referenced missing revision "
        f"'{missing_revision}', but no schema differences were detected. "
        "Automatically reverted migration metadata to local revision(s): "
        f"{', '.join(local_heads)}.",
        file=sys.stderr,
    )
    return True


def _is_connection_error(stderr: str) -> bool:
    needle_set = {
        "connection refused",
        "could not connect to server",
        "connection to server",
        "temporary failure in name resolution",
        "timeout expired",
    }
    lowered = stderr.lower()
    return any(needle in lowered for needle in needle_set)


def run() -> int:
    attempts = int(os.getenv("MIGRATION_RETRY_ATTEMPTS", str(DEFAULT_ATTEMPTS)))
    delay_seconds = float(os.getenv("MIGRATION_RETRY_DELAY_SECONDS", str(DEFAULT_DELAY_SECONDS)))
    repaired_missing_revision = False

    for attempt in range(1, attempts + 1):
        heads_result = _run_alembic_heads()
        heads: list[str] = []
        if heads_result.returncode != 0:
            result = heads_result
        else:
            heads = _parse_head_revisions(heads_result.stdout)
            if len(heads) > 1:
                merge_result = _run_alembic_merge(heads)
                if merge_result.returncode != 0:
                    result = merge_result
                else:
                    heads_result = _run_alembic_heads()
                    heads = _parse_head_revisions(heads_result.stdout) if heads_result.returncode == 0 else []
                    result = _run_alembic_upgrade("head")
            else:
                result = _run_alembic_upgrade("head")

        if result.returncode == 0:
            print("Database migrations applied successfully.")
            return 0

        stderr = result.stderr.strip()
        missing_revision = _parse_missing_revision(stderr)
        if missing_revision and not repaired_missing_revision:
            repair_heads = heads
            if not repair_heads:
                latest_heads_result = _run_alembic_heads()
                if latest_heads_result.returncode == 0:
                    repair_heads = _parse_head_revisions(latest_heads_result.stdout)
            if _repair_missing_metadata_only_revision(missing_revision, repair_heads):
                repaired_missing_revision = True
                continue

        if attempt < attempts and _is_connection_error(stderr):
            print(
                f"Migration attempt {attempt}/{attempts} failed due to database connectivity; retrying in {delay_seconds:.1f}s...",
                file=sys.stderr,
            )
            time.sleep(delay_seconds)
            continue

        print("Migration failed and cannot be retried automatically.", file=sys.stderr)
        if result.stdout:
            print(result.stdout, file=sys.stderr)
        if stderr:
            print(stderr, file=sys.stderr)
        return result.returncode

    return 1


if __name__ == "__main__":
    raise SystemExit(run())
