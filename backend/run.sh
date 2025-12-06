#!/usr/bin/env bash

# Exit immediately if any command exits with a non-zero status
set -e

# Backend run script
# Tries to load the virtual environment (.venv) from current dir or back one dir before proceeding
# Starts PostgreSQL and MinIO containers, then starts the FastAPI backend with uvicorn

# Check for virtual environment in current directory
if [ -d ".venv" ]; then
    echo "Found .venv in current directory, activating..."
    source .venv/bin/activate
    # Verify activation succeeded
    if ! command -v uvicorn >/dev/null 2>&1; then
        echo "ERROR: uvicorn not found after activating virtual environment. Please run 'pip install -r requirements.txt'"
        exit 1
    fi
# Check for virtual environment in parent directory
elif [ -d "../.venv" ]; then
    echo "Found .venv in parent directory, activating..."
    source ../.venv/bin/activate
    # Verify activation succeeded
    if ! command -v uvicorn >/dev/null 2>&1; then
        echo "ERROR: uvicorn not found after activating virtual environment. Please run 'pip install -r requirements.txt'"
        exit 1
    fi
else
    echo "No .venv found in current or parent directory, proceeding without virtual environment"
    # Check if uvicorn is available globally
    if ! command -v uvicorn >/dev/null 2>&1; then
        echo "ERROR: uvicorn not found. Please install dependencies or activate a virtual environment."
        exit 1
    fi
fi

echo "Checking container health before starting backend..."

# Function to check PostgreSQL
check_postgres() {
    local max_attempts=30
    local attempt=1
    local postgres_host="${POSTGRES_SERVER:-localhost}"
    local postgres_port="${POSTGRES_PORT:-5433}"

    echo "Checking PostgreSQL at ${postgres_host}:${postgres_port}..."
    while [ $attempt -le $max_attempts ]; do
        if timeout 1 bash -c "cat < /dev/null > /dev/tcp/${postgres_host}/${postgres_port}" 2>/dev/null; then
            echo "PostgreSQL is ready"
            return 0
        fi
        echo "Waiting for PostgreSQL (attempt $attempt/$max_attempts)..."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo "ERROR: PostgreSQL not responding after $max_attempts attempts"
    echo "Make sure PostgreSQL is running: podman compose up -d postgres"
    return 1
}

# Function to check MinIO
check_minio() {
    local max_attempts=30
    local attempt=1
    local s3_endpoint="${S3_ENDPOINT:-localhost:9000}"
    local protocol="http"

    if [ "${S3_USE_SSL:-false}" = "true" ]; then
        protocol="https"
    fi

    echo "Checking MinIO at ${protocol}://${s3_endpoint}..."
    while [ $attempt -le $max_attempts ]; do
        if curl -sf "${protocol}://${s3_endpoint}/minio/health/live" >/dev/null 2>&1; then
            echo "MinIO is ready"
            return 0
        fi
        echo "Waiting for MinIO (attempt $attempt/$max_attempts)..."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo "ERROR: MinIO not responding after $max_attempts attempts"
    echo "Make sure MinIO is running: podman compose up -d minio"
    return 1
}

# Load environment variables if .env exists
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
elif [ -f "../.env" ]; then
    set -a
    source ../.env
    set +a
fi

# Run health checks
check_postgres || exit 1
check_minio || exit 1

echo "All containers are healthy"
echo "Starting uvicorn main:app --host 0.0.0.0 --port 8000"
exec uvicorn main:app --host 0.0.0.0 --port 8000
