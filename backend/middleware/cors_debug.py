"""
CORS and Debug middleware configuration for FastAPI application.
"""

import time
import traceback
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings


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
    """Debug middleware to catch exceptions and print debug information."""
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        print(f"Request: {request.method} {request.url.path} completed in {process_time:.4f}s")
        return response
    except Exception as e:
        process_time = time.time() - start_time
        print(f"ERROR in {request.method} {request.url.path} after {process_time:.4f}s: {type(e).__name__}: {str(e)}")
        # Avoid dumping headers/body in non-dev logs
        if settings.DEBUG:
            print(f"Traceback: {traceback.format_exc()}")
        raise  # Re-raise the exception for FastAPI to handle
