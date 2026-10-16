from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_repo_file(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_production_dockerfile_does_not_copy_test_only_folders_into_image():
    dockerfile = _read_repo_file("Dockerfile")

    assert "test_toolbox" not in dockerfile
    # The final stage copies only the runtime sample assets Project Data's
    # built-in example loader needs, never the test suites themselves.
    assert "COPY test/" not in dockerfile
    assert "COPY backend/tests" not in dockerfile
    assert "COPY ./test/data" in dockerfile


def test_ci_build_configuration_does_not_reference_removed_test_toolbox():
    dockerfile = _read_repo_file("Dockerfile")
    dockerignore = _read_repo_file(".dockerignore")

    checked_build_files = "\n".join([dockerfile, dockerignore])

    assert "test_toolbox" not in checked_build_files
