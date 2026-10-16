#!/usr/bin/env bash
# Backend Test Runner
# Usage: ./test/backend_tests.sh [--verbose]
# Set BACKEND_TEST_MAXFAIL=0 to disable the default failure cap.
# Set BACKEND_TEST_WORKERS=0 to run serially, or a number/auto for xdist.
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
      echo "  BACKEND_TEST_MAXFAIL=0 disables the default failure cap"
      echo "  BACKEND_TEST_WORKERS=0 disables pytest-xdist"
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

# Ensure uv cache is writable
if [ ! -w "${UV_CACHE_DIR:-$HOME/.cache/uv}" ] 2>/dev/null; then
  export UV_CACHE_DIR="/tmp/uv-cache"
fi

install_python_packages() {
  if ! command -v uv >/dev/null 2>&1; then
    echo "Error: uv is required to install backend test dependencies."
    return 1
  fi
  uv pip install "$@" >/dev/null 2>&1
}

ensure_pytest_dependencies() {
  if "${PY_BIN}" - <<'PY' >/dev/null 2>&1
import aiosqlite
import numpy
import pytest
import pytest_asyncio
PY
  then
    return
  fi

  if ! install_python_packages pytest pytest-asyncio aiosqlite numpy; then
    echo "Error: failed to install backend test dependencies."
    echo "Install pytest pytest-asyncio aiosqlite numpy in the active environment."
    exit 1
  fi
}

supports_xdist() {
  "${PY_BIN}" - <<'PY' >/dev/null 2>&1
import xdist
PY
}

ensure_xdist_if_requested() {
  if [ "$BACKEND_TEST_WORKERS" = "0" ] || supports_xdist; then
    return
  fi
  install_python_packages pytest-xdist || true
}

# Find and activate virtual environment
if [ -f "/opt/venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating Docker virtual environment..."
  # shellcheck disable=SC1091
  source /opt/venv/bin/activate
elif [ -f "backend/.venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating backend virtual environment..."
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
elif [ -f ".venv/bin/activate" ]; then
  [ "$VERBOSE_MODE" = true ] && echo "Activating local virtual environment..."
  # shellcheck disable=SC1091
  source .venv/bin/activate
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
ensure_pytest_dependencies

# Run tests
cd backend
echo "Backend tests:"
echo "============================================="

# Tests are executed from backend/ for legacy top-level imports such as
# `from main import app`, while newer tests also import `backend.*` modules.
export PYTHONPATH="$(pwd)/..:${PYTHONPATH:-}"

# Suppress SQLAlchemy logging to reduce noise
export SQLALCHEMY_WARN_20=0

# Mirror the GitLab backend job defaults for local runs. Individual variables
# remain overridable for native-runtime debugging and focused development.
export DEBUG="${DEBUG:-true}"
export SKIP_HEADER_CHECK="${SKIP_HEADER_CHECK:-true}"
export FAST_TEST_MODE="${FAST_TEST_MODE:-true}"
export VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME="${VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME:-true}"
export VISTA_RUN_NATIVE_SEGMENTATION_TESTS="${VISTA_RUN_NATIVE_SEGMENTATION_TESTS:-false}"

# JUnit XML output for CI test reporting
JUNIT_FLAG=""
if [ -n "${JUNIT_XML_PATH:-}" ]; then
  mkdir -p "$(dirname "$JUNIT_XML_PATH")"
  JUNIT_FLAG="--junitxml=$JUNIT_XML_PATH"
fi

# Keep default console output compact so CI logs stay below platform limits.
# Full per-test progress and longer tracebacks are still available with --verbose.
PYTEST_COMMON_ARGS=(
  -m "not postgres"
  --no-header
  --disable-warnings
  --quiet
  --tb=short
  --show-capture=no
)
BACKEND_TEST_WORKERS="${BACKEND_TEST_WORKERS:-2}"
ensure_xdist_if_requested
if [ "$BACKEND_TEST_WORKERS" != "0" ] && supports_xdist; then
  PYTEST_COMMON_ARGS=(-n "$BACKEND_TEST_WORKERS" "${PYTEST_COMMON_ARGS[@]}")
fi

# Stop after a bounded number of failures by default; JUnit still records the
# collected failures that occurred before the stop. Override with
# BACKEND_TEST_MAXFAIL=0 to run the full suite after diagnosing the first batch.
BACKEND_TEST_MAXFAIL="${BACKEND_TEST_MAXFAIL:-10}"
if [ "$BACKEND_TEST_MAXFAIL" != "0" ]; then
  PYTEST_COMMON_ARGS+=("--maxfail=$BACKEND_TEST_MAXFAIL")
fi

if [ -n "$JUNIT_FLAG" ]; then
  PYTEST_COMMON_ARGS+=("$JUNIT_FLAG")
fi

set +e
if [ "$VERBOSE_MODE" = true ]; then
  "${PY_BIN}" -m pytest -v "${PYTEST_COMMON_ARGS[@]}" tests/
else
  "${PY_BIN}" -m pytest "${PYTEST_COMMON_ARGS[@]}" tests/
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
