"""
Core group authorization function.
Single source of truth for group membership checks.
Companies should replace the _check_group_membership function with their real auth system.
"""

import logging
from typing import Dict, List
from .config import settings

logger = logging.getLogger(__name__)


def is_user_in_group(user_email: str, group_id: str) -> bool:
    """
    Single source of truth for group membership checks.
    Companies should customize the _check_group_membership function below.
    
    Args:
        user_email: The user's email address (already validated by middleware)
        group_id: The group ID to check membership for
        
    Returns:
        True if user is in the group, False otherwise
    """
    if not user_email or not group_id:
        return False
    
    # In debug/test mode, always allow access
    if settings.DEBUG or settings.SKIP_HEADER_CHECK:
        # Sanitize user input for logs to prevent injection
        safe_user_email = user_email.replace('\n', '').replace('\r', '') if user_email else 'unknown'
        safe_group_id = group_id.replace('\n', '').replace('\r', '') if group_id else 'unknown'
        logger.debug("DEBUG MODE: Allowing user access", extra={"user": safe_user_email, "group": safe_group_id})
        return True
    
    # Normalize inputs
    user_email = user_email.lower().strip()
    group_id = group_id.strip()
    
    # Call the actual group membership check
    is_member = _check_group_membership(user_email, group_id)
    
    # Sanitize for logging
    safe_user_email = user_email.replace('\n', '').replace('\r', '')
    safe_group_id = group_id.replace('\n', '').replace('\r', '')
    logger.info("Group membership check", extra={"user": safe_user_email, "group": safe_group_id, "result": is_member})
    return is_member


def _check_group_membership(user_email: str, group_id: str) -> bool:
    """
    Internal method to check group membership.
    
    **COMPANIES SHOULD REPLACE THIS FUNCTION** with their actual auth system integration.
    
    Examples of what to implement here:
    - Query LDAP/Active Directory
    - Call external auth service API  
    - Query database with user roles
    - Call OAuth2 userinfo endpoint
    - Integrate with enterprise SSO system
    
    Args:
        user_email: The user's email address (normalized)
        group_id: The group ID to check membership for (normalized)
        
    Returns:
        True if user is in the group, False otherwise
    """
    # TODO: Replace with actual auth system lookup
    # This is just a development/demo implementation
    
    # For development, simple user-to-group mapping
    user_group_mapping: Dict[str, List[str]] = {
        "admin@example.com": ["admin", "data-scientists", "project-alpha-group"],
        "scientist@example.com": ["data-scientists", "project-alpha-group"], 
        "user@example.com": ["project-alpha-group"],
        settings.MOCK_USER_EMAIL.lower(): settings.MOCK_USER_GROUPS,
    }
    
    user_groups = user_group_mapping.get(user_email, [])
    return group_id in user_groups