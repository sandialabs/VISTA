#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_DIR"

: "${DATABASE_URL:?DATABASE_URL is required to start the production server}"
PORT="${PORT:-8000}"

echo 'Running database migrations...'
python "$BACKEND_DIR/scripts/run_migrations.py"

echo 'Starting backend server...'
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"
