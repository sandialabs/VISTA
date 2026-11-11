"""Contract tests for extra CA certificate support in the dev container build."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLE = "/etc/pki/tls/certs/ca-bundle.crt"


def _read_repo_file(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def _base_stage(dockerfile: str) -> str:
    return dockerfile.split("FROM base AS", 1)[0]


def test_dev_dockerfile_trusts_extra_cas_before_any_network_fetch():
    """Extra CAs must be installed before microdnf, pip, uv, or npm reach the network."""
    base = _base_stage(_read_repo_file("Dockerfile.dev"))

    trust_step = base.index("update-ca-trust extract")
    assert base.index("COPY certs/ /tmp/extra-ca/") < trust_step
    assert trust_step < base.index("microdnf install")
    assert trust_step < base.index("pip install")
    assert trust_step < base.index("uv sync")


def test_dev_dockerfile_points_https_clients_at_system_bundle():
    """pip, uv, requests, and Node must all use the system trust store."""
    base = _base_stage(_read_repo_file("Dockerfile.dev"))

    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "PIP_CERT", "NODE_EXTRA_CA_CERTS"):
        assert f"{var}={BUNDLE}" in base, var
    assert "UV_NATIVE_TLS=true" in base


def test_dev_build_files_never_disable_tls_verification():
    """TLS errors are fixed with CA injection, never by skipping verification."""
    files = (
        "Dockerfile.dev",
        "docker-compose.dev.yml",
        "scripts/dev.sh",
        "Dockerfile",
        "vendor/opencv/Dockerfile.build",
        "scripts/build_image.sh",
        "scripts/check_image_ca.sh",
    )
    checked = "\n".join(
        line
        for path in files
        for line in _read_repo_file(path).splitlines()
        if not line.lstrip().startswith("#")
    )

    for pattern in (
        r"--trusted-host",
        r"--insecure\b",
        r"strict-ssl",
        r"--no-check-certificate",
        r"\bcurl\s+(-\w*k|--insecure)\b",
        r"NODE_TLS_REJECT_UNAUTHORIZED",
        r"UV_INSECURE_HOST|--allow-insecure-host",
    ):
        assert not re.search(pattern, checked), pattern


def test_certs_staging_directory_is_tracked_but_contents_are_ignored():
    """The build context needs certs/, but certificates must never be committed."""
    gitignore = _read_repo_file(".gitignore").splitlines()

    assert (REPO_ROOT / "certs" / ".gitkeep").is_file()
    assert "certs/*" in gitignore
    assert "!certs/.gitkeep" in gitignore


def test_dev_services_bypass_host_proxy_for_in_network_hosts():
    """Podman injects host proxy vars; service-to-service HTTP must not go through them."""
    compose = _read_repo_file("docker-compose.dev.yml")

    for line in ("- NO_PROXY=", "- no_proxy="):
        values = [entry for entry in compose.splitlines() if entry.strip().startswith(line)]
        assert len(values) >= 2, line
        for entry in values:
            for host in ("minio", "postgres", "backend-dev"):
                assert host in entry.split("=", 1)[1].split(","), (line, host)
