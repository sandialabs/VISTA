from __future__ import annotations

import subprocess

from backend.scripts import run_migrations


def _cp(returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_parse_head_revisions_extracts_revision_tokens() -> None:
    stdout = "abc123 (head)\ndef456 (head)\n"
    assert run_migrations._parse_head_revisions(stdout) == ["abc123", "def456"]


def test_parse_missing_revision_extracts_alembic_error_token() -> None:
    stderr = "FAILED: Can't locate revision identified by 'removed_noop_rev'"
    assert run_migrations._parse_missing_revision(stderr) == "removed_noop_rev"


def test_run_merges_multiple_heads_then_upgrades(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []

    def fake_run(*args: str) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args == ("heads",):
            return _cp(stdout="rev_a (head)\nrev_b (head)\n")
        return _cp()

    monkeypatch.setattr(run_migrations, "_run_alembic_command", fake_run)

    rc = run_migrations.run()

    assert rc == 0
    assert calls == [
        ("heads",),
        ("merge", "-m", "auto-merge concurrent heads", "rev_a", "rev_b"),
        ("heads",),
        ("upgrade", "head"),
    ]


def test_run_upgrades_single_head_without_merge(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []

    def fake_run(*args: str) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args == ("heads",):
            return _cp(stdout="rev_main (head)\n")
        return _cp()

    monkeypatch.setattr(run_migrations, "_run_alembic_command", fake_run)

    rc = run_migrations.run()

    assert rc == 0
    assert calls == [
        ("heads",),
        ("upgrade", "head"),
    ]


def test_run_repairs_missing_metadata_only_revision_then_retries(monkeypatch, capsys) -> None:
    calls: list[tuple[str, ...]] = []
    repairs: list[tuple[str, tuple[str, ...]]] = []

    def fake_run(*args: str) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args == ("heads",):
            return _cp(stdout="rev_present (head)\n")
        if args == ("upgrade", "head") and len([call for call in calls if call == args]) == 1:
            return _cp(returncode=255, stderr="FAILED: Can't locate revision identified by 'removed_noop_rev'")
        return _cp()

    def fake_repair(missing_revision: str, local_heads: list[str]) -> bool:
        repairs.append((missing_revision, tuple(local_heads)))
        print(
            "WARNING: Database alembic_version referenced missing revision "
            f"'{missing_revision}', but no schema differences were detected.",
            file=run_migrations.sys.stderr,
        )
        return True

    monkeypatch.setattr(run_migrations, "_run_alembic_command", fake_run)
    monkeypatch.setattr(run_migrations, "_repair_missing_metadata_only_revision", fake_repair)

    rc = run_migrations.run()

    assert rc == 0
    assert repairs == [("removed_noop_rev", ("rev_present",))]
    assert calls == [
        ("heads",),
        ("upgrade", "head"),
        ("heads",),
        ("upgrade", "head"),
    ]
    assert "WARNING:" in capsys.readouterr().err


def test_run_does_not_retry_missing_revision_when_schema_diff_blocks_repair(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []

    def fake_run(*args: str) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args == ("heads",):
            return _cp(stdout="rev_present (head)\n")
        return _cp(returncode=255, stderr="FAILED: Can't locate revision identified by 'real_removed_rev'")

    monkeypatch.setattr(run_migrations, "_run_alembic_command", fake_run)
    monkeypatch.setattr(run_migrations, "_repair_missing_metadata_only_revision", lambda *_args: False)

    rc = run_migrations.run()

    assert rc == 255
    assert calls == [
        ("heads",),
        ("upgrade", "head"),
    ]
