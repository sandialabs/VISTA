#!/usr/bin/env python3
"""
ML Pipeline Simulation Script

This script simulates an external ML pipeline that:
1. Creates a test analysis
2. Updates status to processing
3. Requests presigned upload URL
4. Uploads a fake heatmap image
5. Posts bulk annotations (bounding boxes + heatmap reference)
6. Finalizes analysis as completed

Usage:
    python scripts/test_ml_pipeline.py [--image-id IMAGE_ID] [--base-url BASE_URL]

Authentication:
    --api-key KEY       API key for Bearer token authentication (recommended)
    Or set API_KEY environment variable.
    In debug mode (DEBUG=true on backend), no auth is needed.
"""

import argparse
import os
import random
import sys
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw

# Load environment variables from .env file in project root
project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env")


def create_fake_heatmap(width=512, height=512) -> bytes:
    """Create a fake heatmap image (PNG) for testing."""
    # Create a simple gradient heatmap
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)

    # Create a radial gradient effect
    center_x, center_y = width // 2, height // 2
    max_distance = ((width / 2) ** 2 + (height / 2) ** 2) ** 0.5

    for y in range(height):
        for x in range(width):
            distance = ((x - center_x) ** 2 + (y - center_y) ** 2) ** 0.5
            intensity = int(255 * (1 - distance / max_distance))
            # Red-yellow gradient (heatmap style)
            r = min(255, intensity + 100)
            g = max(0, intensity - 50)
            b = 0
            draw.point((x, y), fill=(r, g, b))

    # Convert to bytes
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def run_pipeline(
    base_url: str,
    image_id: str,
    session: requests.Session,
    model_name: str = "yolo_v8",
    model_version: str = "1.0.0",
):
    """
    Run a complete ML pipeline simulation.

    Args:
        base_url: Base URL of the API (e.g., http://localhost:8000)
        image_id: UUID of the image to analyze
        session: Authenticated requests session
        model_name: Model name to use for analysis
        model_version: Model version
    """
    print("Starting ML Pipeline Simulation")
    print(f"   Base URL: {base_url}")
    print(f"   Image ID: {image_id}")
    print(f"   Model: {model_name} v{model_version}")
    print()

    # Step 1: Create analysis
    print("Step 1: Creating analysis...")
    create_payload = {
        "image_id": image_id,
        "model_name": model_name,
        "model_version": model_version,
        "parameters": {
            "confidence_threshold": 0.5,
            "iou_threshold": 0.4,
            "max_detections": 100,
        },
    }

    resp = session.post(
        f"{base_url}/api/images/{image_id}/analyses", json=create_payload
    )

    if resp.status_code != 201:
        print(f"FAIL: Failed to create analysis: {resp.status_code} - {resp.text}")
        return False

    analysis = resp.json()
    analysis_id = analysis["id"]
    print(f"  OK: Analysis created: {analysis_id}")
    print(f"   Status: {analysis['status']}")
    print()

    # Step 2: Update status to processing
    print("Step 2: Updating status to 'processing'...")
    status_payload = {"status": "processing"}

    resp = session.patch(
        f"{base_url}/api/analyses/{analysis_id}/status", json=status_payload
    )

    if resp.status_code != 200:
        print(f"FAIL: Failed to update status: {resp.status_code} - {resp.text}")
        return False

    print("  OK: Status updated to 'processing'")
    print()

    # Step 3: Request presigned upload URL for heatmap
    print("Step 3: Requesting presigned upload URL for heatmap...")
    presign_payload = {"artifact_type": "heatmap", "filename": "heatmap.png"}

    resp = session.post(
        f"{base_url}/api/analyses/{analysis_id}/artifacts/presign", json=presign_payload
    )

    if resp.status_code != 200:
        print(f"FAIL: Failed to get presigned URL: {resp.status_code} - {resp.text}")
        return False

    presign_data = resp.json()
    upload_url = presign_data["upload_url"]
    storage_path = presign_data["storage_path"]
    print("  OK: Presigned URL obtained")
    print(f"   Storage path: {storage_path}")
    print()

    # Step 4: Upload heatmap (only if not a mock URL)
    print("Step 4: Uploading heatmap image...")
    if not upload_url.startswith("https://example.com"):
        # Real S3 upload
        heatmap_bytes = create_fake_heatmap()
        upload_resp = requests.put(
            upload_url, data=heatmap_bytes, headers={"Content-Type": "image/png"}
        )

        if upload_resp.status_code not in (200, 204):
            print(f"  WARN: Heatmap upload failed: {upload_resp.status_code}")
            print("   Continuing anyway (artifact upload is optional)")
        else:
            print("  OK: Heatmap uploaded successfully")
    else:
        print("  INFO: Skipping upload (mock S3 URL detected)")
    print()

    # Step 5: Post bulk annotations
    print("Step 5: Posting bulk annotations...")

    # Generate random bounding boxes
    num_boxes = random.randint(3, 8)
    image_width, image_height = 1024, 768
    class_names = ["cat", "dog", "car", "person", "bicycle", "bird", "horse"]

    annotations = []

    # Add bounding boxes
    for i in range(num_boxes):
        x_min = random.randint(0, image_width - 200)
        y_min = random.randint(0, image_height - 200)
        box_width = random.randint(50, 200)
        box_height = random.randint(50, 200)
        x_max = min(x_min + box_width, image_width)
        y_max = min(y_min + box_height, image_height)

        annotations.append(
            {
                "annotation_type": "bounding_box",
                "class_name": random.choice(class_names),
                "confidence": round(random.uniform(0.5, 0.99), 4),
                "data": {
                    "x_min": x_min,
                    "y_min": y_min,
                    "x_max": x_max,
                    "y_max": y_max,
                    "image_width": image_width,
                    "image_height": image_height,
                },
                "ordering": i,
            }
        )

    # Add heatmap reference
    annotations.append(
        {
            "annotation_type": "heatmap",
            "class_name": None,
            "confidence": None,
            "data": {"width": 512, "height": 512, "color_map": "viridis"},
            "storage_path": storage_path,
            "ordering": len(annotations),
        }
    )

    # Add overall classification
    top_class = max(annotations[:-1], key=lambda a: a["confidence"])["class_name"]
    annotations.append(
        {
            "annotation_type": "classification",
            "class_name": top_class,
            "confidence": 0.95,
            "data": {
                "topk": [
                    {"class": top_class, "confidence": 0.95},
                    {
                        "class": random.choice(
                            [c for c in class_names if c != top_class]
                        ),
                        "confidence": 0.03,
                    },
                    {
                        "class": random.choice(
                            [c for c in class_names if c != top_class]
                        ),
                        "confidence": 0.02,
                    },
                ]
            },
            "ordering": len(annotations),
        }
    )

    bulk_payload = {"annotations": annotations}

    resp = session.post(
        f"{base_url}/api/analyses/{analysis_id}/annotations:bulk", json=bulk_payload
    )

    if resp.status_code != 200:
        print(f"FAIL: Failed to post annotations: {resp.status_code} - {resp.text}")
        return False

    result = resp.json()
    print("  OK: Annotations posted successfully")
    print(f"   Total annotations: {result['total']}")
    print(f"   Bounding boxes: {num_boxes}")
    print("   Heatmap: 1")
    print("   Classification: 1")
    print()

    # Step 6: Finalize analysis
    print("Step 6: Finalizing analysis...")
    finalize_payload = {"status": "completed"}

    resp = session.post(
        f"{base_url}/api/analyses/{analysis_id}/finalize", json=finalize_payload
    )

    if resp.status_code != 200:
        print(f"FAIL: Failed to finalize analysis: {resp.status_code} - {resp.text}")
        return False

    final_analysis = resp.json()
    print("  OK: Analysis finalized")
    print(f"   Status: {final_analysis['status']}")
    print(f"   Started: {final_analysis.get('started_at', 'N/A')}")
    print(f"   Completed: {final_analysis.get('completed_at', 'N/A')}")
    print()

    print("=" * 60)
    print("ML Pipeline Simulation Completed Successfully!")
    print("=" * 60)
    print(f"\nAnalysis ID: {analysis_id}")
    print(f"View in UI: {base_url.replace(':8000', ':3000')}/view/{image_id}")
    print()

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Simulate an external ML pipeline for testing"
    )
    parser.add_argument(
        "--image-id", required=True, help="UUID of the image to analyze"
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("API_BASE_URL", "http://localhost:8000"),
        help="Base URL of the API (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("API_KEY"),
        help="API key for Bearer token authentication",
    )
    parser.add_argument(
        "--model-name", default="yolo_v8", help="Model name to use (default: yolo_v8)"
    )
    parser.add_argument(
        "--model-version", default="1.0.0", help="Model version (default: 1.0.0)"
    )

    args = parser.parse_args()

    # Set up authenticated session
    session = requests.Session()
    if args.api_key:
        session.headers.update({"Authorization": f"Bearer {args.api_key}"})
        print("Using API key authentication")
    else:
        print("No API key provided -- relying on debug mode (X-User-Email header)")
        session.headers.update({"X-User-Email": "test@example.com"})

    # Run the pipeline
    success = run_pipeline(
        base_url=args.base_url.rstrip("/"),
        image_id=args.image_id,
        session=session,
        model_name=args.model_name,
        model_version=args.model_version,
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
