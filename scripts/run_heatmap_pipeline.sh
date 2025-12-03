#!/usr/bin/env bash
# Heatmap ML Pipeline Runner
# End-to-end integration test for ML heatmap visualization feature

set -euo pipefail

# Trap to handle errors and print clear messages
trap 'error "Script failed at line $LINENO with exit code $?"; exit 1' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables from .env file
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

say() {
    echo -e "${BLUE}[heatmap-pipeline]${NC} $*"
}

error() {
    echo -e "${RED}[heatmap-pipeline]${NC} $*" >&2
}

success() {
    echo -e "${GREEN}[heatmap-pipeline]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[heatmap-pipeline]${NC} $*"
}

usage() {
    cat << EOF
Usage: $0 <project_id> [options]

Run heatmap generation pipeline on a project's images.

Arguments:
    project_id          UUID of the project to process

Options:
    --api-url URL       API base URL (default: http://localhost:8000)
    --api-key KEY       API key for authentication
                        REQUIRED for production (with auth enabled)
                        Optional for dev/test (with DEBUG=true)
    --heatmap-type TYPE Heatmap type: random (default: random)
                        Future: gradcam, saliency, attention
    --limit N           Maximum images to process (default: 10)
    --skip-existing     Skip images that already have ML analysis results
    --output-dir DIR    Directory to save heatmaps locally for inspection (optional)
    --install-deps      Install ML dependencies before running
    --help              Show this help message

Environment Variables:
    ML_CALLBACK_HMAC_SECRET    HMAC secret (required)
    API_KEY                    API key for authentication (alternative to --api-key)

Examples:
    # Development/testing (with DEBUG=true on backend)
    $0 abc-123-def --limit 5

    # Production (requires API key)
    $0 abc-123-def --api-url https://api.example.com --api-key your-api-key --limit 5

    # Save heatmaps locally for inspection
    $0 abc-123-def --limit 5 --output-dir ./heatmap_outputs

    # Skip images with existing analyses
    $0 abc-123-def --skip-existing --api-key your-api-key

    # Install dependencies first
    $0 abc-123-def --install-deps

Note: ML pipeline callbacks require BOTH API key AND HMAC signature in production.
      The API key authenticates the user, HMAC proves the request is from an authorized pipeline.

EOF
}

# Parse arguments
PROJECT_ID=""
API_URL="http://localhost:8000"
API_KEY="${API_KEY:-}"
HEATMAP_TYPE="random"
LIMIT=10
SKIP_EXISTING=false
OUTPUT_DIR=""
INSTALL_DEPS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            usage
            exit 0
            ;;
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --heatmap-type)
            HEATMAP_TYPE="$2"
            shift 2
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        --skip-existing)
            SKIP_EXISTING=true
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --install-deps)
            INSTALL_DEPS=true
            shift
            ;;
        -*)
            error "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [[ -z "$PROJECT_ID" ]]; then
                PROJECT_ID="$1"
            else
                error "Unexpected argument: $1"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate project ID
if [[ -z "$PROJECT_ID" ]]; then
    error "Project ID is required"
    usage
    exit 1
fi

# Validate heatmap type
if [[ ! "$HEATMAP_TYPE" =~ ^(random)$ ]]; then
    error "Invalid heatmap type: $HEATMAP_TYPE (currently only 'random' is supported)"
    exit 1
fi

# Try to load .env file if HMAC secret is not set
if [[ -z "${ML_CALLBACK_HMAC_SECRET:-}" ]]; then
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        say "Loading environment from $PROJECT_ROOT/.env"
        set -a
        source "$PROJECT_ROOT/.env"
        set +a
    fi
fi

# Check HMAC secret
if [[ -z "${ML_CALLBACK_HMAC_SECRET:-}" ]]; then
    error "ML_CALLBACK_HMAC_SECRET environment variable is required"
    echo ""
    echo "Set it with:"
    echo "  export ML_CALLBACK_HMAC_SECRET='your-secret-here'"
    echo ""
    echo "Or add it to your .env file:"
    echo "  echo 'ML_CALLBACK_HMAC_SECRET=your-secret' >> $PROJECT_ROOT/.env"
    exit 1
fi

