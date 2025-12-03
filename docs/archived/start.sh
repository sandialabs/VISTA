#!/usr/bin/env bash

# =============================================================================
# Unified Startup Script for VISTA
# =============================================================================
# This script handles dependency installation, infrastructure setup, and
# service startup for both backend and frontend components.
#
# Usage: ./start.sh [OPTIONS]
#
# Options:
#   -f, --frontend        Start frontend only
#   -b, --backend         Start backend only
#   -i, --install-only    Install dependencies and exit
#   -c, --clean           Clean containers/volumes before starting
#   -m, --migrate         Run database migrations before starting
#   --skip-install        Skip dependency installation
#   --skip-node-apt       Skip apt-based Node.js management (use devcontainer feature)
#   -h, --help            Show this help message
#
# Examples:
#   ./start.sh              # Full stack startup (default)
#   ./start.sh -b           # Backend only
#   ./start.sh -f           # Frontend only
#   ./start.sh -i           # Install dependencies only
#   ./start.sh -c -b        # Clean start backend
#   ./start.sh -m -b        # Run migrations + start backend
#
# =============================================================================

set -euo pipefail

# =============================================================================
# GLOBAL CONFIGURATION
# =============================================================================

# Store the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Container engine (podman or podman)
CONTAINER_ENGINE="${CONTAINER_ENGINE:-podman}"

# Docker resources
NETWORK_NAME="data_mgmt_net"
PG_CONTAINER="postgres_db"
MINIO_CONTAINER="minio_storage"
PG_VOLUME="postgres_data"
MINIO_VOLUME="minio_data"

# Process tracking
BACKEND_PID=""
FRONTEND_PID=""

# Mode flags
MODE_FRONTEND_ONLY=false
MODE_BACKEND_ONLY=false
MODE_INSTALL_ONLY=false
MODE_INFRA_ONLY=false
MODE_CLEAN=false
MODE_MIGRATE=false
SKIP_INSTALL=false
SKIP_NODE_APT=false

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# OUTPUT FUNCTIONS
# =============================================================================

say() {
    echo -e "${BLUE}[start]${NC} $*"
}

success() {
    echo -e "${GREEN}✅ $*${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $*${NC}"
}

error() {
    echo -e "${RED}❌ $*${NC}"
}

section() {
    echo ""
    echo -e "${BLUE}===================================================${NC}"
    echo -e "${BLUE}$*${NC}"
    echo -e "${BLUE}===================================================${NC}"
}

# =============================================================================
# CLEANUP FUNCTIONS
# =============================================================================

cleanup_processes() {
    say "Checking for existing uvicorn processes..."
    if pgrep -f "uvicorn main:app" >/dev/null 2>&1; then
        say "Killing existing uvicorn processes..."
        pkill -f "uvicorn main:app" || true
        sleep 2
    fi
}

cleanup_logs() {
    say "Clearing logs for fresh start..."
    mkdir -p "$PROJECT_ROOT/logs"
    echo "NEW LOG - $(date -Iseconds)" > "$PROJECT_ROOT/logs/app.jsonl"
    success "Logs cleared"
}

cleanup_containers() {
    section "Cleaning Containers & Volumes"

    # Stop and remove containers
    for container in "$PG_CONTAINER" "$MINIO_CONTAINER"; do
        if container_exists "$container"; then
            say "Stopping and removing $container..."
            "$CONTAINER_ENGINE" stop "$container" >/dev/null 2>&1 || true
            "$CONTAINER_ENGINE" rm "$container" >/dev/null 2>&1 || true
            success "$container removed"
        fi
    done

    # Remove volumes
    for volume in "$PG_VOLUME" "$MINIO_VOLUME"; do
        if volume_exists "$volume"; then
            say "Removing volume $volume..."
            "$CONTAINER_ENGINE" volume rm "$volume" >/dev/null 2>&1 || true
            success "$volume removed"
        fi
    done

    success "Cleanup complete"
}

cleanup_on_exit() {
    say "Shutting down services..."

    # Stop backend
    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        say "Stopping backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi

    # Stop frontend
    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        say "Stopping frontend (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi

    success "All services stopped"
}

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

have_cmd() {
    command -v "$1" >/dev/null 2>&1
}

container_running() {
    local name="$1"
    "$CONTAINER_ENGINE" ps --format '{{.Names}}' 2>/dev/null | grep -qx "$name"
}

container_exists() {
    local name="$1"
    "$CONTAINER_ENGINE" ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"
}

volume_exists() {
    local vol="$1"
    "$CONTAINER_ENGINE" volume ls --format '{{.Name}}' 2>/dev/null | grep -qx "$vol"
}

