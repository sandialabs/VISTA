from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_repo_file(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_production_dockerfile_does_not_copy_test_only_folders_into_image():
    dockerfile = _read_repo_file("Dockerfile")

    assert "test_toolbox" not in dockerfile
    assert "COPY test" not in dockerfile
    assert "COPY ./test" not in dockerfile


def test_ci_build_configuration_does_not_reference_removed_test_toolbox():
    ci_config = _read_repo_file(".gitlab-ci.yml")
    dockerfile = _read_repo_file("Dockerfile")
    dockerignore = _read_repo_file(".dockerignore")

    checked_build_files = "\n".join([ci_config, dockerfile, dockerignore])

    assert "test_toolbox" not in checked_build_files
