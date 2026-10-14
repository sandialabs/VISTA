import os

from pydantic import ConfigDict, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Data Management API"
    GITLAB_COMMIT_SHA: str = ""
    DEBUG: bool = False
    PORT: int = 8000
    # Deployment environment: "development", "staging", or "production".
    # When set to "production", the app refuses to start with DEBUG=true or
    # SKIP_HEADER_CHECK=true, or with VISTA_AUTH_BACKEND=demo.
    ENV: str = "development"
    # Group-auth backend selector. Must be set explicitly to enable group
    # membership checks. Supported values:
    #   - "demo": hardcoded example email->group mapping. Development/testing only.
    #   - "custom": a project-specific implementation is wired into
    #     core.group_auth._check_group_membership. Fail-closed by default.
    # Any other value (including unset) causes _check_group_membership to
    # raise NotImplementedError, preventing accidental prod-bypass.
    VISTA_AUTH_BACKEND: str | None = None
    # When enabled, avoid any external calls and heavy startup work (for tests)
    FAST_TEST_MODE: bool = False
    SKIP_HEADER_CHECK: bool = False
    CHECK_MOCK_MEMBERSHIP: bool = True
    MOCK_USER_EMAIL: str = "test@example.com"
    MOCK_USER_GROUPS_JSON: str = (
        '["admin-group", "data-scientists", "project-alpha-group"]'
    )
    AUTH_SERVER_URL: str | None = None
    PROXY_SHARED_SECRET: str | None = None
    X_USER_ID_HEADER: str = "X-User-Email"
    X_PROXY_SECRET_HEADER: str = "X-Proxy-Secret"

    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "postgres"
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5433
    HOST_DB_PORT: str = "5433"
    POSTGRES_PORT_HOST: str = "5433"
    DATABASE_URL: str = "sqlite+aiosqlite:///./test.db"

    # S3/MinIO settings - defaults for local development
    # Back-compat: we also honor MINIO_* env vars; see post-init below.
    S3_ENDPOINT: str = "localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadminpassword"
    S3_BUCKET: str = "data-storage"
    S3_NAMESPACE: str | None = None
    S3_USE_SSL: bool = False
    S3_REGION: str = "us-east-1"
    MAX_S3_LIST_SCAN_KEYS: int = 50_000
    MINIO_ENDPOINT: str | None = None
    MINIO_ACCESS_KEY: str | None = None
    MINIO_SECRET_KEY: str | None = None
    MINIO_BUCKET_NAME: str | None = None
    MINIO_USE_SSL: bool | None = None

    # Frontend build path configuration
    FRONTEND_BUILD_PATH: str = "frontend/build"
    DISABLE_FILE_LOGGING: bool = False
    CORS_ORIGINS: str = "http://localhost:3000"
    CI: bool = False
    IN_DOCKER: bool = False
    PYTEST_CURRENT_TEST: str | None = None
    PYTEST_XDIST_WORKER: str | None = None

    # Security headers configuration
    SECURITY_NOSNIFF_ENABLED: bool = True
    SECURITY_XFO_ENABLED: bool = True
    SECURITY_XFO_VALUE: str = "SAMEORIGIN"
    SECURITY_REFERRER_POLICY_ENABLED: bool = True
    SECURITY_REFERRER_POLICY_VALUE: str = "no-referrer"
    SECURITY_CSP_ENABLED: bool = True
    SECURITY_CSP_VALUE: str | None = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';"
    )

    # Cache configuration
    CACHE_SIZE_MB: int = 1000
    CACHE_DIR: str | None = None
    VOLUME_CACHE_DIR: str | None = None
    VOLUME_CACHE_MAX_BYTES: int = 10 * 1024 * 1024 * 1024
    VOLUME_MEMMAP_CACHE_ITEMS: int = 8

    # ML Analysis settings
    ML_ANALYSIS_ENABLED: bool = True
    ML_MAX_ANALYSES_PER_IMAGE: int = 10
    ML_ALLOWED_MODELS: str = "resnet50_classifier,vgg16,inception_v3,efficientnet_b0,demo-model-detcls,yolo_v8"
    ML_DEFAULT_STATUS: str = "queued"
    ML_MAX_BULK_ANNOTATIONS: int = (
        1000  # Lowered from 5000 to prevent memory/timeout issues
    )
    ML_PRESIGNED_URL_EXPIRY_SECONDS: int = (
        3600  # 1 hour to allow slow uploads of large artifacts
    )
    TOOLBOX_MODEL_SERVICE_URL: str | None = None
    CHECKPOINT_DEEP_INSPECTION_MAX_BYTES: int = 64 * 1024 * 1024
    VISTA_MCP_API_KEY: str | None = None
    MCP_HOST: str = "localhost"
    MCP_PORT: int = 8001
    VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME: bool = False
    VISTA_MODEL_SERVICE_DEVICE: str = "auto"
    # Trusted local Python entry point used for calibrated, optimized 3DGS
    # training. The browser cannot choose this value; deployments explicitly
    # opt in with e.g. ``package.module.optimize``.
    PT3_REAL_3DGS_PROVIDER: str | None = None

    # Image deletion / retention settings
    IMAGE_DELETE_RETENTION_DAYS: int = 60  # Soft delete retention window (days)
    IMAGE_DELETE_REASON_MIN_CHARS: int = (
        5  # Minimum characters required for a deletion reason
    )
    IMAGE_DELETE_PURGE_BATCH_SIZE: int = 500  # Max images purged per cycle
    IMAGE_DELETE_PURGE_INTERVAL_SECONDS: int = 3600  # Background purge interval
    ENABLE_IMAGE_PURGE: bool = True  # Toggle background purge task

    # Image upload and S3 import limits
    MAX_UPLOAD_BYTES: int = int(2.5 * 1024 * 1024 * 1024)
    MAX_BATCH_UPLOAD_FILES: int = 100
    MAX_BATCH_UPLOAD_BYTES: int = 256 * 1024 * 1024
    MAX_BATCH_UPLOAD_MANIFEST_BYTES: int = 8 * 1024 * 1024
    MAX_BATCH_UPLOAD_CONCURRENCY: int = 6
    MAX_BATCH_METADATA_BYTES: int = 1024 * 1024
    MAX_BATCH_METADATA_DEPTH: int = 32
    MAX_BATCH_METADATA_ITEMS: int = 10_000
    MAX_BATCH_METADATA_STRING_BYTES: int = 1024 * 1024
    MAX_BATCH_METADATA_KEY_BYTES: int = 4096
    MAX_S3_LIST_KEYS: int = 5000
    MAX_S3_IMPORT_CONCURRENCY: int = 6

    # Alembic migrations
    USE_ALEMBIC_MIGRATIONS: bool = True  # Use Alembic for database migrations
    MIGRATION_RETRY_ATTEMPTS: int = 15
    MIGRATION_RETRY_DELAY_SECONDS: float = 2.0

    @field_validator(
        "DEBUG",
        "FAST_TEST_MODE",
        "SKIP_HEADER_CHECK",
        "S3_USE_SSL",
        "MINIO_USE_SSL",
        "SECURITY_NOSNIFF_ENABLED",
        "SECURITY_XFO_ENABLED",
        "SECURITY_REFERRER_POLICY_ENABLED",
        "SECURITY_CSP_ENABLED",
        "ENABLE_IMAGE_PURGE",
        "USE_ALEMBIC_MIGRATIONS",
        "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME",
        "DISABLE_FILE_LOGGING",
        "CI",
        "IN_DOCKER",
        mode="before",
    )
    @classmethod
    def parse_bool_with_strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
        return v

    # Pydantic v2 style configuration
    model_config = ConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="allow"
    )

    @property
    def MOCK_USER_GROUPS(self):
        import json

        return json.loads(self.MOCK_USER_GROUPS_JSON)

    @property
    def is_production(self) -> bool:
        return (self.ENV or "").strip().lower() == "production"

    def validate_production_safety(self) -> None:
        """Refuse to run in production with unsafe debug/bypass flags or
        a demo auth backend. Raises RuntimeError with an explicit message.

        Called from application startup; kept as a method (not a field
        validator) so tests can monkey-patch individual flags without
        tripping startup-time checks.
        """
        if not self.is_production:
            return
        errors = []
        if self.DEBUG:
            errors.append("DEBUG=true is not allowed when ENV=production")
        if self.SKIP_HEADER_CHECK:
            errors.append("SKIP_HEADER_CHECK=true is not allowed when ENV=production")
        if self.FAST_TEST_MODE:
            errors.append("FAST_TEST_MODE=true is not allowed when ENV=production")
        if (self.VISTA_AUTH_BACKEND or "").strip().lower() == "demo":
            errors.append(
                "VISTA_AUTH_BACKEND=demo is not allowed when ENV=production. "
                "Set VISTA_AUTH_BACKEND=custom and implement "
                "core.group_auth._check_group_membership."
            )
        if not self.PROXY_SHARED_SECRET:
            errors.append(
                "PROXY_SHARED_SECRET must be set when ENV=production"
            )
        if errors:
            raise RuntimeError(
                "Refusing to start in production with unsafe config:\n  - "
                + "\n  - ".join(errors)
            )

    def patch(self, updates: dict):
        """Return a shallow patched copy of settings with provided overrides.

        Does not mutate the original instance. Intended for tests where
        monkeypatch.setattr(module_path, settings.patch({...})) is used.
        """
        if not isinstance(updates, dict):
            raise TypeError("updates must be a dict")
        # Pydantic v2 provides model_copy for efficient cloning
        return self.model_copy(update=updates)

    def uses_ephemeral_cache_dir(self) -> bool:
        """Return whether runtime caches should use per-process temp storage."""
        return bool(
            getattr(self, "CI", False)
            or self.PYTEST_CURRENT_TEST
            or self.PYTEST_XDIST_WORKER
        )