ensure_volume() {
    local vol="$1"
    if ! volume_exists "$vol"; then
        say "Creating volume $vol..."
        "$CONTAINER_ENGINE" volume create "$vol" >/dev/null
    fi
}

ensure_network() {
    if ! "$CONTAINER_ENGINE" network ls --format '{{.Name}}' 2>/dev/null | grep -qx "$NETWORK_NAME"; then
        say "Creating network $NETWORK_NAME..."
        "$CONTAINER_ENGINE" network create "$NETWORK_NAME" >/dev/null
        success "Network created"
    fi
}

load_env_file() {
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        say "Loading environment from .env file..."
        # shellcheck disable=SC1091
        set -a
        source "$PROJECT_ROOT/.env"
        set +a
    else
        warn ".env file not found, using defaults"
    fi
}

# =============================================================================
# DEPENDENCY CHECKING
# =============================================================================

check_dependencies() {
    section "Checking Dependencies"

    local missing=()

    # Check Docker/Podman
    if ! have_cmd "$CONTAINER_ENGINE"; then
        missing+=("$CONTAINER_ENGINE")
    else
        success "$CONTAINER_ENGINE is available"
    fi

    # Check curl
    if ! have_cmd curl; then
        missing+=("curl")
    else
        success "curl is available"
    fi

    # Check Python
    if ! have_cmd python3; then
        missing+=("python3")
    else
        success "python3 is available: $(python3 --version)"
    fi

    # Check uv
    if ! have_cmd uv; then
        warn "uv not installed, will install it"
    else
        success "uv is available: $(uv --version)"
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing required dependencies: ${missing[*]}"
        error "Please install missing dependencies and try again"
        exit 1
    fi

    success "All required dependencies are available"
}

ensure_node() {
    # Try existing PATH first
    if have_cmd node; then
        say "Node detected: $(node --version)"
        if have_cmd npm; then
            say "npm detected: $(npm --version)"
        else
            warn "npm not found"
        fi
        return 0
    fi

    # Try devcontainer feature path (nvm current)
    local NVM_NODE_BIN="/usr/local/share/nvm/current/bin"
    if [[ -d "$NVM_NODE_BIN" ]]; then
        export PATH="$NVM_NODE_BIN:$PATH"
        if have_cmd node; then
            say "Node made available via devcontainer feature path: $(node --version)"
            if have_cmd npm; then
                say "npm detected: $(npm --version)"
            else
                warn "npm not found"
            fi
            return 0
        fi
    fi

    warn "Node.js not found on PATH. Frontend tasks may fail."
    return 1
}

# =============================================================================
# DEPENDENCY INSTALLATION
# =============================================================================

install_dependencies() {
    section "Installing Dependencies"

    # Install Node.js if needed
    if [[ "$SKIP_NODE_APT" == "true" ]]; then
        say "SKIP_NODE_APT set; skipping apt-based Node.js management"
        ensure_node || true
    else
        if ! ensure_node; then
            say "Installing Node.js via apt/NodeSource..."
            sudo apt-get update -y || true
            sudo apt remove -y nodejs npm || true
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs

            if have_cmd node; then
                success "Node.js installed: $(node --version)"
            else
                error "Node.js installation failed"
                exit 1
            fi

            if have_cmd npm; then
                success "npm installed: $(npm --version)"
            else
                error "npm installation failed"
                exit 1
            fi
        fi
    fi

    # Install uv if needed
    if ! have_cmd uv; then
        say "Installing uv..."
        python3 -m pip install uv
        success "uv installed: $(uv --version)"
    fi

    # Create and setup Python virtual environment
    if [[ ! -d "$PROJECT_ROOT/backend/.venv" ]]; then
        say "Creating Python virtual environment in backend/..."
        cd "$PROJECT_ROOT/backend"
        uv venv .venv
        cd "$PROJECT_ROOT"
        success "Virtual environment created"
    else
        say "Virtual environment already exists"
    fi

    # Install Python dependencies
    if [[ -f "$PROJECT_ROOT/backend/requirements.txt" ]]; then
        say "Installing Python dependencies..."
        cd "$PROJECT_ROOT/backend"
        source .venv/bin/activate
        uv pip install -r requirements.txt
        cd "$PROJECT_ROOT"
        success "Python dependencies installed"
    else
        warn "backend/requirements.txt not found; skipping pip install"
    fi

    # Install frontend dependencies
    if [[ -f "$PROJECT_ROOT/frontend/package.json" ]]; then
        if [[ ! -d "$PROJECT_ROOT/frontend/node_modules" ]]; then
            say "Installing frontend dependencies..."
            cd "$PROJECT_ROOT/frontend"
            npm install
            cd "$PROJECT_ROOT"
            success "Frontend dependencies installed"
        else
            say "Frontend dependencies already installed"
        fi
    else
        warn "frontend/package.json not found; skipping npm install"
    fi

    success "All dependencies installed"
}

