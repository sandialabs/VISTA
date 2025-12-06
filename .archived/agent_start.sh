#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}=== VISTA Development Environment Setup ===${NC}\n"

# Cleanup function for graceful shutdown
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# Detect container runtime (podman or docker)
if command -v podman &> /dev/null; then
    CONTAINER_CMD="podman"
    COMPOSE_CMD="podman compose"
elif command -v docker &> /dev/null; then
    CONTAINER_CMD="docker"
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        echo -e "${RED}ERROR: Neither 'docker compose' nor 'docker-compose' found${NC}"
        exit 1
    fi
else
    echo -e "${RED}ERROR: Neither podman nor docker found. Please install one.${NC}"
    exit 1
fi

echo -e "${GREEN}Using container runtime: $CONTAINER_CMD${NC}\n"

# 1. Check if .env exists
echo -e "${BLUE}[1/7] Checking environment configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "${YELLOW}  .env file not found, creating from .env.example...${NC}"
    if [ ! -f .env.example ]; then
        echo -e "${RED}  ERROR: .env.example not found!${NC}"
        exit 1
    fi
    cp .env.example .env
    echo -e "${GREEN}  Created .env file${NC}"
else
    echo -e "${GREEN}  .env file exists${NC}"
fi

# Source environment variables
set -a
source .env
set +a

# 2. Check and start containers
echo -e "\n${BLUE}[2/7] Checking containers...${NC}"
POSTGRES_RUNNING=$($CONTAINER_CMD ps --filter "name=vista_postgres" --filter "status=running" --format "{{.Names}}" 2>/dev/null || true)
MINIO_RUNNING=$($CONTAINER_CMD ps --filter "name=vista_minio" --filter "status=running" --format "{{.Names}}" 2>/dev/null || true)

if [ -z "$POSTGRES_RUNNING" ] || [ -z "$MINIO_RUNNING" ]; then
    echo -e "${YELLOW}  Starting containers...${NC}"
    $COMPOSE_CMD up -d postgres minio
    
    # Wait for containers to be healthy
    echo -e "${YELLOW}  Waiting for containers to be healthy...${NC}"
    sleep 5
    
    # Wait for PostgreSQL to be ready
    MAX_RETRIES=30
    RETRY_COUNT=0
    until $CONTAINER_CMD exec vista_postgres pg_isready -U postgres &>/dev/null || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
        echo -e "${YELLOW}  Waiting for PostgreSQL to be ready... ($RETRY_COUNT/$MAX_RETRIES)${NC}"
        sleep 2
        RETRY_COUNT=$((RETRY_COUNT + 1))
    done
    
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}  ERROR: PostgreSQL did not become ready in time${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}  Containers are running and healthy${NC}"
else
    echo -e "${GREEN}  Containers already running${NC}"
fi

# 3. Check virtual environment
echo -e "\n${BLUE}[3/7] Checking Python virtual environment...${NC}"
if [ ! -d .venv ]; then
    echo -e "${YELLOW}  Creating virtual environment...${NC}"
    if ! command -v uv &> /dev/null; then
        echo -e "${YELLOW}  Installing uv...${NC}"
        pip install uv
    fi
    uv venv .venv
    echo -e "${GREEN}  Virtual environment created${NC}"
else
    echo -e "${GREEN}  Virtual environment exists${NC}"
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies if needed
if ! python -c "import fastapi" &>/dev/null; then
    echo -e "${YELLOW}  Installing Python dependencies...${NC}"
    uv pip install -r requirements.txt
    echo -e "${GREEN}  Dependencies installed${NC}"
else
    echo -e "${GREEN}  Python dependencies already installed${NC}"
fi

# 4. Check database migrations
echo -e "\n${BLUE}[4/7] Checking database migrations...${NC}"
cd backend

# Check if alembic is at head
CURRENT_REVISION=$(alembic current 2>/dev/null | grep -oP '(?<=^)[a-f0-9]+' | head -n1 || echo "none")
HEAD_REVISION=$(alembic heads 2>/dev/null | grep -oP '(?<=^)[a-f0-9]+' | head -n1 || echo "none")

if [ "$CURRENT_REVISION" != "$HEAD_REVISION" ] || [ "$CURRENT_REVISION" = "none" ]; then
    echo -e "${YELLOW}  Running database migrations...${NC}"
    alembic upgrade head
    echo -e "${GREEN}  Database migrations completed${NC}"
