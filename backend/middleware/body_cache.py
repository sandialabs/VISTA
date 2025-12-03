"""
Middleware to cache request body for HMAC verification.

FastAPI consumes the request body when parsing Pydantic models,
so we need to cache it early in the middleware stack.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class BodyCacheMiddleware(BaseHTTPMiddleware):
    """Cache request body in request.state for later access."""

    async def dispatch(self, request: Request, call_next):
        # Only cache body for POST/PATCH/PUT requests
        if request.method in ("POST", "PATCH", "PUT"):
            # Read and cache the body
            body = await request.body()

            # Create a new receive function that returns the cached body
            async def receive():
                return {"type": "http.request", "body": body}

            # Replace the request's receive with our cached version
            request._receive = receive

            # Also store in request.state for easy access
            request.state.cached_body = body

        response = await call_next(request)
        return response
