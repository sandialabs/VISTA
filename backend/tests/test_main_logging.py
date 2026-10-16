import json
import logging

from core.config import settings
from main import (
    HIGH_VOLUME_APPLICATION_LOGGERS,
    NOISY_THIRD_PARTY_LOGGERS,
    JSONFormatter,
    setup_logging,
)


def test_json_formatter_preserves_structured_context_fields():
    record = logging.LogRecord(
        name="routers.images",
        level=logging.INFO,
        pathname=__file__,
        lineno=12,
        msg="batch complete",
        args=(),
        exc_info=None,
    )
    record.file_count = 2000
    record.elapsed_ms = 1234.5
    record.project_id = "project-1"
    record.unserializable = object()

    payload = json.loads(JSONFormatter().format(record))

    assert payload["message"] == "batch complete"
    assert payload["file_count"] == 2000
    assert payload["elapsed_ms"] == 1234.5
    assert payload["project_id"] == "project-1"
    assert isinstance(payload["unserializable"], str)


def test_debug_logging_keeps_application_debug_and_caps_noisy_dependencies(monkeypatch):
    root_logger = logging.getLogger()
    original_root_level = root_logger.level
    original_handlers = list(root_logger.handlers)
    original_dependency_levels = {
        name: logging.getLogger(name).level
        for name in (*NOISY_THIRD_PARTY_LOGGERS, *HIGH_VOLUME_APPLICATION_LOGGERS)
    }

    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "DISABLE_FILE_LOGGING", True)
    for name in NOISY_THIRD_PARTY_LOGGERS:
        logging.getLogger(name).setLevel(logging.DEBUG)
    for name in HIGH_VOLUME_APPLICATION_LOGGERS:
        logging.getLogger(name).setLevel(logging.DEBUG)

    try:
        app_logger = setup_logging()

        assert root_logger.level == logging.DEBUG
        assert app_logger.level == logging.NOTSET
        assert all(
            logging.getLogger(name).level == logging.WARNING
            for name in NOISY_THIRD_PARTY_LOGGERS
        )
        assert (
            logging.getLogger("python_multipart.multipart").getEffectiveLevel()
            == logging.WARNING
        )
        assert (
            logging.getLogger("multipart.multipart").getEffectiveLevel()
            == logging.WARNING
        )
        assert all(
            logging.getLogger(name).level == logging.INFO
            for name in HIGH_VOLUME_APPLICATION_LOGGERS
        )
    finally:
        for handler in list(root_logger.handlers):
            root_logger.removeHandler(handler)
            if handler not in original_handlers:
                handler.close()
        for handler in original_handlers:
            root_logger.addHandler(handler)
        root_logger.setLevel(original_root_level)
        for name, level in original_dependency_levels.items():
            logging.getLogger(name).setLevel(level)
