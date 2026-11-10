# opencv-python-headless 5.0.0.93, built without FFmpeg

Prebuilt wheel of the OpenCV the VISTA lockfile pins, compiled from the PyPI source
distribution with `-DWITH_FFMPEG=OFF`, so it ships no FFmpeg, libvpx, libaom, libavif or
OpenSSL. The production `Dockerfile` installs it offline and hash-pinned instead of compiling
OpenCV on every image build. Built 2026-11-10 with the recipe in `Dockerfile.build` (the
`opencv-build` stage the production Dockerfile used to carry, plus a configurable job count
`OPENCV_JOBS`, 10 for this build instead of `nproc`, which does not change the output).

## The artifact

| | |
|---|---|
| File | `opencv_python_headless-5.0.0.93-cp311-cp311-linux_x86_64.whl` (33,536,079 bytes) |
| SHA-256 | `800d33f83bd70d2fe1e8c256572422da60860358cbd2dd51cd3b78b0c9a22723` |
| Target | CPython 3.11, linux x86_64, glibc 2.34 or newer (built and tested on UBI 9.8) |
| Source | `opencv_python_headless-5.0.0.93.tar.gz`, SHA-256 `b82f9831daab90b725c7c1ee1b36cb5732c367096ac76d119e64e14eb70d5f3c` (pinned in `Dockerfile`, checked with `--require-hashes`) |
| CMake args | `-DWITH_FFMPEG=OFF` (the stage's only setting), with `ENABLE_HEADLESS=1` |
| Base image | `registry.access.redhat.com/ubi9/ubi-minimal@sha256:c4c285d42941ebb2bd4da878479008e1e4536bb599aad1dbe568f89de9053661` |
| Toolchain | gcc-toolset-13 13.3.1, binutils 2.40, cmake 3.31.8, make 4.3, python3.11 3.11.13, pip 22.3.1 |

The production `Dockerfile` consumes it with `requirements-opencv-prebuilt.txt`:

    uv pip install --no-index --find-links <dir> --require-hashes --no-deps -r requirements-opencv-prebuilt.txt
    pip install   --no-index --find-links <dir> --require-hashes --no-deps -r requirements-opencv-prebuilt.txt

A wrong hash is rejected (tested).

## What was verified

- The wheel holds one native module, `cv2/cv2.abi3.so` (83 MB), and no `*.libs/` directory. No libav*, libsw*,
  libvpx, libaom, libavif, libdav1d, libssl or libcrypto files.
- The module's dynamic dependencies are only libstdc++, libm, libgcc_s and libc. It has no libavcodec/libavformat
  references and no reference to a `libopencv_videoio_ffmpeg` plugin, so a stray plugin file cannot enable FFmpeg.
- Functional test (a script that was run once, not kept), run on the host (Python 3.11.15, numpy 2.4.6) and on UBI 9.8
  (Python 3.11.13, glibc 2.34): imwrite/imread round trips for png, jpg, tif, webp, bmp; resize, cvtColor,
  threshold, connectedComponents, watershed, drawing. All pass.
- Video is unavailable by design: an MP4 written with the stock PyPI wheel opens and reads in the stock wheel,
  and does not open in this wheel on any backend. `VideoWriter` (mp4v) does not open.
- `cv2.videoio_registry` still lists FFMPEG among known backend names. That is OpenCV's static name table for
  plugin-capable backends and not a working backend; the open test above is the evidence.

## Limits and caveats

- Image codecs are compiled into `cv2.abi3.so` from OpenCV's bundled sources (libpng, libjpeg, libtiff, libwebp,
  openjpeg, zlib), because the stage only turns FFmpeg off. They are invisible to image scanners. Linking them
  to distro RPMs (`-DBUILD_PNG=OFF` and so on, with the -devel packages) is a separate, larger change.
- Not bit-for-bit reproducible: the base image tag floats (pinned here by digest only for record), and `pip wheel`
  fetches its build requirements (cmake, numpy, scikit-build, setuptools) unpinned at build time. Identify the
  artifact by its SHA-256, and rebuild only when OpenCV is bumped.
- Python 3.11 only (cp311 wheel), linux x86_64 only. An OpenCV bump in `uv.lock` needs a rebuild and a new hash:
  `backend/tests/test_container_build_config.py` fails if the wheel, its requirements line, `SHA256SUMS` and
  `uv.lock` disagree.
- A 33 MB binary lives in git history. Each rebuild adds another 33 MB; consider an artifact registry if that grows.
- The wheel was not signed or attested, and it was not scanned by Syft/Grype/Trivy as an image layer.
