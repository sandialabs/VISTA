# Docker Development Guide for VISTA

This guide covers running VISTA in a fully containerized development environment using Docker Compose.

## Quick Start

```bash
# One-time setup: copy configuration files
cp .env.example .env
cp pgadmin-servers.json.example pgadmin-servers.json

# Start the complete development environment
./scripts/dev.sh up

# View logs
./scripts/dev.sh logs

# Stop everything
./scripts/dev.sh down
```

Access points:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- MinIO Console: http://localhost:9001 (minioadmin/minioadminpassword)
- pgAdmin: http://localhost:8080 (admin@admin.com/admin)

Note: The `pgadmin-servers.json` file pre-configures pgAdmin with the development database connection. If you skip this step, you'll need to manually add the server in pgAdmin.

## Architecture Overview

The Docker development environment consists of five services:

### Infrastructure Services
- **postgres** - PostgreSQL 15 database on port 5433
- **minio** - S3-compatible object storage (API: 9000, Console: 9001)
- **pgadmin** - Database management UI on port 8080

### Application Services
- **backend-dev** - FastAPI backend with hot reload on port 8000
- **frontend-dev** - React development server with HMR on port 3000

All services communicate via Docker networking using service names (postgres:5432, minio:9000) instead of localhost.

## Development Workflow

### Starting Development

```bash
# Start all services
./scripts/dev.sh up

# Services start in the background
# Database migrations run automatically
# Backend and frontend have hot reload enabled
```

### Editing Code

1. Edit backend code in `./backend/` directory
   - Changes trigger automatic reload via uvicorn --reload
   - Reload typically takes 1-2 seconds

2. Edit frontend code in `./frontend/src/` directory
   - Changes trigger React Hot Module Replacement (HMR)
   - Updates appear in browser within 1 second

3. No container rebuild needed for code changes

### Viewing Logs

```bash
# View all logs (follows output)
./scripts/dev.sh logs

# View specific service logs
./scripts/dev.sh logs backend-dev
./scripts/dev.sh logs frontend-dev

# Exit with Ctrl+C
```

### Running Tests

```bash
# Run all tests in containers
./scripts/test-docker.sh

# Run only backend tests
./scripts/test-docker.sh --backend

# Run only frontend tests
./scripts/test-docker.sh --frontend

# Verbose output for debugging
./scripts/test-docker.sh --verbose
```

### Database Operations

```bash
# Migrations run automatically on startup
# To run migrations manually:
./scripts/dev.sh migrate

# Access database via pgAdmin:
# Open http://localhost:8080
# Login: admin@admin.com / admin
# Server already configured
```

### Container Management

```bash
# Stop all services
./scripts/dev.sh down

# Restart services
./scripts/dev.sh restart

# Restart specific service
./scripts/dev.sh restart backend-dev

# View container status
./scripts/dev.sh ps

# Open shell in backend container
./scripts/dev.sh shell backend-dev

# Open shell in frontend container
./scripts/dev.sh shell frontend-dev

# Rebuild containers (after dependency changes)
./scripts/dev.sh build
```

## When to Rebuild Containers

Code changes do not require rebuilds. Rebuild only when dependencies change:

### Backend Dependencies Changed
```bash
# Edit pyproject.toml, then run: uv lock
./scripts/dev.sh down
./scripts/dev.sh build backend-dev
./scripts/dev.sh up
```

### Frontend Dependencies Changed
```bash
# Edit package.json
./scripts/dev.sh down
./scripts/dev.sh build frontend-dev
./scripts/dev.sh up
```

### Rebuild Everything
```bash
./scripts/dev.sh down
docker compose -f docker-compose.dev.yml build
./scripts/dev.sh up
```

## Environment Configuration

The `.env` file is mounted into the backend container. Key differences for Docker:

### Local Development (host-based)
```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/postgres
S3_ENDPOINT=localhost:9000
```

### Docker Development (container-based)
```bash
# Set in docker-compose.dev.yml environment section:
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/postgres
S3_ENDPOINT=minio:9000
```

The docker-compose.dev.yml file overrides these automatically. You can use the same `.env` file for both local and Docker development.

## Testing

### Containerized Testing (Recommended for CI/CD)

Uses ephemeral containers with tmpfs storage for fast, isolated tests:

```bash
./scripts/test-docker.sh
```

