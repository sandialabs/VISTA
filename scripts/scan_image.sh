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
# The repository's .grype.yaml (verified false positives only) is applied, and the number of
# matches it ignored is printed. Bundled library versions in /opt/python are printed too.
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
# The container is only exported, never started, so a placeholder command lets images
# without a CMD (such as a FROM scratch base stage) be scanned too.
cid="$("$RUNTIME" create --entrypoint "" "$IMAGE" /scan-placeholder)"
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
# Verified false positives are suppressed by the repository's .grype.yaml (each rule
# documents why); the summary below reports how many matches it ignored.
GRYPE_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.grype.yaml"
config_args=()
if [[ -f "$GRYPE_CONFIG" ]]; then
  grype_args+=(-v "$GRYPE_CONFIG":/etc/vista-grype.yaml:ro)
  config_args=(--config /etc/vista-grype.yaml)
fi
"$RUNTIME" run "${grype_args[@]}" "$GRYPE_IMAGE" "${config_args[@]}" \
  sbom:/out/sbom.spdx.json -o json --file /out/grype.json -q

# python-build-standalone links OpenSSL, SQLite and expat statically, so Syft cannot see
# them. Ask the image's own Python for their versions (in a throwaway container without
# network) so a stale bundle is noticed; bumping PBS_RELEASE is how they get patched.
if [[ -x "$ROOTFS/opt/python/bin/python3" ]]; then
  "$RUNTIME" run --rm --network none --entrypoint /opt/python/bin/python3 "$IMAGE" -I -c \
    "import sys, ssl, sqlite3, pyexpat, zlib; print('bundled in /opt/python (invisible to scanners): CPython', sys.version.split()[0] + ',', ssl.OPENSSL_VERSION + ', SQLite', sqlite3.sqlite_version + ',', pyexpat.EXPAT_VERSION + ', zlib', zlib.ZLIB_RUNTIME_VERSION)" \
    2>/dev/null || echo "bundled versions: could not run /opt/python/bin/python3 in $IMAGE"
fi

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
ignored = json.load(open(path)).get("ignoredMatches") or []
if ignored:
    names = collections.Counter(m["artifact"]["name"] for m in ignored)
    print(f"  ignored by .grype.yaml (verified false positives): {len(ignored)}",
          "(" + ", ".join(f"{n} x{k}" for n, k in names.most_common()) + ")")
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
