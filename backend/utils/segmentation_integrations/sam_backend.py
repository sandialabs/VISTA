"""SAM segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

import contextlib
import io
from typing import Any

import numpy as np
from PIL import Image

from ._shared import (
    NativeRuntime,
    SegmentationBackend,
    foreground_bbox_xywh,
    options_from_payload,
    output_for_box,
    prompted_bbox_xywh,
    rgb_image_from_payload,
    run_segmenter,
    score_from_options,
    threshold_delta_from_options,
)

_CONFIG_OPTION_NAMES = {"model_checkpoint", "model_type", "device"}
_CONTROL_OPTION_NAMES = {
    "integration_mode",
    "function_path",
    "fastapi_url",
    "timeout_seconds",
    "model",
    *_CONFIG_OPTION_NAMES,
}


def _image_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.uint8)


def _configured_checkpoint(options: dict[str, Any]) -> str:
    return str(
        options.get("model_checkpoint") or options.get("checkpoint") or ""
    ).strip()


def _sam_config(options: dict[str, Any]) -> dict[str, Any]:
    config = {
        name: options[name]
        for name in _CONFIG_OPTION_NAMES
        if options.get(name) not in (None, "")
    }
    checkpoint = _configured_checkpoint(options)
    if checkpoint:
        config["model_checkpoint"] = checkpoint
    return config


def _as_array(value: Any, *, dtype: Any | None = None) -> np.ndarray | None:
    if value is None:
        return None
    array = np.asarray(value, dtype=dtype)
    return array


def _prompt_values(payload: dict[str, Any], image: Image.Image) -> dict[str, Any]:
    prompts = payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}
    options = options_from_payload(payload)
    values = {
        **prompts,
        **{
            key: value
            for key, value in options.items()
            if key not in _CONTROL_OPTION_NAMES
        },
    }

    if values.get("point_coords") is None:
        box = values.get("box") or values.get("bbox")
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            x1, y1, x2, y2 = [float(value) for value in box[:4]]
            values["point_coords"] = [[(x1 + x2) / 2.0, (y1 + y2) / 2.0]]
            values.setdefault("point_labels", [1])

    point_coords = _as_array(values.get("point_coords"), dtype=np.float32)
    point_labels = _as_array(values.get("point_labels"), dtype=np.int64)
    mask_input = _as_array(values.get("mask_input"), dtype=np.float32)
    multimask_output = values.get("multimask_output")
    if multimask_output is None:
        multimask_output = False

    safe_values = {
        "point_coords": point_coords,
        "point_labels": point_labels,
        "mask_input": mask_input,
        "multimask_output": bool(multimask_output),
    }
    if safe_values["point_coords"] is None and values.get("positive_point") is None:
        width, height = image.size
        safe_values["point_coords"] = np.asarray(
            [[width / 2.0, height / 2.0]], dtype=np.float32
        )
        safe_values["point_labels"] = np.asarray([1], dtype=np.int64)
    if safe_values["point_coords"] is not None and safe_values["point_labels"] is None:
        safe_values["point_labels"] = np.ones(
            (safe_values["point_coords"].shape[0],), dtype=np.int64
        )
    return safe_values


def _run_mode(payload: dict[str, Any]) -> str:
    mode = str(payload.get("mode") or "default")
    if mode == "default":
        prompts = (
            payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}
        )
        options = options_from_payload(payload)
        prompt_keys = set(prompts) | (set(options) - _CONTROL_OPTION_NAMES)
        return "predict" if prompt_keys else "auto"
    return mode


def _load_sam_runtime() -> tuple[type, type]:
    """Return the operational SAM runtime (``segment-anything`` only).

    Wraps Meta's Segment Anything Model (https://github.com/facebookresearch/segment-anything)
    automatic and prompt-based mask generation behind VISTA's local
    duck-typed segmentation input/output shape.
    """
    import cv2 as cv  # noqa: PLC0415
    from segment_anything import (  # noqa: PLC0415
        SamAutomaticMaskGenerator,
        SamPredictor,
        sam_model_registry,
    )

    class RuntimeSAMSegmentationInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class RuntimeSAMSegmentation:
        def __init__(self, **config):
            self.config = config
            model_type = config.get("model_type") or "default"
            self._model = sam_model_registry[model_type](
                checkpoint=config.get("model_checkpoint")
            )
            self._model.to(device=config.get("device") or "cpu")

        def run(self, data):
            image = (
                data.image
                if getattr(data, "image", None) is not None
                else cv.imread(str(data.file))
            )
            mode = getattr(data, "run_mode", "auto")
            if mode in ("auto", "default"):
                masks = SamAutomaticMaskGenerator(self._model).generate(image)
                raw_output = None
            else:
                predictor = SamPredictor(self._model)
                predictor.set_image(image)
                mask_arrays, scores, _logits = predictor.predict(
                    point_coords=getattr(data, "point_coords", None),
                    point_labels=getattr(data, "point_labels", None),
                    mask_input=getattr(data, "mask_input", None),
                    multimask_output=bool(getattr(data, "multimask_output", False)),
                )
                masks = mask_arrays
                raw_output = {"scores": scores}
            return type(
                "VistaSAMResult",
                (),
                {
                    "mode": mode,
                    "masks": masks,
                    "raw_output": raw_output,
                },
            )()

    return RuntimeSAMSegmentation, RuntimeSAMSegmentationInput


def _mask_entry_from_array(
    mask: Any, index: int, score: Any = None
) -> dict[str, Any] | None:
    binary = np.asarray(mask).astype(bool)
    if binary.ndim != 2 or not binary.any():
        return None
    ys, xs = np.where(binary)
    x = float(xs.min())
    y = float(ys.min())
    width = float(xs.max() - xs.min() + 1)
    height = float(ys.max() - ys.min() + 1)
    score_value = None
    if score is not None:
        try:
            score_value = float(score)
        except (TypeError, ValueError):
            score_value = None
    return {
        "segmentation": None,
        "bbox": [x, y, width, height],
        "area": float(binary.sum()),
        "score": score_value,
        "label": f"sam-region-{index}",
    }


def _mask_entry_from_dict(mask: dict[str, Any], index: int) -> dict[str, Any] | None:
    bbox = mask.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
        if mask.get("segmentation") is not None:
            return _mask_entry_from_array(
                mask.get("segmentation"), index, mask.get("predicted_iou")
            )
        return None
    try:
        bbox_values = [float(value) for value in bbox[:4]]
    except (TypeError, ValueError):
        return None
    score = mask.get("score", mask.get("predicted_iou", mask.get("stability_score")))
    try:
        score = None if score is None else float(score)
    except (TypeError, ValueError):
        score = None
    area = mask.get("area") or (bbox_values[2] * bbox_values[3])
    return {
        "segmentation": None,
        "bbox": bbox_values,
        "area": float(area),
        "score": score,
        "label": str(mask.get("label") or f"sam-region-{index}"),
    }


def _extract_toolkit_masks(result: Any) -> list[dict[str, Any]]:
    masks = getattr(result, "masks", None)
    raw_output = getattr(result, "raw_output", None)
    scores = None
    if isinstance(raw_output, dict):
        scores = raw_output.get("scores")
    if masks is None:
        return []
    if isinstance(masks, np.ndarray):
        array = masks if masks.ndim != 2 else masks[None, :, :]
        return [
            entry
            for index, mask in enumerate(array, start=1)
            if (
                entry := _mask_entry_from_array(
                    mask,
                    index,
                    scores[index - 1]
                    if scores is not None and len(scores) >= index
                    else None,
                )
            )
        ]
    entries = []
    for index, mask in enumerate(masks, start=1):
        if isinstance(mask, dict):
            entry = _mask_entry_from_dict(mask, index)
        else:
            entry = _mask_entry_from_array(mask, index)
        if entry:
            entries.append(entry)
    return entries


def _fallback_output(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    image = rgb_image_from_payload(payload)
    prompts = payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}
    options = options_from_payload(payload)
    prompt_source = {
        **prompts,
        **{
            key: value
            for key, value in options.items()
            if key not in _CONTROL_OPTION_NAMES
        },
    }
    if prompt_source.get("box") is not None or prompt_source.get("bbox") is not None:
        box = prompted_bbox_xywh(image, prompt_source)
    else:
        box = foreground_bbox_xywh(
            image,
            threshold_delta=threshold_delta_from_options(options),
        )
    return output_for_box(
        payload={**payload, "backend": "sam"},
        box=box,
        label="sam-region",
        runtime="analysis_toolkit.sam_fallback",
        score=score_from_options(options, 0.9),
        extra_metrics={"fallback_reason": reason},
    )


def _toolkit_output(
    payload: dict[str, Any],
    image: Image.Image,
    options: dict[str, Any],
    runtime: NativeRuntime,
) -> dict[str, Any] | None:
    config = _sam_config(options)
    if not _configured_checkpoint(options):
        return None
    sam_segmentation_cls, sam_input_cls = runtime.load()
    with contextlib.redirect_stdout(io.StringIO()):
        segmenter = sam_segmentation_cls(**config)
    data = sam_input_cls(
        file=None,
        image=_image_array(image),
        run_mode=_run_mode(payload),
        **_prompt_values(payload, image),
    )
    result = run_segmenter(segmenter, data)
    masks = _extract_toolkit_masks(result)
    if not masks:
        return None
    return {
        "backend": "sam",
        "mode": str(getattr(result, "mode", _run_mode(payload)) or _run_mode(payload)),
        "masks": masks,
        "metrics": {"runtime": "analysis_toolkit.sam", "mask_count": len(masks)},
        "raw_output": None,
    }


def _run_native(payload: dict[str, Any], runtime: NativeRuntime) -> dict[str, Any]:
    image = rgb_image_from_payload(payload)
    try:
        output = _toolkit_output(payload, image, options_from_payload(payload), runtime)
    except Exception as exc:
        raise RuntimeError(f"toolkit execution failed: {exc}") from exc
    if output is None:
        raise RuntimeError("model_checkpoint is not configured")
    return output


BACKEND = SegmentationBackend(
    display_name="SAM",
    module_name=__name__,
    loader_name="_load_sam_runtime",
    run_native=_run_native,
    fallback=_fallback_output,
)
run = BACKEND.run
