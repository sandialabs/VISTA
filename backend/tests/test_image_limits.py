from services.images import limits


def test_positive_setting_int_uses_positive_configured_values():
    assert limits.positive_setting_int("7", 3) == 7
    assert limits.positive_setting_int(7, 3) == 7


def test_positive_setting_int_falls_back_for_invalid_values():
    assert limits.positive_setting_int("not-a-number", 3) == 3
    assert limits.positive_setting_int(0, 3) == 3
    assert limits.positive_setting_int(-1, 3) == 3


def test_bounded_concurrency_caps_positive_configured_values():
    assert limits.bounded_concurrency(99, default=6, maximum=8) == 8
    assert limits.bounded_concurrency(4, default=6, maximum=8) == 4
    assert limits.bounded_concurrency(0, default=6, maximum=8) == 6


def test_upload_size_limit_accepts_router_default():
    assert limits.upload_size_limit(0, default=123) == 123


def test_file_too_large_detail_matches_existing_message_shape():
    detail = limits.file_too_large_detail("sample.png", 5, 3)

    assert "sample.png is too large: 5 bytes exceeds" in detail
    assert "upload size limit of 0.0 GiB (3 bytes)" in detail
    assert "Set MAX_UPLOAD_BYTES" in detail


def test_file_too_large_detail_uses_uploaded_file_fallback_name():
    assert limits.file_too_large_detail(None, 5, 3).startswith("Uploaded file")
