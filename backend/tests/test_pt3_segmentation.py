import numpy as np
import pytest

from utils.pt3_segmentation import (
    PT3SegmentationError,
    normalize_inline_pt3_segmentation_labels,
)


def test_normalizes_volume_and_indexed_flat_or_nested_slices():
    volume = normalize_inline_pt3_segmentation_labels(
        {"labels": [[[1, 2]], [[3, 4]]]},
        (2, 1, 2),
    )
    slices = normalize_inline_pt3_segmentation_labels(
        {
            "label_slices": [
                {"slice_index": 1, "labels": [[3, 4]]},
                {"slice_index": 0, "labels": [1, 2]},
            ]
        },
        (2, 1, 2),
    )

    assert volume.dtype == np.uint8
    assert np.array_equal(volume, slices)


@pytest.mark.parametrize(
    "segmentation, message",
    [
        (
            {
                "label_slices": [
                    {"slice_index": 0, "labels": [[1]]},
                    {"slice_index": 0, "labels": [[2]]},
                ]
            },
            "duplicate",
        ),
        ({"label_slices": [{"slice_index": 0, "labels": [[1]]}]}, "missing"),
        (
            {
                "label_slices": [
                    {"slice_index": 0, "url": "/labels/0.png"},
                    {"slice_index": 1, "url": "/labels/1.png"},
                ]
            },
            "URL-only",
        ),
        ({"label_slices": [{"slice_index": 0, "labels": [[1]]}, None]}, "malformed"),
    ],
)
def test_rejects_incomplete_or_ambiguous_label_slices(segmentation, message):
    with pytest.raises(PT3SegmentationError, match=message):
        normalize_inline_pt3_segmentation_labels(segmentation, (2, 1, 1))