else
    echo -e "${GREEN}  Database is up to date (revision: $CURRENT_REVISION)${NC}"
fi

cd ..

# 5. Check frontend dependencies
echo -e "\n${BLUE}[5/7] Checking frontend dependencies...${NC}"
cd frontend
if [ ! -d node_modules ]; then
    echo -e "${YELLOW}  Installing frontend dependencies...${NC}"
    npm install
    echo -e "${GREEN}  Frontend dependencies installed${NC}"
else
    echo -e "${GREEN}  Frontend dependencies already installed${NC}"
fi
cd ..

# 6. Kill existing backend/frontend processes
echo -e "\n${BLUE}[6/7] Checking for existing processes...${NC}"

# Kill existing uvicorn processes
UVICORN_PIDS=$(pgrep -f "uvicorn main:app" || true)
if [ ! -z "$UVICORN_PIDS" ]; then
    echo -e "${YELLOW}  Stopping existing backend processes...${NC}"
    echo "$UVICORN_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Kill existing npm dev server processes
NPM_PIDS=$(pgrep -f "vite.*frontend" || pgrep -f "react-scripts start" || true)
if [ ! -z "$NPM_PIDS" ]; then
    echo -e "${YELLOW}  Stopping existing frontend processes...${NC}"
    echo "$NPM_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 2
fi

echo -e "${GREEN}  Ready to start services${NC}"

# 7. Start services
echo -e "\n${BLUE}[7/7] Starting services...${NC}"
cd backend

# Start backend in background
echo -e "${YELLOW}  Starting backend server...${NC}"
nohup uvicorn main:app --host 0.0.0.0 --port 8000 --reload > ../backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}  Backend started (PID: $BACKEND_PID)${NC}"

cd ..

# Wait for backend to be ready
echo -e "${YELLOW}  Waiting for backend to be ready...${NC}"
sleep 3
MAX_RETRIES=15
RETRY_COUNT=0
until curl -s http://localhost:8000/docs &>/dev/null || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${YELLOW}  Backend may not be fully ready (check backend.log)${NC}"
else
    echo -e "${GREEN}  Backend is ready${NC}"
fi

# Start frontend
echo -e "${YELLOW}  Starting frontend server...${NC}"
cd frontend

# Start frontend in background
nohup npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}  Frontend started (PID: $FRONTEND_PID)${NC}"

cd ..

# Final summary
echo -e "\n${GREEN}=== VISTA is ready! ===${NC}"
echo -e "${BLUE}Frontend:${NC}     http://localhost:3000"
echo -e "${BLUE}Backend API:${NC}  http://localhost:8000"
echo -e "${BLUE}API Docs:${NC}     http://localhost:8000/docs"
echo -e "${BLUE}MinIO:${NC}        http://localhost:9001 (minioadmin/minioadminpassword)"
echo -e "\n${YELLOW}Logs:${NC}"
echo -e "  Backend:  tail -f backend.log"
echo -e "  Frontend: tail -f frontend.log"
echo -e "\n${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Keep script running and monitor processes
while true; do
    if ! ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo -e "${RED}Backend process died! Check backend.log${NC}"
        cleanup
    fi
    if ! ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${RED}Frontend process died! Check frontend.log${NC}"
        cleanup
    fi
    sleep 5
done
echo -e "  API Docs:  ${GREEN}http://localhost:8000/docs${NC}"
echo -e "  MinIO:     ${GREEN}http://localhost:9001${NC} (minioadmin/minioadminpassword)"
echo -e ""
echo -e "${BLUE}Process IDs:${NC}"
echo -e "  Backend:  ${YELLOW}$BACKEND_PID${NC}"
echo -e "  Frontend: ${YELLOW}$FRONTEND_PID${NC}"
echo -e ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  Backend:  ${YELLOW}tail -f backend.log${NC}"
echo -e "  Frontend: ${YELLOW}tail -f frontend.log${NC}"
echo -e ""
echo -e "${BLUE}To stop all services:${NC}"
echo -e "  ${YELLOW}kill $BACKEND_PID $FRONTEND_PID${NC}"
echo -e "  ${YELLOW}podman compose down${NC}"
echo -e ""
echo -e "${GREEN}Press Ctrl+C to exit (services will continue running)${NC}"
echo -e "${YELLOW}To restart, simply run this script again.${NC}\n"

# Keep script running to show it's active (optional)
wait
