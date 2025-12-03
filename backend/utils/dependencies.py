from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
import hashlib
import hmac
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

# Function to get a user's accessible groups
async def get_user_accessible_groups(
    db: AsyncSession,
    user: User
) -> List[str]:
    """
    Get all groups that a user has access to by checking membership for each project's group.
    This implements the new approach of iterating through projects and checking if the user
    is a member of each project's group.
    
    Args:
        db: Database session
        user: The user to get accessible groups for
        
    Returns:
        List of group IDs the user has access to
    """
    # Get all projects
    all_projects = await crud.get_all_projects(db)
    
    # Initialize empty list for accessible groups
    groups = []
    
    # For each project, check if the user is a member of the project's group
    for project in all_projects:
        if is_user_in_group(user.email, project.meta_group_id) and project.meta_group_id not in groups:
            groups.append(project.meta_group_id)
    
    return groups

# Function to get accessible projects for a user
async def get_accessible_projects_for_user(
    db: AsyncSession,
    user: User,
    skip: int = 0,
    limit: int = 100
) -> List[models.Project]:
    """
    Get all projects that a user has access to by checking membership for each project.
    This implements the new approach of iterating through projects and checking if the user
    is a member of each project's group.
    
    Args:
        db: Database session
        user: The user to get accessible projects for
        skip: Number of records to skip
        limit: Maximum number of records to return
        
    Returns:
        List of projects the user has access to
    """
    # Get all projects
    all_projects = await crud.get_all_projects(db, skip, limit)
    
    # Initialize empty list for accessible projects
    accessible_projects = []
    
    # For each project, check if the user is a member of the project's group
    for project in all_projects:
        if is_user_in_group(user.email, project.meta_group_id):
            accessible_projects.append(project)
    
    return accessible_projects


