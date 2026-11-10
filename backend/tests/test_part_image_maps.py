"""User-supplied image metadata is stored verbatim; nothing is implicitly mapped."""

from utils.part_image_maps import (
    metadata_with_source_images,
    normalize_source_image_record,
    prune_legacy_image_maps,
    removed_record_identities,
    user_image_descriptor_fields,
)


def test_user_descriptor_values_are_not_lowercased_renamed_or_defaulted():
    assert user_image_descriptor_fields({"side": "B"}) == {"side": "B"}
    assert user_image_descriptor_fields({"modality": "optical"}) == {
        "modality": "optical"
    }
    # "view" is not a synonym for "side": it is left alone, not mapped.
    assert user_image_descriptor_fields({"view": 18}) == {}
    # Absent values stay absent instead of becoming "" / "overlay" / "image".
    assert user_image_descriptor_fields({}) == {}
    assert user_image_descriptor_fields({"side": "", "modality": None}) == {}
    # Falsy-but-meaningful values are preserved.
    assert user_image_descriptor_fields({"side": 0}) == {"side": 0}
    assert user_image_descriptor_fields(None) == {}


def test_source_record_normalization_only_touches_structural_fields():
    record = {
        "filename": "  a.png ",
        "side": "B",
        "view": 18,
        "modality": "Optical",
        "station": "S-1",
        "overlay": "true",
    }
    assert normalize_source_image_record(record) == {
        "filename": "a.png",
        "side": "B",
        "view": 18,
        "modality": "Optical",
        "station": "S-1",
        "overlay": True,
    }
    assert normalize_source_image_record({"filename": ""}) is None
    assert normalize_source_image_record("not-a-record") is None


def test_no_grouping_keys_are_created_for_new_parts():
    metadata = metadata_with_source_images(
        {"serial_number": "SN"},
        [
            {"filename": "a.png", "modality": "optical", "side": "B"},
            {"filename": "b.png", "view": 18},
        ],
    )
    assert metadata == {
        "serial_number": "SN",
        "source_images": [
            {"filename": "a.png", "modality": "optical", "side": "B", "overlay": False},
            {"filename": "b.png", "view": 18, "overlay": False},
        ],
    }


def test_removed_identities_ignore_survivors_that_share_a_filename():
    previous = [
        {"image_id": "1", "filename": "dup.png"},
        {"image_id": "2", "filename": "dup.png"},
        {"filename": "legacy.png"},
    ]
    retained = [{"image_id": "2", "filename": "dup.png"}, {"filename": "legacy.png"}]
    assert removed_record_identities(previous, retained) == ({"1"}, {"dup.png"})


def test_prune_legacy_maps_prefers_image_id_and_keeps_unrelated_entries():
    pruned = prune_legacy_image_maps(
        {
            "view_images": {
                "a": "gone.png",
                "b": {"image_id": "keep", "filename": "gone.png"},
                "c": "other.png",
            },
            "overlay_images": {"a": {"heat": "gone.png"}, "b": "gone.png"},
        },
        {"gone-id"},
        {"gone.png"},
    )
    assert pruned == {
        "view_images": {
            "b": {"image_id": "keep", "filename": "gone.png"},
            "c": "other.png",
        },
        "overlay_images": {},
    }
    assert prune_legacy_image_maps({}, {"x"}, {"y"}) == {}
