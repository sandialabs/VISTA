"""The optional build CA (extra_ca secret) must never reach an image, git, or CI."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_FILES = ("Dockerfile", "vendor/opencv/Dockerfile.build")
# Stages that only download build inputs; nothing from their RUN mounts is copied out.
DOWNLOAD_STAGES = {"python", "checkpoints", "ui", "builder", "opencv-build"}
SHIPPED_STAGES = ("rootfs", "base", "final", "test", "release")


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def _stages(dockerfile: str) -> dict[str, str]:
    stages = {}
    for chunk in re.split(r"^(?=FROM )", dockerfile, flags=re.MULTILINE):
        match = re.match(r"FROM \S+ AS (\S+)", chunk)
        if match:
            stages[match.group(1)] = "\n".join(
                ln for ln in chunk.splitlines() if not ln.lstrip().startswith("#")
            )
    return stages


def test_secret_mounts_are_optional_and_only_in_download_stages():
    """Only download steps mount extra_ca; it is optional and never an env var."""
    seen = 0
    for build_file in BUILD_FILES:
        for name, stage in _stages(_read(build_file)).items():
            for mount in re.findall(r"--mount=type=secret[^\s\\]*", stage):
                seen += 1
                assert name in DOWNLOAD_STAGES, (build_file, name)
                assert mount == "--mount=type=secret,id=extra_ca", mount
    assert seen >= 5


def test_shipped_stages_never_reference_the_ca():
    """The CA path, the combined bundle and certs/ never appear where layers ship."""
    stages = _stages(_read("Dockerfile"))
    for name in SHIPPED_STAGES:
        for needle in ("extra_ca", "/run/secrets", "/run/ca"):
            assert needle not in stages[name], (name, needle)
        # The repository's certs/ directory is for the dev image only.
        assert not re.search(r"^COPY[^\n]*(\s|\./)certs/", stages[name], re.MULTILINE), name


def test_ca_bundle_is_never_persisted_or_copied():
    """No ENV points at the temporary bundle, and no certificate file is copied in."""
    for build_file in BUILD_FILES:
        text = "\n".join(
            ln for ln in _read(build_file).splitlines() if not ln.lstrip().startswith("#")
        )
        assert not re.search(r"^ENV[^\n]*/run/(ca|secrets)", text, flags=re.MULTILINE)
        assert not re.search(r"^COPY[^\n]*\.(pem|crt)\b", text, flags=re.MULTILINE)
        # The combined bundle lives on a tmpfs mount of the same RUN.
        for run in re.findall(r"^RUN --mount=type=secret.*?(?=^\S|\Z)", text, re.M | re.S):
            if "/run/ca/" in run:
                assert "--mount=type=tmpfs,target=/run/ca" in run


def test_ci_workflows_pass_no_build_secrets():
    """CI never receives the local CA; it builds without the secret."""
    for workflow in sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml")):
        text = workflow.read_text(encoding="utf-8")
        assert "extra_ca" not in text, workflow.name
        assert "VISTA_EXTRA_CA_FILE" not in text, workflow.name
        assert not re.search(r"^\s+secret(s|-files|-envs):", text, flags=re.MULTILINE)


@pytest.mark.skipif(shutil.which("git") is None, reason="needs git (not in the image)")
def test_no_certificate_or_key_is_tracked_and_certs_stays_ignored():
    """A local CA must never be committed (and so never pushed to GitHub)."""
    tracked = subprocess.run(
        ["git", "grep", "-lE", "^-----BEGIN (CERTIFICATE|[A-Z ]*PRIVATE KEY)-----$"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.split()
    assert tracked == [], tracked
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", "certs/local-proxy-ca.crt"],
        cwd=REPO_ROOT,
        check=False,
    )
    assert ignored.returncode == 0, "certs/* must stay gitignored"
    build_script = _read("scripts/build_image.sh")
    assert "must live outside the repository" in build_script
    assert "check_image_ca.sh" in build_script
