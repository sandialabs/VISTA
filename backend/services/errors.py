"""Domain errors raised by services and mapped to HTTP once in ``main.py``.

Services raise these instead of FastAPI's HTTP exception so they stay
framework-independent. Each error carries an HTTP status and a client-safe
``detail``; the exception handler registered in ``main.py`` turns any
``ServiceError`` into the same JSON shape as every other HTTP error.
Never put internal paths, bucket names, or raw exception text in ``detail``.
"""

from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """Base class for errors with a client-safe detail and an HTTP status."""

    status_code: int = 500
    default_detail: str = "Unexpected server error."
    headers: dict[str, str] | None = None

    def __init__(
        self,
        detail: Any = None,
        *,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ):
        """Store the client-safe detail, status code, and optional headers."""
        self.detail = self.default_detail if detail is None else detail
        if status_code is not None:
            self.status_code = status_code
        if headers is not None:
            self.headers = headers
        super().__init__(self.detail if isinstance(self.detail, str) else "")

    def __str__(self) -> str:
        """Return the string detail, or the base representation otherwise."""
        return self.detail if isinstance(self.detail, str) else super().__str__()


class ValidationFailedError(ServiceError):
    """Raised when request data fails validation."""

    status_code = 400
    default_detail = "Invalid request."


class ForbiddenError(ServiceError):
    """Raised when the caller lacks access to the requested resource."""

    status_code = 403
    default_detail = "Access forbidden"


class NotFoundError(ServiceError):
    """Raised when the requested resource does not exist."""

    status_code = 404
    default_detail = "Not found"


class ConflictError(ServiceError):
    """Raised when the request conflicts with the current resource state."""

    status_code = 409
    default_detail = "Conflict"


class GoneError(ServiceError):
    """Raised when the requested resource no longer exists."""

    status_code = 410
    default_detail = "Gone"


class PayloadTooLargeError(ServiceError):
    """Raised when the request payload exceeds the allowed size."""

    status_code = 413
    default_detail = "Payload too large"


class UnprocessableError(ServiceError):
    """Raised when the request is well-formed but cannot be processed."""

    status_code = 422
    default_detail = "Unprocessable request."


class CapacityError(ServiceError):
    """Raised when too many concurrent requests exhaust available capacity."""

    status_code = 429
    default_detail = "Too many concurrent requests"
    headers = {"Retry-After": "1"}


class UpstreamError(ServiceError):
    """Raised when a dependent upstream service returns an error."""

    status_code = 502
    default_detail = "Upstream service error"


class ServiceUnavailableError(ServiceError):
    """Raised when the service is temporarily unable to handle requests."""

    status_code = 503
    default_detail = "Service temporarily unavailable"


class UpstreamTimeoutError(ServiceError):
    """Raised when a dependent upstream service times out."""

    status_code = 504
    default_detail = "Upstream request timed out"