def _running_in_podman(active_settings: Settings) -> bool:
    # Basic heuristics to detect containerized runtime
    return os.path.exists("/.podmanenv") or active_settings.IN_DOCKER


settings = Settings()

# Backwards-compatibility: map MINIO_* env vars to S3_* if provided
if settings.MINIO_ENDPOINT and "S3_ENDPOINT" not in settings.model_fields_set:
    settings.S3_ENDPOINT = settings.MINIO_ENDPOINT  # type: ignore[attr-defined]
if settings.MINIO_ACCESS_KEY and "S3_ACCESS_KEY" not in settings.model_fields_set:
    settings.S3_ACCESS_KEY = settings.MINIO_ACCESS_KEY  # type: ignore[attr-defined]
if settings.MINIO_SECRET_KEY and "S3_SECRET_KEY" not in settings.model_fields_set:
    settings.S3_SECRET_KEY = settings.MINIO_SECRET_KEY  # type: ignore[attr-defined]
if settings.MINIO_BUCKET_NAME and "S3_BUCKET" not in settings.model_fields_set:
    settings.S3_BUCKET = settings.MINIO_BUCKET_NAME  # type: ignore[attr-defined]
if settings.MINIO_USE_SSL is not None and "S3_USE_SSL" not in settings.model_fields_set:
    settings.S3_USE_SSL = settings.MINIO_USE_SSL  # type: ignore[attr-defined]

# If running outside Docker and DATABASE_URL points at the podman hostname 'db',
# rewrite to localhost using HOST_DB_PORT (default 5433) for local dev.
try:
    # Auto-enable FAST_TEST_MODE when running under pytest if not explicitly set
    if not getattr(settings, "FAST_TEST_MODE", False) and settings.PYTEST_CURRENT_TEST:
        settings.FAST_TEST_MODE = True  # type: ignore[attr-defined]

    if not _running_in_podman(settings) and "@db:" in settings.DATABASE_URL:
        host_port = (
            settings.HOST_DB_PORT
            if "HOST_DB_PORT" in settings.model_fields_set
            else settings.POSTGRES_PORT_HOST
        )
        # common compose default: container exposed on host 5433 -> container 5432
        settings.DATABASE_URL = settings.DATABASE_URL.replace(
            "@db:5432", f"@localhost:{host_port}"
        )  # type: ignore[attr-defined]
except Exception:
    # Don't fail settings import on best-effort rewrite
    pass
