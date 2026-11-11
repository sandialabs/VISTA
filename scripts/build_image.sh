#!/usr/bin/env bash
# Build the production (or test) image, optionally trusting a proxy CA during the build.
#
# Usage: scripts/build_image.sh [--target release|test] [--tag TAG] [--verbose]
#
# Environment:
#   VISTA_EXTRA_CA_FILE  PEM file with an extra CA (for networks that inspect TLS). It is
#                        passed as the build secret `extra_ca`, used only by the download
#                        steps, and never written to the build context, an image layer or
#                        git. It must live outside the repository. TLS is never disabled.
#   CONTAINER_RUNTIME    podman or docker (default: podman if installed, else docker)
#   OS_REFRESH           value that re-runs the root filesystem install (default: ISO week)
#
# After a build that used a CA, scripts/check_image_ca.sh confirms the CA is absent from
# the image. Output is one result line; --verbose streams the build log.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="release"
TAG=""
VERBOSE=false

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --verbose|-v) VERBOSE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$TARGET" in release|test) ;; *) echo "--target must be release or test" >&2; exit 2 ;; esac
TAG="${TAG:-vista:$([[ "$TARGET" == test ]] && echo test || echo latest)}"

RUNTIME="${CONTAINER_RUNTIME:-}"
if [[ -z "$RUNTIME" ]]; then
  if command -v podman >/dev/null 2>&1; then RUNTIME=podman; else RUNTIME=docker; fi
fi
OS_REFRESH="${OS_REFRESH:-$(date -u +%G-W%V)}"

args=(build --target "$TARGET" -t "$TAG" --build-arg "OS_REFRESH=$OS_REFRESH")
CA_FILE="${VISTA_EXTRA_CA_FILE:-}"
if [[ -n "$CA_FILE" ]]; then
  [[ -r "$CA_FILE" ]] || { echo "VISTA_EXTRA_CA_FILE is not readable: $CA_FILE" >&2; exit 2; }
  grep -q "BEGIN CERTIFICATE" "$CA_FILE" ||
    { echo "VISTA_EXTRA_CA_FILE has no PEM certificate: $CA_FILE" >&2; exit 2; }
  ca_real="$(realpath "$CA_FILE")"
  if [[ "$ca_real" == "$REPO_ROOT"/* ]]; then
    echo "VISTA_EXTRA_CA_FILE must live outside the repository: $ca_real" >&2
    exit 2
  fi
  args+=(--secret "id=extra_ca,src=$ca_real")
fi
args+=("$REPO_ROOT")

start=$(date +%s)
if [[ "$VERBOSE" == true ]]; then
  "$RUNTIME" "${args[@]}"
else
  log="$(mktemp "${TMPDIR:-/tmp}/vista-build.XXXXXX.log")"
  if ! "$RUNTIME" "${args[@]}" >"$log" 2>&1; then
    echo "FAIL: $TAG ($TARGET) did not build; last lines of $log:" >&2
    tail -n 40 "$log" >&2
    exit 1
  fi
  rm -f "$log"
fi
echo "built: $TAG ($TARGET) in $(( $(date +%s) - start ))s${CA_FILE:+, extra CA used}"

if [[ -n "$CA_FILE" ]]; then
  CONTAINER_RUNTIME="$RUNTIME" "$REPO_ROOT/scripts/check_image_ca.sh" "$TAG" "$CA_FILE"
fi
