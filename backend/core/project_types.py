"""Central project type constants for VISTA.

The canonical values are persisted/API contract values. User-facing deployment labels
are centralized in ``frontend/src/projectTypes.js``.
"""

PROJECT_TYPES = ("PT1", "PT2", "PT3")
DEFAULT_PROJECT_TYPE = PROJECT_TYPES[0]
PROJECT_TYPE_PATTERN = r"^(PT1|PT2|PT3)$"


def normalize_project_type(project_type: str | None) -> str:
    normalized = str(project_type or DEFAULT_PROJECT_TYPE).strip().upper()
    return normalized if normalized in PROJECT_TYPES else DEFAULT_PROJECT_TYPE
