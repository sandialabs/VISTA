# VISTA

A full-stack web application for managing, classifying, and collaborating on visual content. Built for teams that need to organize image datasets, apply custom labels, and integrate machine learning analysis results.

## Features

- **Project Organization** - Group images into projects with team-based access control
- **Image Classification** - Apply custom labels and categories to organize images
- **Team Collaboration** - Add comments and share insights with your team
- **Metadata Management** - Store custom key-value metadata for projects and images
- **ML Analysis Integration** - Visualize machine learning results with interactive overlays (bounding boxes, heatmaps)
- **Safe Deletion** - Two-stage deletion with 60-day recovery period
- **API Access** - RESTful API with comprehensive documentation and API key authentication

## Screenshots

### Projects Overview
![Projects](docs/readme_imgs/projects.png)

### Project Dashboard
![Project Dashboard](docs/readme_imgs/project-dashboard.png)

### Image View
![Individual Image View](docs/readme_imgs/individual_img-view.png)

## Requirements

- **Node.js** 22+
- **Python** 3.11+
- **Podman** (for PostgreSQL and MinIO)
- **uv** - Python package manager (`pip install uv`)

## Quick Start

### Prerequisites

This assumes you're using the dev container which has all required tools (Node.js, Python, Podman, etc.) pre-installed.

### 1. Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` and set these for development:
```bash
DEBUG=true
SKIP_HEADER_CHECK=true
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL and MinIO containers
bash short-cut-launch-postgres-minio.sh
```

### 3. Setup Python Environment

```bash
# Create virtual environment
uv venv .venv

# Activate the virtual environment
source .venv/bin/activate
```

### 4. Split Terminal and Start Services

**Terminal 1 - Frontend:**
```bash
cd frontend
npm install  # First time only
npm run dev
```

**Terminal 2 - Backend:**
```bash
cd backend

# Run database migrations (first time or after model changes)
alembic upgrade head

# Start backend server
bash run.sh
```

### 5. Access the Application

Open http://localhost:3000 in your browser to see the app.

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **API Documentation:** http://localhost:8000/docs (Swagger UI)
- **Alternative API Docs:** http://localhost:8000/redoc (ReDoc)

## Configuration

### Environment Variables

All configuration is managed through the `.env` file in the repository root. This file is **required** for the application to run properly.

**Setup:**
```bash
# Copy the example file (contains all default settings)
cp .env.example .env

# Source it before running backend commands
set -a && source .env && set +a
```

**Key Configuration Sections:**

**Database (PostgreSQL):**
```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=postgres
POSTGRES_SERVER=localhost
POSTGRES_PORT=5433
```
> **Important:** `DATABASE_URL` must be set or Alembic migrations will fail. The default uses PostgreSQL on port 5433.

**S3/MinIO Storage:**
```bash
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadminpassword
S3_BUCKET=data-storage
S3_USE_SSL=false
```

**Authentication:**
```bash
# Development (uses mock user)
SKIP_HEADER_CHECK=false
CHECK_MOCK_MEMBERSHIP=true
MOCK_USER_EMAIL=test@example.com
MOCK_USER_GROUPS_JSON='["admin-group", "data-scientists", "project-alpha-group"]'

# Production (reverse proxy authentication)
PROXY_SHARED_SECRET=your-secure-secret-here
AUTH_SERVER_URL=https://your-auth-server.com
X_USER_ID_HEADER=X-User-Email
X_PROXY_SECRET_HEADER=X-Proxy-Secret
```

**ML Analysis (Optional):**
```bash
ML_ANALYSIS_ENABLED=true
ML_CALLBACK_HMAC_SECRET=your-hmac-secret
ML_ALLOWED_MODELS=yolo_v8,resnet50_classifier
```

**Application Settings:**
```bash
APP_NAME="Data Management API"
DEBUG=false
CACHE_SIZE_MB=1000
FRONTEND_BUILD_PATH=frontend/build
```

## Database Migrations (Alembic)

**Important:** Migrations are **NOT** run automatically. This is intentional to prevent accidental schema changes in production.

