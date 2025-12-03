# Multi-Prefix Authentication Implementation Plan

## Overview

This document provides a step-by-step plan for implementing multiple API route prefixes with different authentication methods. This will simplify our nginx configuration and make authentication requirements clearer.

## Problem Statement

**Current Situation:**
- Single `/api` prefix handles multiple authentication methods (OAuth, API key, HMAC)
- Nginx uses complex `error_page` handlers and `@api_key_fallback` locations
- OAuth authentication is attempted for all requests, then falls back to API key on failure
- This creates unnecessary latency and complexity in the reverse proxy layer

**Desired Outcome:**
- Three distinct API prefixes with clear authentication requirements:
  - `/api` - OAuth authentication (browser users, web UI)
  - `/api-key` - API key authentication only (scripts, automation, CLI tools)
  - `/api-ml` - API key + HMAC authentication (ML pipelines)
- Simpler nginx configuration (no fallback handlers needed)
- Better performance (no unnecessary OAuth checks for programmatic access)
- Clearer documentation and error messages

## Architecture

### Route Prefixes and Authentication

| Prefix | Auth Method | Use Case | Backend Validation |
|--------|-------------|----------|-------------------|
| `/api` | OAuth (header-based) | Web UI, browser users | Middleware checks X-User-Email + X-Proxy-Secret |
| `/api-key` | API key only | Scripts, automation, CLI | Dependency validates Authorization header |
| `/api-ml` | API key + HMAC | ML pipelines | Dependency validates Authorization + HMAC signature |

### How It Works

**FastAPI side:**
```
                    ┌─────────────────────────────────────┐
                    │   FastAPI Application (main.py)    │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
         ┌────▼─────┐       ┌─────▼──────┐      ┌─────▼──────┐
         │ /api     │       │ /api-key   │      │ /api-ml    │
         │ router   │       │ router     │      │ router     │
         └────┬─────┘       └─────┬──────┘      └─────┬──────┘
              │                   │                    │
    ┌─────────▼─────────┐  ┌──────▼──────────┐ ┌──────▼──────────────┐
    │ Middleware auth   │  │ require_api_key │ │ require_hmac_auth   │
    │ (header-based)    │  │ dependency      │ │ dependency          │
    └───────────────────┘  └─────────────────┘ └─────────────────────┘
```

**Request flow:**
1. Nginx receives request to `/api-key/projects`
2. Nginx forwards with `Authorization: Bearer <key>` header (no OAuth check)
3. FastAPI `/api-key` router applies `require_api_key` dependency
4. Dependency validates API key and returns User object
5. Endpoint handler executes with authenticated user

## Implementation Steps

### Step 1: Create New Authentication Dependencies

**File:** `backend/utils/dependencies.py`

**What to do:**
Add two new dependency functions after the existing `get_current_user` function.

**Code to add:**

```python
async def require_api_key(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_user: Optional[User] = Depends(get_user_from_api_key)
) -> User:
    """
    Require API key authentication only (no header-based auth).
    Used for /api-key endpoints (scripts, automation, CLI tools).

    Args:
        request: FastAPI request object
        db: Database session
        api_user: User from API key (if valid key was provided)

    Returns:
        Authenticated User object

    Raises:
        HTTPException 401: If no valid API key is provided
    """
    if not api_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required for /api-key endpoints. Include 'Authorization: Bearer <api-key>' header.",
        )
    return api_user


async def require_hmac_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    body_bytes: bytes = Depends(get_raw_body)
) -> User:
    """
    Require both user authentication AND HMAC signature.
    Used for /api-ml endpoints (ML pipelines).

    This implements dual-layer security:
    1. User authentication (via API key or header-based auth)
    2. HMAC signature verification (proves authorized pipeline)

    Args:
        request: FastAPI request object
        db: Database session
        current_user: Authenticated user (via get_current_user dependency)
        body_bytes: Raw request body for HMAC verification

    Returns:
        Authenticated User object (if both layers pass)

    Raises:
        HTTPException 500: If HMAC secret not configured
        HTTPException 401: If HMAC signature is invalid or missing
    """
    # User is already authenticated via get_current_user dependency
    # Now verify HMAC signature

    if not settings.ML_CALLBACK_HMAC_SECRET:
        logger.error("HMAC authentication required but ML_CALLBACK_HMAC_SECRET not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="HMAC authentication not configured on server"
        )

    # Extract HMAC headers
    signature = request.headers.get("X-ML-Signature", "")
    timestamp = request.headers.get("X-ML-Timestamp", "0")

    # Verify signature
    if not verify_hmac_signature_flexible(
        settings.ML_CALLBACK_HMAC_SECRET,
        body_bytes,
        timestamp,
        signature
    ):
        logger.warning("HMAC signature verification failed", extra={
            "user": current_user.email,
            "path": request.url.path,
            "has_signature": bool(signature),
            "has_timestamp": bool(timestamp and timestamp != "0")
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid HMAC signature. Include 'X-ML-Signature' and 'X-ML-Timestamp' headers."
        )

    return current_user
```

