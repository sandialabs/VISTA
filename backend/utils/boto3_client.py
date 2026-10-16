import asyncio
import contextlib
import io
import logging
from collections.abc import Callable
from datetime import timedelta
from typing import TypeVar

import boto3
from botocore.exceptions import ClientError

from core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_S3_LIST_MAX_KEYS = 5000
DEFAULT_S3_LIST_MAX_SCAN_KEYS = 50_000

_BlockingResult = TypeVar("_BlockingResult")


def _endpoint_url(endpoint: str, *, use_ssl: bool) -> str:
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint
    scheme = "https" if use_ssl else "http"
    return f"{scheme}://{endpoint}"


class S3ObjectList(list[dict]):
    """Backward-compatible listing with raw-scan truncation state."""

    def __init__(self, values=(), *, scan_truncated: bool = False):
        super().__init__(values)
        self.scan_truncated = scan_truncated


async def _run_blocking_s3_call(call: Callable[[], _BlockingResult]) -> _BlockingResult:
    """Run boto3 work without abandoning its thread when the caller cancels.

    ``run_in_executor`` cannot stop a boto3 call that has already begun.  If
    the surrounding request is cancelled, wait for that call to settle before
    propagating cancellation so request-level storage semaphores remain held
    for the true lifetime of the operation.
    """

    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(None, call)
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError as cancelled:
        while not future.done():
            try:
                await asyncio.shield(future)
            except asyncio.CancelledError:
                continue
            except BaseException:
                break
        if future.done():
            # Retrieve any executor exception so it is not reported as an
            # unhandled Future; cancellation remains the public outcome.
            with contextlib.suppress(BaseException):
                future.result()
        raise cancelled


def sanitize_for_log(val: str) -> str:
    """Remove log injection characters from user-sourced input."""
    if not isinstance(val, str):
        val = str(val)
    return val.replace("\r\n", "").replace("\n", "").replace("\r", "")


if getattr(settings, "FAST_TEST_MODE", False):
    boto3_client = None
    logger.info("FAST_TEST_MODE: Skipping real S3 client initialization.")
else:
    # Initialize and test the real S3 client
    try:
        # Initialize boto3 client for S3
        endpoint_url = _endpoint_url(settings.S3_ENDPOINT, use_ssl=settings.S3_USE_SSL)

        # Basic startup info (avoid logging secrets)
        logger.info(
            "S3 configuration",
            extra={
                "endpoint": endpoint_url,
                "bucket": settings.S3_BUCKET,
                "region": settings.S3_REGION,
            },
        )

        boto3_client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
            config=boto3.session.Config(
                signature_version="s3v4", s3={"addressing_style": "path"}
            ),
        )
        # print("Boto3 S3 client initialized successfully")
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.error(
            "S3/MinIO client initialization failed",
            extra={
                "error_code": error_code,
                "error_message": error_message,
                "endpoint": endpoint_url,
                "bucket": settings.S3_BUCKET,
            },
        )
        boto3_client = None
    except Exception as e:
        error_msg = str(e)
        logger.error(
            "S3/MinIO client initialization error",
            extra={"error": error_msg, "error_type": type(e).__name__},
        )
        if "gaierror" in error_msg or "Name or service not known" in error_msg:
            logger.warning(
                "Cannot resolve MinIO/S3 hostname - server may not be running"
            )
        elif "Connection refused" in error_msg:
            logger.warning(
                "MinIO/S3 server connection refused - server may not be ready"
            )
        boto3_client = None

    # Test bucket access
    try:
        if boto3_client:
            boto3_client.head_bucket(Bucket=settings.S3_BUCKET)
            logger.info("Successfully connected to S3")
        else:
            logger.warning("Cannot test S3 connection: boto3_client is not initialized")
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        error_message = e.response.get("Error", {}).get("Message", str(e))

        if error_code == "404":
            logger.info(
                "S3 bucket will be created during startup",
                extra={"bucket": settings.S3_BUCKET},
            )
        elif error_code == "403":
            logger.error(
                "S3/MinIO connection test failed - access denied",
                extra={
                    "error_code": error_code,
                    "error_message": error_message,
                    "bucket": settings.S3_BUCKET,
                },
            )
            logger.warning("Access denied to S3/MinIO bucket - check credentials")
        else:
            logger.error(
                "S3/MinIO connection test failed",
                extra={
                    "error_code": error_code,
                    "error_message": error_message,
                    "bucket": settings.S3_BUCKET,
                },
            )
    except Exception as e:
        error_msg = str(e)
        logger.error(
            "S3/MinIO connection test error",
            extra={"error": error_msg, "error_type": type(e).__name__},
        )
        if "gaierror" in error_msg or "Name or service not known" in error_msg:
            logger.warning("Cannot reach MinIO/S3 server - hostname resolution failed")
        elif "Connection refused" in error_msg:
            logger.warning("MinIO/S3 server refused connection - may still be starting")


