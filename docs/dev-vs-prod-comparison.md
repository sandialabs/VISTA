# Development vs Production: Architecture Comparison & Risk Analysis

## Architecture Overview

### Production Mode
```
Browser → Backend (FastAPI on :8000)
          ├─ /api/* → API endpoints
          ├─ /static/* → Built frontend static files (JS, CSS)
          ├─ / → index.html
          └─ /{path} → index.html (React Router catch-all)
```
- **Single server** on port 8000
- **Built frontend** copied to `/app/ui2` during Docker build
- Backend serves **static React build** from `FRONTEND_BUILD_PATH`
- **No separate frontend server**

### Docker Development Mode (Current Setup)
```
Browser → Frontend Dev Server (React on :3000)
          └─ /api/* → Proxied to Backend (:8000)

Internal → Backend (FastAPI on :8000)
           └─ /api/* → API endpoints only
```
- **Two separate servers**: Frontend :3000, Backend :8000
- Frontend (Vite dev server) proxies `/api/*` to `http://backend-dev:8000` (`server.proxy` in `frontend/vite.config.mjs`)
- Backend runs with `DEBUG=true`, skips static file serving
- **Hot reload** enabled for both services

### Local Development Mode (Original)
```
Browser → Frontend Dev Server (React on :3000)
          └─ /api/* → Proxied to Backend (:8000)

Host → Backend (FastAPI on :8000)
       └─ /api/* → API endpoints only
```
- Same as Docker development, but services run on host machine
- Frontend uses `package.json` proxy: `"proxy": "http://localhost:8000"`

## Key Differences

| Aspect | Production | Docker Development | Risks |
|--------|-----------|-------------------|-------|
| **Servers** | 1 (backend only) | 2 (frontend + backend) | ⚠️ Medium |
| **Frontend Serving** | Backend serves static files | Webpack dev server | ⚠️ Medium |
| **API Routing** | Direct `/api/*` | Proxied by the Vite dev server | ⚠️ Low |
| **CORS** | Not needed (same origin) | Required (different ports) | ⚠️ High |
| **Static Files** | Pre-built in Docker image | Generated on-the-fly | ⚠️ Low |
| **Environment Variables** | `DEBUG=false` | `DEBUG=true` | ⚠️ Medium |
| **React Router** | Catch-all route in backend | Handled by webpack-dev-server | ⚠️ Medium |
| **Authentication** | Reverse proxy headers | Mock user (SKIP_HEADER_CHECK) | ⚠️ Critical |
| **File Logging** | Enabled | Disabled (DISABLE_FILE_LOGGING) | ⚠️ Low |

## Detailed Risk Analysis

### 🔴 CRITICAL RISKS

#### 1. **CORS Configuration Mismatch**
**Problem:**
- Development uses CORS because frontend (:3000) and backend (:8000) are different origins
- Production doesn't need CORS (same origin at :8000)
- CORS is configured in `main.py` line 155: `cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")`

**Risk:**
If CORS_ORIGINS is not properly configured in production, the application will still allow `http://localhost:3000` as an origin, which could be a security issue.

**Mitigation:**
✅ Already safe: Production should set `CORS_ORIGINS` to only the actual production domain or remove CORS entirely since it's same-origin.

**Action Required:**
- Ensure production deployment sets `CORS_ORIGINS` appropriately
- Consider disabling CORS entirely when `DEBUG=false` and serving static files

#### 2. **Authentication Bypass in Development**
**Problem:**
- Development uses `SKIP_HEADER_CHECK=true` with mock user
- Production requires reverse proxy with `X-User-Email` and `X-Proxy-Secret` headers

**Risk:**
If `SKIP_HEADER_CHECK=true` or `DEBUG=true` accidentally makes it to production, authentication is completely bypassed.

**Mitigation:**
- Production must set `DEBUG=false` and `SKIP_HEADER_CHECK=false`
- CI/CD should validate these environment variables before deployment

### 🟡 MEDIUM RISKS

#### 3. **API URL Hardcoding**
**Problem:**
- Frontend development uses proxy configuration that points to `backend-dev:8000` (Docker) or `localhost:8000` (local)
- In production, API calls go to the same origin (no proxy needed)
- The `REACT_APP_API_URL` environment variable exists but may not be used consistently

**Risk:**
If frontend code uses absolute URLs like `http://localhost:8000/api/...` instead of relative URLs `/api/...`, it will fail in production.

**Verification Needed:**
Check frontend code to ensure all API calls use relative paths (`/api/...`) or properly use `REACT_APP_API_URL`.

**Current Status:**
✅ Likely safe: The Vite dev proxy only forwards `/api` paths, suggesting the frontend uses relative URLs.

#### 4. **React Router Catch-All Route**
**Problem:**
- In production, backend has a catch-all route (`/{full_path:path}`) that serves `index.html` for client-side routing
- In development, webpack-dev-server handles this automatically
- The catch-all route is defined AFTER all API routes to avoid conflicts

**Risk:**
If route precedence is wrong, the catch-all could intercept API routes, or conversely, new API routes could break frontend routes.

**Current Implementation:**
```python
# Line 328-339 in main.py
@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    # Don't handle API routes through this catch-all
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
```

