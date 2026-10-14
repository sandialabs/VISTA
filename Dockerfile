# RHEL 9 / UBI 9 Minimal based production image
# Multi-stage build for optimized production image
# Container contract tests parse these named stages; keep the base, builder, and final aliases stable.
FROM registry.access.redhat.com/ubi9/ubi-minimal AS base

# Install Python 3.11, Node.js, and system dependencies
RUN microdnf install -y --nodocs \
    python3.11 \
    python3.11-pip \
    python3.11-devel \
    gcc \
    gcc-c++ \
    libpq-devel \
    git \
    wget \
    ca-certificates \
    nodejs \
    npm \
    atk \
    at-spi2-atk \
    alsa-lib \
    cups-libs \
    gtk3 \
    libX11-xcb \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXfixes \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    libdrm \
    libgbm \
    libxcb \
    pango \
    && microdnf clean all

# Create symlinks for python
RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

# Create a Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install uv package installer and debugging tools
RUN pip install --no-cache-dir --upgrade pip uv debugpy
RUN pip install --no-cache-dir ultralytics

WORKDIR /app

# Set Python environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

FROM base AS builder

# Install Python dependencies
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
RUN uv sync --frozen --no-dev --no-install-project --inexact

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
RUN npm ci --no-audit --no-fund
RUN npm run build
RUN ls -la build || echo "Build directory not found"

# Return to app directory
WORKDIR /app

# Final stage
FROM base AS final

ARG GITLAB_COMMIT_SHA=""

# Copy Python dependencies from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install uv in the final stage for testing
RUN pip install --no-cache-dir uv

# Copy pyproject.toml and lockfile (needed for installing dev deps in CI)
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

# Copy backend code
COPY --from=builder /app/backend /app/backend
# Download the bundled default checkpoints used by Analyze (public weights
# only; nothing is committed to the repository). yolo11n-seg.pt is fetched
# automatically by ultralytics on first use via YOLO_CONFIG_DIR, so only the
# SAM checkpoint needs an explicit download. No default Anomalib checkpoint
# ships; its public PatchCore-like fallback is dependency-free and has no
# pretrained weights to bundle.
RUN mkdir -p /app/checkpoints && \
    wget -q -O /app/checkpoints/sam_vit_b_01ec64.pth \
        https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
# Copy the only root test-tree asset needed at runtime by Project Data's built-in example loader.
COPY ./test/data /app/test/data
# Copy frontend build files
COPY --from=builder /app/frontend/build /app/ui2
# Set frontend build path environment variable
ENV FRONTEND_BUILD_PATH=/app/ui2
ENV GITLAB_COMMIT_SHA=$GITLAB_COMMIT_SHA
ENV VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME=false
ENV YOLO_CONFIG_DIR=/tmp/ultralytics

WORKDIR /app
EXPOSE 8000

# Apply the database schema before accepting requests, then replace the shell
# with uvicorn so container signals are delivered to the server process.
WORKDIR /app/backend
CMD ["bash", "/app/backend/scripts/start_production_server.sh"]
