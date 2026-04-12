# Production Reverse Proxy Setup

This document describes how to configure a reverse proxy (nginx or Apache) for
production deployment of VISTA.

## How Authentication Works

VISTA uses a **single `/api` prefix** for all backend endpoints. The backend
(`utils/dependencies.py::get_current_user`) resolves the caller from whichever
credential is present, checked in this order:

1. **Bearer token (API key)** -- `Authorization: Bearer <key>`.  The backend
   iterates active API keys and verifies each via PBKDF2.  Used by scripts,
   automation, and ML pipelines.
2. **Debug fallback** -- when `DEBUG=true` or `SKIP_HEADER_CHECK=true`, the
   backend accepts `X-User-Email` without a secret, or falls back to
   `MOCK_USER_EMAIL`.  Never use in production.
3. **Proxy headers** -- `X-User-Email` + `X-Proxy-Secret`.  Set by a reverse
   proxy that authenticates users via OAuth2, SAML, LDAP, etc.  Used by the
   web UI.

### The Dual-Prefix Strategy

The reverse proxy exposes **two entry points** that both route to the same
backend `/api` prefix:

| Proxy path | Auth method | Who uses it |
|---|---|---|
| `/api/` | OAuth2 / SAML / LDAP (proxy-enforced) | Browser users via the web UI |
| `/ext/api/` | None at proxy level; backend validates Bearer token | Scripts, automation, ML pipelines |

The `/ext/` prefix is handled entirely at the proxy layer.  The backend never
sees `/ext/` -- the proxy rewrites `/ext/api/projects` to `/api/projects`
before forwarding the request.  This means:

- **Zero backend changes.**  The backend has a single `/api` prefix and a
  single `get_current_user` function.
- **Simple proxy config.**  Each location block does exactly one thing.  No
  conditional logic, no `map` directives, no `error_page` tricks.
- **Decoupled.**  The proxy chooses its own naming (`/ext/`, `/token/`,
  `/v1/`, whatever the sysadmin prefers).  Adding a new auth method means
  adding one proxy location block -- zero backend changes.

For a detailed comparison of alternative approaches, see
`docs/planning/reverse-proxy-auth-approaches.md`.

### Privilege Boundary

Sensitive endpoints (API key management at `/api/api-keys`, user admin at
`/api/users`) use `require_proxy_user` instead of `get_current_user`.  This
dependency **rejects** Bearer-token auth, so these endpoints are only
accessible to proxy-authenticated (human session) users.  API keys cannot
create new API keys or manage users.

## Required Backend Configuration

### 1. Environment Variables

```bash
# --- Production auth (required) ---
DEBUG=false
SKIP_HEADER_CHECK=false
PROXY_SHARED_SECRET=<generate-with-openssl-rand-hex-32>

# --- Header names (defaults shown, customize if needed) ---
X_USER_ID_HEADER=X-User-Email
X_PROXY_SECRET_HEADER=X-Proxy-Secret

# --- ML analysis (optional) ---
ML_ANALYSIS_ENABLED=true
ML_ALLOWED_MODELS=yolo_v8,resnet50
```

### 2. Generate the Shared Secret

```bash
openssl rand -hex 32
# Example: a7f3d9e2c4b8f1a6e9d4c2b7f5a8e3d1c9b6f4a2e7d5c3b1f8a6e4d2c7b5f3a9
```

Store this value in the backend `.env` as `PROXY_SHARED_SECRET` **and** in
your reverse proxy config.  Never commit it to version control.

## Nginx

See `nginx-example.conf` in this directory for a complete, copy-paste-ready
configuration.  The key pattern is two location blocks:

```nginx
# Browser users -- OAuth required
location /api/ {
    auth_request /oauth2/auth;
    auth_request_set $user_email $upstream_http_x_auth_request_email;

    proxy_set_header X-User-Email   $user_email;
    proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET";
    proxy_set_header Authorization  "";           # strip to prevent Bearer override
    proxy_pass http://backend;
}

# Scripts / automation -- no OAuth, backend validates Bearer token
location /ext/ {
    proxy_set_header Authorization  $http_authorization;
    proxy_set_header X-User-Email   "";           # prevent header injection
    proxy_set_header X-Proxy-Secret "";           # prevent header injection
    proxy_set_header Host           $host;
    proxy_set_header X-Real-IP      $remote_addr;
    proxy_pass http://backend/;    # trailing slash strips /ext prefix
}
```

