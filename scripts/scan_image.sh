#!/usr/bin/env bash
# Scan a container image with Syft (SBOM) and Grype (vulnerabilities) and print a summary.
#
# Usage: scripts/scan_image.sh IMAGE [--out DIR] [--compare PREVIOUS_GRYPE_JSON]
#                              [--fail-on SEVERITY] [--keep-rootfs] [--verbose]
#
# The image's filesystem is exported and scanned as a directory. Syft refuses very large
# image archives (a decompression-bomb guard that the PyTorch layers trip), and a directory
# scan covers the same files, without per-layer attribution.
#
# Environment:
#   CONTAINER_RUNTIME  podman or docker (default: podman if installed, else docker)
#   SYFT_IMAGE         default docker.io/anchore/syft:latest
#   GRYPE_IMAGE        default docker.io/anchore/grype:latest
#   SCAN_CA_BUNDLE     PEM bundle for networks that inspect TLS; given to Grype for its database
#                      download. Verification is never disabled.
#   GRYPE_DB_DIR       vulnerability database cache (default ~/.cache/vista-scan/grype-db)
#
# Reports findings only: the exit status is 0 unless --fail-on is given and a finding at or
# above that severity (critical, high, medium, low) exists.

set -euo pipefail

IMAGE=""
OUT_DIR=""
COMPARE=""
FAIL_ON=""
KEEP_ROOTFS=false
VERBOSE=false

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    --compare) COMPARE="$2"; shift 2 ;;
    --fail-on) FAIL_ON="$2"; shift 2 ;;
    --keep-rootfs) KEEP_ROOTFS=true; shift ;;
    --verbose|-v) VERBOSE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) IMAGE="$1"; shift ;;
  esac
done

[[ -n "$IMAGE" ]] || { usage >&2; exit 2; }

RUNTIME="${CONTAINER_RUNTIME:-}"
if [[ -z "$RUNTIME" ]]; then
  if command -v podman >/dev/null 2>&1; then RUNTIME=podman; else RUNTIME=docker; fi
fi
SYFT_IMAGE="${SYFT_IMAGE:-docker.io/anchore/syft:latest}"
GRYPE_IMAGE="${GRYPE_IMAGE:-docker.io/anchore/grype:latest}"
GRYPE_DB_DIR="${GRYPE_DB_DIR:-$HOME/.cache/vista-scan/grype-db}"
OUT_DIR="${OUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/vista-scan.XXXXXX")}"
mkdir -p "$OUT_DIR" "$GRYPE_DB_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
ROOTFS="$OUT_DIR/rootfs"

log() { if [[ "$VERBOSE" == true ]]; then echo "$*" >&2; fi; }

log "Exporting the filesystem of $IMAGE"
rm -rf "$ROOTFS" && mkdir -p "$ROOTFS"
cid="$("$RUNTIME" create "$IMAGE")"
trap '"$RUNTIME" rm "$cid" >/dev/null 2>&1 || true' EXIT
"$RUNTIME" export "$cid" | tar -x --no-same-owner --no-same-permissions -C "$ROOTFS"
# Image directories can be read-only; keep the tree removable.
chmod -R u+rwX "$ROOTFS"

log "Generating the SBOM with Syft"
"$RUNTIME" run --rm -e SYFT_CHECK_FOR_APP_UPDATE=false \
  -v "$ROOTFS":/rootfs:ro -v "$OUT_DIR":/out "$SYFT_IMAGE" \
  dir:/rootfs -o spdx-json=/out/sbom.spdx.json -q

log "Scanning the SBOM with Grype"
grype_args=(--rm -e GRYPE_CHECK_FOR_APP_UPDATE=false -e GRYPE_DB_CACHE_DIR=/db
  -e HTTPS_PROXY -e HTTP_PROXY -e NO_PROXY
  -v "$GRYPE_DB_DIR":/db -v "$OUT_DIR":/out)
if [[ -n "${SCAN_CA_BUNDLE:-}" ]]; then
  grype_args+=(-e SSL_CERT_FILE=/etc/ssl/scan-ca.pem -v "$SCAN_CA_BUNDLE":/etc/ssl/scan-ca.pem:ro)
fi
"$RUNTIME" run "${grype_args[@]}" "$GRYPE_IMAGE" \
  sbom:/out/sbom.spdx.json -o json --file /out/grype.json -q

if [[ "$KEEP_ROOTFS" != true ]]; then chmod -R u+rwX "$ROOTFS" 2>/dev/null || true; rm -rf "$ROOTFS"; fi

python3 - "$OUT_DIR/grype.json" "$COMPARE" "$VERBOSE" "$FAIL_ON" <<'PY'
import collections, json, sys

path, compare, verbose, fail_on = sys.argv[1], sys.argv[2], sys.argv[3] == "true", sys.argv[4]
ORDER = ["Critical", "High", "Medium", "Low", "Negligible", "Unknown"]


def load(p):
    found = {}
    for match in json.load(open(p))["matches"]:
        vuln, art = match["vulnerability"], match["artifact"]
        fix = vuln.get("fix") or {}
        found[(vuln["id"], art["name"], art["version"])] = (
            vuln["severity"], art["type"], art["name"], fix.get("state"))
    return found


def counts(found):
    c = collections.Counter(v[0] for v in found.values())
    unfixed = sum(1 for v in found.values() if v[0] in ("Critical", "High") and v[3] != "fixed")
    return c, unfixed


now = load(path)
c, unfixed = counts(now)
line = "  ".join(f"{s}={c[s]}" for s in ORDER if c[s])
print(f"findings: {len(now)}  ({line})  unfixed Critical+High={unfixed}")
by_type = collections.Counter((v[1], v[0]) for v in now.values())
for t in sorted({k[0] for k in by_type}):
    print(f"  {t:10}", {s: by_type[(t, s)] for s in ORDER if by_type[(t, s)]})
if compare:
    pc, punfixed = counts(load(compare))
    print("vs previous:", "  ".join(f"{s}: {pc[s]} -> {c[s]}" for s in ("Critical", "High", "Medium", "Low")),
          f"| unfixed Critical+High: {punfixed} -> {unfixed}")
if verbose:
    worst = collections.Counter(v[2] for v in now.values() if v[0] in ("Critical", "High"))
    print("Critical+High by package:", ", ".join(f"{n} x{k}" for n, k in worst.most_common(15)))
if fail_on:
    limit = ORDER.index(fail_on.capitalize())
    if any(ORDER.index(v[0]) <= limit for v in now.values()):
        print(f"FAIL: a finding at or above {fail_on} exists")
        sys.exit(1)
PY
echo "reports: $OUT_DIR/grype.json $OUT_DIR/sbom.spdx.json"
