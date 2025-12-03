# Use Fedora latest as the base image
# Multi-stage build for optimized production image
FROM fedora:latest AS base

# Install system dependencies and development tools in a single layer
RUN dnf update -y && dnf install -y \
    gcc \
    gcc-c++ \
    postgresql-devel \
    git \
    curl \
    wget \
    ca-certificates \
    python3.11 \
    python3.11-devel \
    python3-pip \
    nodejs \
    npm \
    && dnf clean all

# Create symbolic links for python and pip
RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

# Create a Python virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install uv package installer and debugging tools
RUN pip install --no-cache-dir --upgrade pip uv debugpy

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
COPY ./frontend/config-overrides.js ./frontend/.env.local ./frontend/

# copy the test folder over as well. 
COPY test ./test

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

# Install uv in the final stage for testing
RUN pip install --no-cache-dir uv

# Copy backend code
COPY --from=builder /app/backend /app/backend
# Copy frontend build files
COPY --from=builder /app/frontend/build /app/ui2
# Copy test folder
COPY test ./test

# Set frontend build path environment variable
ENV FRONTEND_BUILD_PATH=/app/ui2

WORKDIR /app
EXPOSE 8000

# Use uvicorn to run the FastAPI app (remove --reload for production)
# Change to backend directory so imports work correctly
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
