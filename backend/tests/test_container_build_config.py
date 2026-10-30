"""Contract tests for the production container build configuration."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_repo_file(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_production_dockerfile_does_not_copy_test_only_folders_into_image():
    """Keep test-only folders out of the production image."""
    dockerfile = _read_repo_file("Dockerfile")

    assert "test_toolbox" not in dockerfile
    # The final stage copies only the runtime sample assets Project Data's
    # built-in example loader needs, never the test suites themselves.
    assert "COPY test/" not in dockerfile
    assert "COPY backend/tests" not in dockerfile
    assert "COPY ./test/data" in dockerfile


def test_ci_build_configuration_does_not_reference_removed_test_toolbox():
    """Keep the removed test_toolbox out of the CI build configuration."""
    dockerfile = _read_repo_file("Dockerfile")
    dockerignore = _read_repo_file(".dockerignore")

    checked_build_files = "\n".join([dockerfile, dockerignore])

    assert "test_toolbox" not in checked_build_files


def _locked_version(package: str) -> str:
    lock = _read_repo_file("uv.lock")
    marker = f'[[package]]\nname = "{package}"\nversion = "'
    start = lock.index(marker) + len(marker)
    return lock[start : lock.index('"', start)]


def test_opencv_is_built_from_pinned_source_without_ffmpeg():
    """Build OpenCV from pinned source with FFmpeg disabled."""
    dockerfile = _read_repo_file("Dockerfile")
    pyproject = _read_repo_file("pyproject.toml")

    assert "AS opencv-build" in dockerfile
    assert 'CMAKE_ARGS="-DWITH_FFMPEG=OFF"' in dockerfile
    assert "--no-binary opencv-python-headless" in dockerfile
    assert "--require-hashes" in dockerfile
    # An unpinned install in the base stage leaks the GUI opencv-python (and its
    # FFmpeg) into the shipped image, because COPY --from never deletes files.
    assert "pip install --no-cache-dir ultralytics" not in dockerfile
    # The GUI distribution bundles its own FFmpeg and shares the cv2 directory.
    assert "opencv-python; sys_platform == 'never'" in pyproject


def test_dockerfile_opencv_version_matches_lockfile():
    """Pin the Dockerfile's OpenCV version to the version in uv.lock."""
    dockerfile = _read_repo_file("Dockerfile")

    assert (
        f"ARG OPENCV_VERSION={_locked_version('opencv-python-headless')}" in dockerfile
    )


def test_lockfile_never_installs_gui_opencv_distribution():
    """Keep the GUI OpenCV distribution out of every install."""
    lock = _read_repo_file("uv.lock")

    # uv keeps the package as an unreachable node; every reference to it must
    # carry the never-matching marker so a frozen sync cannot install it.
    references = [
        line for line in lock.splitlines() if '{ name = "opencv-python"' in line
    ]
    assert references
    assert all("sys_platform == 'never'" in line for line in references)


def test_ci_container_sync_preserves_ffmpeg_free_opencv():
    """Keep the CI container sync from replacing the FFmpeg-free OpenCV."""
    workflow = _read_repo_file(".github/workflows/docker-image.yml")

    # A plain "uv sync --frozen" before uvicorn inside the image reinstalls the
    # PyPI OpenCV wheel that bundles FFmpeg, replacing the wheel built in the
    # Dockerfile.
    assert (
        "uv sync --frozen --inexact --no-install-package opencv-python-headless"
        " && uvicorn"
    ) in workflow
    assert "uv sync --frozen && uvicorn" not in workflow


def test_minio_services_use_a_pullable_image_and_a_curl_free_healthcheck():
    """Use a pullable MinIO image with a curl-free healthcheck."""
    for relative_path in (
        "docker-compose.yml",
        "docker-compose.dev.yml",
        "docker-compose.test.yml",
        "deployment-test/minio.yaml",
    ):
        content = _read_repo_file(relative_path)

        # Pulls of the official minio/minio image were denied on Docker Hub and Quay.
        assert "image: minio/minio" not in content, relative_path
        assert "image: cgr.dev/chainguard/minio" in content, relative_path
        # The Chainguard image ships no curl; use MinIO's own readiness check.
        assert "minio/health/live" not in content, relative_path
