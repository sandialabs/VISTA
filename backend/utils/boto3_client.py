import os
import boto3
import logging
from botocore.exceptions import ClientError
from core.config import settings
from datetime import timedelta
import io

logger = logging.getLogger(__name__)

def sanitize_for_log(val: str) -> str:
    """Remove log injection characters from user-sourced input."""
    if not isinstance(val, str):
        val = str(val)
    return val.replace('\r\n', '').replace('\n', '').replace('\r', '')

if getattr(settings, 'FAST_TEST_MODE', False):
    boto3_client = None
    logger.info("FAST_TEST_MODE: Skipping real S3 client initialization.")
else:
    # Initialize and test the real S3 client
    try:
        # Initialize boto3 client for S3
        S3_REGION = os.getenv("S3_REGION", "us-east-1")

        # Ensure endpoint URL has http:// or https:// prefix
        endpoint_url = settings.S3_ENDPOINT
        if not endpoint_url.startswith("http://") and not endpoint_url.startswith("https://"):
            if settings.S3_USE_SSL:
                endpoint_url = f"https://{endpoint_url}"
            else:
                endpoint_url = f"http://{endpoint_url}"

        # Basic startup info (avoid logging secrets)
        logger.info("S3 configuration", extra={
            "endpoint": endpoint_url,
            "bucket": settings.S3_BUCKET,
            "region": S3_REGION
        })

        boto3_client = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=S3_REGION,
            config=boto3.session.Config(signature_version='s3v4', s3={'addressing_style': 'path'})
        )
        # print("Boto3 S3 client initialized successfully")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error("S3/MinIO client initialization failed", extra={
            "error_code": error_code,
            "error_message": error_message,
            "endpoint": endpoint_url,
            "bucket": settings.S3_BUCKET
        })
        boto3_client = None
    except Exception as e:
        error_msg = str(e)
        logger.error("S3/MinIO client initialization error", extra={
            "error": error_msg,
            "error_type": type(e).__name__
        })
        if "gaierror" in error_msg or "Name or service not known" in error_msg:
            logger.warning("Cannot resolve MinIO/S3 hostname - server may not be running")
        elif "Connection refused" in error_msg:
            logger.warning("MinIO/S3 server connection refused - server may not be ready")
        boto3_client = None

    # Test bucket access
    try:
        if boto3_client:
            boto3_client.head_bucket(Bucket=settings.S3_BUCKET)
            logger.info("Successfully connected to S3")
        else:
            logger.warning("Cannot test S3 connection: boto3_client is not initialized")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        error_message = e.response.get('Error', {}).get('Message', str(e))

        if error_code == '404':
            logger.info("S3 bucket will be created during startup", extra={
                "bucket": settings.S3_BUCKET
            })
        elif error_code == '403':
            logger.error("S3/MinIO connection test failed - access denied", extra={
                "error_code": error_code,
                "error_message": error_message,
                "bucket": settings.S3_BUCKET
            })
            logger.warning("Access denied to S3/MinIO bucket - check credentials")
        else:
            logger.error("S3/MinIO connection test failed", extra={
                "error_code": error_code,
                "error_message": error_message,
                "bucket": settings.S3_BUCKET
            })
    except Exception as e:
        error_msg = str(e)
        logger.error("S3/MinIO connection test error", extra={
            "error": error_msg,
            "error_type": type(e).__name__
        })
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
        error_code = e.response.get('Error', {}).get('Code')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        
        if error_code == '404':
            # Bucket doesn't exist, create it
            logger.info("Bucket not found, attempting to create", extra={"bucket": bucket_name})
            try:
                client.create_bucket(Bucket=bucket_name)
                logger.info("Bucket created successfully", extra={"bucket": bucket_name})
                return True
            except ClientError as create_error:
                create_error_code = create_error.response.get('Error', {}).get('Code')
                create_error_message = create_error.response.get('Error', {}).get('Message', str(create_error))
                logger.error("Error creating bucket", extra={
                    "bucket": bucket_name,
                    "error_code": create_error_code,
                    "error_message": create_error_message
                })
                return False
        else:
            logger.error("Error checking bucket", extra={
                "bucket": bucket_name,
                "error_code": error_code,
                "error_message": error_message
            })
            return False
    except Exception as e:
        logger.error("Unexpected error with S3 bucket operations", extra={
            "bucket": bucket_name,
            "error": str(e),
            "error_type": type(e).__name__
        })
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
    content_type: str = "application/octet-stream"
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
            logger.warning("File seek operation failed, continuing with current position", extra={
                "error": str(e),
                "error_type": type(e).__name__
            })
        
        # Stream upload to S3 without buffering whole file in memory
        boto3_client.upload_fileobj(
            file_data,
            bucket_name,
            object_name,
            ExtraArgs={
                'ContentType': content_type
            }
        )
        logger.info("Successfully uploaded file to bucket", extra={
            "object_name": object_name,
            "bucket": bucket_name,
            "content_type": content_type
        })
        return True
    except ClientError as e:
        logger.error("S3 error during file upload", extra={
            "object_name": object_name,
            "bucket": bucket_name,
            "error": str(e),
            "error_type": "ClientError"
        })
        return False
    except Exception as e:
        logger.error("Unexpected error during file upload", extra={
            "object_name": object_name,
            "bucket": bucket_name,
            "error": str(e),
            "error_type": type(e).__name__
        })
        return False

