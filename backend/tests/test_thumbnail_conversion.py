"""Tests for thumbnail conversion of non-web image formats (TIFF, CMYK, etc.)."""

import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from PIL import Image

from utils.cache_manager import get_cache


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache = get_cache()
    cache.clear()
    yield
    cache.clear()


def _make_tiff_bytes(mode="RGB", size=(100, 100)):
    """Create test TIFF image bytes in specified mode."""
    if mode == "CMYK":
        img = Image.new("CMYK", size, (0, 255, 255, 0))  # Cyan
    elif mode == "RGBA":
        img = Image.new("RGBA", size, (255, 0, 0, 128))  # Semi-transparent red
    elif mode == "I;16":
        # 16-bit grayscale with explicit mid-gray value
        img = Image.new("I;16", size, 32768)
    else:
        img = Image.new("RGB", size, (255, 0, 0))  # Red

    buf = io.BytesIO()
    img.save(buf, format="TIFF")
    buf.seek(0)
    return buf.getvalue()


def _make_palette_png_bytes(with_transparency=False, size=(100, 100)):
    """Create test palette mode PNG image bytes."""
    # Create an RGB image first, then convert to palette
    img = Image.new("RGB", size, (255, 0, 0))  # Red
    img = img.convert("P")
    if with_transparency:
        # Set transparency for palette index 0
        img.info["transparency"] = 0
    buf = io.BytesIO()
    img.save(buf, format="PNG", transparency=0 if with_transparency else None)
    buf.seek(0)
    return buf.getvalue()


class TestThumbnailConversion:
    """Test thumbnail generation converts non-web formats correctly."""

    def test_tiff_rgb_converts_to_jpeg(self, client):
        """Test that RGB TIFF images are converted to JPEG thumbnails."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "TiffTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload TIFF image
        tiff_bytes = _make_tiff_bytes(mode="RGB")
        files = {"file": ("test.tiff", io.BytesIO(tiff_bytes), "image/tiff")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx to return our TIFF bytes when thumbnail fetches from "S3"
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=tiff_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to JPEG
            assert r.headers["content-type"] == "image/jpeg"

            # Verify it's a valid JPEG image
            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "JPEG"

    def test_tiff_rgba_converts_to_png(self, client):
        """Test that RGBA TIFF images are converted to PNG to preserve transparency."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "TiffRgbaTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload RGBA TIFF image
        tiff_bytes = _make_tiff_bytes(mode="RGBA")
        files = {"file": ("test_rgba.tiff", io.BytesIO(tiff_bytes), "image/tiff")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=tiff_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to PNG (preserves transparency)
            assert r.headers["content-type"] == "image/png"

            # Verify it's a valid PNG image
            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "PNG"

    def test_tiff_cmyk_converts_to_jpeg(self, client):
        """Test that CMYK TIFF images are converted to RGB JPEG."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "TiffCmykTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload CMYK TIFF image
        tiff_bytes = _make_tiff_bytes(mode="CMYK")
        files = {"file": ("test_cmyk.tiff", io.BytesIO(tiff_bytes), "image/tiff")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=tiff_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to JPEG
            assert r.headers["content-type"] == "image/jpeg"

            # Verify it's a valid JPEG image with RGB mode
            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "JPEG"
            assert result_img.mode == "RGB"

    def test_tiff_16bit_grayscale_converts_to_jpeg(self, client):
        """Test that 16-bit grayscale TIFF images are converted to JPEG."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "Tiff16bitTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload 16-bit grayscale TIFF image
        tiff_bytes = _make_tiff_bytes(mode="I;16")
        files = {"file": ("test_16bit.tiff", io.BytesIO(tiff_bytes), "image/tiff")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=tiff_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to JPEG
            assert r.headers["content-type"] == "image/jpeg"

            # Verify it's a valid JPEG image
            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "JPEG"

    def test_palette_mode_without_transparency_converts_to_jpeg(self, client):
        """Test that palette mode images without transparency convert to JPEG."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "PaletteTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload palette PNG without transparency
        png_bytes = _make_palette_png_bytes(with_transparency=False)
        files = {"file": ("test_palette.png", io.BytesIO(png_bytes), "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=png_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to JPEG (no transparency to preserve)
            assert r.headers["content-type"] == "image/jpeg"

            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "JPEG"

    def test_palette_mode_with_transparency_converts_to_png(self, client):
        """Test that palette mode images with transparency convert to PNG."""
        # Create project
        pr = client.post(
            "/api/projects/",
            json={
                "name": "PaletteTransTest",
                "description": None,
                "meta_group_id": "test-group",
            },
        )
        assert pr.status_code == 201
        pid = pr.json()["id"]

        # Upload palette PNG with transparency
        png_bytes = _make_palette_png_bytes(with_transparency=True)
        files = {"file": ("test_palette_trans.png", io.BytesIO(png_bytes), "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]

        # Mock httpx
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.aread = AsyncMock(return_value=png_bytes)

        with patch("services.images.thumbnails.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            # Request thumbnail
            r = client.get(f"/api/images/{image_id}/thumbnail?width=50&height=50")
            assert r.status_code == 200

            # Verify it was converted to PNG (preserves transparency)
            assert r.headers["content-type"] == "image/png"

            result_img = Image.open(io.BytesIO(r.content))
            assert result_img.format == "PNG"
