"""Example SAM segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

from ._shared import (
    decode_request_image,
    options_from_payload,
    output_for_box,
    payload_from_request,
    prompted_bbox_xywh,
    score_from_options,
)


def run(request):
    """Decode VISTA input, apply SAM-like prompts, and return mask metadata.

    Replace the prompted bbox fallback with your Segment Anything predictor.
    VISTA passes prompt data in ``payload["prompts"]`` for SAM-like models.
    """

    payload = payload_from_request(request)
    image = decode_request_image(payload)
    options = options_from_payload(payload)
    prompts = payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}

    box = prompted_bbox_xywh(image, prompts)
    return output_for_box(
        payload=payload,
        box=box,
        label=str(options.get("label", "sam-region")),
        runtime="sam_local_import",
        score=score_from_options(options, default=0.88),
        extra_metrics={"adapter": "example_sam_backend", "prompt_keys": sorted(prompts.keys())},
    )