The trailing slash on `proxy_pass http://backend/;` is critical.  It causes
nginx to strip the `/ext` prefix from the URI before forwarding.  A request
to `/ext/api/projects` reaches the backend as `/api/projects`.

## Apache

See `apache-example.conf` in this directory for a complete configuration.  The
equivalent pattern uses two `<Location>` blocks with `ProxyPass` path mapping:

```apache
# Browser users -- OIDC required
<Location /api/>
    AuthType openid-connect
    Require valid-user
    RequestHeader set X-User-Email   "%{OIDC_CLAIM_email}e"
    RequestHeader set X-Proxy-Secret "YOUR_SHARED_SECRET"
    RequestHeader unset Authorization
    ProxyPass        http://localhost:8000/api/
    ProxyPassReverse http://localhost:8000/api/
</Location>

# Scripts / automation -- no auth at proxy, backend validates Bearer token
<Location /ext/>
    Require all granted
    RequestHeader unset X-User-Email
    RequestHeader unset X-Proxy-Secret
    ProxyPass        http://localhost:8000/
    ProxyPassReverse http://localhost:8000/
</Location>
```

The `ProxyPass` in the `/ext/` block maps `/ext/api/projects` to
`http://localhost:8000/api/projects`, stripping the `/ext` prefix.

## Testing the Setup

### 1. Test OAuth (Browser Users)

Open `https://yourdomain.com` in a browser.  You should be redirected to
your OAuth provider.  After login the application loads normally.

Simulate it with curl:
```bash
curl -i \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: <your-secret>" \
  http://localhost:8000/api/projects
# Expected: 200 OK
```

### 2. Test API Key (Scripts)

Create an API key via the web UI, then use it via the `/ext/` prefix:

```bash
# Through the reverse proxy:
curl -i \
  -H "Authorization: Bearer <your-api-key>" \
  https://yourdomain.com/ext/api/projects
# Expected: 200 OK (no OAuth redirect)

# Direct to backend (for debugging):
curl -i \
  -H "Authorization: Bearer <your-api-key>" \
  http://localhost:8000/api/projects
# Expected: 200 OK
```

### 3. Test Health Endpoint (No Auth)

```bash
curl -i https://yourdomain.com/api/health
# Expected: 200 OK (no authentication required)
```

### 4. Verify Privilege Boundary

```bash
# API keys should NOT be able to create more API keys:
curl -i \
  -H "Authorization: Bearer <your-api-key>" \
  -X POST https://yourdomain.com/ext/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "sneaky"}'
# Expected: 403 Forbidden
```

## Group Authorization

Projects belong to groups (`meta_group_id`).  Users must be members of a
project's group to access it.

### Customizing Group Membership

`core.group_auth._check_group_membership` is **fail-closed** -- it raises
`NotImplementedError` until you configure a backend. You must set
`VISTA_AUTH_BACKEND` (see `.env.example`):

- `demo` -- hardcoded example mapping. Development and tests only; refused
  at startup when `ENV=production`.
- `custom` -- your real auth integration.

For production, set `VISTA_AUTH_BACKEND=custom`, edit
`backend/core/group_auth.py`, and replace the `custom` branch of
`_check_group_membership`:

```python
def _check_group_membership(user_email: str, group_id: str) -> bool:
    backend = (settings.VISTA_AUTH_BACKEND or "").strip().lower()
    if backend == "custom":
        # Example: query LDAP
        response = requests.get(
            f"{settings.AUTH_SERVER_URL}/api/user/{user_email}/groups",
            headers={"Authorization": f"Bearer {settings.AUTH_API_TOKEN}"},
        )
        return group_id in response.json().get("groups", [])
    # ... leave the demo / fallthrough branches intact
```

On startup, `run_auth_startup_self_test()` verifies the stub was replaced
and that the hardcoded demo emails (`admin@example.com`,
`scientist@example.com`, `user@example.com`) do **not** resolve as members
of the demo groups. If they do, the app refuses to start -- this catches
deployments that forgot to replace the helper, or that accidentally named a
real user after one of the demo emails.

