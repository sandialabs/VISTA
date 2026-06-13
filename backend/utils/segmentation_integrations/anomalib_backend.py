"""Example Anomalib segmentation adapter for VISTA local_import placeholders."""

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
    """Decode VISTA input, run anomaly segmentation, and return masks.

    Replace the luminance-difference heuristic with your deployed Anomalib
    inferencer and convert anomaly masks/boxes to the shared VISTA output shape.
    """

    payload = payload_from_request(request)
    image = decode_request_image(payload)
    options = options_from_payload(payload)

    box = foreground_bbox_xywh(image, threshold_delta=threshold_delta_from_options(options, default=24.0))
    return output_for_box(
        payload=payload,
        box=box,
        label=str(options.get("label", "anomaly")),
        runtime="anomalib_local_import",
        score=score_from_options(options, default=0.87),
        extra_metrics={"adapter": "example_anomalib_backend"},
    )
