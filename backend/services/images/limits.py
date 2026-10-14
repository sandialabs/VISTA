"""Byte, count, and concurrency limits for image uploads and S3 imports."""

from collections.abc import Callable

DEFAULT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024
DEFAULT_BATCH_UPLOAD_MAX_FILES = 100
DEFAULT_BATCH_UPLOAD_MAX_BYTES = 256 * 1024 * 1024
DEFAULT_BATCH_UPLOAD_MAX_MANIFEST_BYTES = 8 * 1024 * 1024
DEFAULT_BATCH_UPLOAD_CONCURRENCY = 6
MAX_BATCH_UPLOAD_CONCURRENCY = 6
DEFAULT_BATCH_METADATA_MAX_BYTES = 1024 * 1024
DEFAULT_BATCH_METADATA_MAX_DEPTH = 32
DEFAULT_BATCH_METADATA_MAX_ITEMS = 10_000
DEFAULT_BATCH_METADATA_MAX_STRING_BYTES = 1024 * 1024
DEFAULT_BATCH_METADATA_MAX_KEY_BYTES = 4096
DEFAULT_S3_LIST_MAX_KEYS = 5000
DEFAULT_S3_IMPORT_CONCURRENCY = 6
MAX_S3_IMPORT_CONCURRENCY = 6


def format_byte_limit(byte_count: int) -> str:
    """Format a byte count as a human-readable GiB string."""
    gib = byte_count / (1024**3)
    return f"{gib:.1f} GiB ({byte_count} bytes)"


def positive_setting_int(value: int, default: int) -> int:
    """Return `value` as a positive int, or `default` if invalid or non-positive."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def upload_size_limit(
    max_upload_bytes: int,
    *,
    default: int = DEFAULT_UPLOAD_MAX_BYTES,
) -> int:
    """Return the configured single-file upload size limit in bytes."""
    return positive_setting_int(max_upload_bytes, default)


def batch_upload_file_limit(max_batch_upload_files: int) -> int:
    """Return the configured maximum number of files per batch upload."""
    return positive_setting_int(
        max_batch_upload_files,
        DEFAULT_BATCH_UPLOAD_MAX_FILES,
    )


def batch_upload_byte_limit(max_batch_upload_bytes: int) -> int:
    """Return the configured maximum total bytes per batch upload."""
    return positive_setting_int(
        max_batch_upload_bytes,
        DEFAULT_BATCH_UPLOAD_MAX_BYTES,
    )


def batch_upload_manifest_byte_limit(max_batch_upload_manifest_bytes: int) -> int:
    """Return the configured maximum byte size of a batch upload manifest."""
    return positive_setting_int(
        max_batch_upload_manifest_bytes,
        DEFAULT_BATCH_UPLOAD_MAX_MANIFEST_BYTES,
    )


def batch_metadata_byte_limit(max_batch_metadata_bytes: int) -> int:
    """Return the configured maximum byte size of batch metadata."""
    return positive_setting_int(
        max_batch_metadata_bytes,
        DEFAULT_BATCH_METADATA_MAX_BYTES,
    )


def batch_metadata_depth_limit(max_batch_metadata_depth: int) -> int:
    """Return the configured maximum nesting depth of batch metadata."""
    return positive_setting_int(
        max_batch_metadata_depth,
        DEFAULT_BATCH_METADATA_MAX_DEPTH,
    )


def batch_metadata_item_limit(max_batch_metadata_items: int) -> int:
    """Return the configured maximum number of batch metadata items."""
    return positive_setting_int(
        max_batch_metadata_items,
        DEFAULT_BATCH_METADATA_MAX_ITEMS,
    )


def batch_metadata_string_byte_limit(max_batch_metadata_string_bytes: int) -> int:
    """Return the configured maximum total bytes of batch metadata strings."""
    return positive_setting_int(
        max_batch_metadata_string_bytes,
        DEFAULT_BATCH_METADATA_MAX_STRING_BYTES,
    )


def batch_metadata_key_byte_limit(max_batch_metadata_key_bytes: int) -> int:
    """Return the configured maximum byte size of a batch metadata key."""
    return positive_setting_int(
        max_batch_metadata_key_bytes,
        DEFAULT_BATCH_METADATA_MAX_KEY_BYTES,
    )


def bounded_concurrency(
    configured_value: int,
    *,
    default: int,
    maximum: int,
) -> int:
    """Return the configured concurrency clamped to at most `maximum`."""
    configured = positive_setting_int(configured_value, default)
    return min(configured, maximum)


def batch_upload_concurrency(max_batch_upload_concurrency: int) -> int:
    """Return the configured concurrency limit for batch uploads."""
    return bounded_concurrency(
        max_batch_upload_concurrency,
        default=DEFAULT_BATCH_UPLOAD_CONCURRENCY,
        maximum=MAX_BATCH_UPLOAD_CONCURRENCY,
    )


def s3_list_key_limit(max_s3_list_keys: int) -> int:
    """Return the configured maximum number of keys per S3 list request."""
    return positive_setting_int(max_s3_list_keys, DEFAULT_S3_LIST_MAX_KEYS)


def s3_import_concurrency(max_s3_import_concurrency: int) -> int:
    """Return the configured concurrency limit for S3 imports."""
    return bounded_concurrency(
        max_s3_import_concurrency,
        default=DEFAULT_S3_IMPORT_CONCURRENCY,
        maximum=MAX_S3_IMPORT_CONCURRENCY,
    )


def file_too_large_detail(
    filename: str | None,
    file_size: int,
    max_size: int,
    *,
    formatter: Callable[[int], str] = format_byte_limit,
) -> str:
    """Build the error detail message for a file exceeding its size limit."""
    name = filename or "Uploaded file"
    return (
        f"{name} is too large: {file_size} bytes exceeds the built-in "
        f"upload size limit of {formatter(max_size)}. "
        "Set MAX_UPLOAD_BYTES to adjust this limit."
    )
