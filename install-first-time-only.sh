#!/usr/bin/env bash
set -euo pipefail

# Use sudo only if it exists (Codespaces often runs as root)
SUDO=""
if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

echo ">>> Updating system and installing base dependencies + Python + podman"
$SUDO apt update -y
$SUDO apt install -y \
  python3 python3-venv python3-dev \
  curl build-essential pkg-config libssl-dev zlib1g-dev \
  podman

echo ">>> Installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh

echo ">>> Installing Node.js + npm (NodeSource 22.x)"
curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
$SUDO apt install -y nodejs

echo ">>> Versions:"
python3 --version || true
uv --version || "$HOME/.local/bin/uv" --version || true
node --version || true
npm --version || true
podman --version || true

echo ">>> Done."
