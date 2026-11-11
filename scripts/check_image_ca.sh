#!/usr/bin/env bash
# Confirm that an image contains no trace of a CA certificate that was used during its build.
#
# Usage: scripts/check_image_ca.sh IMAGE CA_FILE [--verbose]
#
# Streams the image filesystem (never written to disk) and searches every file for each
# certificate in CA_FILE: its PEM body lines and a slice of its DER encoding (which catches
# binary trust stores). The image config and history are searched too. A certificate that is
# also a public root shipped in the stock CA bundle is reported as such, not as a leak.
# Exit status: 0 when absent, 1 when found, 2 on usage errors.

set -euo pipefail

IMAGE="${1:-}"
CA_FILE="${2:-}"
VERBOSE="${3:-}"
if [[ -z "$IMAGE" || -z "$CA_FILE" || "$IMAGE" == -h || "$IMAGE" == --help ]]; then
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  [[ "$IMAGE" == -h || "$IMAGE" == --help ]] && exit 0 || exit 2
fi
[[ -r "$CA_FILE" ]] || { echo "CA file is not readable: $CA_FILE" >&2; exit 2; }

RUNTIME="${CONTAINER_RUNTIME:-}"
if [[ -z "$RUNTIME" ]]; then
  if command -v podman >/dev/null 2>&1; then RUNTIME=podman; else RUNTIME=docker; fi
fi

cid="$("$RUNTIME" create --entrypoint "" "$IMAGE" /ca-check-placeholder)"
trap '"$RUNTIME" rm "$cid" >/dev/null 2>&1 || true' EXIT
meta="$(mktemp)"
trap '"$RUNTIME" rm "$cid" >/dev/null 2>&1 || true; rm -f "$meta"' EXIT
{ "$RUNTIME" image inspect "$IMAGE"; "$RUNTIME" history --no-trunc "$IMAGE"; } >"$meta"

"$RUNTIME" export "$cid" | python3 -I -c '
import base64, re, sys, tarfile

ca_file, meta_file, verbose = sys.argv[1], sys.argv[2], sys.argv[3] == "--verbose"
pem = open(ca_file, encoding="ascii", errors="ignore").read()
certs = re.findall(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", pem, re.S)
needles = []  # (cert index, bytes)
for index, body in enumerate(certs):
    lines = [ln.strip() for ln in body.strip().splitlines() if ln.strip()]
    der = base64.b64decode("".join(lines))
    for line in lines[1:-1]:
        if len(line) >= 64:
            needles.append((index, line.encode()))
    middle = len(der) // 2
    needles.append((index, der[middle - 32 : middle + 32]))
if not needles:
    sys.exit("no certificates found in " + ca_file)

longest = max(len(n) for _i, n in needles)
hits = {}
def scan(name, stream):
    tail = b""
    while True:
        chunk = stream.read(1 << 20)
        if not chunk:
            return
        data = tail + chunk
        for index, needle in needles:
            if needle in data:
                hits.setdefault(index, set()).add(name)
        tail = data[-longest:]

with open(meta_file, "rb") as handle:
    scan("<image config and history>", handle)
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as archive:
    for member in archive:
        if member.isfile():
            scan(member.name, archive.extractfile(member))

stock = ("etc/pki/ca-trust/extracted", "etc/pki/tls/certs", "usr/share/pki/ca-trust-source")
leaks = {i: sorted(p for p in paths if not p.startswith(stock)) for i, paths in hits.items()}
public = sorted(i for i, paths in hits.items() if not leaks[i])
leaked = {i: paths for i, paths in leaks.items() if paths}
for i in public:
    print(f"note: certificate {i + 1} is a public root already in the stock CA bundle")
if leaked:
    for i, paths in leaked.items():
        shown = paths if verbose else paths[:5]
        print(f"FAIL: certificate {i + 1} found in: " + ", ".join(shown))
    sys.exit(1)
print(f"ok: extra CA ({len(certs)} certificate(s)) absent from the image")
' "$CA_FILE" "$meta" "$VERBOSE"
