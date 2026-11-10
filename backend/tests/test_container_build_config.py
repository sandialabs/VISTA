"""Contract tests for the production container build configuration."""

import hashlib
import re
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENCV_VENDOR_DIR = "vendor/opencv"


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


def _prebuilt_opencv_wheel() -> Path:
    vendor = REPO_ROOT / OPENCV_VENDOR_DIR
    wheels = sorted(vendor.glob("opencv_python_headless-*.whl"))
    assert len(wheels) == 1, f"expected one prebuilt OpenCV wheel, found {wheels}"
    return wheels[0]


def _prebuilt_opencv_requirement() -> tuple[str, str]:
    text = _read_repo_file(f"{OPENCV_VENDOR_DIR}/requirements-opencv-prebuilt.txt")
    match = re.fullmatch(
        r"opencv-python-headless==(\S+) \\\n\s+--hash=sha256:([0-9a-f]{64})\n?", text
    )
    assert match, "requirements-opencv-prebuilt.txt must pin one version and one hash"
    return match.group(1), match.group(2)


def test_opencv_comes_from_the_prebuilt_hash_pinned_wheel():
    """Install OpenCV from the prebuilt FFmpeg-free wheel, offline and hash-pinned."""
    dockerfile = _read_repo_file("Dockerfile")
    pyproject = _read_repo_file("pyproject.toml")

    assert f"{OPENCV_VENDOR_DIR}/requirements-opencv-prebuilt.txt" in dockerfile
    assert f"{OPENCV_VENDOR_DIR}/opencv_python_headless-*.whl" in dockerfile
    for flag in ("--no-index", "--find-links", "--require-hashes", "--no-deps"):
        assert flag in dockerfile
    # The image build no longer compiles OpenCV; the recipe lives with the wheel.
    assert "AS opencv-build" not in dockerfile
    assert "WITH_FFMPEG" not in dockerfile
    # An unpinned install in the base stage leaks the GUI opencv-python (and its
    # FFmpeg) into the shipped image, because COPY --from never deletes files.
    assert "pip install --no-cache-dir ultralytics" not in dockerfile
    # The GUI distribution bundles its own FFmpeg and shares the cv2 directory.
    assert "opencv-python; sys_platform == 'never'" in pyproject


def test_prebuilt_opencv_wheel_matches_lockfile_and_pinned_hash():
    """Keep the wheel, its requirements line, SHA256SUMS and uv.lock in step."""
    wheel = _prebuilt_opencv_wheel()
    locked = _locked_version("opencv-python-headless")
    version, pinned_hash = _prebuilt_opencv_requirement()
    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    sums = _read_repo_file(f"{OPENCV_VENDOR_DIR}/SHA256SUMS").split()

    assert wheel.name.startswith(f"opencv_python_headless-{locked}-cp311-")
    assert wheel.name.endswith("linux_x86_64.whl")
    assert version == locked
    assert pinned_hash == digest
    assert sums == [digest, wheel.name]


def test_prebuilt_opencv_wheel_ships_no_ffmpeg_or_codec_libraries():
    """Keep FFmpeg, its codecs and the old OpenSSL out of the prebuilt wheel."""
    with zipfile.ZipFile(_prebuilt_opencv_wheel()) as wheel:
        names = wheel.namelist()

    assert not [n for n in names if ".libs/" in n]
    forbidden = re.compile(
        r"libav|libsw|ffmpeg|libvpx|libaom|libdav1d|libssl|libcrypto", re.IGNORECASE
    )
    assert not [n for n in names if forbidden.search(n)]
    assert "cv2/cv2.abi3.so" in names


def test_opencv_rebuild_recipe_pins_source_and_disables_ffmpeg():
    """Keep the recipe that regenerates the wheel pinned and FFmpeg-free."""
    recipe = _read_repo_file(f"{OPENCV_VENDOR_DIR}/Dockerfile.build")

    assert f"ARG OPENCV_VERSION={_locked_version('opencv-python-headless')}" in recipe
    assert re.search(r"ARG OPENCV_SDIST_SHA256=[0-9a-f]{64}", recipe)
    assert 'CMAKE_ARGS="-DWITH_FFMPEG=OFF"' in recipe
    assert "--no-binary opencv-python-headless" in recipe
    assert "--require-hashes" in recipe


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
    # PyPI OpenCV wheel that bundles FFmpeg, replacing the prebuilt wheel the
    # Dockerfile installs.
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


def test_compose_and_manifest_images_use_fully_qualified_names():
    """Podman without unqualified-search registries rejects short names like postgres:15."""
    for relative_path in (
        "docker-compose.yml",
        "docker-compose.dev.yml",
        "docker-compose.test.yml",
        "deployment-test/postgres.yaml",
        "deployment-test/minio.yaml",
    ):
        for image in re.findall(r"^\s*image:\s*(\S+)", _read_repo_file(relative_path), re.MULTILINE):
            registry = image.split("/", 1)[0]
            assert "/" in image and ("." in registry or ":" in registry), f"{relative_path}: {image}"
