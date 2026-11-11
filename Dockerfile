# RHEL 9 / UBI 9 Minimal based production image
# Multi-stage build for optimized production image
# Container contract tests parse these named stages; keep the base, builder, and final aliases stable.
# The frontend is built in its own stage and only the compiled bundle ships: Node, npm and
# node_modules stay out of the runtime image. Pinned by digest (ubi9/nodejs-22:latest on
# 2026-11-05); the UI needs Node 20 or newer (react-router 7).
# ubi9/ubi-minimal:latest pinned by digest (2026-11-09 build). Bump both digests together to pick up
# base image fixes; the build's `microdnf upgrade` then applies the rest.
ARG UBI_MINIMAL=registry.access.redhat.com/ubi9/ubi-minimal@sha256:f26ef64172ea61f5ac5ba4be8c5c738bf8760b22b3e5148ce7b40f7308ab32db
ARG UBI_NODEJS=registry.access.redhat.com/ubi9/nodejs-22@sha256:18efae02a19cdfbda303ff98d096cfcc2e123f300aff146e7dab1e75b9116dec

FROM ${UBI_MINIMAL} AS base

# Runtime base: Python 3.11 and CA certificates only. Compilers, headers, git, wget and the
# GTK/X11/browser libraries are deliberately absent. Every dependency installs from a prebuilt
# wheel (psycopg2-binary bundles its own libpq), and nothing in the image launches a browser.
# Keep this list minimal: the final stage inherits everything installed here, and each extra OS
# package adds image scan findings. test_container_build_config.py guards the denylist.
# Weak dependencies are skipped: since glibc 2.34-290.el9_9 the upgrade otherwise adds
# glibc-langpack-en and gawk-all-langpacks (Supplements only, nothing requires them).
RUN microdnf upgrade -y --nodocs --setopt=install_weak_deps=0 && \
    microdnf install -y --nodocs --setopt=install_weak_deps=0 \
    python3.11 \
    ca-certificates \
    && microdnf clean all

# Create symlinks for python
RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

# The virtual environment is created and filled in the builder stage and copied into final.
# The runtime image carries no pip, setuptools seed or uv.
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Set Python environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ---- ui: the React build. Only /app/frontend/build is copied out of this stage. ----
FROM ${UBI_NODEJS} AS ui
USER 0
WORKDIR /app/frontend
# Copy package.json and package-lock.json first for better caching
COPY ./frontend/package.json ./frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Copy frontend source and the Vite build config (not node_modules)
COPY ./frontend/index.html ./frontend/vite.config.mjs ./
COPY ./frontend/public ./public
COPY ./frontend/src ./src
RUN npm run build

# ---- checkpoints: public default weights, verified by SHA-256. Only the files are copied out. ----
FROM ${UBI_MINIMAL} AS checkpoints
ARG SAM_VIT_B_SHA256=ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912
ARG YOLO11N_SEG_SHA256=55ed65c56c91713d23e8402371c6c49a6fd84f257f7dce452e8d70e41dcbe152
RUN mkdir -p /checkpoints && \
    curl -fsSL -o /checkpoints/sam_vit_b_01ec64.pth \
        https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth && \
    echo "${SAM_VIT_B_SHA256}  /checkpoints/sam_vit_b_01ec64.pth" | sha256sum -c - && \
    curl -fsSL -o /checkpoints/yolo11n-seg.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-seg.pt && \
    echo "${YOLO11N_SEG_SHA256}  /checkpoints/yolo11n-seg.pt" | sha256sum -c -

FROM base AS builder

# pip and uv exist only in this stage. The venv is seedless (no pip or setuptools of its own),
# so the OS-packaged setuptools never lands in /opt/venv; uv installs the locked versions.
RUN microdnf install -y --nodocs python3.11-pip && microdnf clean all && \
    python3.11 -m pip install --no-cache-dir uv && \
    uv venv --python /usr/bin/python3.11 /opt/venv

# Install Python dependencies
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
RUN uv sync --frozen --no-dev --no-install-project --inexact

