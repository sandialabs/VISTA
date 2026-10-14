"""Source contracts for deprecated APIs that previously escaped CI."""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_STATUS_ALIASES = {
    "HTTP_413_REQUEST_ENTITY_TOO_LARGE",
    "HTTP_422_UNPROCESSABLE_ENTITY",
}


def _production_python_files() -> list[Path]:
    return [
        path
        for path in sorted(BACKEND_ROOT.rglob("*.py"))
        if "tests" not in path.relative_to(BACKEND_ROOT).parts
    ]


def test_production_backend_avoids_deprecated_http_status_aliases() -> None:
    violations: list[str] = []

    for path in _production_python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            identifier = None
            if isinstance(node, ast.Attribute):
                identifier = node.attr
            elif isinstance(node, ast.Name):
                identifier = node.id
            elif isinstance(node, ast.alias):
                identifier = node.name
            if identifier in FORBIDDEN_STATUS_ALIASES:
                relative_path = path.relative_to(BACKEND_ROOT.parent)
                violations.append(
                    f"{relative_path}:{getattr(node, 'lineno', 1)}: {identifier}"
                )

    assert not violations, (
        "Replace deprecated HTTP status aliases with "
        "HTTP_413_CONTENT_TOO_LARGE or HTTP_422_UNPROCESSABLE_CONTENT:\n"
        + "\n".join(violations)
    )
