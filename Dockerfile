# Use Debian-based Python image to match devcontainer environment
# Multi-stage build for optimized production image
FROM python:3.11-bookworm AS base

# Install system dependencies and development tools in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    git \
    curl \
    wget \
    ca-certificates \
    nodejs \
    npm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create a Python virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install uv package installer
RUN pip install --no-cache-dir --upgrade pip uv

WORKDIR /app

# Set Python environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

FROM base AS builder

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    uv pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY ./backend /app/backend
# COPY .env /app/.env

# Copy frontend files selectively (excluding node_modules)
WORKDIR /app
# Copy package.json and package-lock.json first for better caching
COPY ./frontend/package.json ./frontend/package-lock.json ./frontend/
# Copy frontend source and config files
COPY ./frontend/public ./frontend/public
COPY ./frontend/src ./frontend/src
COPY ./frontend/config-overrides.js ./frontend/

# Install frontend dependencies and build
WORKDIR /app/frontend
RUN npm install
RUN npm run build
RUN ls -la build || echo "Build directory not found"

# Return to app directory
WORKDIR /app

# Final stage
FROM base AS final

# Copy Python dependencies from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy backend code
COPY --from=builder /app/backend /app/backend
# Copy frontend build files
COPY --from=builder /app/frontend/build /app/ui2

# Set frontend build path environment variable
ENV FRONTEND_BUILD_PATH=/app/ui2

# Create non-root user for running the application
RUN groupadd --gid 1000 vista && \
    useradd --uid 1000 --gid vista --create-home vista && \
    chown -R vista:vista /app

USER vista

WORKDIR /app
EXPOSE 8000

# Use uvicorn to run the FastAPI app
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