# OpenCV without FFmpeg. The opencv-python-headless wheels on PyPI bundle FFmpeg
# libraries (and OpenSSL 1.1.1k) that accumulate unpatched CVEs, and VISTA never decodes
# video with cv2, so replace the PyPI wheel with the prebuilt FFmpeg-free wheel in
# vendor/opencv, compiled from the hash-pinned PyPI source distribution with FFmpeg
# disabled. The install is offline and hash-pinned. Video writing and decoding through
# cv2 is unavailable in this image by design. vendor/opencv/MANIFEST.md says how the
# wheel was built and how to rebuild it; its version must equal the opencv-python-headless
# version in uv.lock (backend/tests/test_container_build_config.py enforces it).
# The final stage verifies that nothing FFmpeg-related ships.
COPY vendor/opencv/requirements-opencv-prebuilt.txt vendor/opencv/opencv_python_headless-*.whl /tmp/opencv-wheels/
RUN uv pip uninstall --python /opt/venv/bin/python opencv-python-headless && \
    uv pip install --python /opt/venv/bin/python --no-index --find-links /tmp/opencv-wheels \
        --require-hashes --no-deps --no-cache -r /tmp/opencv-wheels/requirements-opencv-prebuilt.txt && \
    rm -rf /tmp/opencv-wheels

# Copy backend code
COPY ./backend /app/backend
# COPY .env /app/.env
WORKDIR /app

# Final stage
FROM base AS final

ARG GITLAB_COMMIT_SHA=""

# Copy Python dependencies from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Fail the build if the shipped environment contains FFmpeg in any form: a cv2
# built with it, an FFmpeg library, or a PyPI OpenCV distribution (all of which
# bundle FFmpeg) next to the FFmpeg-free wheel.
RUN python -c "import cv2; assert 'FFMPEG' not in cv2.getBuildInformation(), 'cv2 was built with FFmpeg'" && \
    ! find /opt/venv \( -name 'libavcodec*' -o -name 'libavformat*' -o -name 'libavutil*' \
        -o -name 'libswscale*' -o -name 'libswresample*' -o -name 'opencv_python.libs' \
        -o -name 'opencv_python-*.dist-info' -o -name 'opencv_python_headless.libs' \) | grep -q .

# Copy backend code
COPY --from=builder /app/backend /app/backend
# Bundled default checkpoints used by Analyze (public weights only; nothing is committed to
# the repository). Both come from the checkpoints stage, verified by SHA-256. yolo11n-seg.pt is
# bundled, not downloaded at first use, because the unprivileged runtime user cannot write to
# the working directory where ultralytics would save a download; the symlink below lets the
# bare model name resolve from /app/backend. No default Anomalib checkpoint ships; its public
# PatchCore-like fallback is dependency-free and has no pretrained weights to bundle.
COPY --from=checkpoints /checkpoints /app/checkpoints
RUN ln -sf /app/checkpoints/yolo11n-seg.pt /app/backend/yolo11n-seg.pt
# Copy the only root test-tree asset needed at runtime by Project Data's built-in example loader.
COPY ./test/data /app/test/data
# Copy frontend build files
COPY --from=ui /app/frontend/build /app/ui2
# Set frontend build path environment variable
ENV FRONTEND_BUILD_PATH=/app/ui2
ENV GITLAB_COMMIT_SHA=$GITLAB_COMMIT_SHA
ENV VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME=false
ENV YOLO_CONFIG_DIR=/tmp/ultralytics

# Run as an unprivileged user. The code, venv and checkpoints stay root-owned and read-only;
# only the runtime state directories below are writable. Group 0 gets the same access so an
# arbitrary UID assigned by OpenShift (always in group 0) works too. ubi-minimal has no
# useradd, so the account is added directly.
ENV HOME=/home/vista \
    CACHE_DIR=/var/cache/vista
RUN echo "vista:x:10001:" >> /etc/group && \
    echo "vista:x:10001:10001:vista:/home/vista:/sbin/nologin" >> /etc/passwd && \
    mkdir -p /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp && \
    chown -R 10001:0 /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp && \
    chmod -R g=u /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp
USER 10001

WORKDIR /app
EXPOSE 8000

# Apply the database schema before accepting requests, then replace the shell
# with uvicorn so container signals are delivered to the server process.
WORKDIR /app/backend
CMD ["bash", "/app/backend/scripts/start_production_server.sh"]

# ---- test: final plus uv and the project files, so CI can install dev dependencies and run the
# suites inside the image. Never shipped. Build it with --target test. ----
FROM final AS test
# CI installs dev dependencies into /opt/venv, which only root can write.
USER 0
COPY --from=builder /usr/local/bin/uv /usr/local/bin/uv
COPY pyproject.toml uv.lock /app/
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

# ---- release: the default build target, identical to final. Keeping it last means a plain
# `docker build .` produces the production image and never the test image. ----
FROM final AS release
