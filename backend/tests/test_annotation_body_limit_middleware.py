from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from middleware.request_body_limits import (
    INSPECTION_ANNOTATION_REQUEST_MAX_BYTES,
    InspectionAnnotationBodyLimitMiddleware,
)


async def _consume_body(request: Request):
    body = await request.body()
    return JSONResponse({"size": len(body)})


def _limited_test_client(*, max_body_bytes: int = 8) -> TestClient:
    app = Starlette(
        routes=[
            Route(
                "/api/projects/{project_id}/parts/{part_id}/annotations",
                _consume_body,
                methods=["POST"],
            ),
            Route(
                "/api/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
                _consume_body,
                methods=["PATCH"],
            ),
            Route("/api/unrelated", _consume_body, methods=["POST"]),
        ]
    )
    app.add_middleware(
        InspectionAnnotationBodyLimitMiddleware,
        max_body_bytes=max_body_bytes,
    )
    return TestClient(app)


def test_annotation_body_limit_accepts_exact_boundary_and_is_route_scoped():
    with _limited_test_client() as client:
        exact = client.post(
            "/api/projects/project/parts/part/annotations",
            content=b"12345678",
        )
        unrelated = client.post("/api/unrelated", content=b"123456789")

    assert exact.status_code == 200
    assert exact.json() == {"size": 8}
    assert unrelated.status_code == 200
    assert unrelated.json() == {"size": 9}


def test_annotation_body_limit_rejects_declared_and_streamed_overflow():
    with _limited_test_client() as client:
        declared = client.post(
            "/api/projects/project/parts/part/annotations",
            content=b"{}",
            headers={"content-length": "9"},
        )
        streamed = client.patch(
            "/api/projects/project/parts/part/annotations/annotation",
            content=iter((b"1234", b"56789")),
        )

    for response in (declared, streamed):
        assert response.status_code == 413
        assert response.json() == {
            "detail": "Annotation request body exceeds the built-in limit of 8 bytes"
        }


def test_application_rejects_oversized_annotation_body_before_path_or_model_validation(
    client,
):
    response = client.post(
        "/api/projects/not-a-uuid/parts/not-a-uuid/annotations",
        content=b"{",
        headers={
            "content-type": "application/json",
            "content-length": str(INSPECTION_ANNOTATION_REQUEST_MAX_BYTES + 1),
        },
    )

    assert response.status_code == 413
    assert response.json()["detail"] == (
        "Annotation request body exceeds the built-in limit of "
        f"{INSPECTION_ANNOTATION_REQUEST_MAX_BYTES} bytes"
    )
