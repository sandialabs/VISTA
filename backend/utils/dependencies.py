import hashlib
import logging
import re
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from repositories import api_keys as api_key_repository
from repositories import images as image_repository
from repositories import projects as project_repository
from repositories import users as user_repository
from schemas.users import User, UserCreate

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)


def _get_email_from_headers(request: Request) -> str | None:
    """Extract and validate user email from request headers.

    Checks both the configured X_USER_ID_HEADER and the common
    ``X-User-Email`` fallback.  Returns a normalised, lower-cased email
    or ``None`` if the header is missing / invalid.
    """
    headers = {k.lower(): v for k, v in request.headers.items()}
    raw = headers.get(settings.X_USER_ID_HEADER.lower()) or headers.get("x-user-email")
    return get_user_from_header(raw) if raw else None


def get_user_from_header(header_value: str) -> str | None:
    """Extract and validate user email from a raw header value.

    Returns cleaned, lower-cased email or None if invalid.
    """
    if not header_value:
        return None
    email = header_value.strip().lower()
    email_pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if not re.match(email_pattern, email):
        return None
    return email


async def _ensure_user_in_db(email: str, db: AsyncSession) -> User:
    """Look up or auto-create a user row, returning a Pydantic User."""
    try:
        db_user = await user_repository.get_user_by_email(db=db, email=email)
        if not db_user:
            user_create = UserCreate(email=email)
            try:
                db_user = await user_repository.create_user(db=db, user=user_create)
            except IntegrityError:
                # Another concurrent request may have created the same email
                # after our initial lookup. Roll back and fetch the existing row.
                await db.rollback()
                db_user = await user_repository.get_user_by_email(db=db, email=email)
                if not db_user:
                    raise
    except ProgrammingError as exc:
        err_text = str(exc).lower()
        if 'relation "users" does not exist' in err_text:
            logger.error(
                "Database schema missing users table; migrations have not been applied.",
                exc_info=exc,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Database schema is not initialized (missing 'users' table). "
                    "Run 'alembic upgrade head' before starting the API."
                ),
            ) from exc
        raise
    return User(
        id=db_user.id,
        email=db_user.email,
        username=db_user.username,
        is_active=db_user.is_active,
        created_at=db_user.created_at,
        updated_at=db_user.updated_at,
        groups=[],
    )


async def _resolve_from_api_key(
    credentials: HTTPAuthorizationCredentials,
    db: AsyncSession,
) -> User | None:
    """Try to resolve a user from a Bearer token (API key).

    Returns the User on success, or None if no key matches.
    """
    all_api_keys = await api_key_repository.get_all_active_api_keys(db)
    for api_key_record in all_api_keys:
        if verify_api_key(credentials.credentials, api_key_record.key_hash):
            await api_key_repository.update_api_key_last_used(db, api_key_record.id)
            return User(
                id=api_key_record.user.id,
                email=api_key_record.user.email,
                username=api_key_record.user.username,
                is_active=api_key_record.user.is_active,
                created_at=api_key_record.user.created_at,
                updated_at=api_key_record.user.updated_at,
                groups=[],
            )
    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> User:
    """Resolve the current user from the request.

    Resolution order:
    1. Bearer token (API key)
    2. Debug / test mode -- header email or MOCK_USER_EMAIL fallback
    3. Production proxy headers (X-User-Email + X-Proxy-Secret)
    """
    # 1. Bearer token -> API key
    if credentials:
        user = await _resolve_from_api_key(credentials, db)
        if user:
            request.state.auth_method = "api_key"
            return user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )

    # 2. Debug / test mode
    if settings.DEBUG or settings.SKIP_HEADER_CHECK:
        email = _get_email_from_headers(request) or settings.MOCK_USER_EMAIL
        request.state.auth_method = "debug"
        return await _ensure_user_in_db(email, db)

    # 3. Production proxy headers
    headers = {k.lower(): v for k, v in request.headers.items()}
    if settings.PROXY_SHARED_SECRET:
        proxy_secret = headers.get(settings.X_PROXY_SECRET_HEADER.lower())
        if not secrets.compare_digest(proxy_secret or "", settings.PROXY_SHARED_SECRET):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid proxy authentication.",
            )

    email = _get_email_from_headers(request)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide API key or ensure proxy auth headers are present.",
        )
    request.state.auth_method = "proxy"
    return await _ensure_user_in_db(email, db)


async def require_authenticated_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> User:
    """Like get_current_user but rejects API key auth.

    Used for sensitive endpoints where local debug/mock identity or an
    externally authenticated browser user should have access, but API-key
    automation callers should not.
    """
    if credentials:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires authenticated user context. API key access is not allowed.",
        )
    return await get_current_user(request, db, credentials=None)


# --- Project / image access ---


