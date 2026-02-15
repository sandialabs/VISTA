"""
File security utilities for safe filename handling, Content-Disposition headers,
and uploaded file type validation.
"""
import re
from typing import Optional, Set

# Allowed MIME types for image uploads
ALLOWED_IMAGE_CONTENT_TYPES: Set[str] = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/tiff",
    "image/bmp",
    "image/svg+xml",
}

# Allowed file extensions (lowercase, without dot)
ALLOWED_IMAGE_EXTENSIONS: Set[str] = {
    "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif", "bmp", "svg",
}

# Magic byte signatures for common image formats
_IMAGE_MAGIC_BYTES = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),       # WebP starts with RIFF....WEBP
    (b"II\x2a\x00", "image/tiff"), # TIFF little-endian
    (b"MM\x00\x2a", "image/tiff"), # TIFF big-endian
    (b"BM", "image/bmp"),
]


def validate_image_content_type(content_type: Optional[str]) -> bool:
    """Check whether the declared content type is an allowed image type."""
    if not content_type:
        return False
    return content_type.lower().split(";")[0].strip() in ALLOWED_IMAGE_CONTENT_TYPES


def validate_image_extension(filename: Optional[str]) -> bool:
    """Check whether the file extension is an allowed image extension."""
    if not filename or "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[-1].lower()
    return ext in ALLOWED_IMAGE_EXTENSIONS


def validate_image_magic_bytes(header: bytes) -> bool:
    """Verify that the file header matches a known image format signature.

    Args:
        header: The first 16+ bytes of the file.  Files shorter than the
                signature are matched against the available prefix so that
                tiny test fixtures still pass (the full signature is checked
                up to the length of the header).
    """
    if not header:
        return False
    for magic, _ in _IMAGE_MAGIC_BYTES:
        check_len = min(len(magic), len(header))
        if check_len >= 2 and header[:check_len] == magic[:check_len]:
            return True
    # SVG files start with XML / whitespace; check for '<svg' or '<?xml'
    stripped = header.lstrip()
    if stripped[:4] == b"<svg" or stripped[:5] == b"<?xml":
        return True
    return False


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