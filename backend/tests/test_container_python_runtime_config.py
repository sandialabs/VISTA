"""Contract tests for the minimal runtime root filesystem and the bundled CPython."""

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

ROOTFS_PACKAGES = {
    "glibc",
    "glibc-minimal-langpack",
    "bash",
    "coreutils-single",
    "libstdc++",
    "libgcc",
    "zlib",
    "ca-certificates",
    "tzdata",
}
# The packages behind the 31 High findings of the former ubi-minimal base.
HIGH_FINDING_PACKAGES = (
    "krb5-libs",
    "sqlite-libs",
    "expat",
    "json-glib",
    "libblkid",
    "libmount",
    "libsmartcols",
    "libuuid",
    "python3.11",
    "microdnf",
)
PBS_ARGS = ("PBS_RELEASE", "PBS_PYTHON", "PBS_SHA256")


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def _instructions(dockerfile: str, name: str) -> str:
    stages = re.split(r"^(?=FROM )", dockerfile, flags=re.MULTILINE)
    matches = [s for s in stages if re.match(rf"FROM \S+ AS {name}\s*$", s.splitlines()[0])]
    assert len(matches) == 1, f"expected one stage named {name}"
    return "\n".join(
        line for line in matches[0].splitlines() if not line.lstrip().startswith("#")
    )


def _dnf_install_packages(stage: str) -> set[str]:
    command = re.search(r"dnf install (.*?)&&", stage, flags=re.S)
    assert command, "expected a dnf install command"
    words = command.group(1).replace("\\", " ").split()
    return {word for word in words if not word.startswith("-")}


def test_runtime_rootfs_installs_exactly_the_allowlist():
    """The runtime OS is a fixed package list; base itself installs nothing."""
    dockerfile = _read("Dockerfile")
    rootfs = _instructions(dockerfile, "rootfs")
    assert _dnf_install_packages(rootfs) == ROOTFS_PACKAGES
    assert "--installroot=/rootfs" in rootfs
    assert "--disablerepo='*' --enablerepo=ubi-9-baseos-rpms" in rootfs
    deny_loop = re.search(r"for denied in (.*?);", rootfs, flags=re.S)
    assert deny_loop
    assert set(HIGH_FINDING_PACKAGES) <= set(deny_loop.group(1).replace("\\", " ").split())
    assert "exit 1" in rootfs
    base = _instructions(dockerfile, "base")
    assert base.startswith("FROM scratch AS base")
    assert not re.search(r"^RUN ", base, flags=re.MULTILINE)
    assert "COPY --from=rootfs /rootfs /" in base
    assert "COPY --from=python /opt/python /opt/python" in base


def test_runtime_rootfs_skips_weak_dependencies_and_keeps_ldconfig():
    """Weak dependencies would ship; ldconfig is needed by the NVIDIA CDI hook."""
    rootfs = _instructions(_read("Dockerfile"), "rootfs")
    assert "--setopt=install_weak_deps=0" in re.search(r"dnf install (.*?)&&", rootfs, re.S)[1]
    assert "test -x /rootfs/usr/sbin/ldconfig" in rootfs
    assert "ldconfig -r /rootfs" in rootfs
    assert re.search(r"^ARG OS_REFRESH=", rootfs, flags=re.MULTILINE)
    assert "${OS_REFRESH" in rootfs


def test_python_is_a_hash_pinned_standalone_build_without_pip():
    """CPython comes from python-build-standalone, verified, with pip and Tk removed."""
    dockerfile = _read("Dockerfile")
    python = _instructions(dockerfile, "python")
    assert re.search(r"^ARG PBS_RELEASE=\d{8}$", python, flags=re.MULTILINE)
    assert re.search(r"^ARG PBS_PYTHON=3\.14\.\d+$", python, flags=re.MULTILINE)
    assert re.search(r"^ARG PBS_SHA256=[0-9a-f]{64}$", python, flags=re.MULTILINE)
    assert "sha256sum -c -" in python
    assert "install_only_stripped.tar.gz" in python
    for pruned in ("bin/pip*", "site-packages/pip*", "ensurepip", "idlelib", "tkinter"):
        assert pruned in python, pruned
    assert "uv venv --python /opt/python/bin/python3.14 /opt/venv" in dockerfile


def test_dev_image_uses_the_same_python_build():
    """Dev and production run the same CPython build."""
    production, dev = _read("Dockerfile"), _read("Dockerfile.dev")
    for arg in PBS_ARGS:
        value = re.search(rf"^ARG {arg}=(\S+)$", production, flags=re.MULTILINE)
        assert value, arg
        assert f"ARG {arg}={value.group(1)}" in dev, arg
    assert "python3.11" not in dev
    assert "ENV CC=gcc CXX=g++" in dev


def test_base_sets_its_own_path_and_certificate_bundle():
    """scratch has no PATH, and the bundled OpenSSL must find the system CA bundle."""
    base = _instructions(_read("Dockerfile"), "base")
    path = re.search(r"PATH=(\S+)", base)
    assert path
    entries = path.group(1).split(":")
    assert entries[0] == "/opt/venv/bin"
    assert {"/usr/bin", "/bin", "/usr/sbin"} <= set(entries)
    assert "" not in entries and "." not in entries
    assert "SSL_CERT_FILE=/etc/pki/tls/certs/ca-bundle.crt" in base
    assert "LANG=C.UTF-8" in base


def test_final_stage_checks_use_python_not_shell_tools():
    """final verifies FFmpeg absence and CA loading in Python, and needs no find or grep."""
    final = _instructions(_read("Dockerfile"), "final")
    assert not re.search(r"\b(find|grep|awk|sed)\b", final)
    assert "FFMPEG" in final
    assert "cert_store_stats()['x509_ca'] > 0" in final
    assert "import torch, ultralytics, segment_anything, anomalib.models" in final
    assert "/usr/bin/false" in final and "/sbin/nologin" not in final
    assert "chmod 1777 /tmp" in final
    # Uploaded YOLO checkpoints must not be fully unpickled.
    assert "ENV ULTRALYTICS_SAFE_LOAD=1" in final
    assert "ENV ULTRALYTICS_SAFE_LOAD=1" in _read("Dockerfile.dev")


def test_ci_refreshes_the_rootfs_weekly_with_one_value_for_every_build():
    """Every image build in a workflow passes the same OS_REFRESH, so caches line up."""
    for workflow in ("docker-image.yml", "container-scan-trivy.yml"):
        text = _read(f".github/workflows/{workflow}")
        builds = text.count("docker/build-push-action@")
        assert builds >= 1, workflow
        values = re.findall(r"OS_REFRESH=(\S+)", text)
        assert len(values) == builds, workflow
        assert len(set(values)) == 1, workflow
        assert "date -u +%G-W%V" in text, workflow


def test_build_and_ca_check_scripts_parse_and_document_usage():
    """Keep the image build helper and the CA leak check runnable."""
    for name, expected in (
        ("build_image.sh", ("--target", "VISTA_EXTRA_CA_FILE", "OS_REFRESH")),
        ("check_image_ca.sh", ("IMAGE", "CA_FILE")),
    ):
        script = REPO_ROOT / "scripts" / name
        subprocess.run(["bash", "-n", str(script)], check=True)
        help_text = subprocess.run(
            ["bash", str(script), "--help"], check=True, capture_output=True, text=True
        ).stdout
        for word in expected:
            assert word in help_text, (name, word)
