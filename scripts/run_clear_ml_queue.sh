#!/usr/bin/env bash
# ML Queue Clear Runner
# Helper wrapper around clear_ml_queue.py for convenience.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd ""$SCRIPT_DIR/.."" && pwd)"

# Load environment variables from .env file if present
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.env"
    set +a
fi

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

say() {
    echo -e "${BLUE}[ml-queue-clear]${NC} $*"
}

error() {
    echo -e "${RED}[ml-queue-clear]${NC} $*" >&2
}

usage() {
    cat << EOF
Usage: $0 <project_id> [options]

Clear queued ML analyses for a project using the regular API
status endpoint (no HMAC /api-ml calls).

Options:
    --api-url URL             API base URL (default: http://localhost:8000)
    --api-key KEY             API key (or set API_KEY env)
    --status-from STATUS      Source status (default: queued)
    --status-to STATUS        Target status (default: canceled)
    --limit N                 Max analyses to update (default: 100)
    --older-than-seconds SEC  Only touch analyses older than SEC seconds
    --dry-run                 Only show what would be changed
    --confirm                 Actually perform updates
    -h, --help                Show this help message

Examples:
    # Dry run for queued->canceled on a project
    $0 <UUID> --status-from queued --status-to canceled --limit 50 --dry-run

    # Actually clear queued analyses (requires --confirm)
    $0 <UUID> --status-from queued --status-to canceled --limit 50 --confirm
EOF
}

PROJECT_ID=""
API_URL="${API_URL:-http://localhost:8000}"
API_KEY_OPT=""
STATUS_FROM="queued"
STATUS_TO="canceled"
LIMIT=100
OLDER_THAN_SECONDS=""
DRY_RUN=false
CONFIRM=false

if [[ $# -lt 1 ]]; then
    error "project_id is required as the first argument"
    usage
    exit 1
fi

PROJECT_ID="$1"
shift

while [[ $# -gt 0 ]]; do
    case "$1" in
        --api-url)
            API_URL="$2"; shift 2 ;;
        --api-key)
            API_KEY_OPT="$2"; shift 2 ;;
        --status-from)
            STATUS_FROM="$2"; shift 2 ;;
        --status-to)
            STATUS_TO="$2"; shift 2 ;;
        --limit)
            LIMIT="$2"; shift 2 ;;
        --older-than-seconds)
            OLDER_THAN_SECONDS="$2"; shift 2 ;;
        --dry-run)
            DRY_RUN=true; shift ;;
        --confirm)
            CONFIRM=true; shift ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            error "Unknown option: $1"; usage; exit 1 ;;
    esac
done

# Determine Python command (similar to run_heatmap_pipeline.sh)
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
    PYTHON_CMD="$VIRTUAL_ENV/bin/python"
elif [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.venv/bin/activate"
    PYTHON_CMD="$VIRTUAL_ENV/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    error "Python 3 is required but not found"
    exit 1
fi

say "Using Python: $($PYTHON_CMD --version 2>&1)"

CMD=("$PYTHON_CMD" "$SCRIPT_DIR/clear_ml_queue.py" "$PROJECT_ID" "--api-url" "$API_URL" "--limit" "$LIMIT" "--status-from" "$STATUS_FROM" "--status-to" "$STATUS_TO")

if [[ -n "$API_KEY_OPT" ]]; then
    CMD+=("--api-key" "$API_KEY_OPT")
fi
if [[ -n "$OLDER_THAN_SECONDS" ]]; then
    CMD+=("--older-than-seconds" "$OLDER_THAN_SECONDS")
fi
if [[ "$DRY_RUN" == true ]]; then
    CMD+=("--dry-run")
fi
if [[ "$CONFIRM" == true ]]; then
    CMD+=("--confirm")
fi

say "Running clear_ml_queue.py..."
"${CMD[@]}"