# =============================================================================
# INFRASTRUCTURE SETUP
# =============================================================================

start_postgres() {
    ensure_network
    ensure_volume "$PG_VOLUME"

    # Load defaults from env
    local POSTGRES_USER="${POSTGRES_USER:-postgres}"
    local POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
    local POSTGRES_DB="${POSTGRES_DB:-postgres}"
    local POSTGRES_PORT_HOST="${POSTGRES_PORT:-5433}"

    if container_running "$PG_CONTAINER"; then
        success "PostgreSQL already running ($PG_CONTAINER)"
    else
        if container_exists "$PG_CONTAINER"; then
            say "Starting existing PostgreSQL container..."
            "$CONTAINER_ENGINE" start "$PG_CONTAINER" >/dev/null
        else
            say "Launching PostgreSQL ($PG_CONTAINER) on host port $POSTGRES_PORT_HOST..."
            "$CONTAINER_ENGINE" run -d \
                --name "$PG_CONTAINER" \
                --network "$NETWORK_NAME" \
                -p "${POSTGRES_PORT_HOST}:5432" \
                -e POSTGRES_USER="$POSTGRES_USER" \
                -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
                -e POSTGRES_DB="$POSTGRES_DB" \
                -v "${PG_VOLUME}:/var/lib/postgresql/data" \
                postgres:15 >/dev/null
        fi
    fi

    # Wait until Postgres reports ready
    say "Waiting for PostgreSQL to become ready..."
    local tries=0
    until "$CONTAINER_ENGINE" exec "$PG_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
        tries=$((tries+1))
        if (( tries > 60 )); then
            error "PostgreSQL did not become ready in time"
            exit 1
        fi
        sleep 1
    done
    success "PostgreSQL is ready"
}

start_minio() {
    ensure_network
    ensure_volume "$MINIO_VOLUME"

    # Load defaults from env
    local S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
    local S3_SECRET_KEY="${S3_SECRET_KEY:-minioadminpassword}"

    if container_running "$MINIO_CONTAINER"; then
        success "MinIO already running ($MINIO_CONTAINER)"
    else
        if container_exists "$MINIO_CONTAINER"; then
            say "Starting existing MinIO container..."
            "$CONTAINER_ENGINE" start "$MINIO_CONTAINER" >/dev/null
        else
            say "Launching MinIO ($MINIO_CONTAINER) on ports 9000/9090..."
            "$CONTAINER_ENGINE" run -d \
                --name "$MINIO_CONTAINER" \
                --network "$NETWORK_NAME" \
                -p 9000:9000 -p 9090:9090 \
                -e MINIO_ROOT_USER="$S3_ACCESS_KEY" \
                -e MINIO_ROOT_PASSWORD="$S3_SECRET_KEY" \
                -v "${MINIO_VOLUME}:/data" \
                minio/minio:latest \
                server /data --console-address ":9090" >/dev/null
        fi
    fi

    # Wait for MinIO live endpoint
    if have_cmd curl; then
        say "Waiting for MinIO to become ready..."
        local tries=0
        until curl -sf "http://localhost:9000/minio/health/live" >/dev/null 2>&1; do
            tries=$((tries+1))
            if (( tries > 60 )); then
                error "MinIO did not become ready in time"
                exit 1
            fi
            sleep 1
        done
        success "MinIO is ready"
    else
        warn "curl not found; skipping MinIO readiness check"
    fi
}

test_connectivity() {
    say "Testing connectivity to services..."

    local POSTGRES_PORT_HOST="${POSTGRES_PORT:-5433}"
    local all_ok=true

    # Test PostgreSQL
    if have_cmd pg_isready; then
        if pg_isready -h localhost -p "$POSTGRES_PORT_HOST" -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1; then
            success "PostgreSQL is accessible from host"
        else
            error "PostgreSQL is not accessible from host on port $POSTGRES_PORT_HOST"
            all_ok=false
        fi
    elif have_cmd nc; then
        if nc -z localhost "$POSTGRES_PORT_HOST" >/dev/null 2>&1; then
            success "PostgreSQL port $POSTGRES_PORT_HOST is accessible"
        else
            error "PostgreSQL port $POSTGRES_PORT_HOST is not accessible"
            all_ok=false
        fi
    fi

    # Test MinIO
    if have_cmd curl; then
        if curl -sf "http://localhost:9000/minio/health/live" >/dev/null; then
            success "MinIO is accessible from host"
        else
            error "MinIO is not accessible from host on port 9000"
            all_ok=false
        fi
    elif have_cmd nc; then
        if nc -z localhost 9000 >/dev/null 2>&1; then
            success "MinIO port 9000 is accessible"
        else
            error "MinIO port 9000 is not accessible"
            all_ok=false
        fi
    fi

    if [[ "$all_ok" != "true" ]]; then
        error "Cannot connect to required services"
        say "Current port mappings:"
        "$CONTAINER_ENGINE" ps --format "table {{.Names}}\t{{.Ports}}"
        return 1
    fi

    return 0
}

