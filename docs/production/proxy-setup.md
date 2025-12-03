# Production Reverse Proxy Setup

This document describes how to configure a reverse proxy (nginx, Apache, etc.) for production deployment of the VISTA application.

## Overview

The application uses **header-based authentication** via a reverse proxy. The proxy supports two authentication methods:

1. **OAuth2/SAML/LDAP** (for browser users)
   - Proxy authenticates users and sets `X-User-Email` + `X-Proxy-Secret` headers
   - Used for web UI and interactive API access
2. **API Keys** (for programmatic access)
   - Client sends `Authorization: Bearer <api-key>` header
   - Backend validates API key directly
   - Used for scripts, automation, CLI tools, and ML pipelines

**HMAC Signatures** (additional security layer for ML pipelines):
- ML pipeline endpoints require **BOTH** user authentication (API key) **AND** HMAC signature
- Client sends `X-ML-Signature` + `X-ML-Timestamp` headers along with API key
- This two-layer approach ensures:
  - Only authenticated users can trigger ML callbacks
  - Only authorized pipelines (with HMAC secret) can update analyses
  - Prevents unauthorized pipelines from making callbacks even with valid user credentials

The reverse proxy is responsible for:

1. Authenticating browser users (via OAuth2, SAML, LDAP, etc.)
2. Setting authentication headers on requests to the backend
3. Forwarding API key requests directly to backend (bypassing OAuth)
4. Forwarding all requests to the FastAPI backend
5. Serving static frontend assets (optional)

## Authentication Flow

### OAuth/SAML/LDAP (Browser Users)
```
Browser --> Reverse Proxy (OAuth) --> FastAPI Backend
                |
                v
           Sets Headers:
           - X-User-Email: user@example.com
           - X-Proxy-Secret: <shared-secret>
```

### API Key Authentication (Scripts/Automation)
```
Script/CLI --> Reverse Proxy --> FastAPI Backend
    |              |                    |
    v              v                    v
Authorization: Bearer <key>   Forwards header   Validates API key
                              X-Proxy-Secret     Returns user from DB
```

### HMAC Authentication (ML Pipeline - Two Layers)
```
ML Pipeline --> Reverse Proxy --> FastAPI Backend
    |               |                   |
    v               v                   v
Authorization:   Forwards both      1. Validates API key
  Bearer <key>   auth headers       2. Validates HMAC signature
+                                   3. Verifies timestamp
X-ML-Signature                      (Both must pass)
X-ML-Timestamp
```

**Why two layers?**
- Layer 1 (API key): Identifies and authenticates the user
- Layer 2 (HMAC): Proves request came from authorized ML pipeline
- This prevents unauthorized pipelines from accessing endpoints even if they steal/guess valid API keys

## Required Configuration

### 1. Environment Variables

Configure the following in your backend `.env` file:

```bash
# Disable debug mode for production
DEBUG=false
SKIP_HEADER_CHECK=false

# Shared secret between proxy and backend
PROXY_SHARED_SECRET=<generate-strong-random-secret>

# Header names (customize if needed)
X_USER_ID_HEADER=X-User-Email
X_PROXY_SECRET_HEADER=X-Proxy-Secret

# Optional: URL for auth server (for reference/documentation)
AUTH_SERVER_URL=https://auth.yourcompany.com
```

### 2. Generate Shared Secret

The `PROXY_SHARED_SECRET` must be a strong random value shared between the proxy and backend:

```bash
# Generate a secure random secret (Linux/Mac)
openssl rand -hex 32

# Example output:
# a7f3d9e2c4b8f1a6e9d4c2b7f5a8e3d1c9b6f4a2e7d5c3b1f8a6e4d2c7b5f3a9
```

**Important:** Keep this secret secure and never commit it to version control.

### 3. Backend Security Validation

The backend middleware (`backend/middleware/auth.py`) performs the following checks:

1. **Shared Secret Validation:** Verifies `X-Proxy-Secret` matches `PROXY_SHARED_SECRET`
2. **User Header Validation:** Extracts and validates email format from `X-User-Email`
3. **Group Membership:** Checks user permissions via `core/group_auth.py`

If validation fails, the backend returns `401 Unauthorized`.

## Reverse Proxy Configuration

### Nginx Configuration

See `nginx-simplified.conf` in this directory for the recommended multi-prefix configuration (`/api`, `/api-key`, `/api-ml`) that matches the current authentication model.

Key requirements:

**For OAuth-authenticated requests (browser users):**
- Authenticate users via OAuth2 before forwarding requests
- Set `X-User-Email` header with authenticated user's email
- Set `X-Proxy-Secret` header with shared secret
- Forward standard headers (`Host`, `X-Real-IP`, `X-Forwarded-For`)

