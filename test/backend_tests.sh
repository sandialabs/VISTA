#!/usr/bin/env bash
# Backend Test Runner
# Usage: ./test/backend_tests.sh [--verbose]
set -euo pipefail

# Parse arguments
VERBOSE_MODE=false
for arg in "$@"; do
  case $arg in
    --verbose|-v)
      VERBOSE_MODE=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--verbose|-v]"
      exit 1
      ;;
  esac
done

# Change to project root
cd "$(dirname "$0")/.."

if [ ! -d "backend" ]; then
  echo "Error: backend directory not found."
  exit 1
fi

# Setup Python
PY_BIN="$(command -v python3 || command -v python || true)"
export PATH="$HOME/.local/bin:$PATH"

# Check for uv
if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv not found. Install with:"
  echo " curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# Find and activate virtual environment
if [ -f "/opt/venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating Docker virtual environment..."
  # shellcheck disable=SC1091
  source /opt/venv/bin/activate
  uv pip install pytest pytest-asyncio pytest-xdist >/dev/null 2>&1
elif [ -f "backend/.venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating backend virtual environment..."
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  uv pip install pytest pytest-asyncio pytest-xdist >/dev/null 2>&1
elif [ -f ".venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating local virtual environment..."
  # shellcheck disable=SC1091
  source .venv/bin/activate
  uv pip install pytest pytest-asyncio pytest-xdist >/dev/null 2>&1
else
  echo "Error: Virtual environment not found"
  echo "Expected: /opt/venv or backend/.venv or .venv"
  exit 1
fi

# Ensure we have a python executable post-activate
PY_BIN="$(command -v python3 || command -v python || true)"
if [ -z "${PY_BIN}" ]; then
  echo "Error: python not found in the active environment."
  exit 1
fi

# Run tests
cd backend
echo "Backend tests:"
echo "============================================="

# Suppress SQLAlchemy logging to reduce noise
export SQLALCHEMY_WARN_20=0

set +e
if [ "$VERBOSE_MODE" = true ]; then
  "${PY_BIN}" -m pytest -v -n auto --tb=short --no-header tests/
else
  "${PY_BIN}" -m pytest -v -n auto --tb=line --no-header tests/
fi
EXIT_CODE=$?
set -e

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "Backend tests: PASSED"
else
  echo "Backend tests: FAILED"
  [ "$VERBOSE_MODE" = false ] && echo "  Run with --verbose for full tracebacks"
fi

exit $EXIT_CODE
