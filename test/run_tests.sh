#!/usr/bin/env bash
# Test Runner - Backend and/or Frontend
# Usage: ./test/run_tests.sh [--backend|--frontend] [--verbose]
# No flag = run both
set -euo pipefail

# Parse arguments
VERBOSE_MODE=true
RUN_BACKEND=false
RUN_FRONTEND=false

if [ $# -eq 0 ]; then
  # No arguments = run both
  RUN_BACKEND=true
  RUN_FRONTEND=true
else
  for arg in "$@"; do
    case $arg in
      --backend)
        RUN_BACKEND=true
        ;;
      --frontend)
        RUN_FRONTEND=true
        ;;
      --verbose|-v)
        VERBOSE_MODE=true
        ;;
      *)
        echo "Unknown argument: $arg"
        echo "Usage: $0 [--backend] [--frontend] [--verbose|-v]"
        echo "  No arguments = run both backend and frontend tests"
        echo "  --verbose = show detailed output"
        exit 1
        ;;
    esac
  done
fi

cd "$(dirname "$0")/.."

BACKEND_EXIT_CODE=0
FRONTEND_EXIT_CODE=0

# ========================================
# BACKEND TESTS
# ========================================
if [ "$RUN_BACKEND" = true ]; then
  if [ ! -d "backend" ]; then
    echo "Error: backend directory not found."
    exit 1
  fi

  PY_BIN="$(command -v python3 || command -v python || true)"
  export PATH="$HOME/.local/bin:$PATH"

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

  cd backend
  echo -n "Backend tests... "

  # Suppress SQLAlchemy logging to reduce noise
  export SQLALCHEMY_WARN_20=0

  set +e
  if [ "$VERBOSE_MODE" = true ]; then
    echo ""
    "${PY_BIN}" -m pytest -n auto --tb=short --no-header -p no:logging tests/
  else
    "${PY_BIN}" -m pytest -n auto --tb=no -q tests/ >/dev/null 2>&1
  fi
  BACKEND_EXIT_CODE=$?
  set -e

  if [ $BACKEND_EXIT_CODE -eq 0 ]; then
    echo "PASSED"
  else
    echo "FAILED"
    [ "$VERBOSE_MODE" = false ] && echo "  Run with --verbose for details"
  fi

  cd ..
fi

# ========================================
# FRONTEND TESTS
# ========================================
if [ "$RUN_FRONTEND" = true ]; then
  if [ ! -d "frontend" ]; then
    echo "Error: frontend directory not found."
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm not found. Please install Node.js and npm."
    exit 1
  fi

  cd frontend
  echo -n "Frontend tests... "

  set +e
  # Run Jest tests, excluding the custom test-runner script
  if [ "$VERBOSE_MODE" = true ]; then
    echo ""
    echo "Jest tests:"
    npx react-scripts test --testPathIgnorePatterns=test-runner.cjs --watchAll=false --passWithNoTests
  else
    npx react-scripts test --testPathIgnorePatterns=test-runner.cjs --watchAll=false --passWithNoTests --silent >/dev/null 2>&1
  fi
  JEST_EXIT_CODE=$?

  # Run the custom test runner separately
  if [ "$VERBOSE_MODE" = true ]; then
    echo ""
    echo "Custom test runner:"
    node src/__tests__/test-runner.cjs
  else
    node src/__tests__/test-runner.cjs >/dev/null 2>&1
  fi
  CUSTOM_TEST_EXIT_CODE=$?

  # Frontend passes if both Jest tests and custom tests pass
  if [ $JEST_EXIT_CODE -eq 0 ] && [ $CUSTOM_TEST_EXIT_CODE -eq 0 ]; then
    FRONTEND_EXIT_CODE=0
  else
    FRONTEND_EXIT_CODE=1
  fi
  set -e

  if [ $FRONTEND_EXIT_CODE -eq 0 ]; then
    echo "PASSED"
  else
    echo "FAILED"
    [ "$VERBOSE_MODE" = false ] && echo "  Run with --verbose for details"
  fi

  cd ..
fi

# ========================================
# FINAL SUMMARY
# ========================================
OVERALL_EXIT_CODE=0

if [ "$RUN_BACKEND" = true ] && [ $BACKEND_EXIT_CODE -ne 0 ]; then
  OVERALL_EXIT_CODE=1
fi

if [ "$RUN_FRONTEND" = true ] && [ $FRONTEND_EXIT_CODE -ne 0 ]; then
  OVERALL_EXIT_CODE=1
fi

echo ""
if [ $OVERALL_EXIT_CODE -eq 0 ]; then
  echo "Overall: PASSED"
else
  echo "Overall: FAILED"
fi

exit $OVERALL_EXIT_CODE
