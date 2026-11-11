# Production image: a minimal UBI 9 root filesystem (no package manager) plus a hash-pinned
# CPython 3.14 from python-build-standalone, so the runtime carries neither the RHEL python3.11
# RPM's krb5/sqlite/expat dependencies nor the microdnf stack.
# Container contract tests parse these named stages; keep the rootfs, python, base, builder,
# final, test and release aliases stable.
#
# Pins (bump deliberately; test_container_build_config.py checks their form):
#   UBI         ubi9/ubi:latest 2026-11-11, builds the root filesystem and unpacks Python
#   UBI_MINIMAL ubi9/ubi-minimal:latest 2026-11-09, checkpoints and builder stages
#   UBI_NODEJS  ubi9/nodejs-22:latest 2026-11-05, the UI build (react-router 7 needs Node 20+)
#   UV_IMAGE    ghcr.io/astral-sh/uv 0.13.7, the uv binary for the builder and test stages
# Compare a tag's build-date label with the pinned image before bumping: a tag can point at an
# older build than the pin. OS_REFRESH (CI passes the ISO week) re-runs the rootfs install so
# base package fixes land even when every other layer is cached.
#
# Optional build secret extra_ca: a proxy CA for networks that inspect TLS
# (scripts/build_image.sh passes it from VISTA_EXTRA_CA_FILE). Only the download steps of the
# python, checkpoints, ui and builder stages mount it; it is combined with the system bundle in
# a tmpfs, never written to a layer, and TLS verification is never disabled. Without the
# secret (CI) the build is unchanged.
ARG UBI=registry.access.redhat.com/ubi9/ubi@sha256:8b212f75a0e5a156ac28b1c5c030d2e8a07715254e19d522286118279399af81
ARG UBI_MINIMAL=registry.access.redhat.com/ubi9/ubi-minimal@sha256:f26ef64172ea61f5ac5ba4be8c5c738bf8760b22b3e5148ce7b40f7308ab32db
ARG UBI_NODEJS=registry.access.redhat.com/ubi9/nodejs-22@sha256:18efae02a19cdfbda303ff98d096cfcc2e123f300aff146e7dab1e75b9116dec
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490

# ---- rootfs: the runtime operating system, installed into an empty root. ----
# Only glibc, bash, coreutils, the C++ runtime, zlib, CA certificates and tzdata, plus their
# hard requirements (weak dependencies off). The wheels need nothing else: everything Python's
# stdlib links (OpenSSL, SQLite, expat, ...) is inside the python-build-standalone build.
FROM ${UBI} AS rootfs
ARG OS_REFRESH=""
RUN echo "OS refresh: ${OS_REFRESH:-none}" && \
    dnf install -y --installroot=/rootfs --releasever=9 --nodocs \
        --config=/etc/dnf/dnf.conf --setopt=reposdir=/etc/yum.repos.d \
        --disablerepo='*' --enablerepo=ubi-9-baseos-rpms --enablerepo=ubi-9-appstream-rpms \
        --setopt=install_weak_deps=0 \
        glibc glibc-minimal-langpack bash coreutils-single libstdc++ libgcc zlib \
        ca-certificates tzdata && \
    dnf --installroot=/rootfs clean all && \
    rm -rf /rootfs/var/cache/dnf /rootfs/var/lib/dnf /rootfs/var/log/dnf* /rootfs/var/log/hawkey.log && \
    for denied in krb5-libs sqlite-libs expat json-glib libblkid libmount libsmartcols libuuid \
        util-linux python3 python3-libs python3.11 python3.11-libs rpm dnf microdnf libdnf; do \
      if rpm --root=/rootfs -q --quiet "$denied"; then echo "denied package in rootfs: $denied"; exit 1; fi; \
    done && \
    test -s /rootfs/etc/pki/tls/certs/ca-bundle.crt && test -e /rootfs/etc/os-release && \
    test -f /rootfs/var/lib/rpm/rpmdb.sqlite && test -x /rootfs/usr/sbin/ldconfig && \
    mkdir -p /rootfs/etc/ssl && ln -sf /etc/pki/tls/certs/ca-bundle.crt /rootfs/etc/ssl/cert.pem && \
    ln -sf /opt/python/bin/python3.14 /rootfs/usr/bin/python3 && \
    ln -sf /opt/python/bin/python3.14 /rootfs/usr/bin/python && \
    ldconfig -r /rootfs

