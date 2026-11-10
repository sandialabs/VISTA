"""Contract tests for the production container build configuration."""

import hashlib
import re
import subprocess
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


def _dockerfile_stage(dockerfile: str, name: str) -> str:
    """Return the instructions of one named build stage."""
    stages = re.split(r"^(?=FROM )", dockerfile, flags=re.MULTILINE)
    matches = [
        stage
        for stage in stages
        if re.match(rf"FROM \S+ AS {re.escape(name)}\s*$", stage.splitlines()[0])
    ]
    assert len(matches) == 1, f"expected one stage named {name}"
    return matches[0]


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


def test_ci_container_steps_configure_the_group_auth_backend():
    """Give every CI container run a group-auth backend so the app can start."""
    workflow = _read_repo_file(".github/workflows/docker-image.yml")

    # The app refuses to start without VISTA_AUTH_BACKEND (the startup self-test
    # fails closed); the demo backend is the one allowed outside production.
    runs = workflow.count("docker run")
    assert runs >= 2
    assert workflow.count("-e VISTA_AUTH_BACKEND=demo") == runs


def test_frontend_is_built_in_its_own_node_stage():
    """Build the UI in a pinned Node 22 stage and ship only the bundle."""
    dockerfile = _read_repo_file("Dockerfile")
    ui = _dockerfile_stage(dockerfile, "ui")

    pinned_node_image = (
        r"^ARG UBI_NODEJS=registry\.access\.redhat\.com/ubi9/nodejs-22"
        r"@sha256:[0-9a-f]{64}"
    )
    assert re.search(pinned_node_image, dockerfile, flags=re.MULTILINE)
    assert "FROM ${UBI_NODEJS} AS ui" in dockerfile
    assert "RUN npm ci --no-audit --no-fund" in ui
    assert "RUN npm run build" in ui
    assert "COPY --from=ui /app/frontend/build /app/ui2" in dockerfile


def test_runtime_stages_carry_no_node_toolchain():
    """Keep Node, npm and the UI sources out of every Python stage."""
    dockerfile = _read_repo_file("Dockerfile")

    for name in ("base", "builder", "final"):
        stage = _dockerfile_stage(dockerfile, name)
        instructions = "\n".join(
            line for line in stage.splitlines() if not line.lstrip().startswith("#")
        )
        assert not re.search(r"\b(nodejs|npm)\b", instructions), name
        assert "COPY ./frontend" not in instructions, name
        assert "/app/frontend" not in instructions.replace(
            "COPY --from=ui /app/frontend/build /app/ui2", ""
        ), name


def test_runtime_base_installs_only_python_and_certificates():
    """Keep compilers, headers, git, wget and GUI libraries out of the runtime image."""
    base = _dockerfile_stage(_read_repo_file("Dockerfile"), "base")
    installed = re.search(r"microdnf install[^\n]*\\\n((?:.*\\\n)*.*)", base)
    assert installed, "base stage must install its packages with microdnf"
    packages = set(re.findall(r"[A-Za-z0-9_.+-]+", installed.group(1).replace("\\", " ")))
    packages.discard("microdnf")
    assert {"python3.11", "ca-certificates"} <= packages
    denied = re.compile(
        r"^(gcc|gcc-c\+\+|git|wget|gtk3|webkit.*|atk|at-spi2-atk|alsa-lib|cups-libs|pango"
        r"|libX.*|libxcb|libdrm|libgbm|.*-devel)$"
    )
    assert not [name for name in packages if denied.match(name)]


def test_sam_checkpoint_is_downloaded_in_its_own_stage_with_a_pinned_hash():
    """Download weights outside the runtime stages and verify them by SHA-256."""
    dockerfile = _read_repo_file("Dockerfile")
    stage = _dockerfile_stage(dockerfile, "checkpoints")
    assert re.search(r"ARG SAM_VIT_B_SHA256=[0-9a-f]{64}\b", stage)
    assert "sha256sum -c -" in stage
    assert "COPY --from=checkpoints /checkpoints /app/checkpoints" in dockerfile
    for name in ("base", "builder", "final"):
        instructions = "\n".join(
            line
            for line in _dockerfile_stage(dockerfile, name).splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "wget" not in instructions, name


def test_base_images_are_pinned_by_digest():
    """Pin both base images so rebuilds are reproducible and bumps are deliberate."""
    dockerfile = _read_repo_file("Dockerfile")
    for arg, repo in (
        ("UBI_MINIMAL", "ubi9/ubi-minimal"),
        ("UBI_NODEJS", "ubi9/nodejs-22"),
    ):
        assert re.search(
            rf"^ARG {arg}=registry\.access\.redhat\.com/{re.escape(repo)}@sha256:[0-9a-f]{{64}}$",
            dockerfile,
            flags=re.MULTILINE,
        ), arg
    assert "FROM ${UBI_MINIMAL} AS base" in dockerfile
    assert "FROM ${UBI_MINIMAL} AS checkpoints" in dockerfile
    assert not re.search(r"^FROM registry\.access\.redhat\.com/\S+(?<!\))\s", dockerfile, re.M)


def test_runtime_image_has_no_debugger_and_current_setuptools():
    """Keep debugpy out of the image and replace the OS-seeded setuptools."""
    instructions = "\n".join(
        line
        for line in _read_repo_file("Dockerfile").splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "debugpy" not in instructions
    assert re.search(r"pip install .*--upgrade pip setuptools uv", instructions)
    for package, minimum in (
        ("fastmcp", (3, 4, 10)),
        ("fastmcp-slim", (3, 4, 10)),
        ("opentelemetry-api", (1, 45, 1)),
        ("setuptools", (84, 1, 0)),
    ):
        version = tuple(int(part) for part in _locked_version(package).split("."))
        assert version >= minimum, package


def test_image_scan_script_parses_and_documents_its_usage():
    """Keep the image scan helper runnable and its usage documented."""
    script = REPO_ROOT / "scripts" / "scan_image.sh"

    assert script.is_file()
    subprocess.run(["bash", "-n", str(script)], check=True)
    help_text = subprocess.run(
        ["bash", str(script), "--help"], check=True, capture_output=True, text=True
    ).stdout
    for option in ("--out", "--compare", "--fail-on", "SCAN_CA_BUNDLE"):
        assert option in help_text


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
