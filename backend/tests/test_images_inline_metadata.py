import base64

from backend.routers import images as images_router


class InlineImage:
    def __init__(self, metadata_json, filename="inline.png"):
        self.metadata_json = metadata_json
        self.filename = filename


def test_inline_image_bytes_decodes_plain_base64_metadata():
    payload = b"inline image bytes"
    image = InlineImage(
        {
            "analysis_inline_image_base64": base64.b64encode(payload).decode("ascii"),
        }
    )

    assert images_router._inline_image_bytes(image) == payload


def test_inline_image_bytes_returns_none_for_missing_or_invalid_metadata():
    assert images_router._inline_image_bytes(InlineImage({})) is None
    assert images_router._inline_image_bytes(InlineImage(None)) is None
    assert (
        images_router._inline_image_bytes(
            InlineImage({"analysis_inline_image_base64": "not base64!"})
        )
        is None
    )
