"""Pagination helpers for image listing."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime

from services.errors import ValidationFailedError


def encode_image_page_cursor(created_at: datetime, image_id: uuid.UUID) -> str:
    """Encode a stable image-list keyset cursor."""
    normalized_created_at = (
        created_at.replace(tzinfo=UTC)
        if created_at.tzinfo is None
        else created_at.astimezone(UTC)
    )
    payload = json.dumps(
        {"v": 1, "created_at": normalized_created_at.isoformat(), "id": str(image_id)},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_image_page_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Decode and validate an image-list keyset cursor."""
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError("invalid cursor length")
        padded = cursor + ("=" * (-len(cursor) % 4))
        raw = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        payload = json.loads(raw.decode("utf-8"))
        if (
            not isinstance(payload, dict)
            or set(payload) != {"v", "created_at", "id"}
            or payload.get("v") != 1
        ):
            raise ValueError("invalid cursor payload")
        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            raise ValueError("cursor timestamp must include a UTC offset")
        created_at = created_at.astimezone(UTC)
        image_id = uuid.UUID(payload["id"])
    except (TypeError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid image page cursor") from exc
    return created_at, image_id


def parse_optional_image_page_cursor(
    cursor: str | None,
) -> tuple[datetime | None, uuid.UUID | None]:
    """Decode an optional request cursor, rejecting malformed values with 400."""
    if cursor is None:
        return None, None
    try:
        return decode_image_page_cursor(cursor)
    except ValueError as exc:
        raise ValidationFailedError("Invalid image page cursor") from exc