say "Heatmap ML Pipeline Integration Test"
echo "===================================="
echo ""
echo "Project ID:    $PROJECT_ID"
echo "API URL:       $API_URL"
echo "Heatmap Type:  $HEATMAP_TYPE"
echo "Image Limit:   $LIMIT"
echo "HMAC Secret:   ${ML_CALLBACK_HMAC_SECRET:0:8}... (set)"
[[ -n "$API_KEY" ]] && echo "API Key:       ${API_KEY:0:8}... (set)"
[[ -n "$OUTPUT_DIR" ]] && echo "Output Dir:    $OUTPUT_DIR"
echo ""

# Check for active virtual environment or use root .venv
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
    say "Using active virtual environment: $VIRTUAL_ENV"
    PYTHON_CMD="$VIRTUAL_ENV/bin/python"
elif [[ -f "$PROJECT_ROOT/.venv/bin/python" ]]; then
    say "Activating root virtual environment..."
    source "$PROJECT_ROOT/.venv/bin/activate"
    PYTHON_CMD="$VIRTUAL_ENV/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    error "Python 3 is required but not found"
    exit 1
fi

say "Using Python: $($PYTHON_CMD --version)"

# Check system dependencies for OpenCV
say "Checking system dependencies..."
MISSING_DEPS=()

# Check for OpenGL library (required by opencv-python)
if ! ldconfig -p | grep -q "libGL.so.1"; then
    MISSING_DEPS+=("libgl1-mesa-glx")
fi

# Check for GLib (required by opencv-python)
if ! ldconfig -p | grep -q "libglib-2.0.so.0"; then
    MISSING_DEPS+=("libglib2.0-0")
fi

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    error "Missing required system libraries for OpenCV"
    echo ""
    echo "The following packages are required:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "  - $dep"
    done
    echo ""
    echo "Install them with:"
    echo "  sudo apt-get update"
    echo "  sudo apt-get install -y ${MISSING_DEPS[*]}"
    echo ""
    exit 1
fi

# Install dependencies if requested
if [[ "$INSTALL_DEPS" == true ]]; then
    say "Installing ML dependencies..."

    # Use uv with the active python, or pip from virtual environment
    if command -v uv >/dev/null 2>&1; then
        uv pip install --python "$PYTHON_CMD" -r "$SCRIPT_DIR/heatmap_ml_requirements.txt"
    elif [[ -n "${VIRTUAL_ENV:-}" ]] && [[ -x "$VIRTUAL_ENV/bin/pip" ]]; then
        "$VIRTUAL_ENV/bin/pip" install -r "$SCRIPT_DIR/heatmap_ml_requirements.txt"
    elif command -v pip >/dev/null 2>&1; then
        pip install -r "$SCRIPT_DIR/heatmap_ml_requirements.txt"
    elif command -v pip3 >/dev/null 2>&1; then
        pip3 install -r "$SCRIPT_DIR/heatmap_ml_requirements.txt"
    else
        error "No package installer found (pip or uv)"
        exit 1
    fi

    success "Dependencies installed"
    echo ""
fi

# Check if required packages are available
if ! $PYTHON_CMD -c "import cv2" 2>/dev/null; then
    error "opencv-python package not found"
    echo ""
    echo "Install ML dependencies with:"
    echo "  $0 $PROJECT_ID --install-deps"
    echo ""
    echo "Or manually:"
    echo "  pip3 install -r scripts/heatmap_ml_requirements.txt"
    exit 1
fi

# Build command
CMD=(
    "$PYTHON_CMD"
    "$SCRIPT_DIR/heatmap_ml_pipeline.py"
    "$PROJECT_ID"
    "--api-url" "$API_URL"
    "--heatmap-type" "$HEATMAP_TYPE"
    "--limit" "$LIMIT"
)

[[ -n "$API_KEY" ]] && CMD+=("--api-key" "$API_KEY")
[[ "$SKIP_EXISTING" == true ]] && CMD+=("--skip-existing")
[[ -n "$OUTPUT_DIR" ]] && CMD+=("--output-dir" "$OUTPUT_DIR")

# Run pipeline
say "Starting pipeline..."
echo ""

set +e
"${CMD[@]}"
EXIT_CODE=$?
set -e

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
    success "Pipeline completed successfully!"
    echo ""
    echo "View results in the web UI:"
    echo "   1. Navigate to your project: $API_URL"
    echo "   2. Open any processed image"
    echo "   3. Check the 'ML Analyses' panel in the sidebar"
    echo "   4. Heatmap overlay should be visible on the image"
    echo ""
else
    error "Pipeline failed with exit code $EXIT_CODE"
    exit $EXIT_CODE
fi
