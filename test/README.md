# Test Directory

This directory contains test scripts and utilities for VISTA.

## Backend Tests

### Running Tests

To run the comprehensive backend test suite:

```bash
./test/run_tests.sh
```

This script will:
- Validate the environment
- Run all backend tests in the `backend/tests/` directory
- Provide a summary of test results
- Exit with appropriate codes for CI/CD integration

### Test Coverage

The backend test suite includes:

- **Configuration Tests** (`test_config.py`, `test_config_extras.py`)
  - Settings validation and environment variable parsing
  - Boolean parsing with whitespace handling
  - Mock user groups configuration

- **Database Tests** (`test_database.py`)
  - Database connection and table creation
  - Error handling for various connection failures
  - Async session management

- **Authentication & Dependencies** (`test_dependencies.py`)
  - API key authentication
  - Mock user authentication (DEBUG mode)
  - Trusted proxy header authentication
  - Group membership validation

- **API Router Tests**
  - Users (`test_users_router.py`)
  - Projects (`test_projects_router.py`)
  - Images (`test_images_router.py`)
  - API Keys (`test_api_keys.py`)

- **CRUD Operations** 
  - Project metadata (`test_project_metadata_crud.py`)
  - Image classes (`test_image_classes_crud.py`)
  - Classifications and comments (`test_classifications_and_comments_crud.py`)

- **Schema Validation** (`test_schemas.py`)
  - Pydantic model validation
  - Field validators and aliases
  - Data type conversions

- **Content Delivery** (`test_images_content_edge.py`)
  - Image content proxying
  - Header sanitization
  - Error handling for HTTP requests

- **Metadata Management** (`test_images_metadata_endpoints.py`)
  - Metadata updates and deletions
  - JSON handling and validation

### Requirements

- Python 3.11+
- pytest
- pytest-asyncio
- All backend dependencies (see `requirements.txt`)

### Exit Codes

- `0`: All tests passed
- `1`: Some tests failed
- `2`: Test discovery or setup error

### Development

When adding new tests:
1. Place test files in `backend/tests/`
2. Follow the naming convention `test_*.py`
3. Use pytest fixtures and async test patterns as shown in existing tests
4. Update this README if adding new test categories

### CI/CD Integration

This script is designed to be easily integrated into CI/CD pipelines:

```bash
# In your CI script
./test/run_tests.sh
if [ $? -eq 0 ]; then
    echo "Tests passed, proceeding with deployment"
else
    echo "Tests failed, stopping deployment"
    exit 1
fi
```
