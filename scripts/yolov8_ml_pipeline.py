#!/usr/bin/env python3
"""
YOLOv8 ML Pipeline Integration Test
End-to-end test that:
1. Fetches images from a project
2. Runs YOLOv8 object detection
3. Pushes results back to the ML analysis API
"""

import os
import sys
import json
import hmac
import hashlib
import time
import tempfile
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
from io import BytesIO

from dotenv import load_dotenv

# Load environment variables from .env file in project root
project_root = Path(__file__).parent.parent
load_dotenv(project_root / '.env')

import requests
from PIL import Image
import cv2
import numpy as np

try:
    from ultralytics import YOLO
except ImportError:
    print("X Error: ultralytics not installed. Run: pip install ultralytics opencv-python")
    sys.exit(1)


class YOLOv8Pipeline:
    """YOLOv8 object detection pipeline with ML API integration"""

    def __init__(self, api_base_url: str, hmac_secret: str, api_key: Optional[str] = None, user_email: str = "test@example.com"):
        self.api_base_url = api_base_url.rstrip('/')
        self.hmac_secret = hmac_secret
        self.api_key = api_key
        self.user_email = user_email
        self.model = None
        self.session = requests.Session()

        # Set up headers
        # Always include mock user header for auth compatibility
        self.session.headers.update({'X-User-Email': self.user_email})

        if self.api_key:
            self.session.headers.update({'Authorization': f'Bearer {self.api_key}'})

    def _get_api_url(self, path: str) -> str:
        """
        Build URL for regular API endpoint (non-HMAC).
        Uses /api-key prefix when using API key, /api when using OAuth.

        Args:
            path: API path (e.g., "/projects/123/images")

        Returns:
            Full URL with appropriate prefix
        """
        path = path.lstrip('/')
        # Use /api-key prefix if we have an API key, otherwise /api (OAuth)
        prefix = "api-key" if self.api_key else "api"
        return f"{self.api_base_url}/{prefix}/{path}"

    def _get_ml_url(self, path: str) -> str:
        """
        Build URL for ML pipeline endpoint.
        Uses /api-ml prefix which requires API key + HMAC authentication.

        Args:
            path: API path (e.g., "/analyses/123/status")

        Returns:
            Full URL with /api-ml prefix
        """
        path = path.lstrip('/')
        return f"{self.api_base_url}/api-ml/{path}"

    def _generate_hmac_signature(self, body: str) -> tuple[str, str]:
        """Generate HMAC signature for ML pipeline authentication"""
        timestamp = str(int(time.time()))
        # Message format: timestamp.body (dot separator, not colon)
        message = timestamp.encode('utf-8') + b'.' + body.encode('utf-8')
        signature_hex = hmac.new(
            self.hmac_secret.encode('utf-8'),
            message,
            hashlib.sha256
        ).hexdigest()
        # Signature format: sha256=<hex>
        signature = f"sha256={signature_hex}"
        return signature, timestamp

    def _make_hmac_request(self, method: str, url: str, json_data: Dict[str, Any]) -> requests.Response:
        """Make authenticated request with HMAC signature

        HMAC requests require TWO layers of authentication:
        1. User authentication (API key OR user email headers)
        2. HMAC signature (proves request is from authorized ML pipeline)

        This prevents unauthorized pipelines from making callbacks, even if they
        have valid user credentials.
        """
        body = json.dumps(json_data, separators=(',', ':'))
        signature, timestamp = self._generate_hmac_signature(body)

        headers = {
            'X-ML-Signature': signature,
            'X-ML-Timestamp': timestamp,
            'Content-Type': 'application/json'
        }

        # Add user authentication headers
        # Prefer API key if available, otherwise use user email (for dev/testing)
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        else:
            # For dev/testing without API key - assumes DEBUG=true on backend
            headers['X-User-Email'] = self.user_email

        # Make request with both auth layers
        response = requests.request(
            method=method,
            url=url,
            data=body,
            headers=headers
        )
        return response

    def load_model(self, model_size: str = 'n'):
        """Load YOLOv8 model (n=nano, s=small, m=medium, l=large, x=xlarge)"""
        model_name = f'yolov8{model_size}.pt'
        print(f"X Loading YOLOv8 model: {model_name}")
        self.model = YOLO(model_name)
        print("X Model loaded successfully")

    def get_project_images(self, project_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch images from a project"""
        print(f"X Fetching images from project {project_id}")

        url = self._get_api_url(f"projects/{project_id}/images")
        params = {'skip': 0, 'limit': limit}

        response = self.session.get(url, params=params)
        response.raise_for_status()

        images = response.json()
        print(f"X Found {len(images)} images")
        return images

    def get_image_analyses(self, image_id: str) -> List[Dict[str, Any]]:
        """Fetch existing analyses for an image"""
        url = self._get_api_url(f"images/{image_id}/analyses")

        try:
            response = self.session.get(url)
            response.raise_for_status()
            data = response.json()
            # API returns {"analyses": [...], "total": N}
            return data.get('analyses', [])
        except Exception as e:
            print(f"  X  Failed to fetch analyses for image {image_id}: {e}")
            return []

    def download_image(self, image_id: str) -> tuple[np.ndarray, Dict[str, Any]]:
        """Download image from API and return as numpy array"""
        print(f"  X Downloading image {image_id}")

        # First, get the download info (returns JSON with URL)
        info_url = self._get_api_url(f"images/{image_id}/download")
        info_response = self.session.get(info_url)
        info_response.raise_for_status()

        download_info = info_response.json()
        content_url = download_info.get('url')

        if not content_url:
            raise ValueError(f"No content URL in download response: {download_info}")

        # Now download the actual image content
        if not content_url.startswith('http'):
            # Ensure the content URL has proper API prefix if it's a relative path
            if not content_url.startswith(('/api/', '/api-key/', '/api-ml/')):
                # Prepend appropriate prefix for relative URLs
                prefix = "api-key" if self.api_key else "api"
                content_url = f"/{prefix}{content_url}"
            content_url = f"{self.api_base_url}{content_url}"

        response = self.session.get(content_url, stream=True)
        response.raise_for_status()

        # Get image metadata from headers
        metadata = {
            'content_type': response.headers.get('Content-Type', 'image/jpeg'),
            'filename': download_info.get('object_key', '').split('/')[-1] or f"{image_id}.jpg",
            'object_key': download_info.get('object_key', '')
        }

        # Convert to numpy array for OpenCV
        image_bytes = BytesIO(response.content)

        # Debug: check if we got any content
        if len(response.content) == 0:
            raise ValueError(f"Empty response from {content_url}. Status: {response.status_code}, Headers: {dict(response.headers)}")

        content_type = response.headers.get('Content-Type', '')
        print(f"  X Received {len(response.content)} bytes, content-type: {content_type}")

        # Check if we got HTML (error page) instead of image
        if 'text/html' in content_type:
            error_body = response.content.decode('utf-8', errors='ignore')[:500]
            raise ValueError(f"Got HTML error page instead of image from {content_url}:\n{error_body}")

        pil_image = Image.open(image_bytes)
        image_array = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

        print(f"  X Downloaded {metadata['filename']}")
        print(f"  DEBUG: Image shape (HxWxC): {image_array.shape}")
        print(f"  DEBUG: Image dimensions - Height: {image_array.shape[0]}, Width: {image_array.shape[1]}")

        return image_array, metadata

    def create_analysis(self, image_id: str, model_version: str) -> str:
        """Create ML analysis entry"""
        print(f"  X Creating analysis for image {image_id}")

        url = self._get_api_url(f"images/{image_id}/analyses")
        data = {
            "image_id": image_id,  # Include image_id in request body
            "model_name": "yolo_v8",
            "model_version": model_version,
            "parameters": {
                "conf_threshold": 0.25,
                "iou_threshold": 0.45,
                "model_size": model_version.split('_')[-1]
            }
        }

        response = self.session.post(url, json=data)

        # Add better error handling
        if not response.ok:
            error_detail = response.text
            raise ValueError(f"Failed to create analysis: {response.status_code} - {error_detail}")

        analysis = response.json()
        analysis_id = analysis['id']
        print(f"  X Created analysis {analysis_id}")
        return analysis_id

    def update_analysis_status(self, analysis_id: str, status: str):
        """Update analysis status"""
        print(f"  X Updating analysis status to: {status}")

        url = self._get_ml_url(f"analyses/{analysis_id}/status")
        data = {"status": status}

        response = self._make_hmac_request('PATCH', url, data)
        response.raise_for_status()
        print(f"  X Status updated to {status}")

    def run_detection(self, image: np.ndarray, conf_threshold: float = 0.25) -> List[Dict[str, Any]]:
        """Run YOLOv8 detection on image"""
        print(f"  X Running YOLOv8 detection...")

        results = self.model(image, conf=conf_threshold, verbose=False)[0]

        detections = []
        for box in results.boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            confidence = float(box.conf[0].cpu().numpy())
            class_id = int(box.cls[0].cpu().numpy())
            class_name = results.names[class_id]

            detections.append({
                'class_name': class_name,
                'confidence': confidence,
                'bbox': {
                    'x_min': float(x1),
                    'y_min': float(y1),
                    'x_max': float(x2),
                    'y_max': float(y2),
                    'width': float(x2 - x1),
                    'height': float(y2 - y1)
                }
            })

        print(f"  X Detected {len(detections)} objects")
        return detections

    def create_visualizations(self, image: np.ndarray, detections: List[Dict[str, Any]]) -> tuple[bytes, bytes]:
        """Create annotated image and heatmap"""
        # Annotated image with bounding boxes
        annotated = image.copy()
        for det in detections:
            bbox = det['bbox']
            x1, y1 = int(bbox['x_min']), int(bbox['y_min'])
            x2, y2 = int(bbox['x_max']), int(bbox['y_max'])

            # Draw bounding box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # Draw label
            label = f"{det['class_name']} {det['confidence']:.2f}"
            cv2.putText(annotated, label, (x1, y1 - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        # Convert to JPEG bytes
        _, annotated_bytes = cv2.imencode('.jpg', annotated)

        # Create simple heatmap (confidence-based)
        heatmap = np.zeros(image.shape[:2], dtype=np.float32)
        for det in detections:
            bbox = det['bbox']
            x1, y1 = int(bbox['x_min']), int(bbox['y_min'])
            x2, y2 = int(bbox['x_max']), int(bbox['y_max'])
            heatmap[y1:y2, x1:x2] += det['confidence']

        # Normalize and colorize
        if heatmap.max() > 0:
            heatmap = (heatmap / heatmap.max() * 255).astype(np.uint8)
        heatmap_color = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)
        _, heatmap_bytes = cv2.imencode('.png', heatmap_color)

        return annotated_bytes.tobytes(), heatmap_bytes.tobytes()

    def upload_artifact(self, analysis_id: str, artifact_type: str, filename: str, data: bytes):
        """Upload artifact to S3 via presigned URL"""
        print(f"  X Uploading {artifact_type}: {filename}")

        # Get presigned URL
        url = self._get_ml_url(f"analyses/{analysis_id}/artifacts/presign")
        presign_data = {
            "artifact_type": artifact_type,
            "filename": filename
        }

        response = self._make_hmac_request('POST', url, presign_data)

        if not response.ok:
            print(f"  X Presign request failed: {response.status_code}")
            print(f"  Response: {response.text}")
            print(f"  Headers sent: X-ML-Signature={response.request.headers.get('X-ML-Signature')[:16]}...")
            print(f"  HMAC secret (first 16 chars): {self.hmac_secret[:16]}...")

        response.raise_for_status()

        presign_response = response.json()
        upload_url = presign_response['upload_url']
        storage_path = presign_response['storage_path']

        # Upload to S3
        headers = {'Content-Type': 'image/png' if artifact_type == 'heatmap' else 'image/jpeg'}
        upload_response = requests.put(upload_url, data=data, headers=headers)
        upload_response.raise_for_status()

        print(f"  X Uploaded to {storage_path}")
        return storage_path

    def submit_annotations(self, analysis_id: str, detections: List[Dict[str, Any]],
                          heatmap_path: str, image_shape: tuple):
        """Submit detection annotations"""
        print(f"  X Submitting {len(detections)} annotations")

        annotations = []

        # Get image dimensions (height, width, channels)
        image_height, image_width = image_shape[0], image_shape[1]

        print(f"  DEBUG: Image shape for annotations: {image_shape}")
        print(f"  DEBUG: Embedding dimensions in bbox data - Width: {image_width}, Height: {image_height}")

        # Add bounding box annotations
        for i, det in enumerate(detections):
            # Include image dimensions in bbox data for proper scaling on frontend
            bbox_data = det['bbox'].copy()
            bbox_data['image_width'] = image_width
            bbox_data['image_height'] = image_height

            if i == 0:  # Log first bbox as sample
                print(f"  DEBUG: Sample bbox data: {bbox_data}")

            annotations.append({
                "annotation_type": "bounding_box",
                "class_name": det['class_name'],
                "confidence": det['confidence'],
                "data": bbox_data,
                "ordering": i
            })

        # Add heatmap annotation
        annotations.append({
            "annotation_type": "heatmap",
            "data": {
                "width": image_width,
                "height": image_height
            },
            "storage_path": heatmap_path,
            "ordering": len(detections)
        })

        url = self._get_ml_url(f"analyses/{analysis_id}/annotations:bulk")
        data = {
            "annotations": annotations,
            "mode": "append"
        }

        response = self._make_hmac_request('POST', url, data)
        response.raise_for_status()

        print(f"  X Submitted {len(annotations)} annotations")

    def finalize_analysis(self, analysis_id: str, status: str = "completed", error_message: str = None):
        """Finalize analysis"""
        print(f"  X Finalizing analysis as {status}")

        url = self._get_ml_url(f"analyses/{analysis_id}/finalize")
        data = {"status": status}
        if error_message:
            data["error_message"] = error_message

        response = self._make_hmac_request('POST', url, data)
        response.raise_for_status()
        print(f"  X Analysis finalized")

    def process_image(self, image_id: str, model_version: str):
        """Process a single image end-to-end"""
        print(f"\n{'='*60}")
        print(f"Processing image: {image_id}")
        print(f"{'='*60}")

        analysis_id = None
        try:
            # Download image
            image, metadata = self.download_image(image_id)

            # Create analysis
            analysis_id = self.create_analysis(image_id, model_version)

            # Update to processing
            self.update_analysis_status(analysis_id, "processing")

            # Run detection
            detections = self.run_detection(image)

            # Create visualizations
            annotated_bytes, heatmap_bytes = self.create_visualizations(image, detections)

            # Upload artifacts
            heatmap_path = self.upload_artifact(
                analysis_id, 'heatmap', f'heatmap_{analysis_id}.png', heatmap_bytes
            )
            # Note: 'visualization' isn't in backend's content_type_map,
            # so it gets 'application/octet-stream'. We won't upload annotated for now.
            # Just upload heatmap which is sufficient for visualization
            # self.upload_artifact(
            #     analysis_id, 'visualization', f'annotated_{analysis_id}.jpg', annotated_bytes
            # )

            # Submit annotations
            self.submit_annotations(analysis_id, detections, heatmap_path, image.shape)

            # Finalize
            self.finalize_analysis(analysis_id, "completed")

            print(f"X Successfully processed image {image_id}")

        except Exception as e:
            print(f"X Error processing image {image_id}: {e}")
            if analysis_id:
                try:
                    self.finalize_analysis(analysis_id, "failed", str(e))
                except:
                    pass
            raise

    def run_project_pipeline(self, project_id: str, model_size: str = 'n', limit: int = 10, skip_existing: bool = False):
        """Run pipeline on all images in a project"""
        print(f"\nX Starting YOLOv8 Pipeline")
        print(f"Project ID: {project_id}")
        print(f"Model Size: yolov8{model_size}")
        print(f"Image Limit: {limit}")
        print(f"Skip Existing: {skip_existing}")
        print(f"{'='*60}\n")

        # Load model
        self.load_model(model_size)
        model_version = f"yolov8_{model_size}"

        # Get project images
        images = self.get_project_images(project_id, limit)

        if not images:
            print("X  No images found in project")
            return

        # Filter images if skip_existing is enabled
        images_to_process = []
        skipped_count = 0

        if skip_existing:
            print(f"X Checking for existing analyses...")
            for image in images:
                analyses = self.get_image_analyses(image['id'])
                # Only skip if there's at least one completed analysis
                completed_analyses = [a for a in analyses if a.get('status') == 'completed']
                if completed_analyses:
                    print(f"  X  Skipping {image['id']} (has {len(completed_analyses)} completed analysis/analyses)")
                    skipped_count += 1
                else:
                    if analyses:
                        non_completed = [a.get('status') for a in analyses]
                        print(f"  → Including {image['id']} (has analyses but none completed: {non_completed})")
                    images_to_process.append(image)
            print(f"X Filtered {len(images)} images → {len(images_to_process)} to process ({skipped_count} skipped)\n")
        else:
            images_to_process = images

        if not images_to_process:
            print("X  No images to process (all have existing analyses)")
            return

        # Process each image
        success_count = 0
        for i, image in enumerate(images_to_process, 1):
            print(f"\n[{i}/{len(images_to_process)}] Processing image...")
            try:
                self.process_image(image['id'], model_version)
                success_count += 1
            except Exception as e:
                print(f"X Failed to process image: {e}")

        # Summary
        print(f"\n{'='*60}")
        print(f"Pipeline Complete!")
        print(f"{'='*60}")
        print(f"Total Images: {len(images)}")
        if skip_existing:
            print(f"Skipped (existing): {skipped_count}")
            print(f"Processed: {len(images_to_process)}")
        print(f"Successful: {success_count}")
        print(f"Failed: {len(images_to_process) - success_count}")


def main():
    parser = argparse.ArgumentParser(description='YOLOv8 ML Pipeline Integration Test')
    parser.add_argument('project_id', help='Project ID to process')
    parser.add_argument('--api-url', default='http://localhost:8000',
                       help='API base URL (default: http://localhost:8000)')
    parser.add_argument('--hmac-secret', help='HMAC secret for pipeline authentication')
    parser.add_argument('--api-key', help='API key for authentication')
    parser.add_argument('--model-size', default='n', choices=['n', 's', 'm', 'l', 'x'],
                       help='YOLOv8 model size (n=nano, s=small, m=medium, l=large, x=xlarge)')
    parser.add_argument('--limit', type=int, default=10,
                       help='Maximum number of images to process (default: 10)')
    parser.add_argument('--skip-existing', action='store_true',
                       help='Skip images that already have ML analysis results')

    args = parser.parse_args()

    # Get HMAC secret from args or environment
    hmac_secret = args.hmac_secret or os.environ.get('ML_CALLBACK_HMAC_SECRET')
    if not hmac_secret:
        print("X Error: HMAC secret required. Set ML_CALLBACK_HMAC_SECRET or use --hmac-secret")
        sys.exit(1)

    # Get API key from args or environment
    api_key = args.api_key or os.environ.get('API_KEY')

    # Get user email from environment or default
    user_email = os.environ.get('MOCK_USER_EMAIL', 'test@example.com')

    # Run pipeline
    pipeline = YOLOv8Pipeline(args.api_url, hmac_secret, api_key, user_email=user_email)
    pipeline.run_project_pipeline(args.project_id, args.model_size, args.limit, args.skip_existing)


if __name__ == '__main__':
    main()