Process:
1. Starts postgres and minio with temporary storage
2. Runs backend tests (pytest)
3. Runs frontend tests (jest)
4. Automatically cleans up all containers

### Local Testing (with containerized infrastructure)

```bash
# Uses local Python/Node with containerized DB/MinIO
./test/run_tests.sh
```

## Troubleshooting

### Build Fails with CERTIFICATE_VERIFY_FAILED (Corporate Proxy / TLS Inspection)

**Symptoms:** `pip`, `uv`, `npm`, or `wget` fail during the image build with
`SSLCertVerificationError ... unable to get local issuer certificate`.

**Cause:** the network re-signs HTTPS traffic with a corporate root CA (for example
Zscaler). The host trusts it, but the UBI9 build container does not.

**Solution:** `./scripts/dev.sh up` and `./scripts/dev.sh build` copy `*.crt` / `*.pem`
files from `/usr/local/share/ca-certificates` into `certs/` (gitignored). `Dockerfile.dev`
adds them to the system trust store before any download and points pip, uv, requests,
and Node at it. After the certificates are staged, rebuild:

```bash
./scripts/dev.sh build
./scripts/dev.sh up
```

- Use a different source directory: `EXTRA_CA_CERT_SOURCE=/path/to/cas ./scripts/dev.sh build`
- Disable automatic staging: `EXTRA_CA_CERTS_AUTO=false`
- If WSL does not have the CA yet, export it from Windows (PowerShell:
  `Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -match Zscaler | Export-Certificate -FilePath zscaler.cer`),
  convert it with `openssl x509 -inform der -in zscaler.cer -out certs/zscaler_root_ca.crt`, and rebuild.
- Never commit certificates or work around the error by disabling TLS verification.

### Podman: short-name did not resolve / dev.sh health waits time out

- `short-name "postgres:15" did not resolve to an alias`: the compose files now use fully
  qualified names (`docker.io/library/postgres:15`). Pull the latest changes.
- podman-compose 1.0.6 (the Ubuntu package) ignores `profiles:` and lacks newer
  `compose ps` flags. `dev.sh` handles both: it starts only `DEV_SERVICES` and checks health
  with `podman inspect` / `podman healthcheck run`. Remove a stray model-service container with
  `podman rm -f vista_toolbox_models_dev`.

### Backend Cannot Reach MinIO (RemoteDisconnected) Behind a Proxy

Podman copies host proxy variables into containers, so requests to `http://minio:9000`
go to the corporate proxy, which drops them. The dev and test compose files set
`NO_PROXY` / `no_proxy` for the compose hostnames. Verify with
`podman exec vista_backend_dev env | grep -i proxy`. Recreate containers after changes:
`./scripts/dev.sh down && ./scripts/dev.sh up`.

### Backend Not Starting

Check logs:
```bash
./scripts/dev.sh logs backend-dev
```

Common issues:
- Migration failure: Check database connection
- Port conflict: Another service using port 8000
- Import errors: Rebuild container after pyproject.toml changes

### Frontend Not Starting

Check logs:
```bash
./scripts/dev.sh logs frontend-dev
```

Common issues:
- Port conflict: Another service using port 3000
- npm install failed: Rebuild container
- File watching not working: Check WATCHPACK_POLLING environment

### Hot Reload Not Working

**Backend:**
- Verify volume mount: `docker inspect vista_backend_dev`
- Check uvicorn logs for reload messages
- Ensure file saved (not just modified in editor)

**Frontend:**
- Check browser console for HMR connection
- Verify WATCHPACK_POLLING=true in docker-compose.dev.yml
- Try hard refresh (Ctrl+Shift+R)

### Database Connection Issues

```bash
# Check postgres is running
docker ps | grep postgres

# Test connection
docker exec vista_postgres_dev pg_isready -U postgres

# View postgres logs
./scripts/dev.sh logs postgres
```

### MinIO Connection Issues

```bash
# Check MinIO is running
docker ps | grep minio

# Test health endpoint
curl http://localhost:9000/minio/health/live

# View MinIO logs
./scripts/dev.sh logs minio
```

### Permission Issues

If encountering permission errors with mounted volumes:

```bash
# Check file ownership in container
./scripts/dev.sh shell backend-dev
ls -la /app/backend

# If needed, adjust file permissions on host
chmod -R 755 backend/
```

### Performance Issues (Mac/Windows)

Docker file watching can be slow on Mac/Windows. Optimizations:

