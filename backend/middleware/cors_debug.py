"""
CORS and Debug middleware configuration for FastAPI application.
"""

import logging
import time
import traceback

from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings

logger = logging.getLogger(__name__)


def add_cors_middleware(app, cors_origins: list[str]):
    """Add CORS middleware to the FastAPI app."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cors_origins if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


async def debug_exception_middleware(request: Request, call_next):
    """Debug middleware to catch exceptions and log debug information."""
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.debug(
            "Request %s %s completed in %.4fs",
            request.method,
            request.url.path,
            process_time,
        )
        return response
    except Exception as e:
        process_time = time.time() - start_time
        logger.error(
            "Error in %s %s after %.4fs: %s: %s",
            request.method,
            request.url.path,
            process_time,
            type(e).__name__,
            str(e),
        )
        # Avoid dumping headers/body in non-dev logs
        if settings.DEBUG:
            logger.debug("Traceback: %s", traceback.format_exc())
        raise  # Re-raise the exception for FastAPI to handle
