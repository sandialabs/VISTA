"""Create (or reuse) project images for built-in test-data fixtures."""

from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

import numpy as np

from core.config import settings
from repositories import images as image_repository
from schemas import images as image_schemas
from services.errors import ConflictError, ServiceError
from utils.boto3_client import upload_file_to_s3
from utils.pt3_test_fixtures import NIST_COCR_FIXTURE_ID

NIST_FIXTURE_REUSE_FIELDS = (
    "source",
    "project_type",
    "builtin_fixture_id",
    "fixture_id",
    "builtin_fixture_filename",
    "fixture_role",
    "volume_stack_id",
    "volume_shape",
    "axis_labels",
    "load_mode",
    "frame_count",
    "voxel_dtype",
    "pixel_dtype",
    "bit_depth",
    "overlay",
    "modality",
    "overlay_base_filename",
    "overlay_base_image_id",
)
UPLOAD_FAILED_DETAIL = "Failed to upload test data image"
METADATA_ONLY_PATCH = {
    "storage_status": "metadata_only",
    "storage_warning": "Test data image object could not be uploaded.",
}


def fixture_object_key(project_id: uuid.UUID, filename: str) -> str:
    """Return the deterministic object storage key for a fixture image."""
    return f"{project_id}/test-data/{filename}"


def nist_fixture_reuse_conflicts(
    *, image, expected_metadata: dict, project_id: uuid.UUID, filename: str
) -> list[str]:
    """Return mismatches between an existing fixture image and expectations."""
    existing_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    conflicts = [
        field
        for field in NIST_FIXTURE_REUSE_FIELDS
        if existing_metadata.get(field) != expected_metadata.get(field)
    ]
    if image.object_storage_key != fixture_object_key(project_id, filename):
        conflicts.append("object_storage_key")
    return conflicts


def _reject_conflicting_nist_reuse(image, metadata, project_id, filename) -> None:
    if metadata.get("builtin_fixture_id") != NIST_COCR_FIXTURE_ID:
        return
    conflicts = nist_fixture_reuse_conflicts(
        image=image,
        expected_metadata=metadata,
        project_id=project_id,
        filename=filename,
    )
    if conflicts:
        raise ConflictError(
            f"Existing image conflicts with built-in NIST fixture {filename}: "
            f"{', '.join(conflicts)}"
        )


async def _upload_fixture_object(
    file_path: Path, object_storage_key: str, content_type: str, allow_metadata_only
) -> bool:
    try:
        with file_path.open("rb") as file_obj:
            uploaded = await upload_file_to_s3(
                bucket_name=settings.S3_BUCKET,
                object_name=object_storage_key,
                file_data=file_obj,
                length=file_path.stat().st_size,
                content_type=content_type,
            )
    except Exception as exc:
        if not allow_metadata_only:
            raise ServiceError(UPLOAD_FAILED_DETAIL) from exc
        return False
    if not uploaded and not allow_metadata_only:
        raise ServiceError(UPLOAD_FAILED_DETAIL)
    return bool(uploaded)


async def create_test_image_if_missing(
    *,
    db,
    project_id: uuid.UUID,
    file_path: Path,
    metadata: dict,
    user_email: str,
    allow_metadata_only: bool = False,
) -> tuple[object, bool]:
    """Return ``(image, created)``; reuse an active image with the same name."""
    matches = await image_repository.list_active_project_images_by_filename(
        db=db, project_id=project_id, filename=file_path.name
    )
    if matches:
        _reject_conflicting_nist_reuse(matches[0], metadata, project_id, file_path.name)
        return matches[0], False

    object_storage_key = fixture_object_key(project_id, file_path.name)
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    uploaded = await _upload_fixture_object(
        file_path, object_storage_key, content_type, allow_metadata_only
    )
    if not uploaded:
        metadata = {**metadata, **METADATA_ONLY_PATCH}
    image = await image_repository.create_data_instance(
        db=db,
        data_instance=image_schemas.DataInstanceCreate(
            project_id=project_id,
            filename=file_path.name,
            object_storage_key=object_storage_key,
            content_type=content_type,
            size_bytes=file_path.stat().st_size,
            metadata=metadata,
            uploaded_by_user_id=user_email,
        ),
        created_by=user_email,
    )
    return image, True


def _read_npy_header(file_spec) -> tuple[tuple[int, ...], np.dtype]:
    try:
        volume = np.load(file_spec.path, mmap_mode="r", allow_pickle=False)
        shape = tuple(int(value) for value in volume.shape)
        dtype = np.dtype(volume.dtype)
        del volume
    except (OSError, ValueError, TypeError) as exc:
        raise ServiceError(
            f"Invalid NIST CoCr fixture NPY header: {file_spec.filename}"
        ) from exc
    expected_dtype = np.dtype(file_spec.dtype)
    if len(shape) != 3 or dtype != expected_dtype:
        raise ServiceError(
            f"Invalid NIST CoCr fixture header for {file_spec.filename}: "
            f"expected a 3D {expected_dtype.name} array"
        )
    return shape, dtype


def validated_nist_fixture_shape(raw_spec, overlay_spec) -> tuple[int, int, int]:
    """Read only NPY headers and reject a malformed or misaligned fixture pair."""
    raw_shape, _ = _read_npy_header(raw_spec)
    overlay_shape, _ = _read_npy_header(overlay_spec)
    if raw_shape != overlay_shape:
        raise ServiceError(
            "NIST CoCr raw and segmentation fixture volumes are not aligned"
        )
    return raw_shape
