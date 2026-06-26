"""Example OpenCV/classical segmentation adapter for VISTA placeholders."""

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
    """Decode VISTA input, run classical segmentation, and return masks.

    This example avoids an OpenCV dependency by using a Pillow luminance
    foreground heuristic. Replace ``foreground_bbox_xywh`` with your cv2-based
    thresholding, contour, watershed, or morphology pipeline as needed.
    """

    payload = payload_from_request(request)
    image = decode_request_image(payload)
    options = options_from_payload(payload)

    box = foreground_bbox_xywh(image, threshold_delta=threshold_delta_from_options(options, default=12.0))
    return output_for_box(
        payload=payload,
        box=box,
        label=str(options.get("label", "foreground")),
        runtime="opencv_local_import",
        score=score_from_options(options, default=0.82),
        extra_metrics={"adapter": "example_opencv_backend"},
    )
