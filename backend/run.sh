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

echo "Starting uvicorn main:app --host 0.0.0.0 --port 8000"
exec uvicorn main:app --host 0.0.0.0 --port 8000
