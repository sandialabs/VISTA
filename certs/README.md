# Extra CA certificates (local only)

Certificates placed here are added to the trust store of the development
container images built from `Dockerfile.dev`. This is needed on networks that
perform TLS inspection (for example Zscaler), where builds otherwise fail with
`CERTIFICATE_VERIFY_FAILED ... unable to get local issuer certificate`.

- `scripts/dev.sh` copies `*.crt` / `*.pem` files from
  `/usr/local/share/ca-certificates` (override with `EXTRA_CA_CERT_SOURCE`)
  into this directory before `up` and `build`. Disable with
  `EXTRA_CA_CERTS_AUTO=false`.
- Files must be PEM encoded. Convert a DER export with
  `openssl x509 -inform der -in root.cer -out root.crt`.
- Everything here except this README and `.gitkeep` is gitignored. Never commit
  certificates, and never work around TLS errors with `--trusted-host`,
  `--insecure`, or `strict-ssl=false`.
- Rebuild after changing certificates: `./scripts/dev.sh build`.
