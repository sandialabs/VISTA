from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_output_only_runner_option_defaults_to_both_suites_in_order(
    tmp_path: Path,
) -> None:
    test_directory = tmp_path / "test"
    test_directory.mkdir()
    runner = test_directory / "run_tests.sh"
    shutil.copy2(REPO_ROOT / "test" / "run_tests.sh", runner)

    log = tmp_path / "runner.log"
    for suite in ("backend", "frontend"):
        script = test_directory / f"{suite}_tests.sh"
        script.write_text(
            f'#!/usr/bin/env bash\nprintf "{suite}:%s\\\\n" "$*" >>"$RUNNER_LOG"\n',
            encoding="utf-8",
        )
        script.chmod(0o755)

    environment = os.environ.copy()
    environment["RUNNER_LOG"] = str(log)
    result = subprocess.run(
        ["bash", str(runner), "--verbose"],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert log.read_text(encoding="utf-8").splitlines() == [
        "backend:--verbose",
        "frontend:--verbose",
    ]


def test_historical_production_build_keeps_runtime_and_safe_context() -> None:
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    dockerignore = (
        (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    )

    assert "FROM registry.access.redhat.com/ubi9/ubi-minimal AS base" in dockerfile
    assert "uv sync --frozen --no-dev --no-install-project" in dockerfile
    assert "COPY ./backend /app/backend" in dockerfile
    assert "RUN npm ci --no-audit --no-fund" in dockerfile
    assert "RUN npm run build" in dockerfile
    assert "COPY --from=builder /app/frontend/build /app/ui2" in dockerfile
    assert "ENV FRONTEND_BUILD_PATH=/app/ui2" in dockerfile
    assert (
        'CMD ["bash", "/app/backend/scripts/start_production_server.sh"]' in dockerfile
    )

    for excluded in (
        ".venv/",
        "backend/tests/",
        "frontend/e2e/",
        "frontend/artifacts/",
        "frontend/node_modules/.cache/",
    ):
        assert excluded in dockerignore
