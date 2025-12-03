"""
Core security validation and authorization logic.
Single source of truth for all auth decisions.
"""

import time
import logging
from typing import Dict, Tuple
from .config import settings

logger = logging.getLogger(__name__)

# Simple in-memory cache for group membership checks
# Format: {(user_email, group_id): (is_member, timestamp)}
_group_membership_cache: Dict[Tuple[str, str], Tuple[bool, float]] = {}
_CACHE_TTL = 300  # 5 minutes


class SecurityValidator:
    """Centralized security validation for authorization decisions."""

    def __init__(self):
        pass

    def is_user_in_group(self, user_email: str, group_id: str) -> bool:
        """
        Single source of truth for group membership checks.
        Includes caching for performance.
        
        Args:
            user_email: The user's email address
            group_id: The group ID to check membership for
            
        Returns:
            True if user is in the group, False otherwise
        """
        if not user_email or not group_id:
            return False
        
        # In debug mode, always allow access
        if settings.DEBUG or settings.SKIP_HEADER_CHECK:
            logger.debug(f"DEBUG MODE: Allowing {user_email} access to group {group_id}")
            return True
        
        # Normalize inputs
        user_email = user_email.lower().strip()
        group_id = group_id.strip()
        
        cache_key = (user_email, group_id)
        current_time = time.time()
        
        # Check cache first
        if cache_key in _group_membership_cache:
            is_member, cached_time = _group_membership_cache[cache_key]
            if current_time - cached_time < _CACHE_TTL:
                logger.debug(f"Cache hit: {user_email} in {group_id} = {is_member}")
                return is_member
            else:
                # Cache expired, remove entry
                del _group_membership_cache[cache_key]
        
        # Look up group membership
        is_member = self._check_group_membership(user_email, group_id)
        
        # Cache the result
        _group_membership_cache[cache_key] = (is_member, current_time)
        
        logger.info(f"Group membership check: {user_email} in {group_id} = {is_member}")
        return is_member
    
    def _check_group_membership(self, user_email: str, group_id: str) -> bool:
        """
        Internal method to check group membership.
        Replace this with your actual auth system integration.
        """
        # TODO: Replace with actual auth system lookup
        # Examples:
        # - Query LDAP/Active Directory
        # - Call external auth service API
        # - Query database with user roles
        # - Call OAuth2 userinfo endpoint
        
        # For development, simple user-to-group mapping
        user_group_mapping = {
            "admin@example.com": ["admin", "data-scientists", "project-alpha-group"],
            "scientist@example.com": ["data-scientists", "project-alpha-group"],
            "user@example.com": ["project-alpha-group"],
            settings.MOCK_USER_EMAIL: settings.MOCK_USER_GROUPS,
        }
        
        user_groups = user_group_mapping.get(user_email, [])
        return group_id in user_groups


# Global instance - single source of truth
security_validator = SecurityValidator()


def is_user_in_group(user_email: str, group_id: str) -> bool:
    """
    Convenience function for the global security validator.
    Single source of truth for group membership checks.
    """
    return security_validator.is_user_in_group(user_email, group_id)
