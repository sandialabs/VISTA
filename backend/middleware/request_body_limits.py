"""Small, route-scoped request-body limits for metadata-backed annotations."""

from __future__ import annotations

import re

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

INSPECTION_ANNOTATION_REQUEST_MAX_BYTES = 8 * 1024 * 1024

_ANNOTATION_MUTATION_PATH = re.compile(
    r"^/api/projects/[^/]+/parts/[^/]+/annotations(?:/([^/]+))?/?$"
)


class _AnnotationRequestBodyTooLarge(Exception):
    pass


class InspectionAnnotationBodyLimitMiddleware:
    """Reject oversized annotation POST/PATCH bodies before model parsing.

    The aggregate annotation document has a separate persisted-size limit. This
    middleware protects the JSON parser itself, including requests that omit or
    forge ``Content-Length`` by counting streamed ASGI body chunks.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_body_bytes: int = INSPECTION_ANNOTATION_REQUEST_MAX_BYTES,
    ) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    @staticmethod
    def _is_limited_request(scope: Scope) -> bool:
        match = _ANNOTATION_MUTATION_PATH.fullmatch(str(scope.get("path") or ""))
        if match is None:
            return False
        annotation_id = match.group(1)
        method = str(scope.get("method") or "").upper()
        return (method == "POST" and annotation_id is None) or (
            method == "PATCH" and annotation_id is not None
        )

    def _too_large_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=413,
            content={
                "detail": (
                    "Annotation request body exceeds the built-in limit of "
                    f"{self.max_body_bytes} bytes"
                )
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or not self._is_limited_request(scope):
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except (TypeError, ValueError):
                declared_size = 0
            if declared_size > self.max_body_bytes:
                await self._too_large_response()(scope, receive, send)
                return

        observed_size = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal observed_size
            message = await receive()
            if message.get("type") == "http.request":
                observed_size += len(message.get("body", b""))
                if observed_size > self.max_body_bytes:
                    raise _AnnotationRequestBodyTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _AnnotationRequestBodyTooLarge:
            if response_started:
                raise
            await self._too_large_response()(scope, receive, send)
