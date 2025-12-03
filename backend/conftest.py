import logging
import warnings
import pytest

# Suppress warnings
warnings.filterwarnings("ignore")

# Completely disable all logging during tests
logging.disable(logging.CRITICAL)

@pytest.fixture(autouse=True)
def disable_logging():
    """Disable all logging for every test."""
    # Save original state
    original_level = logging.root.level

    # Disable all logging
    logging.disable(logging.CRITICAL)

    yield

    # Restore (though we keep it disabled)
    logging.disable(original_level)
