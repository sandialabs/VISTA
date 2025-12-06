import os
import json
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status, HTTPException, Depends
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from pydantic import ValidationError

from core.config import settings
import swagger_ui_bundle
from pathlib import Path
from core.database import create_db_and_tables
from core.migrations import run_migrations  # legacy no-op
from core.config import settings as _app_settings
from utils.boto3_client import boto3_client, ensure_bucket_exists
from middleware.cors_debug import add_cors_middleware, debug_exception_middleware
from middleware.auth import auth_middleware
from middleware.security_headers import SecurityHeadersMiddleware
from middleware.body_cache import BodyCacheMiddleware
from routers import projects, images, users, image_classes, comments, project_metadata, api_keys, ml_analyses


"""
FastAPI application with modular structure.
Separates app creation from runtime configuration.
"""


# Configure logging
def setup_logging():
    """Configure structured logging for the application."""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO
    
    # JSON formatter for structured logging
    class JSONFormatter(logging.Formatter):
        def format(self, record):
            log_entry = {
                'timestamp': self.formatTime(record, self.datefmt),
                'level': record.levelname,
                'logger': record.name,
                'message': record.getMessage(),
                'module': record.module,
                'function': record.funcName,
                'line': record.lineno
            }
            if record.exc_info:
                log_entry['exception'] = self.formatException(record.exc_info)
            return json.dumps(log_entry)
    
    # Setup root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Remove default handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create JSON formatter
    formatter = JSONFormatter()
    
    # Add console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Add file handler for app.json
    log_file_path = os.path.join(os.getcwd(), "logs", "app.json")
    os.makedirs(os.path.dirname(log_file_path), exist_ok=True)
    file_handler = logging.FileHandler(log_file_path)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
    
    return logging.getLogger(__name__)


# Initialize logger
logger = setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Application startup...")
    if settings.FAST_TEST_MODE:
        logger.info("FAST_TEST_MODE enabled: skipping DB table creation and S3 bucket checks.")
    else:
        # NOTE: Database migrations are NOT run automatically on startup.
        # Run migrations manually using: ./start.sh -m or alembic upgrade head
        logger.info("Database migrations should be run manually via './start.sh -m' or 'alembic upgrade head'")

        # Only create tables if not using Alembic (legacy fallback)
        if not _app_settings.USE_ALEMBIC_MIGRATIONS:
            logger.info("USE_ALEMBIC_MIGRATIONS disabled: using fallback create_all path")
            await create_db_and_tables()
            await run_migrations()  # legacy no-op

        logger.info(f"Checking/Creating S3 bucket: {settings.S3_BUCKET}")
        if boto3_client:
            bucket_exists = ensure_bucket_exists(boto3_client, settings.S3_BUCKET)
            if not bucket_exists:
                logger.error(f"FATAL: Could not ensure S3 bucket '{settings.S3_BUCKET}' exists. Uploads/Downloads will fail.")
            else:
                logger.info(f"S3 bucket '{settings.S3_BUCKET}' is ready.")
        else:
            logger.warning("WARNING: Boto3 S3 client not initialized. Object storage operations will fail.")
    # Ensure a writable tmp dir exists for any runtime needs
    os.makedirs(os.path.join(os.getcwd(), "tmp"), exist_ok=True)
    logger.info("Application startup complete.")
    yield
    logger.info("Application shutdown...")
    logger.info("Application shutdown complete.")


# Custom JSON encoder to handle MetaData objects
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, "__class__") and obj.__class__.__name__ == "MetaData":
            return {}
        return super().default(obj)