def get_presigned_download_url(bucket_name: str, object_name: str, expires_delta: timedelta = timedelta(hours=1)) -> str | None:
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot generate URL")
        return None

    try:
        # Generate presigned URL with expiration time
        expires_in = int(expires_delta.total_seconds())
        url = boto3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': object_name},
            ExpiresIn=expires_in
        )
        logger.debug("Generated presigned URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "expires_in": expires_in
        })
        return url
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error("S3 error generating presigned URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error_code": error_code,
            "error_message": error_message
        })
        return None
    except Exception as e:
        logger.error("Unexpected error generating presigned URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error": str(e),
            "error_type": type(e).__name__
        })
        return None


def get_presigned_upload_url(bucket_name: str, object_name: str, expires_delta: timedelta = timedelta(minutes=15), content_type: str = "application/octet-stream") -> str | None:
    """Generate a presigned URL for uploading a file to S3/MinIO using PUT method."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot generate upload URL")
        return None

    try:
        # Generate presigned URL for PUT operation
        expires_in = int(expires_delta.total_seconds())
        url = boto3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': bucket_name,
                'Key': object_name,
                'ContentType': content_type
            },
            ExpiresIn=expires_in,
            HttpMethod='PUT'
        )
        logger.debug("Generated presigned upload URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "expires_in": expires_in,
            "content_type": content_type
        })
        return url
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error("S3 error generating presigned upload URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error_code": error_code,
            "error_message": error_message
        })
        return None
    except Exception as e:
        logger.error("Unexpected error generating presigned upload URL", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error": str(e),
            "error_type": type(e).__name__
        })
        return None


def delete_file_from_s3(bucket_name: str, object_name: str) -> bool:
    """Delete an object from S3/MinIO. Returns True if deleted or object missing, False on error."""
    if not boto3_client:
        logger.error("Boto3 S3 client not initialized, cannot delete object")
        return False
    try:
        boto3_client.delete_object(Bucket=bucket_name, Key=object_name)
        logger.info("Deleted object from bucket", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name)
        })
        return True
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        if error_code in ('NoSuchKey', '404'):
            logger.info("Object already missing when attempting delete", extra={
                "object_name": sanitize_for_log(object_name),
                "bucket": sanitize_for_log(bucket_name)
            })
            return True
        logger.error("S3 error deleting object", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error": str(e)
        })
        return False
    except Exception as e:
        logger.error("Unexpected error deleting object", extra={
            "object_name": sanitize_for_log(object_name),
            "bucket": sanitize_for_log(bucket_name),
            "error": str(e),
            "error_type": type(e).__name__
        })
        return False