async def get_project_or_403(project_id: uuid.UUID, db: AsyncSession, current_user: User) -> models.Project:
    """
    Get a project and check if the current user has access to it.
    Raises 403 if user doesn't have access.
    
    Args:
        project_id: The ID of the project to retrieve
        db: Database session
        current_user: The current authenticated user
        
    Returns:
        The project if user has access
        
    Raises:
        HTTPException: 404 if project doesn't exist, 403 if user doesn't have access
    """
    db_project = await crud.get_project(db, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    is_member = is_user_in_group(current_user.email, db_project.meta_group_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Access forbidden")
    
    return db_project


async def get_image_or_403(image_id: uuid.UUID, db: AsyncSession, current_user: User) -> models.DataInstance:
    """
    Get an image and check if the current user has access to it.
    Raises 403 if user doesn't have access.
    
    Args:
        image_id: The ID of the image to retrieve
        db: Database session
        current_user: The current authenticated user
        
    Returns:
        The image if user has access
        
    Raises:
        HTTPException: 404 if image doesn't exist, 403 if user doesn't have access
    """
    db_image = await crud.get_image(db, image_id)
    if not db_image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    is_member = is_user_in_group(current_user.email, db_image.project.meta_group_id)
    if not is_member:
        raise HTTPException(status_code=403, detail="Access forbidden")
    
    return db_image

def generate_api_key() -> str:
    """Generate a secure API key"""
    return secrets.token_urlsafe(32)

def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage using secure PBKDF2"""
    # Use PBKDF2 with SHA-256 for secure hashing
    salt = secrets.token_bytes(32)  # 256-bit salt
    key = hashlib.pbkdf2_hmac('sha256', api_key.encode('utf-8'), salt, 100000)
    
    # Return salt + hash encoded as hex
    return salt.hex() + key.hex()

def verify_api_key(api_key: str, stored_hash: str) -> bool:
    """Verify an API key against its stored hash"""
    import hashlib
    
    try:
        # Extract salt and hash from stored_hash
        salt_hex = stored_hash[:64]  # First 64 chars are salt (32 bytes)
        hash_hex = stored_hash[64:]  # Remaining chars are hash
        
        salt = bytes.fromhex(salt_hex)
        stored_key = bytes.fromhex(hash_hex)
        
        # Hash the provided key with the same salt
        key = hashlib.pbkdf2_hmac('sha256', api_key.encode('utf-8'), salt, 100000)
        
        # Compare hashes securely
        import secrets
        return secrets.compare_digest(key, stored_key)
    except (ValueError, TypeError):
        return False

async def get_user_from_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """Get user from API key if provided"""
    if not credentials:
        return None
    
    # Get all active API keys and verify against each one
    # Note: This is less efficient but necessary with salted hashes
    # In production, consider adding an index or prefix to optimize
    all_api_keys = await crud.get_all_active_api_keys(db)
    
    for api_key_record in all_api_keys:
        if verify_api_key(credentials.credentials, api_key_record.key_hash):
            # Update last used timestamp
            await crud.update_api_key_last_used(db, api_key_record.id)
            
            # Return the user associated with this API key
            return User(
                id=api_key_record.user.id,
                email=api_key_record.user.email,
                username=api_key_record.user.username,
                is_active=api_key_record.user.is_active,
                created_at=api_key_record.user.created_at,
                updated_at=api_key_record.user.updated_at,
                groups=[]  # Groups handled by auth system
            )
    
    return None

async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_user: Optional[User] = Depends(get_user_from_api_key)
) -> User:
    """
    Get the current authenticated user from multiple sources:
    1. API key authentication (if provided)
    2. Proxy authentication middleware (if user was set in request.state.auth)
    3. Otherwise raise 401 Unauthorized
    
    This is much simpler than the previous implementation.
    """
    # If API key authentication was successful, return that user
    if api_user:
        return api_user
    
    # Check if auth middleware set a user
    user_email = getattr(request.state, 'user_email', None)
    if user_email:
            # Ensure user exists in database for API key operations
            db_user = await crud.get_user_by_email(db=db, email=user_email)
            if not db_user:
                user_create = UserCreate(email=user_email)
                db_user = await crud.create_user(db=db, user=user_create)
            
            # Return user with database ID
            return User(
                id=db_user.id,
                email=db_user.email,
                username=db_user.username,
                is_active=db_user.is_active,
                created_at=db_user.created_at,
                updated_at=db_user.updated_at,
                groups=[]  # Groups handled by auth system
            )
    
    # No authentication found
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Provide API key or ensure proxy auth headers are present.",
    )


def verify_hmac_signature(secret: str, body: bytes, timestamp: str, signature_header: str, skew_seconds: int = 300) -> bool:
    """Verify an HMAC SHA256 signature of the form 'sha256=hex'.
    Includes basic replay protection via timestamp skew check (UTC seconds epoch or ISO8601)."""
    import time, datetime as _dt
    try:
        if timestamp.isdigit():
            ts = int(timestamp)
        else:
            # attempt parse iso8601
            ts = int(_dt.datetime.fromisoformat(timestamp.replace('Z','+00:00')).timestamp())
        now = int(time.time())
        if abs(now - ts) > skew_seconds:
            return False
        if not signature_header.startswith('sha256='):
            return False
        provided = signature_header.split('=',1)[1]
        mac = hmac.new(secret.encode('utf-8'), msg=(timestamp.encode('utf-8') + b'.' + body), digestmod=hashlib.sha256)
        expected = mac.hexdigest()
        return hmac.compare_digest(provided, expected)
    except Exception:
        return False

def verify_hmac_signature_flexible(secret: str, body: bytes, timestamp: str, signature_header: str, skew_seconds: int = 300) -> bool:
    """Attempt HMAC verification using the raw body first; if that fails and body appears to be JSON,
    re-serialize the JSON with canonical formatting (sorted keys, consistent separators) and retry.
    This provides robustness against minor serialization differences (spacing, key ordering) between client and server.

    Security note: The canonical JSON re-serialization uses sorted keys to prevent semantic ambiguity.
    This ensures that different JSON representations with the same semantic meaning are treated consistently.
    """
    if verify_hmac_signature(secret, body, timestamp, signature_header, skew_seconds=skew_seconds):
        return True
    # Try canonical JSON re-dump if body decodes to JSON
    try:
        import json
        obj = json.loads(body.decode('utf-8'))
        # Use sorted keys for canonical representation to prevent semantic ambiguity
        alt = json.dumps(obj, sort_keys=True, separators=(',', ':')).encode('utf-8')
        if verify_hmac_signature(secret, alt, timestamp, signature_header, skew_seconds=skew_seconds):
            return True
    except Exception as e:
        # Alternate HMAC signature verification failed - this is expected when body format differs
        logger.debug(
            f"Alternate HMAC signature verification failed due to exception: {e}"
        )
    return False

async def requires_group_membership(
    required_group_id: str,
    current_user: User = Depends(get_current_user)
) -> bool:
    """
    Check if the current user is a member of the required group.
    Raises an HTTPException if the user is not a member.
    
    Args:
        required_group_id: The ID of the group to check membership for
        current_user: The current user
        
    Returns:
        True if the user is a member of the group
        
    Raises:
        HTTPException: If the user is not a member of the group
    """
    is_member = is_user_in_group(current_user.email, required_group_id)
    
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to group '{required_group_id}'.",
        )
    return True

async def resolve_user_id(user: User, db: AsyncSession) -> uuid.UUID:
    """
    Resolve a user's ID, creating the user in the database if they don't exist.
    This provides automatic mapping for user resolution.
    """
    if user.id is not None:
        return user.id
    
    # Look up user by email
    db_user = await crud.get_user_by_email(db=db, email=user.email)
    if db_user:
        user.id = db_user.id
        return db_user.id
    
    # Create user if they don't exist
    user_create = UserCreate(email=user.email, username=user.username, is_active=user.is_active)
    db_user = await crud.create_user(db=db, user=user_create, created_by=user.email)
    user.id = db_user.id
    return db_user.id

class UserContext:
    """
    Automatic user context injection for CRUD operations.
    This provides automatic mapping for user information.
    """
    def __init__(self, user: User):
        self.user = user
        self.email = user.email
        self.id = user.id

async def get_user_context(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> UserContext:
    """
    Get resolved user context with automatic ID resolution.
    This dependency provides automatic mapping for user operations.
    """
    # Ensure user ID is resolved
    await resolve_user_id(current_user, db)
    return UserContext(current_user)


async def require_api_key(
    api_user: Optional[User] = Depends(get_user_from_api_key)
) -> User:
    """
    Require API key authentication only (no header-based auth).
    Used for /api-key endpoints (scripts, automation, CLI tools).

    Args:
        api_user: User from API key (if valid key was provided)

    Returns:
        Authenticated User object

    Raises:
        HTTPException 401: If no valid API key is provided
    """
    if not api_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return api_user


async def get_raw_body(request: Request) -> bytes:
    """
    Get raw request body from cache.
    The BodyCacheMiddleware caches the body early in the request lifecycle.
    Used for HMAC verification - this is imported from ML analysis router.
    """
    if hasattr(request.state, "cached_body"):
        return request.state.cached_body
    # Fallback for non-cached requests (shouldn't happen for POST/PATCH/PUT)
    return await request.body()


async def get_current_user_from_api_key_only(
    api_user: Optional[User] = Depends(get_user_from_api_key)
) -> User:
    """Resolve current user using ONLY API key authentication.

    Used for /api-ml endpoints where dual authentication (API key + HMAC)
    is required. Header-based auth is intentionally not allowed here.
    """
    if not api_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required.")
    return api_user


async def require_hmac_auth(
    request: Request,
    current_user: User = Depends(get_current_user_from_api_key_only),
    body_bytes: bytes = Depends(get_raw_body)
) -> User:
    """
    Require both user authentication AND HMAC signature.
    Used for /api-ml endpoints (ML pipelines).

    This implements dual-layer security:
    1. User authentication (via API key or header-based auth)
    2. HMAC signature verification (proves authorized pipeline)

    Args:
        request: FastAPI request object
        current_user: Authenticated user (via API key dependency)
        body_bytes: Raw request body for HMAC verification

    Returns:
        Authenticated User object (if both layers pass)

    Raises:
        HTTPException 500: If HMAC secret not configured
        HTTPException 401: If HMAC signature is invalid or missing
    """
    # User is already authenticated via API key dependency
    # If HMAC is disabled via configuration, accept the request after
    # user auth succeeds. This is primarily for test environments.
    if not settings.ML_PIPELINE_REQUIRE_HMAC:
        return current_user

    # HMAC is required from this point onward
    if not settings.ML_CALLBACK_HMAC_SECRET:
        logger.error("HMAC authentication required but ML_CALLBACK_HMAC_SECRET not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="HMAC authentication not configured on server"
        )

    # Extract HMAC headers
    signature = request.headers.get("X-ML-Signature", "")
    timestamp = request.headers.get("X-ML-Timestamp", "0")

    # Verify signature
    if not verify_hmac_signature_flexible(
        settings.ML_CALLBACK_HMAC_SECRET,
        body_bytes,
        timestamp,
        signature,
        skew_seconds=settings.ML_HMAC_TIMESTAMP_SKEW_SECONDS,
    ):
        logger.warning("HMAC signature verification failed", extra={
            "user": current_user.email,
            "path": request.url.path,
            "has_signature": bool(signature),
            "has_timestamp": bool(timestamp and timestamp != "0")
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing HMAC signature."
        )

    return current_user
