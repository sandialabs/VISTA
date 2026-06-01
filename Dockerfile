# RHEL 9 / UBI 9 Minimal based production image
# Multi-stage build for optimized production image
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

WORKDIR /app

# Set Python environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

FROM base AS builder

# Install Python dependencies
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
RUN uv sync --frozen --no-dev --no-install-project

# Copy backend code
COPY ./backend /app/backend
COPY ./test_toolbox /app/test_toolbox
# COPY .env /app/.env

# Copy frontend files selectively (excluding node_modules)
WORKDIR /app
# Copy package.json and package-lock.json first for better caching
COPY ./frontend/package.json ./frontend/package-lock.json ./frontend/
# Copy frontend source and config files
COPY ./frontend/public ./frontend/public
COPY ./frontend/src ./frontend/src
COPY ./frontend/config-overrides.js ./frontend/

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

# Copy pyproject.toml and lockfile (needed for installing dev deps in CI)
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

# Copy backend code
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/test_toolbox /app/test_toolbox
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