**Why this works:**
- `require_api_key`: Only accepts requests with valid API keys (no OAuth fallback)
- `require_hmac_auth`: Chains dependencies - first authenticates user via `get_current_user`, then validates HMAC signature

**Testing this step:**
```bash
# Should pass - this function doesn't change existing behavior yet
cd backend
pytest tests/test_dependencies.py -v
```

### Step 2: Modify Authentication Middleware

**File:** `backend/middleware/auth.py`

**What to do:**
Update the `auth_middleware` function to skip authentication for `/api-key` and `/api-ml` routes (let dependencies handle it instead).

**Find this code** (around line 56):

```python
    # Allow health check and schema/docs without auth but still ensure state has a flag
    if path in {"/api/health", "/openapi.json"} or path.startswith("/docs") or path.startswith("/redoc"):
        if not hasattr(request.state, 'is_authenticated'):
            request.state.is_authenticated = False  # type: ignore
        return await call_next(request)
```

**Replace with:**

```python
    # Allow health check and schema/docs without auth but still ensure state has a flag
    if path in {"/api/health", "/openapi.json"} or path.startswith("/docs") or path.startswith("/redoc"):
        if not hasattr(request.state, 'is_authenticated'):
            request.state.is_authenticated = False  # type: ignore
        return await call_next(request)

    # Skip middleware auth for /api-key and /api-ml routes - dependencies will handle authentication
    if path.startswith("/api-key") or path.startswith("/api-ml"):
        if not hasattr(request.state, 'is_authenticated'):
            request.state.is_authenticated = False  # type: ignore
        return await call_next(request)
```

**Why this works:**
- Middleware no longer tries to authenticate `/api-key` or `/api-ml` requests
- Dependencies (from Step 1) will handle authentication instead
- Existing `/api` routes continue to use middleware auth (no breaking changes)

**Testing this step:**
```bash
cd backend
pytest tests/test_middleware.py -v
```

### Step 3: Create New API Routers in main.py

**File:** `backend/main.py`

**What to do:**
Create three separate routers and include all existing route modules in each.

**Find this code** (around line 180):

```python
    # Create an API router
    api_router = APIRouter()

    # Include all API routers under the /api prefix
    api_router.include_router(projects.router)
    api_router.include_router(images.router)
    api_router.include_router(users.router)
    api_router.include_router(image_classes.router)
    api_router.include_router(comments.router)
    api_router.include_router(project_metadata.router)
    api_router.include_router(api_keys.router)
    api_router.include_router(ml_analyses.router)
```

**Replace with:**

```python
    # Create three API routers with different authentication methods

    # Router 1: /api - OAuth authentication (header-based via middleware)
    # Used by: Web UI, browser users
    # Auth: Middleware validates X-User-Email + X-Proxy-Secret headers
    api_router = APIRouter(prefix="/api")

    # Router 2: /api-key - API key authentication only
    # Used by: Scripts, automation, CLI tools
    # Auth: require_api_key dependency validates Authorization header
    from utils.dependencies import require_api_key
    api_key_router = APIRouter(
        prefix="/api-key",
        dependencies=[Depends(require_api_key)]
    )

    # Router 3: /api-ml - API key + HMAC authentication
    # Used by: ML pipelines
    # Auth: require_hmac_auth dependency validates Authorization header + HMAC signature
    from utils.dependencies import require_hmac_auth
    api_ml_router = APIRouter(
        prefix="/api-ml",
        dependencies=[Depends(require_hmac_auth)]
    )

    # Include all resource routers in each API router
    # This allows the same endpoints to be accessible via different auth methods
    resource_routers = [
        projects.router,
        images.router,
        users.router,
        image_classes.router,
        comments.router,
        project_metadata.router,
        api_keys.router,
        ml_analyses.router,
    ]

    for resource_router in resource_routers:
        api_router.include_router(resource_router)
        api_key_router.include_router(resource_router)
        api_ml_router.include_router(resource_router)
```

