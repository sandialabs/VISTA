import pytest
from pydantic import ValidationError

from schemas import inspection_annotation_limits as inspection_annotation_limit_schemas
from schemas import inspection_annotations as inspection_annotation_schemas


def _segment(**overrides):
    value = {
        "version": 1,
        "axis": "axial",
        "min_slice": 0,
        "max_slice": 0,
        "image_width": 512,
        "image_height": 384,
        "areas": [],
    }
    value.update(overrides)
    return value


def _validate(segment):
    return inspection_annotation_schemas.InspectionAnnotationCreate.model_validate(
        {
            "annotation_kind": "vista_segment",
            "defect_class": "bounded segment",
            "modality": "volume",
            "geometry": {"segment": segment},
        }
    )


def _validation_message(segment):
    with pytest.raises(ValidationError) as exc_info:
        _validate(segment)
    return str(exc_info.value)


def test_vista_segment_accepts_documented_dimension_and_slice_boundaries():
    result = _validate(
        _segment(
            min_slice=inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_SLICE_INDEX,
            max_slice=inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_SLICE_INDEX,
            image_width=inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
            image_height=inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
        )
    )

    assert result.geometry["segment"]["image_width"] == 65_536
    assert result.geometry["segment"]["max_slice"] == 1_000_000


def test_vista_segment_accepts_bounded_version_2_volume_runs():
    result = _validate(
        _segment(
            version=2,
            volume_dimensions=[8, 6, 4],
            areas=[
                {
                    "tool": "brush",
                    "mode": "3d",
                    "volumeRuns": [[0, 1, 2, 5], [3, 5, 0, 8]],
                    "seedVoxel": [3, 1, 0],
                    "voxelCount": 11,
                    "truncated": False,
                }
            ],
        )
    )

    assert result.geometry["segment"]["version"] == 2
    assert result.geometry["segment"]["areas"][0]["volumeRuns"][1] == [3, 5, 0, 8]


@pytest.mark.parametrize(
    ("patch", "expected_message"),
    [
        ({"version": 2}, "volume_dimensions must contain exactly"),
        (
            {"version": 1, "volume_dimensions": [8, 6, 4]},
            "volume_dimensions requires geometry.segment.version 2",
        ),
        (
            {
                "version": 2,
                "volume_dimensions": [8, 6, 4],
                "areas": [{"mode": "3d", "volumeRuns": [[4, 0, 0, 1]]}],
            },
            ".z must be within",
        ),
        (
            {
                "version": 2,
                "volume_dimensions": [8, 6, 4],
                "areas": [{"mode": "3d", "volumeRuns": [[0, 0, 5, 5]]}],
            },
            ".x_end must be greater",
        ),
        (
            {
                "version": 2,
                "volume_dimensions": [8, 6, 4],
                "areas": [{"mode": "volume", "volumeRuns": []}],
            },
            ".mode must be 2d or 3d",
        ),
        (
            {
                "version": 2,
                "volume_dimensions": [8, 6, 4],
                "areas": [
                    {
                        "mode": "3d",
                        "volumeRuns": [],
                        "volume_runs": [[0, 0, 0, 1]],
                    }
                ],
            },
            "must not contain both volumeRuns and volume_runs",
        ),
    ],
)
def test_vista_segment_rejects_malformed_version_2_volume_geometry(
    patch, expected_message
):
    segment = _segment()
    segment.update(patch)
    assert expected_message in _validation_message(segment)


@pytest.mark.parametrize(
    ("field", "value", "expected_message"),
    [
        (
            "image_width",
            inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION
            + 1,
            "geometry.segment.image_width must be at most 65536",
        ),
        (
            "image_height",
            inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION
            + 1,
            "geometry.segment.image_height must be at most 65536",
        ),
        (
            "min_slice",
            inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_SLICE_INDEX + 1,
            "geometry.segment.min_slice must be at most 1000000",
        ),
        (
            "max_slice",
            inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_SLICE_INDEX + 1,
            "geometry.segment.max_slice must be at most 1000000",
        ),
    ],
)
def test_vista_segment_rejects_dimensions_and_slices_above_built_in_limits(
    field,
    value,
    expected_message,
):
    segment = _segment(**{field: value})
    if field == "min_slice":
        segment["max_slice"] = value

    assert expected_message in _validation_message(segment)


