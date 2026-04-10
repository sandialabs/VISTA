import re
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
import hashlib
import secrets
import logging
from core.config import settings
from core.schemas import User, UserCreate
from core.database import get_db
from core.group_auth_helper import is_user_in_group
import utils.crud as crud
from core import models

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)


def _get_email_from_headers(request: Request) -> Optional[str]:
    """Extract and validate user email from request headers.

    Checks both the configured X_USER_ID_HEADER and the common
    ``X-User-Email`` fallback.  Returns a normalised, lower-cased email
    or ``None`` if the header is missing / invalid.
    """
    headers = {k.lower(): v for k, v in request.headers.items()}
    raw = (
        headers.get(settings.X_USER_ID_HEADER.lower())
        or headers.get("x-user-email")
    )
    return get_user_from_header(raw) if raw else None


def get_user_from_header(header_value: str) -> Optional[str]:
    """Extract and validate user email from a raw header value.

    Returns cleaned, lower-cased email or None if invalid.
    """
    if not header_value:
        return None
    email = header_value.strip().lower()
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        return None
    return email


async def _ensure_user_in_db(email: str, db: AsyncSession) -> User:
    """Look up or auto-create a user row, returning a Pydantic User."""
    db_user = await crud.get_user_by_email(db=db, email=email)
    if not db_user:
        user_create = UserCreate(email=email)
        db_user = await crud.create_user(db=db, user=user_create)
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
) -> Optional[User]:
    """Try to resolve a user from a Bearer token (API key).

    Returns the User on success, or None if no key matches.
    """
    all_api_keys = await crud.get_all_active_api_keys(db)
    for api_key_record in all_api_keys:
        if verify_api_key(credentials.credentials, api_key_record.key_hash):
            await crud.update_api_key_last_used(db, api_key_record.id)
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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
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


async def require_proxy_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    """Like get_current_user but rejects API key auth.

    Used for sensitive endpoints (API key management, user admin) where
    only proxy-authenticated (human session) users should have access.
    """
    if credentials:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires proxy authentication. API key access is not allowed.",
        )
    return await get_current_user(request, db, credentials=None)


# --- Project / image access helpers (unchanged) ---

async def get_accessible_projects_for_user(
    db: AsyncSession,
    user: User,
    skip: int = 0,
    limit: int = 100,
    include_archived: bool = False,
) -> List[models.Project]:
    """Return projects the user can access based on group membership."""
    all_projects = await crud.get_all_projects(db, skip, limit, include_archived=include_archived)
    return [p for p in all_projects if is_user_in_group(user.email, p.meta_group_id)]


async def get_project_or_403(
    project_id: uuid.UUID, db: AsyncSession, current_user: User,
) -> models.Project:
    """Get a project; raise 404/403 as appropriate."""
    db_project = await crud.get_project(db, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(status_code=403, detail="Access forbidden")
    return db_project


async def get_project_or_403_writable(
    project_id: uuid.UUID, db: AsyncSession, current_user: User,
) -> models.Project:
    """Get a project; raise 404/403 as appropriate; also raise 403 if archived."""
    db_project = await get_project_or_403(project_id, db, current_user)
    if db_project.is_archived:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is archived and read-only. Unarchive it to make changes.",
        )
    return db_project


async def get_image_or_403(
    image_id: uuid.UUID, db: AsyncSession, current_user: User,
) -> models.DataInstance:
    """Get an image; raise 404/403 as appropriate."""
    db_image = await crud.get_image(db, image_id)
    if not db_image:
        raise HTTPException(status_code=404, detail="Image not found")
    if not is_user_in_group(current_user.email, db_image.project.meta_group_id):
        raise HTTPException(status_code=403, detail="Access forbidden")
    return db_image


async def get_image_or_403_writable(
    image_id: uuid.UUID, db: AsyncSession, current_user: User,
) -> models.DataInstance:
    """Get an image; raise 404/403 as appropriate; also raise 403 if the project is archived."""
    db_image = await get_image_or_403(image_id, db, current_user)
    if db_image.project.is_archived:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is archived and read-only. Unarchive it to make changes.",
        )
    return db_image


# --- API key utilities (unchanged) ---

def generate_api_key() -> str:
    """Generate a secure API key."""
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage using PBKDF2."""
    salt = secrets.token_bytes(32)
    key = hashlib.pbkdf2_hmac('sha256', api_key.encode('utf-8'), salt, 100000)
    return salt.hex() + key.hex()


def verify_api_key(api_key: str, stored_hash: str) -> bool:
    """Verify an API key against its stored hash."""
    try:
        salt_hex = stored_hash[:64]
        hash_hex = stored_hash[64:]
        salt = bytes.fromhex(salt_hex)
        stored_key = bytes.fromhex(hash_hex)
        key = hashlib.pbkdf2_hmac('sha256', api_key.encode('utf-8'), salt, 100000)
        return secrets.compare_digest(key, stored_key)
    except (ValueError, TypeError):
        return False


async def get_user_from_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Get user from API key if provided (legacy helper kept for compatibility)."""
    if not credentials:
        return None
    return await _resolve_from_api_key(credentials, db)


# --- User context helpers (unchanged) ---

async def resolve_user_id(user: User, db: AsyncSession) -> uuid.UUID:
    """Resolve a user's ID, creating the user in the database if needed."""
    if user.id is not None:
        return user.id
    db_user = await crud.get_user_by_email(db=db, email=user.email)
    if db_user:
        user.id = db_user.id
        return db_user.id
    user_create = UserCreate(email=user.email, username=user.username, is_active=user.is_active)
    db_user = await crud.create_user(db=db, user=user_create, created_by=user.email)
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