**For API key requests (programmatic access and ML pipelines):**
- Skip OAuth authentication if `Authorization: Bearer` header is present
- Forward `Authorization` header to backend for validation
- Set `X-Proxy-Secret` header (required for all backend requests)
- Use error_page handler to fallback to API key when OAuth fails
- Forward all headers including `X-ML-Signature` and `X-ML-Timestamp` (for ML pipelines)
- Backend validates API key, then validates HMAC if present

**General:**
- Handle WebSocket upgrades if needed (future feature)
- Rate limiting per endpoint type
- Appropriate timeouts for long-running requests

### Apache Configuration

For Apache with `mod_auth_openidc` or similar:

```apache
<VirtualHost *:443>
    ServerName yourdomain.com

    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem

    # Authentication (example with OpenID Connect)
    OIDCProviderMetadataURL https://auth.example.com/.well-known/openid-configuration
    OIDCClientID your-client-id
    OIDCClientSecret your-client-secret
    OIDCRedirectURI https://yourdomain.com/oauth2callback
    OIDCCryptoPassphrase <random-passphrase>

    <Location />
        AuthType openid-connect
        Require valid-user

        # Set authentication headers
        RequestHeader set X-User-Email "%{OIDC_CLAIM_email}e"
        RequestHeader set X-Proxy-Secret "your-shared-secret-here"

        # Proxy to backend
        ProxyPass http://localhost:8000/
        ProxyPassReverse http://localhost:8000/
    </Location>
</VirtualHost>
```

## Group Authorization Integration

The application uses group-based access control. Each project belongs to a group (`meta_group_id`), and users must be members of that group to access it.

### Customizing Group Membership Checks

Edit `backend/core/group_auth.py` and replace the `_check_group_membership` function:

```python
def _check_group_membership(user_email: str, group_id: str) -> bool:
    """
    Replace this function with your actual auth system integration.

    Examples:
    - Query LDAP/Active Directory
    - Call external auth service API
    - Query database with user roles
    - Call OAuth2 userinfo endpoint
    """
    # Example: Call external auth service
    response = requests.get(
        f"{settings.AUTH_SERVER_URL}/api/user/{user_email}/groups",
        headers={"Authorization": f"Bearer {settings.AUTH_API_TOKEN}"}
    )
    user_groups = response.json().get("groups", [])
    return group_id in user_groups
```

### Group Membership Caching

Group membership checks are cached for 5 minutes by default (configurable in `backend/core/group_auth_helper.py`). This reduces load on external auth systems.

## Security Considerations

### 1. Shared Secret Protection

- Use a strong random value (at least 32 bytes of entropy)
- Store securely (environment variables, secrets manager)
- Rotate periodically (requires coordinated update on proxy and backend)
- Never log or expose in error messages

### 2. Header Validation

The backend validates:
- Email format (RFC 5322 compliant)
- Shared secret exact match (constant-time comparison)
- Headers must come from trusted proxy only

### 3. Network Security

- Backend should ONLY accept connections from the reverse proxy
- Use firewall rules to restrict access (e.g., `iptables`, security groups)
- Consider using Unix sockets instead of TCP for local communication

Example firewall rule (iptables):
```bash
# Allow only localhost and proxy server to access backend port 8000
iptables -A INPUT -p tcp --dport 8000 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 8000 -s <proxy-server-ip> -j ACCEPT
iptables -A INPUT -p tcp --dport 8000 -j DROP
```

### 4. HTTPS/TLS

- Always use HTTPS in production
- Configure proper TLS settings (TLS 1.2+, strong ciphers)
- Use certificates from a trusted CA
- Enable HSTS (Strict-Transport-Security header)

### 5. Additional Security Headers

The backend automatically sets security headers via `SecurityHeadersMiddleware`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy` (configurable)

Configure these in your `.env` file if needed.

## Testing the Setup

### 1. Test OAuth Authentication (Browser Users)

**Via browser:**
1. Navigate to `https://yourdomain.com`
2. Should redirect to OAuth provider
3. After successful login, should see application
4. Check nginx access logs for `X-User-Email` header

**Direct backend test (simulating proxy headers):**
```bash
curl -i \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: your-shared-secret" \
  http://localhost:8000/api/projects
# Expected: 200 OK with project list
```

**Without proper headers (should fail):**
```bash
curl -i http://localhost:8000/api/projects
# Expected: 401 Unauthorized or 500 Server configuration error
```

**Invalid secret (should fail):**
```bash
curl -i \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: wrong-secret" \
  http://localhost:8000/api/projects
# Expected: 401 Invalid proxy authentication
```

### 2. Test API Key Authentication (Programmatic Access)

