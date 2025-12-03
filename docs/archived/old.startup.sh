#!/usr/bin/env bash

# =============================================================================
# DEPRECATED: This script is deprecated
# =============================================================================
# Please use the unified start.sh script instead:
#   ./start.sh             # Start all services
#   ./start.sh -b          # Start backend only
#   ./start.sh -f          # Start frontend only
#
# This wrapper is provided for backward compatibility and will be removed
# in a future version.
# =============================================================================

echo "========================================================================"
echo "⚠️  WARNING: startup.sh is DEPRECATED"
echo "========================================================================"
echo ""
echo "Please use the unified start.sh script instead:"
echo ""
echo "  ./start.sh                 # Start all services (default)"
echo "  ./start.sh -b              # Start backend only"
echo "  ./start.sh -f              # Start frontend only"
echo "  ./start.sh --help          # See all available options"
echo ""
echo "This script will continue in 5 seconds..."
echo "========================================================================"
echo ""

sleep 5

# Parse arguments and forward to new unified script
ARGS=""
while getopts "fb" opt; do
  case $opt in
    f) ARGS="$ARGS -f" ;;
    b) ARGS="$ARGS -b" ;;
  esac
done

# Forward to new unified script
exec "$(dirname "${BASH_SOURCE[0]}")/start.sh" $ARGS
