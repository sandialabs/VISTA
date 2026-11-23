"""Resolve NCR failure and disposition codes against the project config."""

from __future__ import annotations

from pydantic import ValidationError

from schemas import inspection_workspace as workspace_schemas
from services.errors import UnprocessableError
from services.inspection import workspace as workspace_service


class NcrCodeError(UnprocessableError, ValueError):
    """Raised when a failure or disposition code is not configured."""


async def configured_codes(*, db, project) -> dict[str, dict[str, str]]:
    """Return configured codes keyed by list name, then casefolded code."""
    resolved = await workspace_service.get_project_configuration(
        db=db, project_id=project.id, project=project
    )
    ncr_config = resolved["config"].get("ncr_configuration")
    ncr_config = ncr_config if isinstance(ncr_config, dict) else {}
    result: dict[str, dict[str, dict]] = {}
    for list_name in ("failure_codes", "disposition_codes"):
        entries = ncr_config.get(list_name)
        by_code: dict[str, dict] = {}
        for entry in entries if isinstance(entries, list) else []:
            # Stored config can be written through the generic metadata API
            # without schema validation, so re-validate every entry; invalid
            # ones (wrong types, oversized, control characters) are unusable.
            try:
                valid = workspace_schemas.InspectionProjectNcrCodeConfig.model_validate(
                    entry
                )
            except ValidationError:
                continue
            by_code.setdefault(
                valid.code.casefold(),
                {"code": valid.code, "description": valid.description},
            )
        result[list_name] = by_code
    return result


def resolve_code(codes: dict, list_name: str, value: str, label: str) -> dict:
    """Return the configured entry for ``value`` or raise ``NcrCodeError``."""
    entry = codes.get(list_name, {}).get(value.strip().casefold())
    if entry is None:
        raise NcrCodeError(
            f"{label} '{value}' is not configured for this project. "
            "Add it under Project Configuration > NCR Configuration."
        )
    return entry