# Custom JSONResponse that uses our encoder
class CustomJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
            cls=CustomJSONEncoder,
        ).encode("utf-8")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.
    App factory pattern for clean separation of concerns.
    """
    app = FastAPI(
        title=settings.APP_NAME,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json"
    )

    # Add CORS middleware
    cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    add_cors_middleware(app, cors_origins)

    # Add body cache middleware (must be early in the stack, before auth)
    app.add_middleware(BodyCacheMiddleware)

    # Add security headers middleware
    app.add_middleware(SecurityHeadersMiddleware)

    # Add authentication middleware
    app.middleware("http")(auth_middleware)

    # Add debug middleware if in debug mode
    if settings.DEBUG:
        app.middleware("http")(debug_exception_middleware)

    # Global exception handler for Pydantic ValidationError
    @app.exception_handler(ValidationError)
    async def validation_exception_handler(request: Request, exc: ValidationError):
        logger.error(f"ValidationError: {str(exc)}", extra={
            'error_details': exc.errors(),
            'request_path': request.url.path,
            'request_method': request.method
        })
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.errors()},
        )

    # Create three API routers with different authentication methods

    # Router 1: /api - OAuth authentication (header-based via middleware)
    # Used by: Web UI, browser users
    # Auth: Middleware validates X-User-Email + X-Proxy-Secret headers
    api_router = APIRouter(prefix="/api")

    # Router 2: /api-key - API key authentication only
    # Used by: Scripts, automation, CLI tools
    # Auth: require_api_key dependency validates Authorization header
    from utils.dependencies import require_api_key
    api_key_router = APIRouter(
        prefix="/api-key",
        dependencies=[Depends(require_api_key)]
    )

    # Router 3: /api-ml - API key + HMAC authentication
    # Used by: ML pipelines
    # Auth: require_hmac_auth dependency validates Authorization header + HMAC signature
    from utils.dependencies import require_hmac_auth
    api_ml_router = APIRouter(
        prefix="/api-ml",
        dependencies=[Depends(require_hmac_auth)]
    )

    # Standardized router registration: define once, register across all prefixes
    routers_config = [
        {"router": projects.router, "prefix": "/projects"},
        {"router": images.router, "prefix": None},  # full paths include /projects
        {"router": users.router, "prefix": "/users"},
        {"router": image_classes.router, "prefix": None},
        {"router": comments.router, "prefix": None},
        {"router": project_metadata.router, "prefix": None},
        {"router": api_keys.router, "prefix": None},
        {"router": ml_analyses.router, "prefix": None},
    ]

    for cfg in routers_config:
        prefix = cfg["prefix"]
        if prefix:
            api_router.include_router(cfg["router"], prefix=prefix)
            api_key_router.include_router(cfg["router"], prefix=prefix)
            api_ml_router.include_router(cfg["router"], prefix=prefix)
        else:
            api_router.include_router(cfg["router"])
            api_key_router.include_router(cfg["router"])
            api_ml_router.include_router(cfg["router"])

    # Add health check endpoint (no auth required)
    @app.get("/api/health")
    async def health_check():
        """Health check endpoint for container monitoring."""
        return {"status": "healthy", "timestamp": datetime.utcnow().isoformat() + 'Z'}

    # Include all three API routers in the main app
    app.include_router(api_router)
    app.include_router(api_key_router)
    app.include_router(api_ml_router)

    # Setup static file serving
    setup_static_files(app)

    # Setup local Swagger UI assets (served without external CDNs)
    setup_local_swagger_ui(app)
    
    return app


def setup_static_files(app: FastAPI):
    """Configure static file serving for the frontend."""
    # Skip static file serving in debug mode (use npm run dev instead)
    if settings.DEBUG:
        logger.info("DEBUG mode enabled - skipping static file setup (use npm run dev for frontend)")
        return

    # Get frontend build path from settings
    front_end_build_path = settings.FRONTEND_BUILD_PATH
    # Convert to absolute path if it's relative
    if not os.path.isabs(front_end_build_path):
        # Make it relative to the project root (parent of app directory)
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        front_end_build_path = os.path.join(project_root, front_end_build_path)

    logger.info(f"Frontend build path: {front_end_build_path}")

    # Serve the static files from the build directory if it exists
    static_dir = os.path.join(front_end_build_path, "static")
    if os.path.isdir(static_dir):
        app.mount(
            "/static",
            StaticFiles(directory=static_dir),
            name="static_files"
        )
    else:
        logger.warning(f"\n{'='*80}\n"
                      f"DEVELOPMENT MODE - Frontend build not found\n"
                      f"{'='*80}\n"
                      f"Static directory not found at: {static_dir}\n"
                      f"\n"
                      f"To run the frontend in development mode:\n"
                      f"  cd /workspaces/VISTA/frontend\n"
                      f"  npm run dev\n"
                      f"\n"
                      f"The frontend dev server will run on http://localhost:3000\n"
                      f"{'='*80}\n")

    # Mount individual files using separate handlers
    @app.get("/favicon.ico")
    async def get_favicon():
        favicon_path = os.path.join(front_end_build_path, "favicon.ico")
        if os.path.exists(favicon_path):
            return FileResponse(favicon_path)
        else:
            raise HTTPException(status_code=404, detail="Favicon not found")

    @app.get("/logo192.png")
    async def get_logo192():
        logo_path = os.path.join(front_end_build_path, "logo192.png")
        if os.path.exists(logo_path):
            return FileResponse(logo_path)
        else:
            raise HTTPException(status_code=404, detail="Logo not found")

    @app.get("/manifest.json")
    async def get_manifest():
        manifest_path = os.path.join(front_end_build_path, "manifest.json")
        if os.path.exists(manifest_path):
            return FileResponse(manifest_path)
        else:
            raise HTTPException(status_code=404, detail="Manifest not found")

    @app.get("/")
    async def get_index():
        index_path = os.path.join(front_end_build_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        else:
            # Frontend not built - return a simple message instead of crashing
            return JSONResponse(
                content={"message": "Backend API is running. Frontend not built."},
                status_code=200
            )

    # Catch-all route for React Router - this must be last
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        """
        Catch-all route to serve the React app for any path that doesn't match
        an API route or static file. This enables React Router to handle client-side routing.
        """
        # Don't handle API routes through this catch-all
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        
        # Serve the React app's index.html for all other routes
        index_path = os.path.join(front_end_build_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        else:
            # Frontend not built - return 404 for non-API routes
            raise HTTPException(status_code=404, detail="Frontend not available")


def setup_local_swagger_ui(app: FastAPI):
    """Serve Swagger UI assets locally instead of loading from CDN."""
    try:
        dist_path = Path(swagger_ui_bundle.__file__).parent
        # Mount the swagger ui dist directory
        app.mount(
            "/_swagger_static",
            StaticFiles(directory=str(dist_path)),
            name="swagger_static",
        )

        # Override /docs route to serve local assets
        @app.get("/docs", include_in_schema=False)
        async def custom_swagger_ui_html():
            html_content = f"""<!DOCTYPE html>
<html lang=\"en\">
    <head>
        <meta charset=\"UTF-8\" />
        <title>{settings.APP_NAME} - API Docs</title>
        <link rel=\"stylesheet\" type=\"text/css\" href=\"/_swagger_static/swagger-ui.css\" />
        <style>body {{ margin:0; background:#fafafa; }}</style>
    </head>
    <body>
        <div id=\"swagger-ui\"></div>
        <script src=\"/_swagger_static/swagger-ui-bundle.js\"></script>
        <script src=\"/_swagger_static/swagger-ui-standalone-preset.js\"></script>
        <script>
            window.addEventListener('load', () => {{
                const ui = SwaggerUIBundle({{
                    url: '{app.openapi_url}',
                    dom_id: '#swagger-ui',
                    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
                    layout: 'StandaloneLayout'
                }});
                window.ui = ui;
            }});
        </script>
    </body>
</html>"""
            return HTMLResponse(content=html_content, status_code=200)
    except Exception as e:
        # If swagger_ui_bundle isn't available, log the error and skip
        logging.error(f"Failed to set up local Swagger UI: {e}", exc_info=True)
        return None


# Create the app instance
app = create_app()
