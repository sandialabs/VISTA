"""Load built-in test-data fixtures into a project.

PT1 loads only create images: PT1 uploads must not pre-assign images to
groups or inspection parts, so the PT1 ingest payload is always empty.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

from schemas import inspection_parts as inspection_part_schemas
from services.errors import NotFoundError, ValidationFailedError
from services.inspection import fixture_metadata, part_ingest, test_fixture_images
from utils import cache_manager
from utils.pt3_test_fixtures import (
    DEFAULT_PT3_FIXTURE_ID,
    NIST_COCR_FIXTURE_ID,
    get_pt3_test_fixture,
)
from utils.volume_loader import load_slice_stack

TEST_DATA_ROOT = Path(__file__).resolve().parents[3] / "test" / "data"
PT3_TEST_STACK_ROOT = TEST_DATA_ROOT / "3D" / "geometric"
TEST_DATA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".txt"}
PT3_AXIS_LABELS = ["XY", "XZ", "YZ"]
PT3_SYNTH_STACK_ID = "PT3_SYNTH_MPR_001"
NIST_STACK_ID = "PT3_NIST_COCR_SET1SAMPLE5_001"


@dataclass
class _FixtureLoad:
    db: object
    project_id: uuid.UUID
    user_email: str
    uploaded_records: list[dict] = field(default_factory=list)
    images_created: int = 0

    async def add_image(
        self, file_path: Path, metadata: dict, *, metadata_only_ok=True, flat=True
    ):
        image, created = await test_fixture_images.create_test_image_if_missing(
            db=self.db,
            project_id=self.project_id,
            file_path=file_path,
            metadata=metadata,
            user_email=self.user_email,
            allow_metadata_only=metadata_only_ok,
        )
        self.images_created += 1 if created else 0
        record = {"filename": file_path.name, "image_id": str(image.id)}
        record["metadata"] = metadata
        if flat:
            record.update(metadata)
        self.uploaded_records.append(record)
        return image


def _single_part_payload(batch_name, batch_description, serial, display_name, metadata):
    return inspection_part_schemas.InspectionBulkIngestPayload(
        batches=[
            inspection_part_schemas.InspectionIngestBatchRecord(
                name=batch_name,
                description=batch_description,
                parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number=serial,
                        display_name=display_name,
                        metadata=metadata,
                    )
                ],
            )
        ]
    )


def _validate_fixture_request(project_type: str, fixture_id: str) -> None:
    if get_pt3_test_fixture(fixture_id) is None:
        raise ValidationFailedError("Unknown test-data fixture")
    if fixture_id == NIST_COCR_FIXTURE_ID and project_type != "PT3":
        raise ValidationFailedError(
            "The nist-cocr fixture is only available for PT3 projects"
        )


def _nist_file_specs():
    nist_fixture = get_pt3_test_fixture(NIST_COCR_FIXTURE_ID)
    assert nist_fixture is not None
    raw_spec = next(item for item in nist_fixture.files if item.role == "base")
    overlay_spec = next(item for item in nist_fixture.files if item.role == "overlay")
    if not raw_spec.path.is_file() or not overlay_spec.path.is_file():
        raise NotFoundError("NIST CoCr test volumes not found")
    return raw_spec, overlay_spec


def _nist_common_metadata(volume_shape: dict, frame_count: int) -> dict:
    return {
        "source": "vista-test-data",
        "project_type": "PT3",
        "builtin_fixture_id": NIST_COCR_FIXTURE_ID,
        "fixture_id": NIST_COCR_FIXTURE_ID,
        "volume_stack_id": NIST_STACK_ID,
        "volume_shape": volume_shape,
        "axis_labels": PT3_AXIS_LABELS,
        "load_mode": "volume",
        "frame_count": frame_count,
    }


def _nist_file_metadata(common, spec, *, overlay, modality, bit_depth) -> dict:
    return {
        **common,
        "builtin_fixture_filename": spec.filename,
        "fixture_role": spec.role,
        "overlay": overlay,
        "modality": modality,
        "voxel_dtype": spec.dtype,
        "pixel_dtype": spec.dtype,
        "bit_depth": bit_depth,
    }


async def _load_nist_fixture(load: _FixtureLoad):
    raw_spec, overlay_spec = _nist_file_specs()
    axial, coronal, sagittal = test_fixture_images.validated_nist_fixture_shape(
        raw_spec, overlay_spec
    )
    volume_shape = {"axial": axial, "coronal": coronal, "sagittal": sagittal}
    common = _nist_common_metadata(volume_shape, axial)
    raw_metadata = _nist_file_metadata(
        common, raw_spec, overlay=False, modality="volume", bit_depth=16
    )
    raw_image = await load.add_image(raw_spec.path, raw_metadata)
    overlay_metadata = {
        **_nist_file_metadata(
            common, overlay_spec, overlay=True, modality="segmentation", bit_depth=8
        ),
        "overlay_base_filename": raw_spec.filename,
        "overlay_base_image_id": str(raw_image.id),
    }
    await load.add_image(overlay_spec.path, overlay_metadata)
    part_metadata = {
        **common,
        "volume_shape": volume_shape,
        "voxel_dtype": raw_spec.dtype,
        "bit_depth": 16,
        "mpr": {"volume_shape": volume_shape, "axis_labels": PT3_AXIS_LABELS},
        "source_images": load.uploaded_records,
        "view_images": {"volume": raw_spec.filename},
        "overlay_images": {"volume": {"segmentation": overlay_spec.filename}},
    }
    return _single_part_payload(
        "PT3_NIST_COCR_SET1SAMPLE5_BATCH",
        "NIST CoCr set1sample5 paired volume test data",
        "NIST-COCR-SET1SAMPLE5",
        "NIST CoCr set1sample5 center cylinder",
        part_metadata,
    )


def _pt3_slice_metadata(file_path, index, nsipro_metadata, **extra) -> dict:
    metadata = {
        "source": "vista-test-data",
        "project_type": "PT3",
        "builtin_fixture_filename": file_path.name,
        "volume_stack_id": PT3_SYNTH_STACK_ID,
        "slice_index": index,
        "slice_axis": "Z",
        "axis_labels": PT3_AXIS_LABELS,
        **extra,
    }
    if nsipro_metadata:
        metadata["selected_metadata_file"] = nsipro_metadata["source_filename"]
    return metadata


async def _load_pt3_slice(load: _FixtureLoad, file_path, index, nsipro_metadata):
    image = await load.add_image(
        file_path,
        _pt3_slice_metadata(
            file_path, index, nsipro_metadata, overlay=False, modality="volume-slice"
        ),
    )
    overlay_path = PT3_TEST_STACK_ROOT / "overlays" / f"{file_path.stem}_overlay.png"
    if not overlay_path.exists():
        return
    overlay_metadata = _pt3_slice_metadata(
        overlay_path,
        index,
        nsipro_metadata,
        overlay=True,
        modality="segmentation",
        overlay_base_filename=file_path.name,
        overlay_base_image_id=str(image.id),
    )
    await load.add_image(overlay_path, overlay_metadata)


async def _load_pt3_stack_fixture(load: _FixtureLoad):
    if not PT3_TEST_STACK_ROOT.exists():
        raise NotFoundError("PT3 test stack not found")
    volume_info = load_slice_stack(PT3_TEST_STACK_ROOT)
    nsipro_metadata = fixture_metadata.load_nsipro_metadata_fixture(PT3_TEST_STACK_ROOT)
    for index, file_path in enumerate(sorted(PT3_TEST_STACK_ROOT.glob("*.png"))):
        await _load_pt3_slice(load, file_path, index, nsipro_metadata)
    shape = volume_info.shape
    volume_shape = {"axial": shape[0], "coronal": shape[1], "sagittal": shape[2]}
    part_metadata = {
        "source": "vista-test-data",
        "volume_stack_id": PT3_SYNTH_STACK_ID,
        "volume_shape": volume_shape,
        "mpr": {"volume_shape": dict(volume_shape), "axis_labels": PT3_AXIS_LABELS},
        "source_images": load.uploaded_records,
    }
    if nsipro_metadata:
        part_metadata["nsipro_metadata"] = nsipro_metadata
    return _single_part_payload(
        "PT3_SYNTH_MPR_BATCH01",
        "Synthetic PT3 3D stack test data",
        "SN3D0001",
        "PT3 synthetic MPR stack",
        part_metadata,
    )


def _hierarchy_fixture_paths(project_type: str) -> tuple[Path, list[Path]]:
    fixture_root = TEST_DATA_ROOT / project_type
    if not fixture_root.exists() and project_type == "PT2":
        fixture_root = TEST_DATA_ROOT / "PT1"
    if not fixture_root.exists():
        return fixture_root, []
    paths = sorted(
        path
        for path in fixture_root.rglob("*")
        if path.is_file()
        and path.name != "regex.txt"
        and path.suffix.lower() in TEST_DATA_EXTENSIONS
    )
    return fixture_root, paths


async def _load_hierarchy_fixture(load: _FixtureLoad, project_type: str):
    fixture_root, fixture_paths = _hierarchy_fixture_paths(project_type)
    if not fixture_paths:
        raise NotFoundError(f"{project_type} test data not found")
    for file_path in fixture_paths:
        metadata = fixture_metadata.metadata_from_test_data_file(
            file_path, fixture_root
        )
        if metadata is None:
            continue
        await load.add_image(
            file_path,
            {**metadata, "project_type": project_type},
            metadata_only_ok=False,
            flat=False,
        )
    if project_type == "PT1":
        return inspection_part_schemas.InspectionBulkIngestPayload()
    return fixture_metadata.build_hierarchy_ingest_records(load.uploaded_records)


async def _build_fixture_ingest_payload(load, project_type, fixture_id):
    if project_type == "PT3" and fixture_id == NIST_COCR_FIXTURE_ID:
        return await _load_nist_fixture(load)
    if project_type == "PT3":
        return await _load_pt3_stack_fixture(load)
    return await _load_hierarchy_fixture(load, project_type)


async def load_project_test_data(
    *, db, project, project_id: uuid.UUID, fixture: str | None, user_email: str
) -> dict:
    """Create fixture images, ingest their parts, and invalidate image caches."""
    project_type = (project.project_type or "PT1").upper()
    fixture_id = fixture or DEFAULT_PT3_FIXTURE_ID
    _validate_fixture_request(project_type, fixture_id)
    load = _FixtureLoad(db=db, project_id=project_id, user_email=user_email)
    ingest_payload = await _build_fixture_ingest_payload(load, project_type, fixture_id)
    ingest_result = await part_ingest.bulk_ingest_project_parts(
        db=db,
        project_id=project_id,
        payload=ingest_payload,
        user_email=user_email,
        project_type=project.project_type,
    )
    cache_manager.invalidate_project_images(project_id)
    return {
        "project_id": project_id,
        "project_type": project_type,
        "images_received": len(load.uploaded_records),
        "images_created": load.images_created,
        "ingest": ingest_result,
    }
