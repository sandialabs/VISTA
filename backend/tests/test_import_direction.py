"""Imports point from routers to services, never back.

Services, repositories, and utilities must not import router modules; routers
call into them. A reverse import recreates the router compatibility-wrapper
layer that existed only to give services callbacks into router internals.
"""

import ast
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
LOWER_LAYERS = ("services", "repositories", "utils")


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.append(node.module)
    return modules


@pytest.mark.parametrize("layer", LOWER_LAYERS)
def test_lower_layers_never_import_routers(layer):
    offenders = sorted(
        f"{path.relative_to(BACKEND_DIR)}: {module}"
        for path in (BACKEND_DIR / layer).rglob("*.py")
        for module in _imported_modules(path)
        if module == "routers" or module.startswith(("routers.", "backend.routers"))
    )
    assert offenders == []


def test_legacy_compatibility_modules_are_gone():
    assert not (BACKEND_DIR / "utils" / "crud.py").exists()
    assert not (BACKEND_DIR / "core" / "schemas.py").exists()