# ---- python: CPython from python-build-standalone, verified by SHA-256. ----
# OpenSSL, SQLite, expat and the other stdlib libraries are statically linked, so image
# scanners cannot see them: bump PBS_RELEASE when CPython, OpenSSL, SQLite or expat publish a
# security release (scripts/scan_image.sh prints the bundled versions). pip, ensurepip, IDLE
# and Tcl/Tk are removed; the runtime has no package installer.
FROM ${UBI} AS python
ARG PBS_RELEASE=20261110
ARG PBS_PYTHON=3.14.10
ARG PBS_SHA256=c2ff2e97422f5d3896a16e0317fd212ba977bbf2688d93a6f7a03d817506bd30
RUN --mount=type=secret,id=extra_ca --mount=type=tmpfs,target=/run/ca \
    if [ -s /run/secrets/extra_ca ]; then \
      cat /etc/pki/tls/certs/ca-bundle.crt /run/secrets/extra_ca > /run/ca/bundle.pem && \
      export CURL_CA_BUNDLE=/run/ca/bundle.pem; \
    fi && \
    curl -fsSL -o /tmp/python.tar.gz \
        "https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PBS_PYTHON}%2B${PBS_RELEASE}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz" && \
    echo "${PBS_SHA256}  /tmp/python.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/python.tar.gz -C /opt && rm /tmp/python.tar.gz && \
    cd /opt/python && \
    rm -rf bin/pip* bin/idle* bin/pydoc* bin/2to3* \
        lib/python3.14/site-packages/pip* lib/python3.14/ensurepip lib/python3.14/idlelib \
        lib/python3.14/tkinter lib/python3.14/turtledemo lib/python3.14/turtle.py \
        lib/python3.14/lib-dynload/_tkinter* lib/libtcl* lib/libtk* lib/tcl* lib/tk* lib/itcl* \
        lib/thread* && \
    /opt/python/bin/python3.14 -I -c "import sys, ssl, sqlite3, pyexpat; \
print('bundled:', sys.version.split()[0], ssl.OPENSSL_VERSION, 'SQLite', sqlite3.sqlite_version, pyexpat.EXPAT_VERSION)"

# ---- base: the runtime root filesystem and Python. No RUN: there is no package manager. ----
FROM scratch AS base
COPY --from=rootfs /rootfs /
COPY --from=python /opt/python /opt/python
# scratch has no PATH; set it in full so bash and coreutils resolve and the working directory
# is never on it.
ENV PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    SSL_CERT_FILE=/etc/pki/tls/certs/ca-bundle.crt \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

# ---- ui: the React build. Only /app/frontend/build is copied out of this stage. ----
FROM ${UBI_NODEJS} AS ui
USER 0
WORKDIR /app/frontend
# Copy package.json and package-lock.json first for better caching
COPY ./frontend/package.json ./frontend/package-lock.json ./
RUN --mount=type=secret,id=extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi && \
    npm ci --no-audit --no-fund
# Copy frontend source and the Vite build config (not node_modules)
COPY ./frontend/index.html ./frontend/vite.config.mjs ./
COPY ./frontend/public ./public
COPY ./frontend/src ./src
RUN npm run build

# ---- checkpoints: public default weights, verified by SHA-256. Only the files are copied out. ----
FROM ${UBI_MINIMAL} AS checkpoints
ARG SAM_VIT_B_SHA256=ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912
ARG YOLO11N_SEG_SHA256=55ed65c56c91713d23e8402371c6c49a6fd84f257f7dce452e8d70e41dcbe152
RUN --mount=type=secret,id=extra_ca --mount=type=tmpfs,target=/run/ca \
    if [ -s /run/secrets/extra_ca ]; then \
      cat /etc/pki/tls/certs/ca-bundle.crt /run/secrets/extra_ca > /run/ca/bundle.pem && \
      export CURL_CA_BUNDLE=/run/ca/bundle.pem; \
    fi && \
    mkdir -p /checkpoints && \
    curl -fsSL -o /checkpoints/sam_vit_b_01ec64.pth \
        https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth && \
    echo "${SAM_VIT_B_SHA256}  /checkpoints/sam_vit_b_01ec64.pth" | sha256sum -c - && \
    curl -fsSL -o /checkpoints/yolo11n-seg.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-seg.pt && \
    echo "${YOLO11N_SEG_SHA256}  /checkpoints/yolo11n-seg.pt" | sha256sum -c -

# ---- uv: only its static binary is copied out. ----
FROM ${UV_IMAGE} AS uv

# ---- builder: fills /opt/venv from the lockfile. uv exists only here and in test. ----
# /opt/python sits at the same path as in base, so the venv's interpreter link stays valid
# when /opt/venv is copied into final. Every dependency is a prebuilt wheel except FrEIA
# (an anomalib requirement published only as a source distribution; pure Python, hash-pinned
# in uv.lock), which uv builds here. The stage has no compiler, so nothing native is built.
FROM ${UBI_MINIMAL} AS builder
COPY --from=uv /uv /usr/local/bin/uv
COPY --from=python /opt/python /opt/python
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
RUN uv venv --python /opt/python/bin/python3.14 /opt/venv
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=extra_ca --mount=type=tmpfs,target=/run/ca \
    --mount=type=cache,target=/root/.cache/uv \
    if [ -s /run/secrets/extra_ca ]; then \
      cat /etc/pki/tls/certs/ca-bundle.crt /run/secrets/extra_ca > /run/ca/bundle.pem && \
      export SSL_CERT_FILE=/run/ca/bundle.pem; \
    fi && \
    uv sync --frozen --no-dev --no-install-project --inexact