setup_infrastructure() {
    section "Setting Up Infrastructure"

    load_env_file
    start_postgres
    start_minio
    test_connectivity || exit 1

    success "Infrastructure ready"
}

# =============================================================================
# DATABASE MIGRATIONS
# =============================================================================

run_migrations() {
    section "Running Database Migrations"

    cd "$PROJECT_ROOT/backend"

    # Ensure venv is activated
    if [[ -z "${VIRTUAL_ENV:-}" ]]; then
        if [[ -f .venv/bin/activate ]]; then
            source .venv/bin/activate
        else
            error "Virtual environment not found"
            exit 1
        fi
    fi

    # Check if alembic is available
    if ! have_cmd alembic; then
        error "alembic not found. Please install dependencies first."
        exit 1
    fi

    say "Running alembic upgrade head..."
    alembic upgrade head

    cd "$PROJECT_ROOT"
    success "Migrations complete"
}

# =============================================================================
# SERVICE STARTUP
# =============================================================================

start_backend() {
    section "Starting Backend"

    cd "$PROJECT_ROOT/backend"

    # Ensure Python virtual environment is activated
    if [[ -z "${VIRTUAL_ENV:-}" ]]; then
        if [[ -f .venv/bin/activate ]]; then
            say "Activating Python virtual environment..."
            source .venv/bin/activate
        else
            error "Virtual environment not found. Please run install first."
            exit 1
        fi
    else
        say "Virtual environment already activated: $VIRTUAL_ENV"
    fi

    # Check if uvicorn is available
    if ! have_cmd uvicorn; then
        error "uvicorn is not installed. Please run install first."
        exit 1
    fi

    success "Starting FastAPI backend on http://localhost:8000"
    say "Press Ctrl+C to stop the server"
    echo ""

    cd "$PROJECT_ROOT/backend"
    # Start the FastAPI application
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!

    cd "$PROJECT_ROOT"
    say "Backend started with PID: $BACKEND_PID"
}

start_frontend() {
    section "Starting Frontend"

    cd "$PROJECT_ROOT/frontend"

    # Check if Node.js is available
    if ! have_cmd node; then
        error "Node.js is not installed. Please run install first."
        exit 1
    fi

    if ! have_cmd npm; then
        error "npm is not installed. Please run install first."
        exit 1
    fi

    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        error "node_modules not found. Please run install first."
        exit 1
    fi

    success "Starting React frontend on http://localhost:3000"
    say "Press Ctrl+C to stop the server"
    echo ""

    # Set environment variables for optimized development
    export FAST_REFRESH=true
    export GENERATE_SOURCEMAP=true
    export SKIP_PREFLIGHT_CHECK=true

    cd "$PROJECT_ROOT/frontend"
    # Start the development server
    npm run dev &
    FRONTEND_PID=$!

    cd "$PROJECT_ROOT"
    say "Frontend started with PID: $FRONTEND_PID"
}

# =============================================================================
# STATUS DISPLAY
# =============================================================================

