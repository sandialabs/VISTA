from pydantic_settings import BaseSettings
from pydantic import field_validator, ConfigDict
from typing import Optional
import os
from pathlib import Path

class Settings(BaseSettings):
    APP_NAME: str = "Data Management API"
    DEBUG: bool = False
    # When enabled, avoid any external calls and heavy startup work (for tests)
    FAST_TEST_MODE: bool = False
    SKIP_HEADER_CHECK: bool = False
    CHECK_MOCK_MEMBERSHIP: bool = True
    MOCK_USER_EMAIL: str = "test@example.com"
    MOCK_USER_GROUPS_JSON: str = '["admin-group", "data-scientists", "project-alpha-group"]'
    AUTH_SERVER_URL: Optional[str] = None
    PROXY_SHARED_SECRET: Optional[str] = None
    X_USER_ID_HEADER: str = "X-User-Email"
    X_PROXY_SECRET_HEADER: str = "X-Proxy-Secret"

    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "postgres"
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5433
    DATABASE_URL: str = "sqlite+aiosqlite:///./test.db"

    # S3/MinIO settings - defaults for local development
    # Back-compat: we also honor MINIO_* env vars; see post-init below.
    S3_ENDPOINT: str = "localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadminpassword"
    S3_BUCKET: str = "data-storage"
    S3_USE_SSL: bool = False

    # Frontend build path configuration
    FRONTEND_BUILD_PATH: str = "frontend/build"
    
    # Security headers configuration
    SECURITY_NOSNIFF_ENABLED: bool = True
    SECURITY_XFO_ENABLED: bool = True
    SECURITY_XFO_VALUE: str = "SAMEORIGIN"
    SECURITY_REFERRER_POLICY_ENABLED: bool = True
    SECURITY_REFERRER_POLICY_VALUE: str = "no-referrer"
    SECURITY_CSP_ENABLED: bool = True
    SECURITY_CSP_VALUE: Optional[str] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';"
    
    # Cache configuration
    CACHE_SIZE_MB: int = 1000

    # ML Analysis settings
    ML_ANALYSIS_ENABLED: bool = True
    ML_MAX_ANALYSES_PER_IMAGE: int = 10
    ML_ALLOWED_MODELS: str = "resnet50_classifier,vgg16,inception_v3,efficientnet_b0,demo-model-detcls,yolo_v8"
    ML_DEFAULT_STATUS: str = "queued"
    ML_CALLBACK_HMAC_SECRET: Optional[str] = None
    ML_PIPELINE_REQUIRE_HMAC: bool = True
    ML_HMAC_TIMESTAMP_SKEW_SECONDS: int = 300
    ML_MAX_BULK_ANNOTATIONS: int = 1000  # Lowered from 5000 to prevent memory/timeout issues
    ML_PRESIGNED_URL_EXPIRY_SECONDS: int = 3600  # 1 hour to allow slow uploads of large artifacts

    # Image deletion / retention settings
    IMAGE_DELETE_RETENTION_DAYS: int = 60  # Soft delete retention window (days)
    IMAGE_DELETE_REASON_MIN_CHARS: int = 10  # Minimum characters required for a deletion reason
    IMAGE_DELETE_PURGE_BATCH_SIZE: int = 500  # Max images purged per cycle
    IMAGE_DELETE_PURGE_INTERVAL_SECONDS: int = 3600  # Background purge interval
    ENABLE_IMAGE_PURGE: bool = True  # Toggle background purge task

    # Alembic migrations
    USE_ALEMBIC_MIGRATIONS: bool = True  # Use Alembic for database migrations

    @field_validator(
        'DEBUG', 'FAST_TEST_MODE', 'SKIP_HEADER_CHECK', 'S3_USE_SSL',
        'SECURITY_NOSNIFF_ENABLED', 'SECURITY_XFO_ENABLED',
        'SECURITY_REFERRER_POLICY_ENABLED', 'SECURITY_CSP_ENABLED',
        'ENABLE_IMAGE_PURGE', 'USE_ALEMBIC_MIGRATIONS',
        mode='before'
    )
    @classmethod
    def parse_bool_with_strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
        return v

    # Pydantic v2 style configuration
    model_config = ConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding='utf-8',
        extra='allow'
    )
    
    @property
    def MOCK_USER_GROUPS(self):
        import json
        return json.loads(self.MOCK_USER_GROUPS_JSON)

    def patch(self, updates: dict):
        """Return a shallow patched copy of settings with provided overrides.

        Does not mutate the original instance. Intended for tests where
        monkeypatch.setattr(module_path, settings.patch({...})) is used.
        """
        if not isinstance(updates, dict):
            raise TypeError("updates must be a dict")
        # Pydantic v2 provides model_copy for efficient cloning
        return self.model_copy(update=updates)

def _running_in_podman() -> bool:
    # Basic heuristics to detect containerized runtime
    return os.path.exists('/.podmanenv') or os.environ.get('IN_DOCKER') == '1'


settings = Settings()

# Backwards-compatibility: map MINIO_* env vars to S3_* if provided
if os.getenv("MINIO_ENDPOINT") and not os.getenv("S3_ENDPOINT"):
    settings.S3_ENDPOINT = os.getenv("MINIO_ENDPOINT")  # type: ignore[attr-defined]
if os.getenv("MINIO_ACCESS_KEY") and not os.getenv("S3_ACCESS_KEY"):
    settings.S3_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")  # type: ignore[attr-defined]
if os.getenv("MINIO_SECRET_KEY") and not os.getenv("S3_SECRET_KEY"):
    settings.S3_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")  # type: ignore[attr-defined]
if os.getenv("MINIO_BUCKET_NAME") and not os.getenv("S3_BUCKET"):
    settings.S3_BUCKET = os.getenv("MINIO_BUCKET_NAME")  # type: ignore[attr-defined]
if os.getenv("MINIO_USE_SSL") and not os.getenv("S3_USE_SSL"):
    settings.S3_USE_SSL = os.getenv("MINIO_USE_SSL", "False").lower() == "true"  # type: ignore[attr-defined]

# NOTE: HMAC secret must be configured explicitly in tests via conftest.py
# Do not auto-initialize to avoid masking configuration issues

# If running outside Docker and DATABASE_URL points at the podman hostname 'db',
# rewrite to localhost using HOST_DB_PORT (default 5433) for local dev.
try:
    # Auto-enable FAST_TEST_MODE when running under pytest if not explicitly set
    if not getattr(settings, 'FAST_TEST_MODE', False) and os.getenv('PYTEST_CURRENT_TEST'):
        settings.FAST_TEST_MODE = True  # type: ignore[attr-defined]

    if not _running_in_podman() and "@db:" in settings.DATABASE_URL:
        host_port = os.getenv("HOST_DB_PORT", os.getenv("POSTGRES_PORT_HOST", "5433"))
        # common compose default: container exposed on host 5433 -> container 5432
        settings.DATABASE_URL = settings.DATABASE_URL.replace("@db:5432", f"@localhost:{host_port}")  # type: ignore[attr-defined]
except Exception:
    # Don't fail settings import on best-effort rewrite
    pass
