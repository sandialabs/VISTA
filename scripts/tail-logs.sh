#!/usr/bin/env bash
# Tail Docker container logs to files in workspace/logs directory
# Usage: ./scripts/tail-logs.sh [service-name]
# If no service specified, tails all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS_DIR="$PROJECT_ROOT/logs"
COMPOSE_FILE="docker-compose.dev.yml"

cd "$PROJECT_ROOT"

# Create logs directory if it doesn't exist
mkdir -p "$LOGS_DIR"

# Function to tail a specific service
tail_service() {
    local service=$1
    local log_file="$LOGS_DIR/${service}.log"

    echo "Tailing $service logs to $log_file..."
    docker compose -f "$COMPOSE_FILE" logs -f --no-color "$service" > "$log_file" 2>&1 &
}

# If service specified, tail only that service
if [ -n "${1:-}" ]; then
    tail_service "$1"
    echo "Tailing $1 logs. Press Ctrl+C to stop."
    wait
else
    # Tail all services
    echo "Starting log collection for all services..."
    tail_service "postgres"
    tail_service "minio"
    tail_service "backend-dev"
    tail_service "frontend-dev"

    echo ""
    echo "Logs being written to:"
    echo "  - $LOGS_DIR/postgres.log"
    echo "  - $LOGS_DIR/minio.log"
    echo "  - $LOGS_DIR/backend-dev.log"
    echo "  - $LOGS_DIR/frontend-dev.log"
    echo ""
    echo "Press Ctrl+C to stop log collection."
    echo "Logs will continue to update in real-time."

    # Wait for all background processes
    wait
fi
