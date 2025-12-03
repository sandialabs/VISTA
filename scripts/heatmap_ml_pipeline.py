#!/usr/bin/env python3
"""
Heatmap ML Pipeline Integration Test
End-to-end test that:
1. Fetches images from a project
2. Generates heatmaps (random/synthetic for UI testing)
3. Pushes results back to the ML analysis API
"""

import os
import sys
import json
import hmac
import hashlib
import time
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
from io import BytesIO

from dotenv import load_dotenv

# Load environment variables from .env file in project root
project_root = Path(__file__).parent.parent
load_dotenv(project_root / '.env')

import requests
from PIL import Image
import cv2
import numpy as np


class HeatmapPipeline:
    """Heatmap generation pipeline with ML API integration"""

    def __init__(self, api_base_url: str, hmac_secret: str, api_key: Optional[str] = None,
                 user_email: str = "test@example.com", output_dir: Optional[str] = None):
        self.api_base_url = api_base_url.rstrip('/')
        self.hmac_secret = hmac_secret
        self.api_key = api_key
        self.user_email = user_email
        self.output_dir = output_dir
        self.session = requests.Session()

        # Create output directory if specified
        if self.output_dir:
            os.makedirs(self.output_dir, exist_ok=True)
            print(f"Output directory: {self.output_dir}")

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
        # Remove leading slash if present
        path = path.lstrip('/')
        return f"{self.api_base_url}/api-ml/{path}"

    def _generate_hmac_signature(self, body: str) -> tuple[str, str]:
        """Generate HMAC signature for ML pipeline authentication"""
        timestamp = str(int(time.time()))
        # Message format: timestamp.body (dot separator)
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

    def get_project_images(self, project_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch images from a project"""
        print(f"Fetching images from project {project_id}")

        url = self._get_api_url(f"projects/{project_id}/images")
        params = {'skip': 0, 'limit': limit}

        response = self.session.get(url, params=params)
        response.raise_for_status()

        images = response.json()
        print(f"Found {len(images)} images")
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
            print(f"  Failed to fetch analyses for image {image_id}: {e}")
            return []

    def download_image(self, image_id: str) -> tuple[np.ndarray, Dict[str, Any]]:
        """Download image from API and return as numpy array"""
        print(f"  Downloading image {image_id}")

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
        print(f"  Received {len(response.content)} bytes, content-type: {content_type}")

        # Check if we got HTML (error page) instead of image
        if 'text/html' in content_type:
            error_body = response.content.decode('utf-8', errors='ignore')[:500]
            raise ValueError(f"Got HTML error page instead of image from {content_url}:\n{error_body}")

        pil_image = Image.open(image_bytes)
        image_array = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

        print(f"  Downloaded {metadata['filename']}")
        print(f"  Image dimensions - Height: {image_array.shape[0]}, Width: {image_array.shape[1]}")

        return image_array, metadata

    def create_analysis(self, image_id: str, model_version: str, heatmap_type: str) -> str:
        """Create ML analysis entry"""
        print(f"  Creating analysis for image {image_id}")

        url = self._get_api_url(f"images/{image_id}/analyses")
        data = {
            "image_id": image_id,
            "model_name": "heatmap_generator",
            "model_version": model_version,
            "parameters": {
                "heatmap_type": heatmap_type,
                "method": "random" if heatmap_type == "random" else "unknown"
            }
        }

        response = self.session.post(url, json=data)

        # Add better error handling
        if not response.ok:
            error_detail = response.text
            raise ValueError(f"Failed to create analysis: {response.status_code} - {error_detail}")

        analysis = response.json()
        analysis_id = analysis['id']
        print(f"  Created analysis {analysis_id}")
        return analysis_id

    def update_analysis_status(self, analysis_id: str, status: str):
        """Update analysis status"""
        print(f"  Updating analysis status to: {status}")

        # Status updates go through the standard API (API key auth),
        # not the dedicated /api-ml HMAC pipeline endpoints.
        url = self._get_api_url(f"analyses/{analysis_id}/status")
        data = {"status": status}

        response = self.session.patch(url, json=data)
        response.raise_for_status()
        print(f"  Status updated to {status}")

    def generate_random_heatmap(self, image_shape: tuple) -> np.ndarray:
        """
        Generate random heatmap with binary soft-edge blobs for testing

        Args:
            image_shape: (height, width, channels) of the original image

        Returns:
            Binary heatmap with soft edges as BGR image (red channel only)
        """
        height, width = image_shape[0], image_shape[1]

        # Random number of blobs: greater than 5, less than 15
        num_blobs = np.random.randint(6, 15)

        print(f"  Generating binary soft-edge heatmap with {num_blobs} blobs")

        heatmap = np.zeros((height, width), dtype=np.float32)

        # Generate random Gaussian blobs
        for _ in range(num_blobs):
            # Random center position
            cx = np.random.randint(int(width * 0.1), int(width * 0.9))
            cy = np.random.randint(int(height * 0.1), int(height * 0.9))

            # Random blob radius (sigma): greater than 2%, less than 15% of image width
            sigma_min = int(width * 0.02)
            sigma_max = int(width * 0.15)
            sigma_x = np.random.randint(sigma_min, sigma_max + 1)
            sigma_y = np.random.randint(sigma_min, sigma_max + 1)

            # Random intensity
            intensity = np.random.uniform(0.5, 1.0)

            # Create meshgrid for Gaussian
            y, x = np.ogrid[:height, :width]
            gaussian = intensity * np.exp(
                -((x - cx)**2 / (2 * sigma_x**2) + (y - cy)**2 / (2 * sigma_y**2))
            )

            # Add to heatmap (accumulate)
            heatmap += gaussian

        # Normalize to 0-1 range
        if heatmap.max() > 0:
            heatmap = heatmap / heatmap.max()

        # Apply binary threshold with soft edges
        # Values above 0.3 become 1, values below 0.2 become 0, transition is smooth
        threshold_low = 0.2
        threshold_high = 0.3

        # Create binary mask with smooth transition
        binary_heatmap = np.zeros_like(heatmap)

        # Below threshold_low: 0
        # Between threshold_low and threshold_high: smooth transition
        # Above threshold_high: 1
        mask_low = heatmap < threshold_low
        mask_high = heatmap > threshold_high
        mask_transition = ~mask_low & ~mask_high

        binary_heatmap[mask_high] = 1.0
        binary_heatmap[mask_transition] = (heatmap[mask_transition] - threshold_low) / (threshold_high - threshold_low)

        # Apply additional Gaussian blur for softer edges
        binary_heatmap = cv2.GaussianBlur(binary_heatmap, (15, 15), 0)

        # Convert to 0-255 range
        heatmap_uint8 = (binary_heatmap * 255).astype(np.uint8)

        # Create BGR image with heatmap affecting all color channels
        heatmap_color = np.zeros((height, width, 3), dtype=np.uint8)
        heatmap_color[:, :, 0] = heatmap_uint8  # Blue channel
        heatmap_color[:, :, 1] = heatmap_uint8  # Green channel
        heatmap_color[:, :, 2] = heatmap_uint8  # Red channel

        # Draw iso curves around key regions
        # Define threshold levels for iso curves (as percentages of max intensity)
        iso_levels = [0.3, 0.5, 0.7]  # 30%, 50%, 70% intensity levels
        colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]  # Blue, Green, Red for different levels

        for level, color in zip(iso_levels, colors):
            # Create binary mask for this iso level
            threshold_value = int(level * 255)
            _, threshold_mask = cv2.threshold(heatmap_uint8, threshold_value, 255, cv2.THRESH_BINARY)

            # Find contours
            contours, _ = cv2.findContours(threshold_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Draw contours on the heatmap
            cv2.drawContours(heatmap_color, contours, -1, color, 2)  # -1 means all contours, 2 is thickness

        print(f"  Generated binary heatmap with iso curves shape: {heatmap_color.shape}")
        return heatmap_color

    def upload_artifact(self, analysis_id: str, artifact_type: str, filename: str, data: bytes):
        """Upload artifact to S3 via presigned URL"""
        print(f"  Uploading {artifact_type}: {filename}")

        # Get presigned URL
        url = self._get_ml_url(f"analyses/{analysis_id}/artifacts/presign")
        presign_data = {
            "artifact_type": artifact_type,
            "filename": filename
        }

        response = self._make_hmac_request('POST', url, presign_data)

        if not response.ok:
            print(f"  Presign request failed: {response.status_code}")
            print(f"  Response: {response.text}")
            print(f"  Headers sent: X-ML-Signature={response.request.headers.get('X-ML-Signature')[:16]}...")
            print(f"  HMAC secret (first 16 chars): {self.hmac_secret[:16]}...")

        response.raise_for_status()

        presign_response = response.json()
        upload_url = presign_response['upload_url']
        storage_path = presign_response['storage_path']

        # Upload to S3
        headers = {'Content-Type': 'image/png'}
        upload_response = requests.put(upload_url, data=data, headers=headers)
        upload_response.raise_for_status()

        print(f"  Uploaded to {storage_path}")
        return storage_path

    def submit_annotations(self, analysis_id: str, heatmap_path: str,
                          image_shape: tuple, heatmap_type: str):
        """Submit heatmap annotation"""
        print(f"  Submitting heatmap annotation")

        # Get image dimensions (height, width, channels)
        image_height, image_width = image_shape[0], image_shape[1]

        print(f"  Image dimensions - Width: {image_width}, Height: {image_height}")

        # Create heatmap annotation
        annotations = [{
            "annotation_type": "heatmap",
            "data": {
                "width": image_width,
                "height": image_height,
                "method": heatmap_type,
                "model_name": "random_heatmap_generator",
                "description": f"Randomly generated heatmap for testing ({heatmap_type})"
            },
            "storage_path": heatmap_path,
            "ordering": 0
        }]

        url = self._get_ml_url(f"analyses/{analysis_id}/annotations:bulk")
        data = {
            "annotations": annotations,
            "mode": "append"
        }

        response = self._make_hmac_request('POST', url, data)
        response.raise_for_status()

        print(f"  Submitted {len(annotations)} annotation(s)")

    def finalize_analysis(self, analysis_id: str, status: str = "completed", error_message: str = None):
        """Finalize analysis"""
        print(f"  Finalizing analysis as {status}")

        url = self._get_ml_url(f"analyses/{analysis_id}/finalize")
        data = {"status": status}
        if error_message:
            data["error_message"] = error_message

        response = self._make_hmac_request('POST', url, data)
        response.raise_for_status()
        print(f"  Analysis finalized")

    def process_image(self, image_id: str, model_version: str, heatmap_type: str):
        """Process a single image end-to-end"""
        print(f"\n{'='*60}")
        print(f"Processing image: {image_id}")
        print(f"{'='*60}")

        analysis_id = None
        try:
            # Download image
            image, metadata = self.download_image(image_id)

            # Create analysis
            analysis_id = self.create_analysis(image_id, model_version, heatmap_type)

            # Update to processing
            self.update_analysis_status(analysis_id, "processing")

            # Generate heatmap
            heatmap = self.generate_random_heatmap(image.shape)

            # Save to local storage if output directory is specified
            if self.output_dir:
                # Save original image
                original_filename = f"{image_id}_original.jpg"
                original_path = os.path.join(self.output_dir, original_filename)
                cv2.imwrite(original_path, image)
                print(f"  Saved original image to: {original_path}")

                # Save heatmap
                heatmap_filename = f"{image_id}_heatmap.png"
                heatmap_local_path = os.path.join(self.output_dir, heatmap_filename)
                cv2.imwrite(heatmap_local_path, heatmap)
                print(f"  Saved heatmap to: {heatmap_local_path}")

                # Create and save overlay visualization
                overlay = cv2.addWeighted(image, 0.7, heatmap, 0.3, 0)
                overlay_filename = f"{image_id}_overlay.jpg"
                overlay_path = os.path.join(self.output_dir, overlay_filename)
                cv2.imwrite(overlay_path, overlay)
                print(f"  Saved overlay to: {overlay_path}")

            # Encode as PNG
            _, heatmap_bytes = cv2.imencode('.png', heatmap)

            # Upload heatmap artifact
            heatmap_path = self.upload_artifact(
                analysis_id, 'heatmap', f'heatmap_{analysis_id}.png', heatmap_bytes.tobytes()
            )

            # Submit annotations
            self.submit_annotations(analysis_id, heatmap_path, image.shape, heatmap_type)

            # Finalize
            self.finalize_analysis(analysis_id, "completed")

            print(f"Successfully processed image {image_id}")

        except Exception as e:
            print(f"Error processing image {image_id}: {e}")
            if analysis_id:
                try:
                    self.finalize_analysis(analysis_id, "failed", str(e))
                except:
                    pass
            raise

    def run_project_pipeline(self, project_id: str, heatmap_type: str = 'random',
                           limit: int = 10, skip_existing: bool = False):
        """Run pipeline on all images in a project"""
        print(f"\nStarting Heatmap Pipeline")
        print(f"Project ID: {project_id}")
        print(f"Heatmap Type: {heatmap_type}")
        print(f"Image Limit: {limit}")
        print(f"Skip Existing: {skip_existing}")
        print(f"{'='*60}\n")

        model_version = f"random_v1.0"

        # Get project images
        images = self.get_project_images(project_id, limit)

        if not images:
            print("No images found in project")
            return

        # Filter images if skip_existing is enabled
        images_to_process = []
        skipped_count = 0

        if skip_existing:
            print(f"Checking for existing analyses...")
            for image in images:
                analyses = self.get_image_analyses(image['id'])
                # Only skip if there's at least one completed analysis
                completed_analyses = [a for a in analyses if a.get('status') == 'completed']
                if completed_analyses:
                    print(f"  Skipping {image['id']} (has {len(completed_analyses)} completed analysis/analyses)")
                    skipped_count += 1
                else:
                    if analyses:
                        non_completed = [a.get('status') for a in analyses]
                        print(f"  Including {image['id']} (has analyses but none completed: {non_completed})")
                    images_to_process.append(image)
            print(f"Filtered {len(images)} images -> {len(images_to_process)} to process ({skipped_count} skipped)\n")
        else:
            images_to_process = images

        if not images_to_process:
            print("No images to process (all have existing analyses)")
            return

        # Process each image
        success_count = 0
        for i, image in enumerate(images_to_process, 1):
            print(f"\n[{i}/{len(images_to_process)}] Processing image...")
            try:
                self.process_image(image['id'], model_version, heatmap_type)
                success_count += 1
            except Exception as e:
                print(f"Failed to process image: {e}")
                # Continue processing other images but track failures

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

        # Exit with error if any images failed
        if success_count < len(images_to_process):
            print("\nError: Some images failed to process. Exiting with code 1.")
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='Heatmap ML Pipeline Integration Test')
    parser.add_argument('project_id', help='Project ID to process')
    parser.add_argument('--api-url', default='http://localhost:8000',
                       help='API base URL (default: http://localhost:8000)')
    parser.add_argument('--hmac-secret', help='HMAC secret for pipeline authentication')
    parser.add_argument('--api-key', help='API key for authentication')
    parser.add_argument('--heatmap-type', default='random', choices=['random'],
                       help='Heatmap type (currently only random is supported)')
    parser.add_argument('--limit', type=int, default=10,
                       help='Maximum number of images to process (default: 10)')
    parser.add_argument('--skip-existing', action='store_true',
                       help='Skip images that already have ML analysis results')
    parser.add_argument('--output-dir', type=str, default=None,
                       help='Directory to save heatmaps locally for inspection (optional)')

    args = parser.parse_args()

    # Get HMAC secret from args or environment
    hmac_secret = args.hmac_secret or os.environ.get('ML_CALLBACK_HMAC_SECRET')
    if not hmac_secret:
        print("Error: HMAC secret required. Set ML_CALLBACK_HMAC_SECRET or use --hmac-secret")
        sys.exit(1)

    # Get API key from args or environment
    api_key = args.api_key or os.environ.get('API_KEY')

    # Get user email from environment or default
    user_email = os.environ.get('MOCK_USER_EMAIL', 'test@example.com')

    # Run pipeline
    pipeline = HeatmapPipeline(args.api_url, hmac_secret, api_key, user_email=user_email, output_dir=args.output_dir)
    pipeline.run_project_pipeline(args.project_id, args.heatmap_type, args.limit, args.skip_existing)


if __name__ == '__main__':
    main()