def test_vista_segment_accepts_array_and_object_mask_run_contracts_at_image_boundaries():
    _validate(
        _segment(
            image_width=65_536,
            image_height=65_536,
            areas=[
                {
                    "maskRuns": [
                        [0, 0, 65_536],
                        {"row": 65_535, "x": 0.25, "x2": 65_535.75},
                    ]
                },
                {"mask_runs": [{"y": 1.5, "start": 3, "end": 4}]},
            ],
        )
    )


@pytest.mark.parametrize(
    ("run", "expected_message"),
    [
        ([0, 0], "must contain exactly [y, start, end]"),
        ([0, 0, 1, 2], "must contain exactly [y, start, end]"),
        ("0,0,1", "must be a three-value array or coordinate object"),
        ({"y": 0, "start": 0}, "must include y/row, start/x1/x, and end/x2"),
        ([True, 0, 1], ".y must be a finite number"),
        ([float("inf"), 0, 1], "must contain only finite numbers"),
        ([10**400, 0, 1], ".y must be a finite number"),
        ([-1, 0, 1], ".y must be within [0, image_height)"),
        ([384, 0, 1], ".y must be within [0, image_height)"),
        ([0, -1, 1], "horizontal coordinates must be within [0, image_width]"),
        ([0, 0, 513], "horizontal coordinates must be within [0, image_width]"),
        ([0, 3, 3], ".end must be greater than start"),
        ([0, 4, 3], ".end must be greater than start"),
    ],
)
def test_vista_segment_rejects_malformed_or_out_of_bounds_mask_runs(
    run, expected_message
):
    message = _validation_message(_segment(areas=[{"maskRuns": [run]}]))
    assert expected_message in message


def test_vista_segment_mask_run_limits_accept_boundaries_and_reject_each_overflow():
    valid_run = [0, 0, 1]
    maximum_area = [
        valid_run
    ] * inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_MASK_RUNS_PER_AREA
    _validate(_segment(areas=[{"maskRuns": maximum_area}]))

    per_area_message = _validation_message(
        _segment(areas=[{"maskRuns": maximum_area + [valid_run]}])
    )
    assert "maskRuns must contain at most 50000 runs" in per_area_message

    total_message = _validation_message(
        _segment(
            areas=[
                {"maskRuns": maximum_area},
                {"maskRuns": [valid_run]},
            ]
        )
    )
    assert "must contain at most 50000 mask runs in total" in total_message


def test_vista_segment_mask_path_accepts_limit_and_rejects_overflow_and_non_text():
    maximum_path = (
        "M" * inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS
    )
    _validate(_segment(areas=[{"maskPath": maximum_path}]))

    overflow_message = _validation_message(
        _segment(areas=[{"mask_path": maximum_path + "Z"}])
    )
    assert "mask_path must contain at most 4194304 characters" in overflow_message

    non_text_message = _validation_message(_segment(areas=[{"maskPath": ["M", "Z"]}]))
    assert "maskPath must be text" in non_text_message


def _nested_json(container_levels):
    value = True
    for _ in range(container_levels):
        value = {"child": value}
    return value


def test_vista_segment_json_depth_accepts_boundary_and_rejects_one_level_more():
    _validate(_segment(extension=_nested_json(11)))

    message = _validation_message(_segment(extension=_nested_json(12)))
    assert "JSON nesting depth must be at most 12" in message


def test_vista_segment_json_node_count_accepts_boundary_and_rejects_one_more(
    monkeypatch,
):
    monkeypatch.setattr(
        inspection_annotation_limit_schemas, "INSPECTION_SEGMENT_MAX_JSON_NODES", 20
    )

    # Root + seven required values + extension list + eleven entries = 20.
    _validate(_segment(extension=[None] * 11))
    message = _validation_message(_segment(extension=[None] * 12))
    assert "must contain at most 20 JSON values" in message


def test_vista_segment_text_and_key_limits_enforce_exact_boundaries():
    _validate(
        _segment(
            areas=[
                {
                    "note": "x"
                    * inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_OTHER_TEXT_CHARS
                }
            ]
        )
    )
    text_message = _validation_message(
        _segment(
            areas=[
                {
                    "note": "x"
                    * (
                        inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_OTHER_TEXT_CHARS
                        + 1
                    )
                }
            ]
        )
    )
    assert "note must contain at most 4096 characters" in text_message

    valid_key = (
        "k" * inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_JSON_KEY_CHARS
    )
    _validate(_segment(areas=[{valid_key: None}]))
    invalid_key = "k" * (
        inspection_annotation_limit_schemas.INSPECTION_SEGMENT_MAX_JSON_KEY_CHARS + 1
    )
    key_message = _validation_message(_segment(areas=[{invalid_key: None}]))
    assert "keys must contain at most 256 characters" in key_message