Membership checks are cached for 5 minutes by default (configurable in
`backend/core/group_auth_helper.py`).

## Security Considerations

1. **Shared secret** -- at least 32 bytes of entropy.  Rotate periodically
   (requires coordinated update on proxy and backend).
2. **Network isolation** -- the backend should only accept connections from
   the reverse proxy.  Use firewall rules or Unix sockets.
   ```bash
   # Example: restrict backend port to proxy only
   iptables -A INPUT -p tcp --dport 8000 -s 127.0.0.1 -j ACCEPT
   iptables -A INPUT -p tcp --dport 8000 -s <proxy-server-ip> -j ACCEPT
   iptables -A INPUT -p tcp --dport 8000 -j DROP
   ```
3. **HTTPS/TLS** -- always use HTTPS in production.  TLS 1.2+ with strong
   ciphers.  Enable HSTS.
4. **Header validation** -- the backend validates email format via regex and
   uses constant-time comparison for the proxy secret.
5. **Security headers** -- the backend sets `X-Content-Type-Options`,
   `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` via
   `SecurityHeadersMiddleware`.
6. **Rate limiting the `/ext/` prefix** -- since `/ext/` bypasses OAuth, apply
   rate limiting at the proxy level to prevent brute-force API key guessing.
   See the example configs for `limit_req` (nginx) or `mod_ratelimit` (Apache).

## Deployment Checklist

**Backend:**
- [ ] `ENV=production`
- [ ] `DEBUG=false`, `SKIP_HEADER_CHECK=false`
- [ ] `VISTA_AUTH_BACKEND=custom`
- [ ] `PROXY_SHARED_SECRET` set (matches proxy config)
- [ ] `alembic upgrade head` run
- [ ] Production database and S3/MinIO configured
- [ ] Custom `_check_group_membership` implemented (startup self-test passes)

**Reverse Proxy:**
- [ ] OAuth2/SAML/LDAP configured for `/api/` (browser users)
- [ ] `/ext/` location block added (no OAuth, forwards Authorization header)
- [ ] `/ext/` rewrites to `/api/` on the backend (trailing slash in proxy_pass)
- [ ] `X-User-Email` and `X-Proxy-Secret` injected for OAuth users
- [ ] Rate limiting configured on both `/api/` and `/ext/`
- [ ] HTTPS with valid TLS certificate
- [ ] Health endpoint (`/api/health`) accessible without auth

**Testing:**
- [ ] Browser login works (OAuth flow via `/api/`)
- [ ] API key works via `/ext/api/` (no OAuth redirect)
- [ ] Health endpoint works without auth
- [ ] API key cannot access `/api/api-keys` or `/api/users` (403)
- [ ] Invalid proxy secret returns 401
- [ ] Missing headers return 401

## Troubleshooting

### 401 on browser requests
- Check `X-Proxy-Secret` matches `PROXY_SHARED_SECRET` in `.env`.
- Check `X-User-Email` contains a valid email address.
- Check header names match `X_USER_ID_HEADER` / `X_PROXY_SECRET_HEADER`.

### 401 on API key requests
- Verify `Authorization` header is being forwarded by the proxy.
- Verify the request goes through `/ext/api/...`, not `/api/...` (which
  requires OAuth).
- Test directly against backend: `curl -H "Authorization: Bearer <key>" http://localhost:8000/api/projects`.
- Check the key is active and not expired in the database.

### 404 on `/ext/api/...` requests
- Check the `proxy_pass` in the `/ext/` block has a trailing slash:
  `proxy_pass http://backend/;` (not `proxy_pass http://backend;`).
- For Apache, verify the `ProxyPass` path mapping strips `/ext/` correctly.

### 403 on sensitive endpoints with API key
- This is expected.  `/api/api-keys` and `/api/users` require proxy auth.
  Use a browser session (OAuth) to manage API keys and users.

### 403 on project access
- User is not a member of the project's `meta_group_id`.
- Check `_check_group_membership` implementation and cache TTL.

## Additional Resources

- [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
- [Apache mod_auth_openidc](https://github.com/zmartzone/mod_auth_openidc)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) -- explains trailing slash behavior
