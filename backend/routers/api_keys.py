import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from utils.dependencies import get_current_user, generate_api_key, hash_api_key

router = APIRouter(
    tags=["API Keys"],
)

@router.post("/api-keys", response_model=schemas.ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    api_key: schemas.ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Create a new API key for the current user"""
    # Generate a new API key
    raw_key = generate_api_key()
    key_hash = hash_api_key(raw_key)
    
    # Create the API key in the database
    db_api_key = await crud.create_api_key(
        db=db, 
        api_key=api_key, 
        user_id=current_user.id, 
        key_hash=key_hash,
        created_by=current_user.email
    )
    
    # Return both the API key record and the raw key (only shown once)
    return schemas.ApiKeyCreateResponse(
        api_key=schemas.ApiKey.model_validate(db_api_key),
        key=raw_key
    )

@router.get("/api-keys", response_model=List[schemas.ApiKey])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """List all API keys for the current user (keys are masked for security)"""
    api_keys = await crud.get_api_keys_for_user(db=db, user_id=current_user.id)
    # Convert to dict and mask the key values for security
    result = []
    for key in api_keys:
        key_dict = {
            "id": key.id,
            "name": key.name,
            "user_id": key.user_id,
            "is_active": key.is_active,
            "last_used_at": key.last_used_at,
            "created_at": key.created_at,
            "updated_at": key.updated_at,
        }
        result.append(schemas.ApiKey.model_validate(key_dict))
    return result

@router.delete("/api-keys/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_api_key(
    api_key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Deactivate an API key"""
    # First, verify that the API key belongs to the current user
    api_keys = await crud.get_api_keys_for_user(db=db, user_id=current_user.id)
    if not any(key.id == api_key_id for key in api_keys):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found"
        )
    
    # Deactivate the API key
    success = await crud.deactivate_api_key(db=db, api_key_id=api_key_id, deactivated_by=current_user.email)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found"
        )