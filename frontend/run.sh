#!/usr/bin/env bash

# Frontend run script
# Starts the React development server with optimizations

set -euo pipefail

say() { echo "[frontend-run] $*"; }

start_frontend() {
    # Check if we're in the frontend directory
    if [[ ! -f "package.json" ]]; then
        say "ERROR: This script must be run from the frontend directory"
        exit 1
    fi
    
    # Check if Node.js and npm are installed
    if ! command -v node >/dev/null 2>&1; then
        say "ERROR: Node.js is not installed. Please run install.sh first."
        exit 1
    fi
    
    if ! command -v npm >/dev/null 2>&1; then
        say "ERROR: npm is not installed. Please run install.sh first."
        exit 1
    fi
    
    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        say "ERROR: node_modules not found. Please run install.sh first."
        exit 1
    fi
    
    say "Starting React frontend development server..."
    say "Server will be available at http://localhost:3000"
    say "Press Ctrl+C to stop the server"
    
    # Set environment variables for optimized development
    export FAST_REFRESH=true
    export GENERATE_SOURCEMAP=true
    export SKIP_PREFLIGHT_CHECK=true
    
    # Start the development server with optimizations
    npm run dev
}

# Parse command line arguments
BUILD_MODE=false
ANALYZE_MODE=false

while getopts "ba" opt; do
    case $opt in
        b)
            BUILD_MODE=true
            ;;
        a)
            ANALYZE_MODE=true
            ;;
        \?)
            echo "Usage: $0 [-b] [-a]" >&2
            echo "  -b: Build for production instead of starting dev server" >&2
            echo "  -a: Build and analyze bundle size" >&2
            exit 1
            ;;
    esac
done

# Handle different modes
if [[ "$ANALYZE_MODE" == true ]]; then
    say "Building and analyzing bundle..."
    npm run build
    if command -v npx >/dev/null 2>&1 && [[ -d "build/static/js" ]]; then
        npx webpack-bundle-analyzer build/static/js/*.js
    else
        say "Bundle analyzer not available or build failed"
    fi
elif [[ "$BUILD_MODE" == true ]]; then
    say "Building for production..."
    npm run build
    say "Production build complete! Files are in the 'build' directory"
else
    start_frontend
fi