**Create an API key first:**
```bash
# Via web UI: Navigate to /api-keys and create a new key
# Or via API (if you have OAuth access):
curl -X POST https://yourdomain.com/api/api-keys \
  -H "Cookie: oauth2_proxy_cookie..." \
  -H "Content-Type: application/json" \
  -d '{"name": "My Script", "scopes": ["read", "write"]}'
# Save the returned "key" value
```

**Test API key request:**
```bash
curl -i \
  -H "Authorization: Bearer your-api-key-here" \
  https://yourdomain.com/api/projects
# Expected: 200 OK with project list
# Should work without OAuth authentication
```

**Verify in logs:**
- Should NOT see "Invalid proxy authentication"
- Backend should log API key authentication success
- nginx should have triggered @api_key_fallback handler

### 3. Test HMAC Authentication (ML Pipeline - Two Layers)

**IMPORTANT:** ML pipeline requires BOTH API key AND HMAC signature.

**End-to-end test using heatmap pipeline:**
```bash
# Set required environment variable
export ML_CALLBACK_HMAC_SECRET=your-hmac-secret

# Run pipeline with API key (REQUIRED)
./scripts/run_heatmap_pipeline.sh PROJECT_ID \
  --api-url https://yourdomain.com \
  --api-key your-api-key-here \
  --limit 3
# Expected: Pipeline completes successfully
# Check: ML analysis results appear in web UI
```

**What gets validated:**
1. First layer: API key authentication (identifies user)
2. Second layer: HMAC signature (proves authorized pipeline)
3. Timestamp check (prevents replay attacks)

**Manual HMAC request test:**
```bash
# See backend/tests/test_ml_hmac_security.py for HMAC generation examples
# HMAC signature format: sha256=<hex(HMAC-SHA256(timestamp.body, secret))>
# This is complex - use the pipeline script for testing
# Remember: Must include Authorization header with API key
```

### 4. Check Logs

**Backend logs:**
```bash
tail -f backend/logs/app.json | grep -i auth
# Look for authentication method used (OAuth headers, API key, HMAC)
```

**Nginx logs:**
```bash
tail -f /var/log/nginx/image-manager-access.log
# Look for status codes and which endpoints are hit
tail -f /var/log/nginx/image-manager-error.log
# Look for auth_request failures or proxy errors
```

## Deployment Checklist

**Security Configuration:**
- [ ] Generate strong `PROXY_SHARED_SECRET` (32+ bytes)
- [ ] Generate strong `ML_CALLBACK_HMAC_SECRET` (if using ML features)
- [ ] Set `DEBUG=false` and `SKIP_HEADER_CHECK=false`
- [ ] Configure firewall rules to restrict backend access to proxy only
- [ ] Enable HTTPS/TLS on reverse proxy
- [ ] Configure security headers (HSTS, CSP, etc.)

**Reverse Proxy Configuration:**
- [ ] Configure OAuth2/SAML/LDAP authentication
- [ ] Set required headers (`X-User-Email`, `X-Proxy-Secret`)
- [ ] Add `@api_key_fallback` location block for API key support
- [ ] Forward `Authorization` header to backend (for API keys)
- [ ] Forward all headers to backend (including X-ML-* for HMAC)
- [ ] Configure rate limiting per endpoint type
- [ ] Set appropriate timeouts for long-running requests

**Backend Configuration:**
- [ ] Configure `.env` with production settings
- [ ] Set `PROXY_SHARED_SECRET` matching nginx config
- [ ] Set `ML_CALLBACK_HMAC_SECRET` (if using ML features)
- [ ] Implement custom `_check_group_membership` function
- [ ] Configure database connection (PostgreSQL)
- [ ] Configure S3/MinIO for production storage
- [ ] Run database migrations (`alembic upgrade head`)

**Testing:**
- [ ] Test OAuth authentication (browser users)
- [ ] Test API key authentication (programmatic access)
- [ ] Test HMAC authentication (ML pipeline)
- [ ] Test group-based access control
- [ ] Verify all three auth methods work through nginx
- [ ] Load test with expected traffic patterns

**Operations:**
- [ ] Configure logging and monitoring
- [ ] Set up database backups
- [ ] Set up log rotation
- [ ] Configure alerts for authentication failures
- [ ] Document API key creation process for users
- [ ] Plan for secret rotation procedures

## Security Model Changes (v1.x → v2.x)

### Critical Breaking Change: Dual Authentication Required

Starting with version 2.0, ML pipeline callbacks now require **dual-layer authentication**:

1. **User Authentication**: API key or user session (same as other endpoints)
2. **HMAC Signature**: Proves the request comes from an authorized pipeline

This replaces the previous HMAC-only authentication model.

#### Migration Guide for Existing Pipelines