def ensure_bucket_exists(client, bucket_name: str):
    if not client:
        logger.error("Boto3 S3 client not initialized")
        return False
    try:
        # Check if bucket exists
        client.head_bucket(Bucket=bucket_name)
        logger.info("Bucket already exists", extra={"bucket": bucket_name})
        return True
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        error_message = e.response.get("Error", {}).get("Message", str(e))

        if error_code == "404":
            # Bucket doesn't exist, create it
            logger.info(
                "Bucket not found, attempting to create", extra={"bucket": bucket_name}
            )
            try:
                client.create_bucket(Bucket=bucket_name)
                logger.info(
                    "Bucket created successfully", extra={"bucket": bucket_name}
                )
                return True
            except ClientError as create_error:
                create_error_code = create_error.response.get("Error", {}).get("Code")
                create_error_message = create_error.response.get("Error", {}).get(
                    "Message", str(create_error)
                )
                logger.error(
                    "Error creating bucket",
                    extra={
                        "bucket": bucket_name,
                        "error_code": create_error_code,
                        "error_message": create_error_message,
                    },
                )
                return False
        else:
            logger.error(
                "Error checking bucket",
                extra={
                    "bucket": bucket_name,
                    "error_code": error_code,
                    "error_message": error_message,
                },
            )
            return False
    except Exception as e:
        logger.error(
            "Unexpected error with S3 bucket operations",
            extra={
                "bucket": bucket_name,
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return False


# async def upload_file_to_minio(
#     bucket_name: str,
#     object_name: str,
#     file_data: io.BytesIO,
#     length: int,
#     content_type: str = "application/octet-stream"
# ) -> bool:
#     if not boto3_client:
#         print("Boto3 S3 client not initialized. Cannot upload.")
#         return False
#     try:
#         # Reset file pointer to beginning
#         file_data.seek(0)

#         # Upload file to S3
#         boto3_client.upload_fileobj(
#             file_data,
#             bucket_name,
#             object_name,
#             ExtraArgs={
#                 'ContentType': content_type
#             }
#         )
#         print(f"Successfully uploaded {object_name} to bucket {bucket_name}")
#         return True
#     except ClientError as e:
#         print(f"S3 Error during upload of {object_name}: {e}")
#         return False
#     except Exception as e:
#         print(f"An unexpected error occurred during upload of {object_name}: {e}")
#         return False


# old upload_file_to_minio
async def upload_file_to_s3(
    bucket_name: str,
    object_name: str,
    file_data: io.IOBase,
    length: int | None = None,
    content_type: str = "application/octet-stream",
) -> bool:
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot upload")
        return False
    try:
        # Ensure at start
        try:
            file_data.seek(0)
        except Exception as e:
            # Some file-like objects don't support seek, log and continue
            logger.warning(
                "File seek operation failed, continuing with current position",
                extra={"error": str(e), "error_type": type(e).__name__},
            )

        # Run blocking boto3 call in a thread to avoid blocking the event loop
        await _run_blocking_s3_call(
            lambda: boto3_client.upload_fileobj(
                file_data,
                bucket_name,
                object_name,
                ExtraArgs={"ContentType": content_type},
            )
        )
        logger.debug(
            "Successfully uploaded file to bucket",
            extra={
                "object_name": object_name,
                "bucket": bucket_name,
                "content_type": content_type,
            },
        )
        return True
    except ClientError as e:
        logger.error(
            "S3 error during file upload",
            extra={
                "object_name": object_name,
                "bucket": bucket_name,
                "error": str(e),
                "error_type": "ClientError",
            },
        )
        return False
    except Exception as e:
        logger.error(
            "Unexpected error during file upload",
            extra={
                "object_name": object_name,
                "bucket": bucket_name,
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return False


async def list_s3_objects(
    bucket_name: str,
    prefix: str = "",
    max_keys: int = DEFAULT_S3_LIST_MAX_KEYS,
    *,
    key_filter: Callable[[str], bool] | None = None,
    max_scan_keys: int | None = None,
) -> S3ObjectList:
    """List matching objects while bounding the number of raw keys scanned.

    ``max_keys`` applies after ``key_filter``.  This prevents unsupported keys
    at the start of a large bucket from hiding supported files later in the
    listing.  At most ``MAX_S3_LIST_SCAN_KEYS`` raw objects are inspected per
    request unless the caller supplies a smaller explicit bound.
    """
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot list objects")
        return []

    try:
        safe_max_keys = max(1, int(max_keys or DEFAULT_S3_LIST_MAX_KEYS))
        if max_scan_keys is None:
            max_scan_keys = settings.MAX_S3_LIST_SCAN_KEYS
        safe_scan_keys = max(1, int(max_scan_keys or DEFAULT_S3_LIST_MAX_SCAN_KEYS))
        paginator = boto3_client.get_paginator("list_objects_v2")

        def _collect():
            objects = []
            raw_count = 0
            scan_truncated = False
            for page in paginator.paginate(
                Bucket=bucket_name,
                Prefix=prefix or "",
                PaginationConfig={
                    "MaxItems": safe_scan_keys,
                    "PageSize": min(safe_scan_keys, 1000),
                },
            ):
                for obj in page.get("Contents", []):
                    if raw_count >= safe_scan_keys:
                        scan_truncated = True
                        break
                    raw_count += 1
                    key = str(obj.get("Key") or "")
                    if key_filter is None or key_filter(key):
                        objects.append(obj)
                        if len(objects) >= safe_max_keys:
                            scan_truncated = True
                            break
                if len(objects) >= safe_max_keys:
                    break
                if raw_count >= safe_scan_keys:
                    # Conservatively report truncation at the configured raw
                    # bound. A false-positive at an exact bucket boundary is
                    # preferable to claiming that an unscanned suffix is empty.
                    scan_truncated = True
                    break
            return objects[:safe_max_keys], scan_truncated

        raw_objects, scan_truncated = await _run_blocking_s3_call(_collect)
        return S3ObjectList(
            [
                {
                    "key": obj.get("Key", ""),
                    "size": int(obj.get("Size") or 0),
                    "last_modified": obj.get("LastModified"),
                    "etag": obj.get("ETag"),
                }
                for obj in raw_objects
            ],
            scan_truncated=scan_truncated,
        )
    except ClientError as e:
        logger.error(
            "S3 error listing objects",
            extra={
                "bucket": sanitize_for_log(bucket_name),
                "prefix": sanitize_for_log(prefix),
                "error": str(e),
            },
        )
        raise
    except Exception as e:
        logger.error(
            "Unexpected error listing objects",
            extra={
                "bucket": sanitize_for_log(bucket_name),
                "prefix": sanitize_for_log(prefix),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        raise


async def get_s3_object_info(bucket_name: str, object_name: str) -> dict | None:
    """Return metadata for an object in S3."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot inspect object")
        return None

    try:
        response = await _run_blocking_s3_call(
            lambda: boto3_client.head_object(Bucket=bucket_name, Key=object_name)
        )
        return {
            "content_type": response.get("ContentType"),
            "size": int(response.get("ContentLength") or 0),
            "metadata": response.get("Metadata") or {},
            "last_modified": response.get("LastModified"),
            "etag": response.get("ETag"),
        }
    except ClientError as e:
        logger.error(
            "S3 error inspecting object",
            extra={
                "bucket": sanitize_for_log(bucket_name),
                "object_name": sanitize_for_log(object_name),
                "error": str(e),
            },
        )
        return None
    except Exception as e:
        logger.error(
            "Unexpected error inspecting object",
            extra={
                "bucket": sanitize_for_log(bucket_name),
                "object_name": sanitize_for_log(object_name),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return None


async def copy_s3_object_to_s3(
    source_bucket: str,
    source_key: str,
    destination_bucket: str,
    destination_key: str,
    *,
    source_etag: str | None = None,
) -> bool:
    """Copy an object, optionally requiring the source HEAD ETag to still match."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot copy object")
        return False

    try:
        copy_args = {
            "Bucket": destination_bucket,
            "Key": destination_key,
            "CopySource": {"Bucket": source_bucket, "Key": source_key},
        }
        if source_etag:
            copy_args["CopySourceIfMatch"] = source_etag
        await _run_blocking_s3_call(
            lambda: boto3_client.copy_object(
                **copy_args,
            )
        )
        logger.debug(
            "Copied S3 object",
            extra={
                "source_bucket": sanitize_for_log(source_bucket),
                "source_key": sanitize_for_log(source_key),
                "destination_bucket": sanitize_for_log(destination_bucket),
                "destination_key": sanitize_for_log(destination_key),
            },
        )
        return True
    except ClientError as e:
        logger.error(
            "S3 error copying object",
            extra={
                "source_bucket": sanitize_for_log(source_bucket),
                "source_key": sanitize_for_log(source_key),
                "destination_bucket": sanitize_for_log(destination_bucket),
                "destination_key": sanitize_for_log(destination_key),
                "error": str(e),
            },
        )
        return False
    except Exception as e:
        logger.error(
            "Unexpected error copying object",
            extra={
                "source_bucket": sanitize_for_log(source_bucket),
                "source_key": sanitize_for_log(source_key),
                "destination_bucket": sanitize_for_log(destination_bucket),
                "destination_key": sanitize_for_log(destination_key),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return False


def get_presigned_download_url(
    bucket_name: str, object_name: str, expires_delta: timedelta = timedelta(hours=1)
) -> str | None:
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot generate URL")
        return None

    try:
        # Generate presigned URL with expiration time
        expires_in = int(expires_delta.total_seconds())
        url = boto3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket_name, "Key": object_name},
            ExpiresIn=expires_in,
        )
        logger.debug(
            "Generated presigned URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "expires_in": expires_in,
            },
        )
        return url
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.error(
            "S3 error generating presigned URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error_code": error_code,
                "error_message": error_message,
            },
        )
        return None
    except Exception as e:
        logger.error(
            "Unexpected error generating presigned URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return None


def get_presigned_upload_url(
    bucket_name: str,
    object_name: str,
    expires_delta: timedelta = timedelta(minutes=15),
    content_type: str = "application/octet-stream",
) -> str | None:
    """Generate a presigned URL for uploading a file to S3/MinIO using PUT method."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot generate upload URL")
        return None

    try:
        # Generate presigned URL for PUT operation
        expires_in = int(expires_delta.total_seconds())
        url = boto3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket_name,
                "Key": object_name,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
            HttpMethod="PUT",
        )
        logger.debug(
            "Generated presigned upload URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "expires_in": expires_in,
                "content_type": content_type,
            },
        )
        return url
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.error(
            "S3 error generating presigned upload URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error_code": error_code,
                "error_message": error_message,
            },
        )
        return None
    except Exception as e:
        logger.error(
            "Unexpected error generating presigned upload URL",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return None


def delete_file_from_s3(bucket_name: str, object_name: str) -> bool:
    """Delete an object from S3/MinIO. Returns True if deleted or object missing, False on error."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot delete object")
        return False
    try:
        boto3_client.delete_object(Bucket=bucket_name, Key=object_name)
        logger.debug(
            "Deleted object from bucket",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
            },
        )
        return True
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code")
        if error_code in ("NoSuchKey", "404"):
            logger.debug(
                "Object already missing when attempting delete",
                extra={
                    "object_name": sanitize_for_log(object_name),
                    "bucket": sanitize_for_log(bucket_name),
                },
            )
            return True
        logger.error(
            "S3 error deleting object",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error": str(e),
            },
        )
        return False
    except Exception as e:
        logger.error(
            "Unexpected error deleting object",
            extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name),
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        return False