### Running Migrations

```bash
# Activate virtual environment and load environment variables
source .venv/bin/activate
set -a && source .env && set +a

# Run migrations
cd backend
alembic upgrade head
```

> **Common Issue:** If you get "table already exists" errors, check that `DATABASE_URL` in `.env` points to PostgreSQL, not SQLite.

### Creating New Migrations

After modifying models in `core/models.py`:

```bash
cd backend
alembic revision --autogenerate -m "describe your changes"
```

**Always review the generated migration file before applying!**

### Common Migration Commands

```bash
alembic upgrade head              # Apply all pending migrations
alembic downgrade -1              # Rollback last migration
alembic history --verbose         # View migration history
alembic current                   # Show current database version
alembic stamp head                # Mark DB as up-to-date (use cautiously)
```

### Why Manual Migrations?

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "table already exists" error | Verify `DATABASE_URL` in `.env` is set to PostgreSQL, not SQLite |
| "alembic: command not found" | Activate virtual environment: `source .venv/bin/activate` |
| Autogenerate misses table | Verify model is imported in `core/models.py` |
| Dialect errors | Ensure `.env` is sourced and `DATABASE_URL` uses PostgreSQL |
| Schema drift | Run `alembic upgrade head` then regenerate migration |
| Connection refused | Check PostgreSQL is running: `podman ps` |

| Issue | Solution |
|-------|----------|
| Autogenerate misses table | Verify model is imported in `core/models.py` |
| Dialect errors | Ensure using PostgreSQL URL, not SQLite |
| Schema drift | Run `alembic upgrade head` then regenerate migration |

## Development

### Running Tests

**Backend tests (pytest):**
```bash
source .venv/bin/activate
cd backend
pytest                                          # Run all tests
pytest tests/test_specific.py                  # Run specific file
pytest tests/test_file.py::test_function       # Run specific test
pytest -v                                       # Verbose output
pytest -k "auth"                                # Run tests matching pattern
pytest --coverage                               # With coverage report
```

**Frontend tests (Jest):**
```bash
cd frontend
npm test                    # Interactive mode
npm test -- --coverage      # With coverage report
```

### Building for Production

**Frontend:**
```bash
cd frontend
npm run build
```

**Podman image:**
```bash
podman build -t vista .
podman run -p 8000:8000 vista
```

Access at http://localhost:8000

## ML Analysis Feature

This feature allows external ML pipelines to submit analysis results for visualization in the UI. Users cannot trigger analyses directly - they are initiated by external systems.

### For End Users

1. Navigate to an image in the web interface
2. If ML analyses exist, view them in the "ML Analyses" sidebar panel
3. Toggle bounding box and heatmap overlays
4. Adjust visualization opacity or use side-by-side comparison
5. Export results as JSON or CSV

### For ML Pipeline Developers

#### Configuration

```bash
ML_ANALYSIS_ENABLED=true
ML_CALLBACK_HMAC_SECRET=your-secure-secret
ML_ALLOWED_MODELS=yolo_v8,resnet50_classifier,custom_model
```

#### API Integration Workflow

1. **Create analysis** - `POST /api/images/{image_id}/analyses`
2. **Update to processing** - `PATCH /api/analyses/{analysis_id}/status`
3. **Request presigned URL** - `POST /api/analyses/{analysis_id}/artifacts/presign`
4. **Upload artifacts to S3** - `PUT <presigned_url>`
5. **Submit annotations** - `POST /api/analyses/{analysis_id}/annotations:bulk`
6. **Finalize** - `POST /api/analyses/{analysis_id}/finalize`

**Security:** Pipeline endpoints require HMAC authentication:
- Header: `X-ML-Signature` (HMAC-SHA256 of request body)
- Header: `X-ML-Timestamp` (Unix timestamp for replay protection)

#### Testing the Pipeline

```bash
export ML_CALLBACK_HMAC_SECRET='your_secret_here'
python scripts/test_ml_pipeline.py --image-id <uuid>
```

For detailed integration guide, see API documentation at http://localhost:8000/docs