display_status() {
    section "Services Running"

    echo ""
    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        success "Backend:  http://localhost:8000 (PID: $BACKEND_PID)"
        echo "          API Docs: http://localhost:8000/docs"
    fi

    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        success "Frontend: http://localhost:3000 (PID: $FRONTEND_PID)"
    fi

    if container_running "$PG_CONTAINER"; then
        success "PostgreSQL: localhost:${POSTGRES_PORT:-5433}"
    fi

    if container_running "$MINIO_CONTAINER"; then
        success "MinIO API: http://localhost:9000"
        echo "          Console: http://localhost:9090"
    fi

    echo ""
    say "Press Ctrl+C to stop all services"
    echo ""
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

show_help() {
    cat << EOF
Unified Startup Script for VISTA

Usage: ./start.sh [OPTIONS]

Options:
  -f, --frontend        Start frontend only
  -b, --backend         Start backend only
  -I, --infrastructure  Start infrastructure only (postgres & minio)
  -i, --install-only    Install dependencies and exit
  -c, --clean           Clean containers/volumes before starting
  -m, --migrate         Run database migrations before starting
  --skip-install        Skip dependency installation
  --skip-node-apt       Skip apt-based Node.js management (use devcontainer feature)
  -h, --help            Show this help message

Examples:
  ./start.sh              # Full stack startup (default)
  ./start.sh -b           # Backend only
  ./start.sh -f           # Frontend only
  ./start.sh -I           # Infrastructure only (postgres & minio)
  ./start.sh -i           # Install dependencies only
  ./start.sh -c -b        # Clean start backend
  ./start.sh -m -b        # Run migrations + start backend
  ./start.sh --skip-install -b  # Start backend without reinstalling deps

Environment Variables:
  CONTAINER_ENGINE      Container engine to use (podman or podman, default: podman)
  SKIP_NODE_APT         Skip apt-based Node.js installation (default: false)

EOF
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--frontend)
                MODE_FRONTEND_ONLY=true
                shift
                ;;
            -b|--backend)
                MODE_BACKEND_ONLY=true
                shift
                ;;
            -I|--infrastructure)
                MODE_INFRA_ONLY=true
                shift
                ;;
            -i|--install-only)
                MODE_INSTALL_ONLY=true
                shift
                ;;
            -c|--clean)
                MODE_CLEAN=true
                shift
                ;;
            -m|--migrate)
                MODE_MIGRATE=true
                shift
                ;;
            --skip-install)
                SKIP_INSTALL=true
                shift
                ;;
            --skip-node-apt)
                SKIP_NODE_APT=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # Export SKIP_NODE_APT for consistency with old scripts
    export SKIP_NODE_APT
}

# =============================================================================
# MAIN EXECUTION FLOW
# =============================================================================

main() {
    # Parse command line arguments
    parse_arguments "$@"

    # Set trap to cleanup on script exit
    trap cleanup_on_exit EXIT INT TERM

    # Show banner
    section "VISTA - Startup"
    say "Mode: ${CONTAINER_ENGINE}"

    # Handle clean mode
    if [[ "$MODE_CLEAN" == "true" ]]; then
        cleanup_containers
    fi

    # Check dependencies
    check_dependencies

    # Handle install-only mode
    if [[ "$MODE_INSTALL_ONLY" == "true" ]]; then
        install_dependencies
        success "Installation complete. Run ./start.sh to start services."
        exit 0
    fi

    # Handle infrastructure-only mode
    if [[ "$MODE_INFRA_ONLY" == "true" ]]; then
        load_env_file
        check_dependencies
        if [[ "$SKIP_INSTALL" != "true" ]]; then
            install_dependencies
        else
            say "Skipping dependency installation (--skip-install)"
        fi
        if [[ "$MODE_CLEAN" == "true" ]]; then
            cleanup_containers
        fi
        setup_infrastructure
        display_status
        say "Infrastructure is running. Press Ctrl+C to stop."
        # Keep script running indefinitely to maintain containers
        trap 'echo ""; say "Shutting down infrastructure..."; exit 0' INT TERM
        while true; do
            sleep 1
        done
    fi

    # Install dependencies unless skipped
    if [[ "$SKIP_INSTALL" != "true" ]]; then
        install_dependencies
    else
        say "Skipping dependency installation (--skip-install)"
    fi

    # Cleanup processes
    cleanup_processes
    cleanup_logs

    # Determine what to start
    local start_backend=false
    local start_frontend=false

    if [[ "$MODE_BACKEND_ONLY" == "true" ]]; then
        start_backend=true
    elif [[ "$MODE_FRONTEND_ONLY" == "true" ]]; then
        start_frontend=true
    else
        # Default: both
        start_backend=true
        start_frontend=true
    fi

    # Setup infrastructure if backend is starting
    if [[ "$start_backend" == "true" ]]; then
        setup_infrastructure

        # Run migrations if requested
        if [[ "$MODE_MIGRATE" == "true" ]]; then
            run_migrations
        fi

        start_backend
    fi

    # Start frontend if requested
    if [[ "$start_frontend" == "true" ]]; then
        # Give backend a moment to start
        if [[ "$start_backend" == "true" ]]; then
            sleep 2
        fi
        start_frontend
    fi

    # Display status
    sleep 1
    display_status

    # Keep script running
    if [[ -n "$BACKEND_PID" ]] || [[ -n "$FRONTEND_PID" ]]; then
        wait
    fi
}

# Run main function with all arguments
main "$@"
