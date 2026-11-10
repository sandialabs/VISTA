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
`/api/users`, and database settings at `/api/dashboard/settings/database-url`)
use `require_authenticated_user` instead of `get_current_user`.  This
dependency **rejects** Bearer-token auth, so these endpoints are only
accessible to local debug/mock users or externally authenticated browser users.
API keys cannot create new API keys, manage users, or switch database settings.

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

# --- Group authorization (VISTA_AUTH_BACKEND=custom) ---
VISTA_AUTH_BACKEND=custom
X_USER_GROUPS_HEADER=X-Forwarded-Groups
GROUPS_SNAPSHOT_TTL_SECONDS=604800
GROUPS_SNAPSHOT_REFRESH_SECONDS=60

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

### Backends

`core.group_auth._check_group_membership` is **fail-closed**. You must set
`VISTA_AUTH_BACKEND` (see `.env.example`):

- `demo` -- hardcoded example mapping. Development and tests only; refused
  at startup when `ENV=production`.
- `custom` -- membership from the groups your proxy asserts (below), or from
  your own integration if you replace the `custom` branch of
  `_check_group_membership` (for example an LDAP or OIDC userinfo lookup).

### Groups from the proxy (`custom`)

The proxy that authenticates the user already knows their groups from the
identity provider and can pass them the same way it passes the email.
oauth2-proxy sends `X-Forwarded-Groups: group-a,group-b` and strips any copy
the client sent. Set `X_USER_GROUPS_HEADER` if your proxy uses another name.

- On every proxied request, after the `X-Proxy-Secret` check passed,
  `get_current_user` records the user's groups (`core/group_snapshot.py`).
  Each request is a full assertion: it replaces the user's groups, and a missing
  header means no groups (a warning is logged once).
- Membership checks read what is recorded for the user, so they do not depend on
  which request is running. A request with no proxy headers of its own (the MCP
  server, a background task) gets its user's groups as of their last proxied
  request, for `GROUPS_SNAPSHOT_TTL_SECONDS` (default 7 days). A user who has
  not signed in through the proxy within the TTL, or never has, is a member of
  nothing there.
- **API keys carry their own groups.** A key created while `custom` is active
  stores its creator's groups as the proxy asserted them on the creating
  request (`api_keys.groups`, shown in `GET /api/api-keys`). A request made
  with the key is answered from exactly those groups, with no expiry, so an
  unattended workflow keeps working however long since its owner signed in.
  The key does not follow later changes to the owner's groups: to revoke or
  change its access, deactivate it and create a new one while signed in with
  the right groups. A key created before this was added has no stored groups
  and falls back to its owner's recorded groups (the TTL above); recreate it
  for unattended use.
- Records are kept in the `user_group_snapshots` table (run
  `alembic upgrade head`), shared by all replicas, and held in memory by each
  process, which reloads them every `GROUPS_SNAPSHOT_REFRESH_SECONDS`. If a write
  fails it is logged and the request is not affected.
- The app refuses to start with `custom` and no `PROXY_SHARED_SECRET`, unless
  `DEBUG` or `SKIP_HEADER_CHECK` is on (the groups header is trusted only with
  the secret).
- Group names may not contain commas (an LDAP distinguished name, for example).
  The groups are whatever the IdP puts in the claim the proxy reads. VISTA's
  admin checks use a group named `admin`.
- Removing a user from a group takes effect on their next proxied request. For
  API-key and MCP requests it takes effect when they next sign in, or when the
  TTL passes.

### Your own integration

To use another source instead, edit `backend/core/group_auth.py` and replace
the `custom` branch of `_check_group_membership`. VISTA ships with
`AUTH_SERVER_URL` on `core.config.Settings`. Any additional knobs the example
below references (e.g. an API token) must be added by the integrator -- either
as new `Settings` fields or via `os.getenv()`. They are not pre-defined.

```python
import os
import requests
from core.config import settings

def _check_group_membership(user_email: str, group_id: str) -> bool:
    backend = (settings.VISTA_AUTH_BACKEND or "").strip().lower()
    if backend == "custom":
        # Example: query an external auth service.
        # VISTA_AUTH_API_TOKEN is an integrator-owned env var; add it
        # to your deployment environment.
        response = requests.get(
            f"{settings.AUTH_SERVER_URL}/api/user/{user_email}/groups",
            headers={
                "Authorization": f"Bearer {os.environ['VISTA_AUTH_API_TOKEN']}",
            },
        )
        return group_id in response.json().get("groups", [])
    # ... leave the demo / fallthrough branches intact
```

On startup, `run_auth_startup_self_test()` verifies that the hardcoded demo
emails (`admin@example.com`, `scientist@example.com`, `user@example.com`) do
**not** resolve as members of the demo groups. If they do, the app refuses to
start -- this catches deployments that granted access to a demo email, or that
accidentally named a real user after one.

Membership checks are cached for 5 minutes by default (configurable in
`backend/core/group_auth_helper.py`). The proxy-groups backend bypasses that
cache: its answer is already in memory.

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
- [ ] Groups source chosen: proxy groups header (`X_USER_GROUPS_HEADER`) or your own `_check_group_membership` (startup self-test passes)
- [ ] Proxy passes the user's groups header (oauth2-proxy: `X-Forwarded-Groups`)

**Reverse Proxy:**
- [ ] OAuth2/SAML/LDAP configured for `/api/` (browser users)
- [ ] `/ext/` location block added (no OAuth, forwards Authorization header)
- [ ] `/ext/` rewrites to `/api/` on the backend (trailing slash in proxy_pass)
- [ ] `X-User-Email` and `X-Proxy-Secret` injected for OAuth users, and the groups header passed through (the client's own copy stripped)
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
- With proxy groups: confirm the proxy sends the groups header
  (`X_USER_GROUPS_HEADER`) and the IdP's claim holds the project's group name.
  A "no groups header" warning in the backend log means it does not.

### Projects empty for API keys or the MCP server
- A key created after per-key groups were added carries its creator's groups
  (see `groups` in `GET /api/api-keys`). An empty list means the creator had no
  groups when it was made: create a new key while signed in through the proxy.
- A key with no stored groups (made earlier) needs its owner to have made a
  proxied request within `GROUPS_SNAPSHOT_TTL_SECONDS`: have them open the UI, or
  recreate the key.
- For the MCP server, check the `user_group_snapshots` table exists
  (`alembic upgrade head`) and the username's email matches the proxy's
  `X-User-Email` (case-insensitive). Usernames without an `@` become
  `name@local` and never match.

## Additional Resources

- [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
- [Apache mod_auth_openidc](https://github.com/zmartzone/mod_auth_openidc)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) -- explains trailing slash behavior
