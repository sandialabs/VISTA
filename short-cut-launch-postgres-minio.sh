#!/usr/bin/env bash
set -euo pipefail

# Launch postgres + minio using podman or docker inside the dev container.
# Auto-detects which container runtime is available.

cd "$(dirname "${BASH_SOURCE[0]}")"

# Detect container runtime (prefer podman, fallback to docker)
if command -v podman >/dev/null 2>&1; then
	CONTAINER_CMD="podman"
elif command -v docker >/dev/null 2>&1; then
	CONTAINER_CMD="docker"
else
	echo "Error: Neither podman nor docker is installed."
	exit 1
fi

# Check if we need/can use sudo
if command -v sudo >/dev/null 2>&1; then
	echo "Using ${CONTAINER_CMD} via sudo..."
	sudo ${CONTAINER_CMD} compose -f docker-compose.yml up -d postgres minio
else
	echo "Using ${CONTAINER_CMD} rootless..."
	${CONTAINER_CMD} compose -f docker-compose.yml up -d postgres minio
fi

# To totally kill the containers and volumes for a hard reset, run:
#   sudo ${CONTAINER_CMD} compose -f docker-compose.yml down -v
# or:
#   ${CONTAINER_CMD} compose -f docker-compose.yml down -v