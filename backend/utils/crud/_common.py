import uuid
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)


def _sanitize_log_value(value):
    """Strip newline/carriage-return characters from a value to prevent log injection."""
    if isinstance(value, str):
        return value.replace('\n', '').replace('\r', '')
    if isinstance(value, dict):
        return {k: _sanitize_log_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_log_value(item) for item in value]
    return value


def log_db_operation(operation: str, table: str, record_id: uuid.UUID, user_email: str, additional_info: Optional[Dict] = None):
    """Log database operations with user information"""
    # Sanitize user input to prevent log injection
    safe_user_domain = 'unknown'
    if user_email and '@' in user_email:
        # Only log the domain part to avoid logging PII
        domain = user_email.split('@')[-1]
        safe_user_domain = domain.replace('\n', '').replace('\r', '')
    elif user_email:
        safe_user_domain = 'local'  # For cases without @ symbol

    safe_operation = operation.replace('\n', '').replace('\r', '') if operation else 'unknown'
    safe_table = table.replace('\n', '').replace('\r', '') if table else 'unknown'

    log_data = {
        "operation": safe_operation,
        "table": safe_table,
        "record_id": str(record_id),
        "user_domain": safe_user_domain,  # Only log domain, not full email
        "additional_info": _sanitize_log_value(additional_info) or {}
    }
    logger.info("DB_OPERATION", extra=log_data)