✅ Safe: The check for `api/` prefix prevents conflicts.

**Potential Issue:**
The check is `full_path.startswith("api/")` but API routes are mounted at `/api`, so this should work. However, if someone defines a route at `/myapi`, it would still go through the catch-all.

#### 5. **Environment-Specific Code Paths**
**Problem:**
- Backend has different behavior based on `DEBUG` flag
- `setup_static_files()` is completely skipped when `DEBUG=true`
- File logging is disabled when `DISABLE_FILE_LOGGING=true`

**Risk:**
Code paths that only execute in production may have bugs that don't surface during development.

**Mitigation:**
- Periodically test the production Docker image locally with `DEBUG=false`
- Include production build testing in CI/CD

#### 6. **Static File Paths**
**Problem:**
- Production expects frontend build at `/app/ui2` (set by `FRONTEND_BUILD_PATH`)
- Development doesn't use this at all
- If the path is wrong in production, the application will show "Backend API is running. Frontend not built."

**Risk:**
Silent failure - backend starts successfully but frontend doesn't load.

**Current Protection:**
✅ The Dockerfile explicitly sets `ENV FRONTEND_BUILD_PATH=/app/ui2` and copies build files there.

### 🟢 LOW RISKS

#### 7. **Proxy Configuration Differences**
**Problem:**
- Docker dev uses the Vite dev proxy with `REACT_APP_BACKEND_URL=http://backend-dev:8000`
- Local dev uses `package.json` proxy: `"proxy": "http://localhost:8000"`
- Production uses no proxy

**Risk:**
Low - The proxy configuration is only used during development and doesn't affect the production build.

**Note:**
The dev proxy in `vite.config.mjs` is not part of the production build; production serves the UI and API from the same origin.

#### 8. **File Logging Behavior**
**Problem:**
- Development disables file logging (`DISABLE_FILE_LOGGING=true`)
- Production enables it by default

**Risk:**
Log files in production might fill up disk space if not rotated.

**Mitigation:**
- Ensure log rotation is configured in production
- Monitor disk usage
- Consider using a centralized logging solution instead of file logging

## Recommendations

### High Priority

1. **Add Production Mode Testing**
   ```bash
   # Test production build locally
   docker build -t vista:test .
   docker run -p 8000:8000 \
     -e DATABASE_URL=postgresql+asyncpg://... \
     -e S3_ENDPOINT=... \
     -e DEBUG=false \
     -e SKIP_HEADER_CHECK=false \
     vista:test
   ```

2. **Environment Variable Validation**
   Add startup checks in `main.py`:
   ```python
   if not settings.DEBUG and settings.SKIP_HEADER_CHECK:
       raise RuntimeError("SKIP_HEADER_CHECK must be false in production")
   ```

3. **CORS Configuration**
   Update CORS setup to disable when serving static files:
   ```python
   if settings.DEBUG:
       cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
       add_cors_middleware(app, cors_origins)
   else:
       # Production serves frontend from same origin, no CORS needed
       # Unless you have separate frontend domain
       if os.getenv("CORS_ORIGINS"):
           add_cors_middleware(app, os.getenv("CORS_ORIGINS").split(","))
   ```

### Medium Priority

4. **Frontend Code Audit**
   Verify all API calls use relative paths:
   ```bash
   # Check for hardcoded localhost URLs
   grep -r "localhost:8000" frontend/src/
   grep -r "http://" frontend/src/ | grep -v "://$"
   ```

5. **Add Health Check Endpoint**
   The health check returns 404. Add a proper endpoint:
   ```python
   @app.get("/health")
   async def health_check():
       return {"status": "healthy"}
   ```

6. **Document Environment Variables**
   Create a clear checklist of required production environment variables with validation.

### Low Priority

7. **Production Build in CI/CD**
   Ensure the production Docker image build is tested in CI/CD before deployment.

8. **Log Rotation**
   Configure log rotation for production file logging.

## Testing Checklist for Production Deployment

Before deploying to production, verify:

- [ ] `DEBUG=false`
- [ ] `SKIP_HEADER_CHECK=false`
- [ ] `PROXY_SHARED_SECRET` is set to a secure random value
- [ ] `CORS_ORIGINS` is set to production domain (or empty for same-origin)
- [ ] `DATABASE_URL` points to production database
- [ ] `S3_ENDPOINT` points to production S3/MinIO
- [ ] Frontend builds successfully (`npm run build`)
- [ ] Production Docker image includes built frontend at `/app/ui2`
- [ ] Reverse proxy is configured to send `X-User-Email` and `X-Proxy-Secret` headers
- [ ] Static files are served correctly (check `/static/*`)
- [ ] React Router works for all frontend routes
- [ ] API endpoints are accessible at `/api/*`
- [ ] Authentication is enforced (no mock users)

## Summary

The current Docker development setup is well-designed and separates development concerns from production. The main risks are:

1. **Critical:** Authentication misconfiguration (already well-documented)
2. **Medium:** CORS configuration needs production-specific handling
3. **Medium:** Need regular testing of production build
4. **Low:** Most other differences are safe by design

The architecture differences are intentional and beneficial for development velocity. The key is ensuring proper environment configuration during deployment and having good CI/CD validation.