## Production Deployment

### Reverse Proxy Setup

Production deployments require a reverse proxy for authentication. See comprehensive documentation:

- **Setup Guide:** `docs/production/proxy-setup.md`
- **Nginx Example:** `docs/production/nginx-example.conf`

The application uses header-based authentication where the reverse proxy authenticates users and forwards their identity to the backend via HTTP headers.

### Podman Deployment

```bash
podman build -t vista .
podman run -p 8000:8000 vista
```

Access at http://localhost:8000

### Kubernetes Deployment

Test deployment using minikube:

```bash
# Start minikube
minikube start

# Build and load image
podman build -t vista:latest .
minikube image load vista:latest

# Deploy
kubectl apply -f deployment-test/

# Access application
minikube service vista --url
```

See `deployment-test/` directory for Kubernetes manifests.

**Note:** The dev container includes minikube, kubectl, and helm pre-installed.

## Architecture

### Technology Stack

- **Backend:** FastAPI (Python 3.11+) with async SQLAlchemy
- **Frontend:** React 18 with React Router
- **Database:** PostgreSQL 15
- **Storage:** MinIO/S3 compatible object storage
- **Migrations:** Alembic
- **Caching:** aiocache + diskcache

### Project Structure

```
backend/
├── main.py              # Application entry point
├── core/                # Core components (models, schemas, config)
├── routers/             # API endpoint definitions
├── middleware/          # Authentication, CORS, security headers
├── utils/               # Shared utilities (CRUD, caching, S3)
├── alembic/             # Database migrations
└── tests/               # Backend tests

frontend/
├── src/
│   ├── App.js           # Main application component
│   ├── Project.js       # Project view
│   ├── ImageView.js     # Image detail view
│   └── components/      # Reusable React components
```

### Authentication

- **Development:** Mock user from environment variables
- **Production:** Header-based authentication via reverse proxy
- **Group-based access control:** Projects belong to groups
- **API keys:** Programmatic access via API key authentication

## Documentation

Comprehensive guides for different user roles:

### For Users
- **[User Guide](docs/user-guide.md)** - Complete guide for end users
  - Getting started
  - Managing projects and images
  - Classification and collaboration
  - ML analysis visualization

### For Administrators
- **[Administrator Guide](docs/admin-guide.md)** - Deployment and maintenance
  - [Installation & Deployment](docs/admin/installation.md) - Podman, Kubernetes, manual setup
  - [Configuration](docs/admin/configuration.md) - Environment variables and settings
  - [Authentication & Security](docs/admin/authentication.md) - Reverse proxy setup and security
  - [Database Management](docs/admin/database.md) - PostgreSQL, migrations, backups
  - [Storage Configuration](docs/admin/storage.md) - S3/MinIO setup and management
  - [Monitoring & Maintenance](docs/admin/monitoring.md) - Logging, metrics, updates
  - [Troubleshooting](docs/admin/troubleshooting.md) - Common issues and solutions

### For Developers
- **[Developer Guide](docs/developer-guide.md)** - Development and contribution guide
  - Development environment setup
  - Architecture overview
  - Backend and frontend development
  - API development
  - Testing and code style

### For ML Integration
- **[ML Analysis API Guide](docs/api-ml-guide.md)** - Machine learning integration
  - Authentication and workflow
  - API endpoints and data formats
  - Example implementations
  - Testing and best practices

### Additional Resources

- **[Production Proxy Setup](docs/production/proxy-setup.md)** - Detailed reverse proxy configuration
- **API Documentation:** http://localhost:8000/docs (Swagger UI)
- **Alternative API Docs:** http://localhost:8000/redoc (ReDoc)
- **pgAdmin (Database UI):** http://localhost:8080 (user: admin@admin.com, pass: admin)
- **MinIO Console:** http://localhost:9001 (user: minioadmin, pass: minioadminpassword)

## License

Copyright 2025 National Technology & Engineering Solutions of Sandia, LLC (NTESS). Under the terms of Contract DE-NA0003525 with NTESS, the U.S. Government retains certain rights in this software

MIT License