**Immediate Action Required**: All existing ML pipelines will break without modification.

1. **Update pipeline scripts** to include API key authentication:
   ```bash
   # Set API key (get from UI or API)
   export API_KEY="your_api_key_here"

   # Run pipeline with both HMAC secret AND API key
   python yolov8_ml_pipeline.py --api-key $API_KEY --hmac-secret $ML_CALLBACK_HMAC_SECRET ...
   ```

2. **Code changes required** in pipeline scripts:
   ```python
   # OLD: HMAC-only (no longer works)
   def _make_hmac_request(self, method, url, json_data):
       # Only HMAC headers...

   # NEW: Dual authentication required
   def _make_hmac_request(self, method, url, json_data):
       # Add BOTH API key and HMAC headers
       headers = {
           'Authorization': f'Bearer {self.api_key}',  # NEW: API key required
           'X-ML-Signature': signature,
           'X-ML-Timestamp': timestamp,
           'Content-Type': 'application/json'
       }
   ```

#### Backward Compatibility

- No backward compatibility flag is currently provided
- Pipelines using only HMAC will be rejected with 401 errors
- Temporarily disable HMAC (`ML_PIPELINE_REQUIRE_HMAC=false`) for testing only

#### API Key Management Best Practices

1. **Use separate API keys** for production ML pipelines
2. **Rotate keys regularly** and update pipeline environment variables
3. **Store keys securely**:
   - Kubernetes: Use secrets or sealed secrets
   - Docker: Use environment variables, not command line
   - Cloud: Use managed secret services

### Nginx Configuration Updates

Add these headers to your nginx configuration for both `/api/images` and `/api/` location blocks:

```
proxy_set_header X-ML-Signature $http_x_ml_signature;
proxy_set_header X-ML-Timestamp $http_x_ml_timestamp;
```

## Troubleshooting

### Issue: 401 Unauthorized (OAuth)

**Possible causes:**
1. Missing or incorrect `X-Proxy-Secret` header
2. Missing or invalid `X-User-Email` header
3. Header names don't match configuration (`X_USER_ID_HEADER`, `X_PROXY_SECRET_HEADER`)

**Solution:** Check backend logs and verify header values match configuration.

### Issue: 401 Unauthorized (API Key)

**Possible causes:**
1. API key not being forwarded by nginx (missing `proxy_set_header Authorization`)
2. OAuth blocking request before API key can be checked
3. Invalid or expired API key
4. Missing `error_page 401 = @api_key_fallback` in nginx config

**Solution:**
- Verify nginx config has `@api_key_fallback` location block
- Check nginx config forwards `Authorization` header
- Verify API key is active in database
- Test API key directly against backend (bypassing nginx)

### Issue: 401 Unauthorized (HMAC/ML Pipeline)

**Possible causes:**
1. Missing API key (ML pipeline requires BOTH API key AND HMAC)
2. Invalid API key
3. Invalid HMAC signature
4. Timestamp too old (replay protection, default 300 seconds)
5. `ML_CALLBACK_HMAC_SECRET` mismatch between pipeline and backend

**Solution:**
- Ensure pipeline script is called with `--api-key` parameter
- Verify API key is active in database
- Verify `ML_CALLBACK_HMAC_SECRET` matches on both sides
- Check backend logs to see which auth layer failed (API key or HMAC)
- For timestamp issues, ensure server clocks are synchronized

### Issue: 403 Forbidden

**Possible causes:**
1. User not in required group for project access
2. `_check_group_membership` returning false

**Solution:** Verify group membership in your auth system and check logs.

### Issue: 500 Internal Server Error

**Possible causes:**
1. `PROXY_SHARED_SECRET` not configured
2. Database connection failure
3. S3/MinIO unavailable

**Solution:** Check backend logs (`backend/logs/app.json`) for detailed error messages.

### Issue: API Keys Work in Dev but Not Production

**Possible causes:**
1. Nginx `auth_request` blocking all requests
2. `Authorization` header not being forwarded
3. `error_page` handler not configured

**Solution:**
- Compare nginx config with `docs/production/nginx-simplified.conf`
- Ensure `/api`, `/api-key`, and `/api-ml` prefixes are configured as documented (no `@api_key_fallback`)
- Test with `curl -v` to see full request/response headers
- Check nginx error logs for auth_request failures

## Additional Resources

- FastAPI Security: https://fastapi.tiangolo.com/tutorial/security/
- Nginx Auth Request Module: http://nginx.org/en/docs/http/ngx_http_auth_request_module.html
- OAuth2 Proxy: https://oauth2-proxy.github.io/oauth2-proxy/
- Apache mod_auth_openidc: https://github.com/zmartzone/mod_auth_openidc
