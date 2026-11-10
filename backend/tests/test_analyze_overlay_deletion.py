from datetime import UTC, datetime, timedelta

from routers.analyze import ANALYZE_OVERLAY_DELETE_RETENTION_HOURS
from services.analyze.overlays import (
    mark_overlay_deleted_in_metadata,
    purge_expired_deleted_overlays_from_metadata,
    rebuild_analyze_part_image_maps,
    restore_overlay_in_metadata,
)


def _metadata():
    return {
        "source_images": [
            {"filename": "source.png", "image_id": "source-image", "side": "front"},
            {
                "filename": "overlay.png",
                "image_id": "overlay-image",
                "label": "Segmentation Overlay :: Watershed From Seeds",
                "overlay": True,
                "analysis_output": True,
                "side": "front",
                "modality": "analyze-overlay",
            },
        ],
        "analysis_outputs": [
            {
                "filename": "overlay.png",
                "image_id": "overlay-image",
                "label": "Segmentation Overlay :: Watershed From Seeds",
            },
        ],
        "overlay_layers": [
            {
                "id": "analyze-overlay-image",
                "image_id": "overlay-image",
                "label": "Segmentation Overlay :: Watershed From Seeds",
            },
        ],
        "view_images": {"front": "source.png"},
        "overlay_images": {"front": {"analyze-overlay": "overlay.png"}},
    }


def test_mark_overlay_metadata_as_delete_candidate_keeps_legacy_maps_for_restore():
    now = datetime(2026, 4, 30, 12, 0, tzinfo=UTC)

    metadata, deleted = mark_overlay_deleted_in_metadata(
        _metadata(),
        "overlay-image",
        now=now,
        actor_email="operator@example.com",
        retention_hours=ANALYZE_OVERLAY_DELETE_RETENTION_HOURS,
    )

    assert deleted["label"] == "Segmentation Overlay :: Watershed From Seeds"
    assert [record["image_id"] for record in metadata["source_images"]] == [
        "source-image"
    ]
    overlay_record = metadata["analysis_outputs"][0]
    assert overlay_record["overlay_delete_candidate"] is True
    assert (
        overlay_record["pending_hard_delete_at"]
        == (now + timedelta(hours=48)).isoformat()
    )
    assert overlay_record["overlay_deleted_by"] == "operator@example.com"
    # Soft delete is reversible: legacy maps keep their reference (readers
    # skip delete candidates) and are pruned only when the record is purged.
    assert metadata["overlay_images"] == {"front": {"analyze-overlay": "overlay.png"}}


def test_restore_overlay_metadata_clears_delete_candidate_without_losing_maps():
    now = datetime(2026, 4, 30, 12, 0, tzinfo=UTC)
    deleted_metadata, _ = mark_overlay_deleted_in_metadata(
        _metadata(),
        "overlay-image",
        now=now,
        actor_email="operator@example.com",
        retention_hours=ANALYZE_OVERLAY_DELETE_RETENTION_HOURS,
    )

    restored_metadata, restored = restore_overlay_in_metadata(
        deleted_metadata, "overlay-image"
    )

    assert restored is True
    assert "overlay_delete_candidate" not in restored_metadata["analysis_outputs"][0]
    assert restored_metadata["overlay_images"] == {
        "front": {"analyze-overlay": "overlay.png"}
    }


def test_purge_expired_overlay_metadata_removes_records_after_retention():
    now = datetime(2026, 4, 30, 12, 0, tzinfo=UTC)
    deleted_metadata, _ = mark_overlay_deleted_in_metadata(
        _metadata(),
        "overlay-image",
        now=now,
        actor_email="operator@example.com",
        retention_hours=ANALYZE_OVERLAY_DELETE_RETENTION_HOURS,
    )

    purged_metadata, purged_records = purge_expired_deleted_overlays_from_metadata(
        deleted_metadata,
        now=now + timedelta(hours=49),
    )

    assert {record["image_id"] for record in purged_records} == {"overlay-image"}
    assert [record["image_id"] for record in purged_metadata["source_images"]] == [
        "source-image"
    ]
    assert purged_metadata["analysis_outputs"] == []
    assert purged_metadata["overlay_layers"] == []
    assert purged_metadata["view_images"] == {"front": "source.png"}
    assert purged_metadata["overlay_images"] == {}


def test_rebuild_keeps_analysis_outputs_out_of_original_source_images():
    rebuilt = rebuild_analyze_part_image_maps(
        {
            "source_images": [
                {
                    "filename": "front.png",
                    "image_id": "front-image",
                    "side": "front",
                    "overlay": False,
                },
                {
                    "filename": "back.png",
                    "image_id": "back-image",
                    "side": "back",
                    "overlay": False,
                },
                {
                    "filename": "front_overlay.png",
                    "image_id": "overlay-image",
                    "label": "Segmentation Overlay :: Watershed From Seeds",
                    "overlay": True,
                    "analysis_output": True,
                    "side": "front",
                    "modality": "analyze-overlay",
                },
            ],
            "analysis_outputs": [],
        }
    )

    assert [record["image_id"] for record in rebuilt["source_images"]] == [
        "front-image",
        "back-image",
    ]
    assert [record["image_id"] for record in rebuilt["analysis_outputs"]] == [
        "overlay-image"
    ]
    # No grouping maps are synthesized from user side/modality metadata.
    assert "view_images" not in rebuilt
    assert "overlay_images" not in rebuilt
    assert rebuilt["source_images"][0]["side"] == "front"


def test_rebuild_preserves_user_descriptor_values_verbatim():
    rebuilt = rebuild_analyze_part_image_maps(
        {
            "source_images": [
                {"filename": "a.png", "image_id": "a", "side": "B", "view": 18},
                {"filename": "b.png", "image_id": "b", "modality": "Optical"},
                {"filename": "c.png", "image_id": "c", "overlay": True},
            ],
        }
    )

    assert rebuilt["source_images"] == [
        {"filename": "a.png", "image_id": "a", "side": "B", "view": 18},
        {"filename": "b.png", "image_id": "b", "modality": "Optical"},
        {"filename": "c.png", "image_id": "c", "overlay": True},
    ]
    assert "modalities" not in rebuilt
    assert "configured_views" not in rebuilt
