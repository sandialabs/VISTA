"""Pixel-level fallbacks for model-service segmentation methods.

These run when SAM, Mask2Former, or OneFormer are requested through the
local executor; they never import model runtimes.
"""

from typing import Any

from PIL import Image

from .image_ops import (
    asphalt_anomaly_heatmap,
    connected_components,
    frangi_ridge_heatmap,
    grayscale,
    largest_region_ratio,
    mask_area_ratio,
    otsu_threshold,
)

FallbackResult = tuple[Image.Image, list[dict[str, Any]], dict[str, Any]]


def _score_polarity_candidates(
    gray: Image.Image,
    image: Image.Image,
    threshold: int,
    min_area_px: int,
    max_fraction: float,
) -> list[tuple]:
    candidates = []
    for polarity, mask in (
        ("bright", gray.point(lambda value: 255 if value > threshold else 0)),
        ("dark", gray.point(lambda value: 255 if value <= threshold else 0)),
    ):
        labels, measurements = connected_components(mask, min_area_px=min_area_px)
        if not measurements:
            continue
        area_ratio = mask_area_ratio(measurements, image)
        largest_ratio = largest_region_ratio(measurements, image)
        score = float(len(measurements))
        if area_ratio <= max_fraction:
            score += 4.0
        else:
            score -= 6.0
        score -= largest_ratio * 3.0
        candidates.append(
            (score, polarity, labels, measurements, area_ratio, largest_ratio)
        )
    return candidates


def sam_automatic_segmentation_fallback(
    image: Image.Image,
    min_mask_region_area: int,
    max_foreground_fraction: float,
) -> FallbackResult:
    gray = grayscale(image)
    default_mask, threshold = otsu_threshold(gray)
    min_area_px = max(1, int(min_mask_region_area))
    max_fraction = max(0.05, min(0.98, float(max_foreground_fraction)))
    candidates = _score_polarity_candidates(
        gray, image, threshold, min_area_px, max_fraction
    )

    if not candidates:
        labels, measurements = connected_components(
            default_mask, min_area_px=min_area_px
        )
        return (
            labels,
            measurements,
            {
                "threshold": threshold,
                "foreground_polarity": "bright",
                "foreground_fraction": mask_area_ratio(measurements, image),
                "largest_region_fraction": largest_region_ratio(measurements, image),
            },
        )

    _score, polarity, labels, measurements, area_ratio, largest_ratio = max(
        candidates, key=lambda item: item[0]
    )
    return (
        labels,
        measurements,
        {
            "threshold": threshold,
            "foreground_polarity": polarity,
            "foreground_fraction": area_ratio,
            "largest_region_fraction": largest_ratio,
        },
    )


def _labeled_mask_fallback(mask: Image.Image, image: Image.Image) -> FallbackResult:
    labels, measurements = connected_components(mask, min_area_px=1)
    return (
        labels,
        measurements,
        {
            "foreground_fraction": mask_area_ratio(measurements, image),
            "largest_region_fraction": largest_region_ratio(measurements, image),
        },
    )


def universal_segmentation_fallback(
    image: Image.Image, method_id: str, params: dict[str, Any]
) -> FallbackResult:
    if method_id == "ml.sam.segment_anything":
        return sam_automatic_segmentation_fallback(
            image,
            min_mask_region_area=int(params.get("min_mask_region_area", 8) or 8),
            max_foreground_fraction=float(
                params.get("max_foreground_fraction", 0.85) or 0.85
            ),
        )
    if method_id == "ml.mask2former.universal_segment":
        mask = asphalt_anomaly_heatmap(image, sensitivity=0.45, blur_radius=1)
        return _labeled_mask_fallback(mask, image)
    mask = frangi_ridge_heatmap(image, sensitivity=0.5, blur_radius=1)
    return _labeled_mask_fallback(mask, image)
