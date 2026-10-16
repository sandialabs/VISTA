#!/usr/bin/env bash
# Frontend Test Runner
# Usage: ./test/frontend_tests.sh [--verbose]
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

if [ ! -d "frontend" ]; then
  echo "Error: frontend directory not found."
  exit 1
fi

# Check for npm
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm not found. Please install Node.js and npm."
  exit 1
fi

# Run tests
cd frontend
echo "Frontend tests:"
echo "============================================="

if [ -f "node_modules/react-scripts/bin/react-scripts.js" ]; then
  REACT_SCRIPTS=(node ./node_modules/react-scripts/bin/react-scripts.js)
else
  REACT_SCRIPTS=(npx react-scripts)
fi

set +e

# Run Jest tests
echo "Jest tests:"
if [ "$VERBOSE_MODE" = true ]; then
  "${REACT_SCRIPTS[@]}" test --watchAll=false --passWithNoTests --runInBand --verbose
else
  # Application console output can be extremely noisy and can push Jest's
  # failure report past CI log limits. Jest still prints failed assertions,
  # stack traces, and its final summary when --silent is enabled.
  "${REACT_SCRIPTS[@]}" test --watchAll=false --passWithNoTests --runInBand --silent \
    --reporters=./scripts/compact-jest-reporter.js
fi
JEST_EXIT_CODE=$?
set -e

echo ""
if [ $JEST_EXIT_CODE -eq 0 ]; then
  echo "Frontend tests: PASSED"
else
  echo "Frontend tests: FAILED"
  [ "$VERBOSE_MODE" = false ] && echo "  Run with --verbose for full details"
fi

exit $JEST_EXIT_CODE