def test_vista_segment_total_text_limit_and_json_types_are_bounded(monkeypatch):
    with monkeypatch.context() as patcher:
        patcher.setattr(
            inspection_annotation_limit_schemas,
            "INSPECTION_SEGMENT_MAX_TEXT_CHARS_TOTAL",
            4,
        )
        inspection_annotation_limit_schemas._validate_segment_json_complexity(
            {"a": "123"}, "geometry.segment"
        )
        with pytest.raises(ValueError, match="at most 4 characters in total"):
            inspection_annotation_limit_schemas._validate_segment_json_complexity(
                {"a": "1234"}, "geometry.segment"
            )

    message = _validation_message(_segment(extension=object()))
    assert "must contain JSON-compatible values" in message


def _validate_annotation_extensions(
    *, model=inspection_annotation_schemas.InspectionAnnotationCreate, **overrides
):
    payload = {
        "defect_class": "bounded annotation",
        "modality": "visual",
    }
    payload.update(overrides)
    return model.model_validate(payload)


def test_annotation_envelope_depth_has_an_independent_exact_boundary():
    result = _validate_annotation_extensions(metadata=_nested_json(15))
    assert result.metadata

    with pytest.raises(
        ValidationError,
        match="annotation payload JSON nesting depth must be at most 16",
    ):
        _validate_annotation_extensions(metadata=_nested_json(16))

    with pytest.raises(
        ValidationError,
        match="annotation payload JSON nesting depth must be at most 16",
    ):
        _validate_annotation_extensions(
            model=inspection_annotation_schemas.InspectionAnnotationUpdate,
            metadata=_nested_json(16),
        )


def test_annotation_envelope_node_limit_is_independent_from_segment_limit(monkeypatch):
    monkeypatch.setattr(
        inspection_annotation_limit_schemas, "INSPECTION_ANNOTATION_MAX_JSON_NODES", 12
    )

    # Envelope root + four fields + metadata's entries list + six list values.
    result = _validate_annotation_extensions(metadata={"entries": [None] * 6})
    assert len(result.metadata["entries"]) == 6

    with pytest.raises(
        ValidationError, match="annotation payload must contain at most 12 JSON values"
    ):
        _validate_annotation_extensions(metadata={"entries": [None] * 7})


def test_annotation_envelope_bounds_extension_text_keys_and_json_types(monkeypatch):
    valid_key = (
        "k"
        * inspection_annotation_limit_schemas.INSPECTION_ANNOTATION_MAX_JSON_KEY_CHARS
    )
    _validate_annotation_extensions(metadata={valid_key: "ok"})

    invalid_key = "k" * (
        inspection_annotation_limit_schemas.INSPECTION_ANNOTATION_MAX_JSON_KEY_CHARS + 1
    )
    with pytest.raises(
        ValidationError, match="keys must contain at most 256 characters"
    ):
        _validate_annotation_extensions(metadata={invalid_key: "no"})

    _validate_annotation_extensions(
        metadata={
            "note": "x"
            * inspection_annotation_limit_schemas.INSPECTION_ANNOTATION_MAX_OTHER_TEXT_CHARS
        }
    )
    with pytest.raises(
        ValidationError, match="note must contain at most 4096 characters"
    ):
        _validate_annotation_extensions(
            metadata={
                "note": "x"
                * (
                    inspection_annotation_limit_schemas.INSPECTION_ANNOTATION_MAX_OTHER_TEXT_CHARS
                    + 1
                )
            }
        )
    with pytest.raises(
        ValidationError, match="maskPath must contain at most 4096 characters"
    ):
        _validate_annotation_extensions(
            metadata={
                "maskPath": "x"
                * (
                    inspection_annotation_limit_schemas.INSPECTION_ANNOTATION_MAX_OTHER_TEXT_CHARS
                    + 1
                )
            }
        )

    with monkeypatch.context() as patcher:
        patcher.setattr(
            inspection_annotation_limit_schemas,
            "INSPECTION_ANNOTATION_MAX_TEXT_CHARS_TOTAL",
            40,
        )
        _validate_annotation_extensions(metadata={"note": "1234"})
        with pytest.raises(ValidationError, match="at most 40 characters in total"):
            _validate_annotation_extensions(metadata={"note": "12345"})

    with pytest.raises(ValidationError, match="must contain JSON-compatible values"):
        _validate_annotation_extensions(metadata={"opaque": object()})
