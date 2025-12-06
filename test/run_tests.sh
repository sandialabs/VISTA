#!/usr/bin/env bash
# Test Runner - Backend and/or Frontend
# Usage: ./test/run_tests.sh [--backend|--frontend] [--verbose]
# No flag = run both
set -euo pipefail

# Parse arguments
VERBOSE_MODE=false
RUN_BACKEND=false
RUN_FRONTEND=false
VERBOSE_FLAG=""

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
        VERBOSE_FLAG="--verbose"
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

# Get the directory where this script is located
SCRIPT_DIR="$(dirname "$0")"

BACKEND_EXIT_CODE=0
FRONTEND_EXIT_CODE=0

# ========================================
# BACKEND TESTS
# ========================================
if [ "$RUN_BACKEND" = true ]; then
  if [ -f "$SCRIPT_DIR/backend_tests.sh" ]; then
    bash "$SCRIPT_DIR/backend_tests.sh" $VERBOSE_FLAG || BACKEND_EXIT_CODE=$?
  else
    echo "Error: backend_tests.sh not found in $SCRIPT_DIR"
    exit 1
  fi
fi

# ========================================
# FRONTEND TESTS
# ========================================
if [ "$RUN_FRONTEND" = true ]; then
  if [ -f "$SCRIPT_DIR/frontend_tests.sh" ]; then
    echo ""
    bash "$SCRIPT_DIR/frontend_tests.sh" $VERBOSE_FLAG || FRONTEND_EXIT_CODE=$?
  else
    echo "Error: frontend_tests.sh not found in $SCRIPT_DIR"
    exit 1
  fi
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
echo "============================================="
if [ $OVERALL_EXIT_CODE -eq 0 ]; then
  echo "OVERALL RESULT: PASSED"
else
  echo "OVERALL RESULT: FAILED"
fi
echo "============================================="

exit $OVERALL_EXIT_CODE