async def get_accessible_projects_for_user(
    db: AsyncSession,
    user: User,
    skip: int = 0,
    limit: int = 100,
    include_archived: bool = False,
) -> list[models.Project]:
    """Return projects the user can access based on group membership."""
    all_projects = await project_repository.get_all_projects(
        db, skip, limit, include_archived=include_archived
    )
    return [p for p in all_projects if is_user_in_group(user.email, p.meta_group_id)]


ARCHIVED_PROJECT_DETAIL = (
    "This project is archived and read-only. Unarchive it to make changes."
)


def _raise_if_archived(project: models.Project) -> None:
    if project.is_archived:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=ARCHIVED_PROJECT_DETAIL
        )


async def get_project_or_403(
    project_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> models.Project:
    """Get a project; raise 404/403 as appropriate.

    This is the single project access check. Routers receive projects through
    ``ReadableProject``/``WritableProject`` or call this directly when the
    project ID does not come from the path.
    """
    db_project = await project_repository.get_project(db, project_id)
    if not db_project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to project '{project_id}'.",
        )
    return db_project


async def get_project_or_403_writable(
    project_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> models.Project:
    """Get a project; raise 404/403 as appropriate; also raise 403 if archived."""
    db_project = await get_project_or_403(project_id, db, current_user)
    _raise_if_archived(db_project)
    return db_project


async def get_image_or_403(
    image_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
    *,
    include_deleted: bool = True,
) -> models.DataInstance:
    """Get an image; raise 404/403 as appropriate.

    This is the single image access check. Soft-deleted images are 404 unless
    ``include_deleted`` is true.
    """
    db_image = await image_repository.get_data_instance(db, image_id)
    if not db_image or (db_image.deleted_at and not include_deleted):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        )
    if not is_user_in_group(current_user.email, db_image.project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to image '{image_id}'",
        )
    return db_image


async def get_image_or_403_writable(
    image_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> models.DataInstance:
    """Get an image; raise 404/403 as appropriate; also raise 403 if the project is archived."""
    db_image = await get_image_or_403(image_id, db, current_user)
    _raise_if_archived(db_image.project)
    return db_image


async def _readable_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> models.Project:
    return await get_project_or_403(project_id, db, current_user)


async def _writable_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> models.Project:
    return await get_project_or_403_writable(project_id, db, current_user)


async def _accessible_image(
    image_id: uuid.UUID,
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> models.DataInstance:
    return await get_image_or_403(
        image_id, db, current_user, include_deleted=include_deleted
    )


# Route dependencies for the ``{project_id}`` / ``{image_id}`` path parameter.
ReadableProject = Annotated[models.Project, Depends(_readable_project)]
WritableProject = Annotated[models.Project, Depends(_writable_project)]
AccessibleImage = Annotated[models.DataInstance, Depends(_accessible_image)]


# --- API key utilities (unchanged) ---


def generate_api_key() -> str:
    """Generate a secure API key."""
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage using PBKDF2."""
    salt = secrets.token_bytes(32)
    key = hashlib.pbkdf2_hmac("sha256", api_key.encode("utf-8"), salt, 100000)
    return salt.hex() + key.hex()


def verify_api_key(api_key: str, stored_hash: str) -> bool:
    """Verify an API key against its stored hash."""
    try:
        salt_hex = stored_hash[:64]
        hash_hex = stored_hash[64:]
        salt = bytes.fromhex(salt_hex)
        stored_key = bytes.fromhex(hash_hex)
        key = hashlib.pbkdf2_hmac("sha256", api_key.encode("utf-8"), salt, 100000)
        return secrets.compare_digest(key, stored_key)
    except (ValueError, TypeError):
        return False


async def get_user_from_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Get user from API key if provided (legacy helper kept for compatibility)."""
    if not credentials:
        return None
    return await _resolve_from_api_key(credentials, db)


# --- User context helpers (unchanged) ---


async def resolve_user_id(user: User, db: AsyncSession) -> uuid.UUID:
    """Resolve a user's ID, creating the user in the database if needed."""
    if user.id is not None:
        return user.id
    db_user = await user_repository.get_user_by_email(db=db, email=user.email)
    if db_user:
        user.id = db_user.id
        return db_user.id
    user_create = UserCreate(
        email=user.email, username=user.username, is_active=user.is_active
    )
    db_user = await user_repository.create_user(
        db=db, user=user_create, created_by=user.email
    )
    user.id = db_user.id
    return db_user.id


class UserContext:
    """Automatic user context injection for CRUD operations."""

    def __init__(self, user: User):
        self.user = user
        self.email = user.email
        self.id = user.id


async def get_user_context(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserContext:
    """Get resolved user context with automatic ID resolution."""
    await resolve_user_id(current_user, db)
    return UserContext(current_user)