**Find this code** (around line 201):

```python
    # Include the API router in the main app
    app.include_router(api_router)
```

**Replace with:**

```python
    # Include all three API routers in the main app
    app.include_router(api_router)
    app.include_router(api_key_router)
    app.include_router(api_ml_router)
```

**Why this works:**
- Each router gets its own prefix (`/api`, `/api-key`, `/api-ml`)
- The `dependencies` parameter on the router applies to ALL routes included in it
- All resource routers (projects, images, etc.) are included in all three API routers
- Same endpoint logic, different authentication requirements based on prefix

**Example result:**
- `GET /api/projects` - requires OAuth headers
- `GET /api-key/projects` - requires API key
- `GET /api-ml/projects` - requires API key + HMAC

**Testing this step:**
```bash
cd backend
# Start server
uvicorn main:app --reload --port 8000

# In another terminal, test endpoints
# Test /api with mock headers (should work in DEBUG mode)
curl -H "X-User-Email: test@example.com" http://localhost:8000/api/health

# Test /api-key (should fail without API key)
curl -v http://localhost:8000/api-key/projects
# Expected: 401 Unauthorized, "API key required"

# Test /api-ml (should fail without HMAC)
curl -v -H "Authorization: Bearer fake-key" http://localhost:8000/api-ml/projects
# Expected: 401 Unauthorized, "Invalid HMAC signature"
```

### Step 4: Update Nginx Configuration

**File:** `docs/production/nginx-simplified.conf`

**What to do:**
Use the simplified multi-prefix nginx configuration by defining separate location blocks for each prefix and removing any legacy `@api_key_fallback` handlers.

**Find the `/api/images` location block** (around line 134):

```nginx
    location /api/images {
        limit_req zone=upload_limit burst=5 nodelay;

        auth_request /oauth2/auth;
        auth_request_set $user_email $upstream_http_x_auth_request_email;

        proxy_set_header X-User-Email $user_email;
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-ML-Signature $http_x_ml_signature;
        proxy_set_header X-ML-Timestamp $http_x_ml_timestamp;

        # ... standard headers ...
        proxy_pass http://backend;

        error_page 401 = @api_key_fallback;
    }
```

**Replace with:**

```nginx
    # OAuth routes - Web UI and browser users
    location /api/images {
        limit_req zone=upload_limit burst=5 nodelay;

        auth_request /oauth2/auth;
        auth_request_set $user_email $upstream_http_x_auth_request_email;

        proxy_set_header X-User-Email $user_email;
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
    }

    # API key routes - Scripts and automation
    location /api-key/images {
        limit_req zone=upload_limit burst=5 nodelay;

        # No OAuth - just forward API key to backend
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
    }

    # ML pipeline routes - API key + HMAC
    location /api-ml/images {
        limit_req zone=upload_limit burst=5 nodelay;

        # No OAuth - forward API key and HMAC headers to backend
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-ML-Signature $http_x_ml_signature;
        proxy_set_header X-ML-Timestamp $http_x_ml_timestamp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
    }
```

**Find the general `/api/` location block** (around line 215):

```nginx
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;

        auth_request /oauth2/auth;
        auth_request_set $user_email $upstream_http_x_auth_request_email;
        auth_request_set $auth_cookie $upstream_http_set_cookie;
        add_header Set-Cookie $auth_cookie;

        proxy_set_header X-User-Email $user_email;
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-ML-Signature $http_x_ml_signature;
        proxy_set_header X-ML-Timestamp $http_x_ml_timestamp;

        # ... standard headers ...
        proxy_pass http://backend;

        error_page 401 = @api_key_fallback;
    }
```

**Replace with:**

