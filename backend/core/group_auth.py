"""
Core group authorization function.
Single source of truth for group membership checks.

This module is fail-closed by default: ``_check_group_membership`` raises
``NotImplementedError`` unless ``VISTA_AUTH_BACKEND`` is explicitly set.

Companies integrating VISTA should replace ``_check_group_membership`` with
their real auth system (LDAP, OIDC, etc.) and set ``VISTA_AUTH_BACKEND=custom``.
The built-in ``demo`` backend is for development and automated tests only and
is refused in production (see ``Settings.validate_production_safety``).
"""

import logging
from typing import Dict, Iterable, List
from . import group_snapshot
from .config import settings

logger = logging.getLogger(__name__)


def parse_groups_header(values: Iterable[str] | None) -> frozenset[str]:
    """Group names from the proxy's groups header: every value, comma separated."""
    groups = set()
    for value in values or ():
        for name in str(value).split(","):
            name = name.strip()
            if name:
                groups.add(name)
    return frozenset(groups)


def _custom_check_group_membership(user_email: str, group_id: str) -> bool:
    """Membership from the groups the authenticating proxy last asserted for this
    user (core.group_snapshot). Fail closed: no snapshot, or an expired one, is
    not a member."""
    return group_snapshot.is_member(user_email, group_id)


# Hardcoded demo emails that must never resolve as members in a non-demo
# backend. Used by the startup self-test.
_DEMO_EMAILS = (
    "admin@example.com",
    "scientist@example.com",
    "user@example.com",
)


def is_user_in_group(user_email: str, group_id: str) -> bool:
    """
    Single source of truth for group membership checks.

    Args:
        user_email: The user's email address (already validated by middleware)
        group_id: The group ID to check membership for

    Returns:
        True if user is in the group, False otherwise
    """
    if not user_email or not group_id:
        return False

    # Debug/test bypass: allow access when DEBUG or SKIP_HEADER_CHECK is set,
    # but only outside production. ``validate_production_safety`` refuses to
    # start the app if production has these flags on, so reaching this branch
    # in production would indicate tampering -- fail closed.
    if settings.DEBUG or settings.SKIP_HEADER_CHECK:
        if settings.is_production:
            logger.error(
                "Refusing DEBUG/SKIP_HEADER_CHECK bypass in production",
                extra={"env": settings.ENV},
            )
            return False
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


def _demo_check_group_membership(user_email: str, group_id: str) -> bool:
    """Hardcoded development/test mapping. NEVER call directly in production.

    Enabled only when ``VISTA_AUTH_BACKEND=demo`` and the process is not
    running with ``ENV=production``.
    """
    user_group_mapping: Dict[str, List[str]] = {
        "admin@example.com": ["admin", "data-scientists", "project-alpha-group"],
        "scientist@example.com": ["data-scientists", "project-alpha-group"],
        "user@example.com": ["project-alpha-group"],
        settings.MOCK_USER_EMAIL.lower(): settings.MOCK_USER_GROUPS,
    }
    user_groups = user_group_mapping.get(user_email, [])
    return group_id in user_groups


def _check_group_membership(user_email: str, group_id: str) -> bool:
    """
    Internal method to check group membership.

    **Fail-closed by default.** Integrators must either:

    - Set ``VISTA_AUTH_BACKEND=demo`` for local development/testing (refused
      in production).
    - Replace this function with a real auth-system integration and set
      ``VISTA_AUTH_BACKEND=custom``. Examples:

          * Query LDAP/Active Directory
          * Call an external auth service API
          * Query a database with user roles
          * Call an OAuth2 userinfo endpoint

    Args:
        user_email: The user's email address (normalized)
        group_id: The group ID to check membership for (normalized)

    Returns:
        True if user is in the group, False otherwise
    """
    backend = (settings.VISTA_AUTH_BACKEND or "").strip().lower()

    if backend == "demo":
        if settings.is_production:
            logger.error(
                "Refusing demo auth backend in production",
                extra={"env": settings.ENV},
            )
            return False
        return _demo_check_group_membership(user_email, group_id)

    if backend == "custom":
        # The groups the authenticating proxy last asserted for this user
        # (X_USER_GROUPS_HEADER), kept by core.group_snapshot.
        return _custom_check_group_membership(user_email, group_id)

    raise NotImplementedError(
        "Group authorization is not configured. Set VISTA_AUTH_BACKEND=demo "
        "for local development, or VISTA_AUTH_BACKEND=custom and replace "
        "core.group_auth._check_group_membership with your auth system."
    )


def run_auth_startup_self_test() -> None:
    """Fail-closed startup self-test for the group-auth backend.

    Called from the FastAPI lifespan on startup (outside FAST_TEST_MODE).
    Behavior:

    - If ``VISTA_AUTH_BACKEND`` is unset or unknown: raise RuntimeError.
    - If backend == "demo" and ENV == "production": raise RuntimeError.
    - If backend != "demo": verify that the hardcoded demo emails resolve
      as NOT-members of the demo groups. If any demo email still grants
      access, the integrator forgot to replace the helper -- raise.
    """
    backend = (settings.VISTA_AUTH_BACKEND or "").strip().lower()

    if not backend:
        raise RuntimeError(
            "VISTA_AUTH_BACKEND is not set. Refusing to start. "
            "Set VISTA_AUTH_BACKEND=demo for development, or "
            "VISTA_AUTH_BACKEND=custom after replacing "
            "core.group_auth._check_group_membership."
        )

    if backend not in ("demo", "custom"):
        raise RuntimeError(
            f"Unknown VISTA_AUTH_BACKEND={backend!r}. "
            "Expected 'demo' or 'custom'."
        )

    if (
        backend == "custom"
        and not (settings.DEBUG or settings.SKIP_HEADER_CHECK)
        and not settings.PROXY_SHARED_SECRET
    ):
        raise RuntimeError(
            "VISTA_AUTH_BACKEND=custom takes the user's groups from the proxy's "
            "headers, which are trusted only when PROXY_SHARED_SECRET is set. "
            "Refusing to start without it."
        )

    if backend == "demo" and settings.is_production:
        raise RuntimeError(
            "VISTA_AUTH_BACKEND=demo is not allowed when ENV=production."
        )

    # Fail closed if the demo emails still resolve as members under a
    # non-demo backend. This catches deployments where an integrator
    # configured VISTA_AUTH_BACKEND=custom but either forgot to replace the
    # stub (NotImplementedError) or replaced it with something that still
    # grants the demo emails access.
    if backend != "demo":
        for email in _DEMO_EMAILS:
            for group in ("admin", "data-scientists", "project-alpha-group"):
                try:
                    granted = _check_group_membership(email, group)
                except NotImplementedError as exc:
                    raise RuntimeError(
                        "VISTA_AUTH_BACKEND=custom is set but "
                        "core.group_auth._check_group_membership still "
                        "raises NotImplementedError. Replace it with a "
                        "real auth integration."
                    ) from exc
                if granted:
                    raise RuntimeError(
                        "Auth backend self-test failed: demo email "
                        f"{email!r} resolved as a member of {group!r}. "
                        "Replace core.group_auth._check_group_membership "
                        "with a real auth integration before running "
                        "outside demo mode."
                    )
