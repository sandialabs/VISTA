import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_python_package_discovery_is_backend_only_for_editable_installs():
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text())

    package_find = pyproject["tool"]["setuptools"]["packages"]["find"]

    assert package_find["include"] == ["backend*"]
    assert "frontend*" in package_find["exclude"]
    assert "docs*" in package_find["exclude"]


def test_pyproject_exposes_pip_installable_dev_extra():
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text())

    dev_extra = pyproject["project"]["optional-dependencies"]["dev"]

    assert "pytest" in dev_extra
    assert "pytest-asyncio" in dev_extra
    assert "aiosqlite" in dev_extra


def test_testing_strategy_documents_required_layers_and_critical_user_stories():
    strategy = (REPO_ROOT / "docs" / "testing-strategy.md").read_text()

    required_sections = [
        "Backend unit and API integration",
        "Frontend unit/component",
        "Frontend end-to-end",
        "User-story coverage matrix",
        "Red-team robustness checklist",
        "Done criteria for test refactors",
    ]
    for section in required_sections:
        assert section in strategy

    critical_user_stories = [
        "Create, list, archive, and summarize projects",
        "Upload, browse, group, and delete images",
        "Inspect images and preserve visual measurement accuracy",
        "Run analysis overlays and segmentation workflows",
        "Manage metadata, calibration, exports, and reports",
        "Authenticate users, groups, and API keys securely",
    ]
    for user_story in critical_user_stories:
        assert user_story in strategy