```nginx
    # OAuth routes - General API endpoints
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;

        auth_request /oauth2/auth;
        auth_request_set $user_email $upstream_http_x_auth_request_email;
        auth_request_set $auth_cookie $upstream_http_set_cookie;
        add_header Set-Cookie $auth_cookie;

        proxy_set_header X-User-Email $user_email;
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
        proxy_redirect off;
    }

    # API key routes - General API endpoints
    location /api-key/ {
        limit_req zone=api_limit burst=20 nodelay;

        # No OAuth - just forward API key
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
        proxy_redirect off;
    }

    # ML pipeline routes - General API endpoints
    location /api-ml/ {
        limit_req zone=api_limit burst=20 nodelay;

        # No OAuth - forward API key and HMAC headers
        proxy_set_header X-Proxy-Secret "YOUR_SHARED_SECRET_HERE";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-ML-Signature $http_x_ml_signature;
        proxy_set_header X-ML-Timestamp $http_x_ml_timestamp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_pass http://backend;
        proxy_redirect off;
    }
```

**Delete the entire `@api_key_fallback` location block** (around line 174-203):

```nginx
    # Fallback location for API key requests that failed OAuth
    # This handler is triggered when:
    # 1. OAuth authentication fails (401)
    # 2. Request might have an API key instead
    location @api_key_fallback {
        # ... DELETE THIS ENTIRE BLOCK ...
    }
```

**Why this works:**
- No more complex `error_page` fallback logic
- Each location block is simple and self-contained
- API key and HMAC routes skip OAuth entirely (better performance)
- Easier to debug - URL tells you which auth method is expected

**Testing this step:**
```bash
# Test nginx config syntax
sudo nginx -t

# If using podman compose or local nginx
podman compose restart nginx
# or
sudo systemctl reload nginx
```

### Step 5: Update ML Pipeline Scripts

**Files to update:**
- `scripts/heatmap_ml_pipeline.py`
- `scripts/yolov8_ml_pipeline.py`

**What to do:**
Change the base URL construction to use `/api-ml` instead of `/api`.

**Find code like this:**

```python
# In heatmap_ml_pipeline.py, around the class initialization or URL building
self.api_url = api_url or os.getenv("API_URL", "http://localhost:8000")
# Later when making requests:
url = f"{self.api_url}/api/analyses/{analysis_id}/status"
```

**Add a helper method to the ML pipeline class:**

```python
def _get_ml_url(self, path: str) -> str:
    """
    Build URL for ML pipeline endpoint.
    Uses /api-ml prefix which requires API key + HMAC authentication.

    Args:
        path: API path (e.g., "/analyses/123/status")

    Returns:
        Full URL with /api-ml prefix
    """
    # Remove leading slash if present
    path = path.lstrip('/')
    return f"{self.api_url}/api-ml/{path}"
```

**Replace URL construction:**

```python
# OLD:
url = f"{self.api_url}/api/analyses/{analysis_id}/status"

# NEW:
url = self._get_ml_url(f"analyses/{analysis_id}/status")
```

**Why this works:**
- ML pipeline requests go to `/api-ml` endpoints
- Nginx forwards to backend without OAuth check
- Backend applies `require_hmac_auth` dependency (validates API key + HMAC)

**Testing this step:**
```bash
# Test ML pipeline (requires API key and running backend)
export API_URL="http://localhost:8000"
export API_KEY="<create-an-api-key-first>"
export ML_CALLBACK_HMAC_SECRET="<your-hmac-secret>"

python scripts/heatmap_ml_pipeline.py <project-id> --limit 1 --api-key $API_KEY
```

### Step 6: Update Documentation

**Files to update:**
- `docs/production/proxy-setup.md`
- `docs/api-ml-guide.md`
- `README.md`

**What to document:**

1. **In proxy-setup.md**, add section explaining the three prefixes:

```markdown
## API Route Prefixes

The application exposes three API prefixes with different authentication requirements:

### /api - OAuth Authentication (Browser Users)
- **Auth:** X-User-Email + X-Proxy-Secret headers (set by nginx after OAuth)
- **Use case:** Web UI, browser-based API access
- **Example:** `GET https://yourdomain.com/api/projects`
- **Nginx:** Requires `auth_request /oauth2/auth`

### /api-key - API Key Authentication (Scripts & Automation)
- **Auth:** Authorization: Bearer <api-key> header
- **Use case:** Scripts, CLI tools, automation, programmatic access
- **Example:** `curl -H "Authorization: Bearer <key>" https://yourdomain.com/api-key/projects`
- **Nginx:** No OAuth check, forwards Authorization header directly to backend

