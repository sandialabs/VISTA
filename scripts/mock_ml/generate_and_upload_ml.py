#!/usr/bin/env python3
"""Generate a synthetic image with geometric shapes, upload it to the app, create several
mock ML analyses (classification, detection, segmentation/heatmap) and attach annotations.

Usage:
  python scripts/mock_ml/generate_and_upload_ml.py --api-base http://localhost:8000 --project <project_id> \
      [--api-key XYZ]

Steps:
 1. Generate PNG with colored shapes.
 2. Upload image (POST /api/projects/{id}/images).
 3. Create one or more ML analyses (POST /api/images/{image_id}/analyses).
 4. For each analysis, bulk insert annotations (POST /api/analyses/{analysis_id}/annotations:bulk).
 5. Finalize analysis (POST /api/analyses/{analysis_id}/finalize) with status=completed.

Authentication: API key (Bearer token) or debug-mode headers (X-User-Email).
All endpoints use the unified /api prefix.

Requires: Pillow (PIL). Install via: pip install Pillow requests
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time
from typing import Any

import requests
from PIL import Image, ImageDraw


def log(msg: str):
    print(f"[mock-ml] {msg}")


def gen_image(width=640, height=480) -> bytes:
    img = Image.new("RGB", (width, height), (20, 20, 30))
    d = ImageDraw.Draw(img)
    # Draw rectangles
    d.rectangle([50, 40, 200, 180], outline="red", width=4)
    d.rectangle([300, 220, 500, 400], outline="lime", width=4)
    # Circles (ellipses)
    d.ellipse([400, 40, 480, 120], outline="orange", width=5)
    # Polygon (triangle)
    d.polygon([(120, 300), (200, 250), (260, 360)], outline="cyan")
    # Text label
    d.text((20, 450), "Synthetic Demo", fill="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _build_session(api_key: str | None) -> requests.Session:
    """Create an authenticated requests session."""
    session = requests.Session()
    if api_key:
        session.headers.update({"Authorization": f"Bearer {api_key}"})
    else:
        session.headers.update({"X-User-Email": "test@example.com"})
    return session


def upload_image(
    api_base: str, project_id: str, png_bytes: bytes, session: requests.Session
) -> str:
    files = {"file": (f"synthetic_{int(time.time())}.png", png_bytes, "image/png")}
    url = f"{api_base}/api/projects/{project_id}/images"
    log(f"Uploading image -> {url}")
    resp = session.post(url, files=files)
    if resp.status_code >= 400:
        raise RuntimeError(f"Image upload failed: {resp.status_code} {resp.text}")
    data = resp.json()
    image_id = data.get("id") or data.get("image_id") or data.get("image", {}).get("id")
    if not image_id:
        raise RuntimeError(f"Could not parse image id from response: {data}")
    log(f"Uploaded image id={image_id}")
    return image_id


def create_analysis(
    api_base: str,
    image_id: str,
    model_name: str,
    model_version: str,
    session: requests.Session,
    *,
    fallback: bool = True,
) -> str:
    """Attempt to create an analysis; if model not allowed and fallback enabled, retry with a default allowed model."""
    attempt_names = [model_name]
    # Known default allowed models from backend settings (can drift; safe baseline)
    default_allowed = [
        "resnet50_classifier",
        "vgg16",
        "inception_v3",
        "efficientnet_b0",
    ]
    if fallback:
        for d in default_allowed:
            if d not in attempt_names:
                attempt_names.append(d)
    url = f"{api_base}/api/images/{image_id}/analyses"
    last_error = None
    for name in attempt_names:
        payload = {
            "image_id": image_id,
            "model_name": name,
            "model_version": model_version,
            "parameters": {"demo": True, "requested_name": model_name},
        }
        log(f"Create analysis -> {url} model={name}")
        resp = session.post(url, json=payload)
        if resp.status_code < 400:
            data = resp.json()
            if name != model_name:
                log(f"Model '{model_name}' not allowed; fell back to '{name}'")
            return data["id"]
        last_error = f"{resp.status_code} {resp.text}"
        if "Model not allowed" in resp.text and fallback:
            continue
        else:
            break
    raise RuntimeError(f"Create analysis failed after fallbacks: {last_error}")


def bulk_annotations(
    api_base: str,
    analysis_id: str,
    annotations: list[dict[str, Any]],
    session: requests.Session,
):
    payload = {"annotations": annotations, "mode": "append"}
    url = f"{api_base}/api/analyses/{analysis_id}/annotations:bulk"
    log(f"Bulk annotations -> {url} count={len(annotations)}")
    resp = session.post(url, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bulk annotations failed: {resp.status_code} {resp.text}")


def finalize(api_base: str, analysis_id: str, session: requests.Session):
    payload = {"status": "completed"}
    url = f"{api_base}/api/analyses/{analysis_id}/finalize"
    log(f"Finalize analysis -> {analysis_id}")
    resp = session.post(url, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Finalize failed: {resp.status_code} {resp.text}")


def build_detection_annotations(image_w: int, image_h: int) -> list[dict[str, Any]]:
    # Basic two bounding boxes align with shapes drawn
    boxes = [
        {
            "annotation_type": "detection",
            "class_name": "red-rect",
            "confidence": 0.94,
            "data": {
                "x_min": 50,
                "y_min": 40,
                "x_max": 200,
                "y_max": 180,
                "image_width": image_w,
                "image_height": image_h,
            },
        },
        {
            "annotation_type": "detection",
            "class_name": "green-rect",
            "confidence": 0.88,
            "data": {
                "x_min": 300,
                "y_min": 220,
                "x_max": 500,
                "y_max": 400,
                "image_width": image_w,
                "image_height": image_h,
            },
        },
    ]
    return boxes


def build_classification_annotations() -> list[dict[str, Any]]:
    return [
        {
            "annotation_type": "classification",
            "class_name": "synthetic_demo",
            "confidence": 0.99,
            "data": {"topk": ["synthetic_demo", "other"]},
        },
    ]


def build_heatmap_annotation(image_w: int, image_h: int) -> list[dict[str, Any]]:
    # Create a simple gradient heatmap (RGBA) and embed as base64 PNG or just add metadata for now.
    # For simplicity we store a tiny (64x48) heatmap matrix in data and mark type="heatmap".
    import math

    scaled_w, scaled_h = 64, 48
    arr = []
    for y in range(scaled_h):
        row = []
        for x in range(scaled_w):
            # Example intensity pattern
            val = (
                math.sin(x / 5.0) + math.cos(y / 6.0)
            ) / 2 + 0.5  # normalize roughly 0..1
            row.append(round(val, 3))
        arr.append(row)
    return [
        {
            "annotation_type": "heatmap",
            "class_name": None,
            "confidence": None,
            "data": {
                "width": scaled_w,
                "height": scaled_h,
                "matrix": arr,
                "original_width": image_w,
                "original_height": image_h,
            },
        }
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default="http://localhost:8000")
    ap.add_argument("--project", required=True, help="Project UUID")
    ap.add_argument("--api-key", help="API key for Bearer token authentication")
    ap.add_argument("--no-heatmap", action="store_true")
    ap.add_argument("--model-name-base", default="demo-model")
    ap.add_argument(
        "--no-fallback-model",
        action="store_true",
        help="Disable auto fallback to default allowed models",
    )
    args = ap.parse_args()

    png = gen_image()
    # Save local copy for debugging
    out_dir = "scripts/mock_ml/output"
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "synthetic.png"), "wb") as f:
        f.write(png)

    # Build authenticated session
    api_key = args.api_key or os.environ.get("API_KEY")
    session = _build_session(api_key)

    image_id = upload_image(args.api_base, args.project, png, session)

    # ANALYSIS 1: detection + classification combined
    analysis1 = create_analysis(
        args.api_base,
        image_id,
        f"{args.model_name_base}-detcls",
        "1",
        session,
        fallback=not args.no_fallback_model,
    )
    det_anns = (
        build_detection_annotations(640, 480) + build_classification_annotations()
    )
    bulk_annotations(args.api_base, analysis1, det_anns, session)
    finalize(args.api_base, analysis1, session)
    log(f"Analysis {analysis1} (det+cls) completed with {len(det_anns)} annotations")

    # ANALYSIS 2: heatmap (optional)
    if not args.no_heatmap:
        analysis2 = create_analysis(
            args.api_base,
            image_id,
            f"{args.model_name_base}-heatmap",
            "1",
            session,
            fallback=not args.no_fallback_model,
        )
        heatmap_anns = build_heatmap_annotation(640, 480)
        bulk_annotations(args.api_base, analysis2, heatmap_anns, session)
        finalize(args.api_base, analysis2, session)
        log(
            f"Analysis {analysis2} (heatmap) completed with {len(heatmap_anns)} annotations"
        )

    log("Done.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(1)