# OpenCV without FFmpeg. The opencv-python-headless wheels on PyPI bundle FFmpeg
# libraries (and OpenSSL 1.1.1k) that accumulate unpatched CVEs, and VISTA never decodes
# video with cv2, so replace the PyPI wheel with the prebuilt FFmpeg-free wheel in
# vendor/opencv, compiled from the hash-pinned PyPI source distribution with FFmpeg
# disabled (limited API, tagged cp311-abi3, so it loads on 3.14). The install is offline and
# hash-pinned. Video writing and decoding through cv2 is unavailable in this image by design.
# vendor/opencv/MANIFEST.md says how the wheel was built and how to rebuild it; its version
# must equal the opencv-python-headless version in uv.lock
# (backend/tests/test_container_build_config.py enforces it).
# The final stage verifies that nothing FFmpeg-related ships.
COPY vendor/opencv/requirements-opencv-prebuilt.txt vendor/opencv/opencv_python_headless-*.whl /tmp/opencv-wheels/
RUN uv pip uninstall --python /opt/venv/bin/python opencv-python-headless && \
    uv pip install --python /opt/venv/bin/python --no-index --find-links /tmp/opencv-wheels \
        --require-hashes --no-deps --no-cache -r /tmp/opencv-wheels/requirements-opencv-prebuilt.txt && \
    rm -rf /tmp/opencv-wheels

# Copy backend code
COPY ./backend /app/backend

# Final stage
FROM base AS final

ARG GITLAB_COMMIT_SHA=""

# Copy Python dependencies from builder
COPY --from=builder /opt/venv /opt/venv

# Fail the build if the shipped environment contains FFmpeg in any form (a cv2 built with it,
# an FFmpeg library, or a PyPI OpenCV distribution, all of which bundle FFmpeg), if Python
# cannot load the CA bundle, or if a native runtime fails to import. Plain Python, no shell tools.
RUN YOLO_CONFIG_DIR=/tmp/build-ultralytics python -I -c "\
import cv2, pathlib, ssl; \
assert 'FFMPEG' not in cv2.getBuildInformation(), 'cv2 was built with FFmpeg'; \
bad = [str(p) for p in pathlib.Path('/opt/venv').rglob('*') if p.name.startswith(( \
    'libavcodec', 'libavformat', 'libavutil', 'libswscale', 'libswresample', \
    'opencv_python.libs', 'opencv_python-', 'opencv_python_headless.libs'))]; \
assert not bad, bad; \
assert ssl.create_default_context().cert_store_stats()['x509_ca'] > 0, 'no CA certificates'; \
import torch, ultralytics, segment_anything, anomalib.models" && \
    rm -rf /tmp/build-ultralytics

# Copy backend code
COPY --from=builder /app/backend /app/backend
# Bundled default checkpoints used by Analyze (public weights only; nothing is committed to
# the repository). Both come from the checkpoints stage, verified by SHA-256. yolo11n-seg.pt is
# bundled, not downloaded at first use, because the unprivileged runtime user cannot write to
# the working directory where ultralytics would save a download; the symlink below lets the
# bare model name resolve from /app/backend. No default Anomalib checkpoint ships: untrained
# requests use the dependency-free PatchCore-like scorer, and trained checkpoints are uploaded.
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
# Load YOLO checkpoints with torch weights_only=True plus ultralytics' allowlist of model
# classes, instead of a full unpickle: an uploaded .pt cannot run code. (Anomalib checkpoints
# load with weights_only=True too, and torch's default covers SAM.)
ENV ULTRALYTICS_SAFE_LOAD=1

# Run as an unprivileged user. The code, venv and checkpoints stay root-owned and read-only;
# only the runtime state directories below are writable. Group 0 gets the same access so an
# arbitrary UID assigned by OpenShift (always in group 0) works too. The root filesystem has
# no useradd (and no /sbin/nologin), so the account is added directly with /usr/bin/false as
# its shell. A GPU is used when the container runtime passes one in (for example
# `podman run --device nvidia.com/gpu=all`); ldconfig is present for the NVIDIA hook.
ENV HOME=/home/vista \
    CACHE_DIR=/var/cache/vista
RUN echo "vista:x:10001:" >> /etc/group && \
    echo "vista:x:10001:10001:vista:/home/vista:/usr/bin/false" >> /etc/passwd && \
    mkdir -p /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp && \
    chown -R 10001:0 /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp && \
    chmod -R g=u /home/vista /var/cache/vista /app/backend/logs /app/backend/tmp && \
    chmod 1777 /tmp
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
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never

# ---- release: the default build target, identical to final. Keeping it last means a plain
# `docker build .` produces the production image and never the test image. ----
FROM final AS release