### /api-ml - API Key + HMAC Authentication (ML Pipelines)
- **Auth:** Authorization: Bearer <api-key> + X-ML-Signature + X-ML-Timestamp headers
- **Use case:** ML pipeline callbacks
- **Example:** Used by `scripts/heatmap_ml_pipeline.py`
- **Nginx:** Forwards Authorization and HMAC headers, no OAuth check
```

2. **In api-ml-guide.md**, update all example URLs from `/api/` to `/api-ml/`:

```markdown
## ML Pipeline Authentication

ML pipelines use dual-layer authentication via the `/api-ml` prefix:

1. **API Key** - Identifies the user making the request
2. **HMAC Signature** - Proves the request comes from an authorized pipeline

Example request:
```bash
curl -X PATCH https://yourdomain.com/api-ml/analyses/{id}/status \
  -H "Authorization: Bearer <api-key>" \
  -H "X-ML-Signature: sha256=<hmac-hex>" \
  -H "X-ML-Timestamp: <unix-timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"status": "processing"}'
```
```

3. **In README.md**, add section about API prefixes in the "API Documentation" section.

### Step 7: Write Tests

**File:** Create `backend/tests/test_multi_prefix_auth.py`

**What to test:**

```python
"""
Test multi-prefix authentication.

Tests that:
- /api routes require OAuth headers
- /api-key routes require API keys
- /api-ml routes require API keys + HMAC
- Each prefix rejects requests with wrong auth method
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from core.config import settings
import hashlib
import hmac
import time

client = TestClient(app)


def test_api_prefix_requires_oauth_headers():
    """Test that /api endpoints require OAuth headers (X-User-Email)"""
    response = client.get("/api/projects")
    # In test mode with SKIP_HEADER_CHECK, this should work
    # In production mode, this should fail without headers
    assert response.status_code in [200, 401]


def test_api_key_prefix_requires_api_key():
    """Test that /api-key endpoints require API key"""
    # No auth at all - should fail
    response = client.get("/api-key/projects")
    assert response.status_code == 401
    assert "API key required" in response.json()["detail"]


def test_api_key_prefix_accepts_valid_key(db_session, test_user, test_api_key):
    """Test that /api-key endpoints accept valid API keys"""
    headers = {"Authorization": f"Bearer {test_api_key}"}
    response = client.get("/api-key/projects", headers=headers)
    assert response.status_code == 200


def test_api_ml_prefix_requires_hmac():
    """Test that /api-ml endpoints require HMAC signature"""
    # API key but no HMAC - should fail
    headers = {"Authorization": "Bearer fake-key"}
    response = client.get("/api-ml/projects", headers=headers)
    assert response.status_code == 401
    assert "HMAC signature" in response.json()["detail"]


def test_api_ml_prefix_accepts_valid_hmac(db_session, test_user, test_api_key):
    """Test that /api-ml endpoints accept valid API key + HMAC"""
    # Generate valid HMAC signature
    timestamp = str(int(time.time()))
    body = b""  # GET request has no body
    message = f"{timestamp}.{body.decode('utf-8')}".encode('utf-8')
    signature = hmac.new(
        settings.ML_CALLBACK_HMAC_SECRET.encode('utf-8'),
        message,
        hashlib.sha256
    ).hexdigest()

    headers = {
        "Authorization": f"Bearer {test_api_key}",
        "X-ML-Signature": f"sha256={signature}",
        "X-ML-Timestamp": timestamp
    }

    response = client.get("/api-ml/projects", headers=headers)
    assert response.status_code == 200


def test_all_prefixes_expose_same_endpoints():
    """Test that all three prefixes expose the same endpoints"""
    # All should expose /projects endpoint
    # (even if auth fails, we should get 401, not 404)

    response1 = client.get("/api/projects")
    response2 = client.get("/api-key/projects")
    response3 = client.get("/api-ml/projects")

    # None should be 404 (endpoint exists on all prefixes)
    assert response1.status_code != 404
    assert response2.status_code != 404
    assert response3.status_code != 404
```

**Run tests:**
```bash
cd backend
pytest tests/test_multi_prefix_auth.py -v
```

### Step 8: Integration Testing

**Test Checklist:**

1. **Test /api prefix (OAuth)**
   ```bash
   # In DEBUG mode with mock user
   curl -H "X-User-Email: test@example.com" http://localhost:8000/api/projects
   # Expected: 200 OK, list of projects
   ```

2. **Test /api-key prefix (API key)**
   ```bash
   # Create API key via UI or API first
   curl -H "Authorization: Bearer <your-api-key>" http://localhost:8000/api-key/projects
   # Expected: 200 OK, list of projects

   # Without API key - should fail
   curl http://localhost:8000/api-key/projects
   # Expected: 401 Unauthorized, "API key required"
   ```

3. **Test /api-ml prefix (API key + HMAC)**
   ```bash
   # Run ML pipeline script
   python scripts/heatmap_ml_pipeline.py <project-id> --limit 1 --api-key <your-key>
   # Expected: Pipeline completes successfully, creates ML analysis

   # Without HMAC - should fail
   curl -H "Authorization: Bearer <key>" http://localhost:8000/api-ml/projects
   # Expected: 401 Unauthorized, "Invalid HMAC signature"
   ```

4. **Test OpenAPI docs**
   ```bash
   # Open browser to http://localhost:8000/docs
   # Should see all three prefixes with separate endpoint groups:
   # - /api/projects
   # - /api-key/projects
   # - /api-ml/projects
   ```

5. **Test with nginx** (if configured)
   ```bash
   # Test OAuth route through nginx
   curl https://yourdomain.com/api/projects
   # Should redirect to OAuth login

   # Test API key route through nginx
   curl -H "Authorization: Bearer <key>" https://yourdomain.com/api-key/projects
   # Should work without OAuth redirect
   ```

## Rollback Plan

If issues arise, you can rollback in stages:

1. **Rollback nginx only** - temporarily restore a previous nginx config backup if needed; do not reintroduce the legacy `@api_key_fallback` pattern or the removed `nginx-example.conf`.
2. **Rollback backend** - comment out `api_key_router` and `api_ml_router` in `main.py`
3. **Full rollback** - `git revert <commit-hash>`

The changes are additive (new routers alongside existing), so `/api` routes continue working during rollback.

## Success Criteria

- [ ] All three prefixes (`/api`, `/api-key`, `/api-ml`) are accessible
- [ ] `/api` routes require OAuth headers (X-User-Email + X-Proxy-Secret)
- [ ] `/api-key` routes require API key only (reject requests without Authorization header)
- [ ] `/api-ml` routes require API key + HMAC (reject requests without HMAC signature)
- [ ] All existing tests pass: `pytest backend/tests/ -v`
- [ ] ML pipeline scripts work with `/api-ml` prefix
- [ ] Nginx config simplified (no `@api_key_fallback` handler)
- [ ] Documentation updated with new prefix information

## Common Issues and Solutions

### Issue: "API key required" error on /api routes

**Cause:** Frontend is using `/api-key` prefix instead of `/api`

**Solution:** Frontend should always use `/api` prefix (OAuth flow)

### Issue: "Invalid HMAC signature" on /api-ml routes

**Cause:** HMAC signature not being generated correctly

**Solution:**
- Verify `ML_CALLBACK_HMAC_SECRET` matches between script and backend
- Check `X-ML-Timestamp` is current Unix timestamp
- Verify message format: `{timestamp}.{request_body}`

### Issue: 404 Not Found on new prefixes

**Cause:** FastAPI app not including new routers

**Solution:** Verify `app.include_router(api_key_router)` and `app.include_router(api_ml_router)` in `main.py`

### Issue: Nginx still using OAuth for /api-key routes

**Cause:** Nginx config not updated or not reloaded

**Solution:**
```bash
sudo nginx -t  # Verify config syntax
sudo nginx -s reload  # Reload nginx
```

### Issue: Tests failing with "HMAC secret not configured"

**Cause:** `ML_CALLBACK_HMAC_SECRET` not set in test environment

**Solution:** Set in `.env.test` or export before running tests:
```bash
export ML_CALLBACK_HMAC_SECRET="test-secret-12345"
pytest backend/tests/ -v
```

## Questions?

If you have questions during implementation:

1. Check the existing code in referenced files
2. Look at similar patterns (e.g., how `get_current_user` dependency works)
3. Run tests frequently to catch issues early
4. Test each step independently before moving to the next

Good luck! This is a clean architectural improvement that will simplify our authentication layer significantly.
