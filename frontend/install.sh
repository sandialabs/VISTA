#!/usr/bin/env bash

# Frontend installation script
# Installs Node.js version 22 and npm dependencies for the React frontend

set -euo pipefail

say() { echo "[frontend-install] $*"; }

install_frontend_dependencies() {
    # Check if we're in the frontend directory
    if [[ ! -f "package.json" ]]; then
        say "ERROR: This script must be run from the frontend directory"
        exit 1
    fi
    
    # Check Node.js version
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        say "Node.js version detected: $NODE_VERSION"
        
        # Check if it's version 22+
        MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
        if (( MAJOR_VERSION < 22 )); then
            say "WARNING: Node.js version 22+ recommended. Current version: $NODE_VERSION"
        fi
    else
        say "ERROR: Node.js is not installed. Please install Node.js 22+ first."
        exit 1
    fi
    
    # Check npm version
    if command -v npm >/dev/null 2>&1; then
        NPM_VERSION=$(npm --version)
        say "npm version detected: $NPM_VERSION"
    else
        say "ERROR: npm is not installed. Please install npm first."
        exit 1
    fi
    
    # Clean install dependencies
    say "Installing frontend dependencies..."
    
    # Remove node_modules and package-lock.json for a fresh install
    if [[ -d "node_modules" ]]; then
        say "Removing existing node_modules for fresh install"
        rm -rf node_modules
    fi
    
    if [[ -f "package-lock.json" ]]; then
        say "Removing existing package-lock.json for fresh install"
        rm -f package-lock.json
    fi
    
    # Install dependencies
    npm install
    
    say "Frontend dependencies installed successfully"
    
    # Install additional development optimizations
    say "Installing additional optimization packages..."
    npm install --save-dev webpack-bundle-analyzer react-app-rewired
    
    say "Frontend installation complete!"
    say "Run './run.sh' to start the development server"
}

# Run the installation
install_frontend_dependencies