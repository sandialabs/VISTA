"""Security headers middleware with config-based toggles.

Sets common security headers:
 - Content-Security-Policy (CSP)
 - X-Frame-Options (XFO)
 - X-Content-Type-Options: nosniff
 - Referrer-Policy

Each header is individually togglable via settings. HSTS is intentionally omitted.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from starlette.responses import Response
from fastapi import Request
import secrets
import logging
from core.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # X-Content-Type-Options
        if getattr(settings, "SECURITY_NOSNIFF_ENABLED", True):
            if "X-Content-Type-Options" not in response.headers:
                response.headers["X-Content-Type-Options"] = "nosniff"

        # X-Frame-Options
        if getattr(settings, "SECURITY_XFO_ENABLED", True):
            xfo_value = getattr(settings, "SECURITY_XFO_VALUE", "SAMEORIGIN")
            if "X-Frame-Options" not in response.headers:
                response.headers["X-Frame-Options"] = xfo_value

        # Referrer-Policy
        if getattr(settings, "SECURITY_REFERRER_POLICY_ENABLED", True):
            ref_value = getattr(
                settings, "SECURITY_REFERRER_POLICY_VALUE", "no-referrer"
            )
            if "Referrer-Policy" not in response.headers:
                response.headers["Referrer-Policy"] = ref_value

        # Content-Security-Policy
        if getattr(settings, "SECURITY_CSP_ENABLED", True):
            csp_value = getattr(settings, "SECURITY_CSP_VALUE", None)

            # If requesting FastAPI docs or OpenAPI assets, relax CSP to allow required CDNs
            path = request.url.path
            if path.startswith("/docs") or path.startswith("/redoc") or path == "/openapi.json":
                # Generate a nonce for any inline scripts FastAPI docs might use
                nonce = secrets.token_hex(16)
                # Store nonce in request state for potential template usage (if needed later)
                try:
                    request.state.csp_nonce = nonce  # type: ignore[attr-defined]
                except Exception as exc:
                    logging.warning("Could not set CSP nonce on request state: %s", exc)
                # Allow jsdelivr for swagger ui assets, and fastapi.tiangolo.com images
                relaxed_csp = (
                    "default-src 'self'; "
                    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                    "img-src 'self' data: https://fastapi.tiangolo.com; "
                    "font-src 'self' data:; "
                    "connect-src 'self'; "
                    "frame-ancestors 'none';"
                )
                response.headers["Content-Security-Policy"] = relaxed_csp
            else:
                if csp_value and "Content-Security-Policy" not in response.headers:
                    response.headers["Content-Security-Policy"] = csp_value

        return response