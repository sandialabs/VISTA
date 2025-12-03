"""
File security utilities for safe filename handling and Content-Disposition headers.
"""
import re
from typing import Optional


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal and header injection attacks.
    
    Args:
        filename: Original filename from user input
        
    Returns:
        Sanitized filename safe for Content-Disposition header
    """
    if not filename:
        return "download"
    
    # Remove path components - only keep the filename part
    filename = filename.split("/")[-1].split("\\")[-1]
    
    # Remove or replace dangerous characters
    # Allow alphanumeric, dots, dashes, underscores, spaces
    filename = re.sub(r'[^\w\s\-_\.]', '', filename)
    
    # Remove leading dots to prevent hidden files
    filename = filename.lstrip('.')
    
    # Limit length
    if len(filename) > 255:
        name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
        max_name_len = 255 - len(ext) - 1 if ext else 255
        filename = name[:max_name_len] + ('.' + ext if ext else '')
    
    # Fallback if filename becomes empty
    if not filename.strip():
        return "download"
    
    return filename.strip()


def get_content_disposition_header(filename: Optional[str], disposition: str = "inline") -> str:
    """
    Generate a secure Content-Disposition header with proper filename quoting.
    
    Args:
        filename: Original filename to sanitize and include
        disposition: Either "inline" or "attachment"
        
    Returns:
        Complete Content-Disposition header value
    """
    if disposition not in ("inline", "attachment"):
        disposition = "inline"
    
    if not filename:
        return f"{disposition}"
    
    sanitized_filename = sanitize_filename(filename)
    
    # Properly quote the filename to prevent header injection
    # Use double quotes and escape any internal quotes
    escaped_filename = sanitized_filename.replace('"', '\\"')
    
    return f'{disposition}; filename="{escaped_filename}"'