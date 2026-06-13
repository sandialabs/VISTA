"""Example YOLO segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

from ._shared import (
    decode_request_image,
    foreground_bbox_xywh,
    options_from_payload,
    output_for_box,
    payload_from_request,
    score_from_options,
    threshold_delta_from_options,
)


def run(request):
    """Decode VISTA input, run YOLO-like inference, and return mask metadata.

    Replace the foreground-bbox heuristic below with your deployed YOLO segmenter
    while preserving the returned shared output shape.
    """

    payload = payload_from_request(request)
    image = decode_request_image(payload)
    options = options_from_payload(payload)

    box = foreground_bbox_xywh(image, threshold_delta=threshold_delta_from_options(options, default=18.0))
    return output_for_box(
        payload=payload,
        box=box,
        label=str(options.get("label", "object")),
        runtime="yolo_local_import",
        score=score_from_options(options, default=0.9),
        extra_metrics={"adapter": "example_yolo_backend"},
    )