1. Increase Docker Desktop resources:
   - Settings > Resources > Advanced
   - Increase CPU and Memory allocation

2. Use named volumes for node_modules (already configured)

3. Consider using Docker Desktop with VirtioFS (Mac) or WSL2 (Windows)

### Containers Won't Stop

```bash
# Force stop
docker compose -f docker-compose.dev.yml down -v

# If still running, kill manually
docker kill vista_backend_dev vista_frontend_dev

# Clean up orphaned containers
docker container prune
```

## Volume Management

### Persistent Volumes
- `postgres_data` - Database data (persists between restarts)
- `minio_data` - Object storage (persists between restarts)
- `pgadmin_data` - pgAdmin configuration (persists)
- `backend_cache` - Backend cache (persists for performance)
- `backend_logs` - Backend logs (persists)
- `frontend_node_modules` - Node dependencies (persists)

### Listing Volumes
```bash
docker volume ls | grep vista
```

### Cleaning Volumes (WARNING: Deletes data)
```bash
# Stop containers first
./scripts/dev.sh down

# Remove specific volume
docker volume rm docker-compose_postgres_data

# Remove all project volumes
docker volume rm $(docker volume ls -q | grep vista)
```

### Fresh Start (Complete Reset)
```bash
# Stop everything and remove volumes
docker compose -f docker-compose.dev.yml down -v

# Rebuild containers
docker compose -f docker-compose.dev.yml build

# Start fresh
./scripts/dev.sh up
```

## Port Reference

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 3000 | React development server |
| Backend | 8000 | FastAPI application + API docs |
| MinIO API | 9000 | S3-compatible object storage |
| MinIO Console | 9001 | MinIO web interface |
| pgAdmin | 8080 | PostgreSQL management UI |
| Postgres | 5433 | PostgreSQL database (internal: 5432) |

## Comparison with Local Development

### Docker Development (This Guide)
- All services in containers
- Consistent environment across machines
- Hot reload for code changes
- Volume mounts for live editing
- Automatic database migrations
- One command to start everything

**Pros:**
- Zero local dependencies (no Python/Node install needed)
- Identical to CI/CD environment
- Easy to reset to clean state
- No port conflicts with other projects

**Cons:**
- Slightly slower file watching on Mac/Windows
- Requires Docker Desktop resources
- Initial container build time

### Local Development (Original Workflow)
- Infrastructure in containers (postgres, minio)
- Application runs on host
- Local Python virtual environment
- Local Node.js installation

**Pros:**
- Faster file watching
- Direct access to Python/Node tools
- Easier debugging with IDE

**Cons:**
- Requires Python 3.14+ and Node.js installation
- Manual virtual environment setup
- Environment differences between developers
- Manual database migration execution

Choose the workflow that best fits your needs. Both are fully supported.

## Advanced Usage

### Debugging in Containers

#### Backend Debugging
```bash
# Add breakpoint in code:
import debugpy
debugpy.listen(("0.0.0.0", 5678))
debugpy.wait_for_client()

# Expose debug port in docker-compose.dev.yml:
ports:
  - "8000:8000"
  - "5678:5678"

# Attach debugger from IDE (VSCode/PyCharm)
```

#### Frontend Debugging
Use browser developer tools. React DevTools extension recommended.

### Running Commands in Containers

```bash
# Backend commands
./scripts/dev.sh shell backend-dev
cd /app/backend
alembic history
pytest -v tests/test_specific.py

# Frontend commands
./scripts/dev.sh shell frontend-dev
cd /app/frontend
npm run build
npm test -- --coverage
```

### Custom Environment Variables

Add to docker-compose.dev.yml under backend-dev or frontend-dev service:

```yaml
environment:
  - CUSTOM_VAR=value
```

Or mount a custom .env file:

```yaml
volumes:
  - ./custom.env:/app/.env:ro
```

## CI/CD Integration

The test environment is designed for CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run tests in Docker
  run: ./scripts/test-docker.sh --verbose
```

Benefits:
- Ephemeral environment (no state between runs)
- Fast startup with tmpfs storage
- Consistent with local testing
- No cleanup needed (automatic)

## Getting Help

- Check logs: `./scripts/dev.sh logs`
- View container status: `./scripts/dev.sh ps`
- Open shell: `./scripts/dev.sh shell backend-dev`
- Main README: See [README.md](README.md) for general documentation
- Report issues: https://github.com/sandialabs/vista/issues
