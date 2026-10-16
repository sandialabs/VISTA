"""Characterization tests for the single ``ServiceError`` to HTTP mapping.

Services raise ``services.errors`` types instead of HTTP exceptions; ``main.py``
maps them to the same ``{"detail", "error_context"}`` shape every other HTTP
error uses, including status-specific headers such as ``Retry-After``.
"""

import io
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import APIRouter
from PIL import Image

from main import app
from services import errors
from services.images import volumes as image_volume_service
from services.inspection.annotations import AnnotationLimitError
from services.inspection.batches import BatchNotFoundError
from services.inspection.parts import PartNotFoundError

SERVICES_DIR = Path(__file__).resolve().parents[1] / "services"

_probe_router = APIRouter()
_probe_errors: dict[str, Exception] = {}


@_probe_router.get("/api/__service_error_probe/{name}")
async def _service_error_probe(name: str):
    raise _probe_errors[name]


app.include_router(_probe_router)


def _probe(client, name, exc):
    _probe_errors[name] = exc
    return client.get(f"/api/__service_error_probe/{name}")


@pytest.mark.parametrize(
    ("exc", "status_code", "detail"),
    [
        (errors.ValidationFailedError("bad input"), 400, "bad input"),
        (errors.ForbiddenError(), 403, "Access forbidden"),
        (PartNotFoundError(), 404, "Inspection part not found"),
        (BatchNotFoundError(), 404, "Inspection batch not found"),
        (errors.ConflictError("taken"), 409, "taken"),
        (AnnotationLimitError("too many"), 422, "too many"),
        (errors.UpstreamTimeoutError(), 504, "Upstream request timed out"),
    ],
)
def test_service_errors_map_to_http_error_shape(client, exc, status_code, detail):
    resp = _probe(client, type(exc).__name__, exc)

    assert resp.status_code == status_code
    body = resp.json()
    assert body["detail"] == detail
    assert body["error_context"]["status_code"] == status_code
    assert body["error_context"]["path"].startswith("/api/__service_error_probe/")


def test_capacity_error_sets_retry_after(client):
    exc = image_volume_service.VolumeConnectedSelectionCapacityError("busy")
    resp = _probe(client, "capacity", exc)

    assert resp.status_code == 429
    assert resp.headers["retry-after"] == "1"
    assert resp.json()["detail"] == "busy"
    assert isinstance(exc, RuntimeError)


def test_structured_detail_passes_through(client):
    resp = _probe(
        client, "structured", errors.UnprocessableError([{"loc": ["x"], "msg": "m"}])
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == [{"loc": ["x"], "msg": "m"}]


def test_services_do_not_import_fastapi():
    offenders = sorted(
        str(path.relative_to(SERVICES_DIR))
        for path in SERVICES_DIR.rglob("*.py")
        if "from fastapi" in (text := path.read_text(encoding="utf-8"))
        or "import fastapi" in text
        or "HTTPException" in text
    )
    assert offenders == []


def _create_project_with_image(client):
    resp = client.post(
        "/api/projects/",
        json={"name": "Service Error Project", "meta_group_id": "data-scientists"},
    )
    assert resp.status_code == 201, resp.text
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color=(1, 2, 3)).save(buffer, format="PNG")
    upload = client.post(
        f"/api/projects/{resp.json()['id']}/images",
        files={"file": ("e.png", io.BytesIO(buffer.getvalue()), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    return upload.json()["id"]


@pytest.mark.parametrize(
    ("side_effect", "status_code", "detail"),
    [
        (
            httpx.ReadTimeout("slow"),
            504,
            "Object storage request timed out",
        ),
        (
            httpx.ConnectError("refused at 10.0.0.1"),
            502,
            "Unable to retrieve image data from object storage",
        ),
    ],
)
def test_thumbnail_storage_failures_keep_client_safe_details(
    client, side_effect, status_code, detail
):
    image_id = _create_project_with_image(client)

    with (
        patch("services.images.thumbnails.httpx.AsyncClient") as mock_client,
        patch("routers.images._inline_image_bytes", return_value=None),
    ):
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=side_effect
        )
        resp = client.get(f"/api/images/{image_id}/thumbnail?width=20&height=20")

    assert resp.status_code == status_code
    assert resp.json()["detail"] == detail


def test_thumbnail_render_failure_hides_internal_text(client):
    image_id = _create_project_with_image(client)
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.aread = AsyncMock(return_value=b"not an image /internal/path")

    with (
        patch("services.images.thumbnails.httpx.AsyncClient") as mock_client,
        patch("routers.images._inline_image_bytes", return_value=None),
    ):
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=response
        )
        resp = client.get(f"/api/images/{image_id}/thumbnail?width=20&height=20")

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Error generating thumbnail"


def test_cached_thumbnail_still_requires_image_access(client):
    image_id = _create_project_with_image(client)
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buffer, format="PNG")
    with patch("routers.images._inline_image_bytes", return_value=buffer.getvalue()):
        first = client.get(f"/api/images/{image_id}/thumbnail?width=16&height=16")
    assert first.status_code == 200

    with patch("utils.dependencies.is_user_in_group", return_value=False):
        resp = client.get(f"/api/images/{image_id}/thumbnail?width=16&height=16")

    assert resp.status_code == 403


def test_thumbnail_rejects_non_positive_size(client):
    image_id = _create_project_with_image(client)
    resp = client.get(f"/api/images/{image_id}/thumbnail?width=0&height=10")

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Width and height must be positive integers"


def test_missing_thumbnail_image_is_404(client):
    resp = client.get(f"/api/images/{uuid.uuid4()}/thumbnail")
    assert resp.status_code == 404
