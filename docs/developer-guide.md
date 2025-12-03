# Developer Guide

This guide provides comprehensive information for developers contributing to or extending the VISTA application.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Development Environment](#development-environment)
4. [Architecture](#architecture)
5. [Backend Development](#backend-development)
6. [Frontend Development](#frontend-development)
7. [Database](#database)
8. [API Development](#api-development)
9. [Testing](#testing)
10. [Code Style](#code-style)
11. [Security](#security)
12. [Contributing](#contributing)

## Overview

VISTA is a full-stack application for managing, classifying, and collaborating on visual content.

### Technology Stack

**Backend:**
- FastAPI (Python 3.11+) - Modern async web framework
- SQLAlchemy 2.0+ - Async ORM for PostgreSQL
- Alembic - Database migrations
- Pydantic - Data validation and serialization
- boto3 - S3/MinIO integration
- aiocache + diskcache - Caching layer

**Frontend:**
- React 18 - UI library with hooks
- React Router 6 - Client-side routing
- Native fetch API - HTTP requests
- CSS3 - Styling (no framework)

**Infrastructure:**
- PostgreSQL 15+ - Primary database
- MinIO/S3 - Object storage
- Docker & Docker Compose - Development environment

**Package Management:**
- uv - Python package manager
- npm - JavaScript package manager

### Repository Structure

```
.
├── backend/                 # FastAPI backend
│   ├── main.py             # Application entry point
│   ├── core/               # Core components
│   │   ├── models.py       # SQLAlchemy models
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── database.py     # Database engine and session
│   │   ├── config.py       # Configuration settings
│   │   ├── security.py     # Authentication utilities
│   │   └── group_auth.py   # Authorization logic
│   ├── routers/            # API endpoint definitions
│   │   ├── projects.py     # Project endpoints
│   │   ├── images.py       # Image endpoints
│   │   ├── comments.py     # Comment endpoints
│   │   ├── image_classes.py # Classification endpoints
│   │   └── ml_analyses.py  # ML analysis endpoints
│   ├── middleware/         # Request/response processing
│   │   ├── auth.py         # Authentication middleware
│   │   ├── cors_debug.py   # CORS configuration
│   │   └── security_headers.py # Security headers
│   ├── utils/              # Shared utilities
│   │   ├── crud.py         # Database operations
│   │   ├── dependencies.py # FastAPI dependencies
│   │   ├── boto3_client.py # S3 client
│   │   └── cache_manager.py # Caching utilities
│   ├── alembic/            # Database migrations
│   └── tests/              # Backend tests
├── frontend/               # React frontend
│   ├── public/             # Static assets
│   └── src/
│       ├── App.js          # Main component
│       ├── Project.js      # Project view
│       ├── ImageView.js    # Image detail view
│       └── components/     # Reusable components
├── docs/                   # Documentation
├── scripts/                # Utility scripts
├── test/                   # Test utilities
├── deployment-test/        # Kubernetes manifests
└── podman-compose.yml      # Development infrastructure
```

## Getting Started

### Prerequisites

- Git
- Python 3.11+
- Node.js 22+
- Docker and Docker Compose
- uv package manager: `pip install uv`

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/garland3/yet-another-image-project-app.git
   cd yet-another-image-project-app
   ```

2. **Start infrastructure:**
   ```bash
   podman compose up -d postgres minio
   ```

3. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with development settings
   ```

4. **Install backend dependencies:**
   ```bash
   pip install uv
   uv venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   uv pip install -r requirements.txt
   ```

5. **Run database migrations:**
   ```bash
   cd backend
   alembic upgrade head
   ```

6. **Start backend:**
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   # Or use: ./run.sh
   ```

7. **Install frontend dependencies (in new terminal):**
   ```bash
   cd frontend
   npm install
   ```

8. **Start frontend dev server:**
   ```bash
   npm run dev
   ```

9. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

## Development Environment

### Development Tools

**Recommended:**
- VS Code with extensions:
  - Python (Microsoft)
  - Pylance (Microsoft)
  - ESLint (Microsoft)
  - Prettier (Prettier)
  - Docker (Microsoft)

**Database Management:**
- pgAdmin: http://localhost:8080 (user: admin@admin.com, pass: admin)
- Or use: `psql -h localhost -p 5433 -U postgres`

**Storage Management:**
- MinIO Console: http://localhost:9001 (user: minioadmin, pass: minioadminpassword)

### Environment Variables

Key development settings in `.env`:

```bash
# Development mode
DEBUG=true
SKIP_HEADER_CHECK=true  # Disables auth header validation

# Mock user (when SKIP_HEADER_CHECK=true)
MOCK_USER_EMAIL=dev@example.com
MOCK_USER_GROUPS_JSON='["admin-group", "data-scientists"]'

# Database (Docker)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/postgres

# Storage (Docker MinIO)
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadminpassword
S3_BUCKET=data-storage
S3_USE_SSL=false
```

### Hot Reloading

**Backend:** FastAPI auto-reloads on code changes when using `--reload` flag

**Frontend:** React dev server auto-reloads on file changes

**Database Models:** After modifying models, create and apply migration:
```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Architecture

### Application Flow

```
User Request → Frontend (React)
              ↓
         REST API (FastAPI)
              ↓
    Authentication Middleware
              ↓
      Authorization Check
              ↓
         Business Logic
              ↓
    Database (PostgreSQL) + Cache (aiocache)
              ↓
       Storage (S3/MinIO)
              ↓
         JSON Response
```

### Key Design Patterns

**Backend:**
- Repository pattern (CRUD operations in `utils/crud.py`)
- Dependency injection (FastAPI dependencies)
- Middleware pattern (auth, CORS, security headers)
- Factory pattern (database session, S3 client)
- Caching decorator pattern

**Frontend:**
- Component composition
- Hooks for state management
- Custom hooks for API calls
- Controlled components for forms

### Authentication & Authorization

**Development Mode:**
- Mock user from environment variables
- `SKIP_HEADER_CHECK=true` bypasses header validation

**Production Mode:**
- Header-based authentication via reverse proxy
- Validates `X-User-Email` and `X-Proxy-Secret` headers
- Group-based access control for projects

### Caching Strategy

Multi-layer caching for performance:

1. **Application Cache:** aiocache with TTL for API responses
2. **Thumbnail Cache:** diskcache for resized images
3. **Metadata Cache:** Project and image metadata

Cache invalidation on mutations (create/update/delete).

## Backend Development

### Project Structure

```
backend/
├── main.py                 # FastAPI app factory
├── core/
│   ├── config.py           # Settings (Pydantic BaseSettings)
│   ├── database.py         # Async SQLAlchemy engine
│   ├── models.py           # ORM models
│   ├── schemas.py          # Pydantic schemas
│   ├── security.py         # Password hashing, etc.
│   └── group_auth.py       # Authorization helpers
├── routers/                # API endpoints by resource
├── middleware/             # Request/response middleware
├── utils/                  # Shared utilities
└── tests/                  # pytest tests
```

### Adding a New API Endpoint

1. **Define Pydantic schemas** in `core/schemas.py`:
   ```python
   from pydantic import BaseModel
   from uuid import UUID
   from datetime import datetime
   
   class WidgetCreate(BaseModel):
       name: str
       description: str | None = None
   
   class WidgetResponse(BaseModel):
       id: UUID
       name: str
       description: str | None
       created_at: datetime
       
       class Config:
           from_attributes = True
   ```

2. **Add database model** (if needed) in `core/models.py`:
   ```python
   class Widget(Base):
       __tablename__ = "widgets"
       
       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
       name = Column(String(255), nullable=False)
       description = Column(Text)
       created_at = Column(DateTime(timezone=True), server_default=func.now())
   ```

3. **Create migration**:
   ```bash
   cd backend
   alembic revision --autogenerate -m "add widget model"
   # Review generated migration
   alembic upgrade head
   ```

4. **Add CRUD operations** in `utils/crud.py` or router file:
   ```python
   async def create_widget(db: AsyncSession, widget: WidgetCreate) -> Widget:
       db_widget = Widget(**widget.model_dump())
       db.add(db_widget)
       await db.commit()
       await db.refresh(db_widget)
       return db_widget
   ```

5. **Create router** in `routers/widgets.py`:
   ```python
   from fastapi import APIRouter, Depends, HTTPException
   from sqlalchemy.ext.asyncio import AsyncSession
   from core.database import get_db
   from core.schemas import WidgetCreate, WidgetResponse
   from utils.dependencies import get_current_user_email
   
   router = APIRouter(prefix="/api/widgets", tags=["widgets"])
   
   @router.post("/", response_model=WidgetResponse, status_code=201)
   async def create_widget_endpoint(
       widget: WidgetCreate,
       db: AsyncSession = Depends(get_db),
       user_email: str = Depends(get_current_user_email)
   ):
       """Create a new widget."""
       db_widget = await create_widget(db, widget)
       return db_widget
   ```

6. **Register router** in `main.py`:
   ```python
   from routers import widgets
   
   api_router.include_router(widgets.router)
   ```

7. **Add tests** in `tests/test_widgets.py`:
   ```python
   import pytest
   from httpx import AsyncClient
   
   @pytest.mark.asyncio
   async def test_create_widget(client: AsyncClient):
       response = await client.post(
           "/api/widgets/",
           json={"name": "Test Widget", "description": "Test"}
       )
       assert response.status_code == 201
       data = response.json()
       assert data["name"] == "Test Widget"
   ```

### Database Operations

**Creating records:**
```python
from core.models import Project
from sqlalchemy.ext.asyncio import AsyncSession

async def create_project(db: AsyncSession, name: str, group_id: str):
    project = Project(name=name, meta_group_id=group_id)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project
```

**Querying records:**
```python
from sqlalchemy import select

async def get_project(db: AsyncSession, project_id: UUID):
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    return result.scalar_one_or_none()
```

**Updating records:**
```python
async def update_project(db: AsyncSession, project_id: UUID, name: str):
    project = await get_project(db, project_id)
    if not project:
        raise ValueError("Project not found")
    project.name = name
    await db.commit()
    await db.refresh(project)
    return project
```

**Deleting records:**
```python
async def delete_project(db: AsyncSession, project_id: UUID):
    project = await get_project(db, project_id)
    if project:
        await db.delete(project)
        await db.commit()
```

### Working with S3/MinIO

**Initialize client** (in `utils/boto3_client.py`):
```python
import boto3
from core.config import settings

def get_s3_client():
    return boto3.client(
        's3',
        endpoint_url=f"http://{settings.S3_ENDPOINT}" if not settings.S3_USE_SSL else f"https://{settings.S3_ENDPOINT}",
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY
    )
```

**Upload file:**
```python
from utils.boto3_client import get_s3_client

s3_client = get_s3_client()

# Upload from bytes
s3_client.put_object(
    Bucket=settings.S3_BUCKET,
    Key=f"projects/{project_id}/{filename}",
    Body=file_content,
    ContentType=content_type
)

# Upload from file
s3_client.upload_file(
    "/path/to/file",
    settings.S3_BUCKET,
    f"projects/{project_id}/{filename}"
)
```

**Generate presigned URL:**
```python
url = s3_client.generate_presigned_url(
    'get_object',
    Params={
        'Bucket': settings.S3_BUCKET,
        'Key': object_key
    },
    ExpiresIn=3600  # 1 hour
)
```

### Caching

**Using cache decorator:**
```python
from aiocache import cached

@cached(ttl=300, key="projects:list")
async def get_all_projects(db: AsyncSession):
    result = await db.execute(select(Project))
    return result.scalars().all()
```

**Manual cache operations:**
```python
from aiocache import Cache

cache = Cache()

# Set value
await cache.set("key", value, ttl=300)

# Get value
value = await cache.get("key")

# Delete value
await cache.delete("key")

# Clear all
await cache.clear()
```

**Cache invalidation pattern:**
```python
@router.post("/")
async def create_project(...):
    project = await create_project_in_db(...)
    
    # Invalidate list cache
    await cache.delete(f"projects:user:{user_email}:skip:0:limit:100")
    
    return project
```

## Frontend Development

### Project Structure

```
frontend/src/
├── App.js                  # Main component with routing
├── App.css                 # Global styles
├── Project.js              # Project detail view
├── ImageView.js            # Image detail view
├── ApiKeys.js              # API key management
├── components/
│   ├── ImageGallery.js     # Grid view of images
│   ├── ImageDisplay.js     # Main image with overlays
│   ├── ImageClassifications.js # Classification UI
│   ├── ImageComments.js    # Comment threads
│   ├── MLAnalysisPanel.js  # ML analysis controls
│   ├── ClassManager.js     # Class management
│   └── ...
└── __tests__/              # Jest tests
```

### Component Patterns

**Functional component with hooks:**
```javascript
import React, { useState, useEffect } from 'react';

function MyComponent({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const json = await response.json();
        setData(json);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [projectId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      <h2>{data.name}</h2>
      {/* Render data */}
    </div>
  );
}

export default MyComponent;
```

**Custom hook for API calls:**
```javascript
import { useState, useEffect } from 'react';

function useFetch(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Request failed');
        const json = await response.json();
        
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    
    fetchData();
    
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}

// Usage
function Component() {
  const { data, loading, error } = useFetch('/api/projects');
  // ...
}
```

### API Integration

**GET request:**
```javascript
const response = await fetch('/api/projects');
if (!response.ok) {
  throw new Error(`HTTP error! status: ${response.status}`);
}
const projects = await response.json();
```

**POST request:**
```javascript
const response = await fetch('/api/projects', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'New Project',
    description: 'Description',
    meta_group_id: 'group-id'
  })
});

if (!response.ok) {
  throw new Error('Failed to create project');
}

const project = await response.json();
```

**File upload:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('project_id', projectId);

const response = await fetch('/api/images/upload', {
  method: 'POST',
  body: formData
});
```

### State Management

Use React hooks for state management:

```javascript
import { useState, useCallback } from 'react';

function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (projectData) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectData)
    });
    const newProject = await response.json();
    setProjects(prev => [...prev, newProject]);
    return newProject;
  }, []);

  return { projects, loading, fetchProjects, createProject };
}
```

### Styling

The application uses pure CSS (no CSS-in-JS or frameworks):

```css
/* Component-specific styles in App.css */
.my-component {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.my-component__header {
  font-size: 1.5rem;
  font-weight: bold;
}

/* Use BEM naming convention for clarity */
```

## Database

### Models

All models are defined in `backend/core/models.py` using SQLAlchemy 2.0 async:

**Key models:**
- `User` - Application users
- `Project` - Top-level organization unit
- `DataInstance` - Images/files
- `ImageClass` - Custom classification labels
- `ImageClassification` - Links images to classes
- `ImageComment` - Comments on images
- `MLAnalysis` - ML analysis metadata
- `MLAnnotation` - Individual ML annotations
- `MLArtifact` - ML output artifacts

### Migrations

Alembic manages database schema migrations.

**Creating migrations:**
```bash
cd backend
alembic revision --autogenerate -m "add new field"
```

**Reviewing migrations:**
Always review auto-generated migrations before applying:
```bash
cat alembic/versions/<revision>_*.py
```

**Applying migrations:**
```bash
alembic upgrade head
```

**Rolling back:**
```bash
alembic downgrade -1  # Rollback one migration
alembic downgrade <revision>  # Rollback to specific revision
```

**Migration history:**
```bash
alembic history --verbose
alembic current
```

### Common Migration Patterns

**Adding a column:**
```python
def upgrade():
    op.add_column('projects',
        sa.Column('new_field', sa.String(255), nullable=True)
    )

def downgrade():
    op.drop_column('projects', 'new_field')
```

**Adding an index:**
```python
def upgrade():
    op.create_index('ix_projects_name', 'projects', ['name'])

def downgrade():
    op.drop_index('ix_projects_name', table_name='projects')
```

**Adding a foreign key:**
```python
def upgrade():
    op.add_column('images',
        sa.Column('category_id', sa.UUID(), nullable=True)
    )
    op.create_foreign_key(
        'fk_images_category',
        'images', 'categories',
        ['category_id'], ['id']
    )

def downgrade():
    op.drop_constraint('fk_images_category', 'images')
    op.drop_column('images', 'category_id')
```

## API Development

### API Documentation

The API is self-documenting via OpenAPI/Swagger:

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

### Authentication

**Development:** No authentication required when `SKIP_HEADER_CHECK=true`

**Production:** All requests must include:
- `X-User-Email`: User's email
- `X-Proxy-Secret`: Shared secret

### Response Formats

**Success (200 OK):**
```json
{
  "id": "uuid",
  "name": "Project Name",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Error (4xx/5xx):**
```json
{
  "detail": "Error message"
}
```

**List with pagination:**
```json
{
  "items": [...],
  "total": 100,
  "skip": 0,
  "limit": 20
}
```

### Best Practices

1. **Use Pydantic models** for request/response validation
2. **Return appropriate status codes:**
   - 200 OK - Successful GET/PUT/PATCH
   - 201 Created - Successful POST
   - 204 No Content - Successful DELETE
   - 400 Bad Request - Invalid input
   - 401 Unauthorized - Authentication required
   - 403 Forbidden - Insufficient permissions
   - 404 Not Found - Resource doesn't exist
   - 500 Internal Server Error - Server error

3. **Use dependency injection** for common operations (db session, current user)
4. **Include docstrings** for OpenAPI documentation
5. **Validate inputs** with Pydantic
6. **Handle errors** gracefully with appropriate error messages

## Testing

### Backend Tests (pytest)

**Location:** `backend/tests/`

**Running tests:**
```bash
source .venv/bin/activate
cd backend
pytest                              # All tests
pytest tests/test_projects.py       # Specific file
pytest tests/test_projects.py::test_create_project  # Specific test
pytest -v                           # Verbose
pytest -k "auth"                    # Pattern matching
pytest --cov                        # With coverage
```

**Test structure:**
```python
import pytest
from httpx import AsyncClient
from core.models import Project

@pytest.mark.asyncio
async def test_create_project(client: AsyncClient, db_session):
    """Test creating a new project."""
    response = await client.post(
        "/api/projects/",
        json={
            "name": "Test Project",
            "description": "Test",
            "meta_group_id": "test-group"
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Project"
    assert "id" in data
```

**Fixtures:**
```python
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from httpx import AsyncClient
from main import app

@pytest.fixture
async def db_session():
    """Provide a test database session."""
    engine = create_async_engine("sqlite+aiosqlite:///./test.db")
    # Create tables, yield session, cleanup
    # ...

@pytest.fixture
async def client(db_session):
    """Provide a test client."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
```

### Frontend Tests (Jest)

**Location:** `frontend/src/__tests__/`

**Running tests:**
```bash
cd frontend
npm test                    # Interactive mode
npm test -- --coverage      # With coverage
```

**Test structure:**
```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import MyComponent from '../MyComponent';

test('renders component correctly', () => {
  render(<MyComponent />);
  expect(screen.getByText('Hello')).toBeInTheDocument();
});

test('handles click event', () => {
  render(<MyComponent />);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(screen.getByText('Clicked')).toBeInTheDocument();
});
```

**Mocking API calls:**
```javascript
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: 'test' }),
  })
);

test('fetches data', async () => {
  render(<MyComponent />);
  await screen.findByText('test');
  expect(fetch).toHaveBeenCalledWith('/api/endpoint');
});
```

### Integration Tests

Test full workflows combining frontend and backend:

```python
@pytest.mark.asyncio
async def test_upload_and_classify_image(client, db_session):
    # Create project
    project = await create_test_project(db_session)
    
    # Upload image
    files = {'file': ('test.jpg', image_bytes, 'image/jpeg')}
    response = await client.post(
        f"/api/images/upload?project_id={project.id}",
        files=files
    )
    assert response.status_code == 201
    image = response.json()
    
    # Create class
    class_response = await client.post(
        f"/api/projects/{project.id}/classes",
        json={"name": "Test Class"}
    )
    image_class = class_response.json()
    
    # Classify image
    classify_response = await client.post(
        f"/api/images/{image['id']}/classifications",
        json={"class_id": image_class["id"]}
    )
    assert classify_response.status_code == 201
```

### Test Best Practices

1. **Isolate tests** - Each test should be independent
2. **Use fixtures** for common setup
3. **Test edge cases** - Empty lists, null values, errors
4. **Mock external services** - S3, auth servers, etc.
5. **Use descriptive test names** - What is being tested
6. **Assert specific values** - Not just status codes
7. **Clean up** - Reset database state between tests

## Code Style

### General Guidelines

- **No emojis** - Professional code and documentation only
- **File limit** - Each file should be less than 400 lines
- **Clear naming** - Descriptive variable and function names
- **Comments** - Only when necessary to explain complex logic
- **Documentation** - Docstrings for public APIs

### Python Style (PEP 8)

```python
# Imports grouped and sorted
import os
import sys
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select

from core.models import Project
from core.schemas import ProjectCreate

# Type hints
async def get_project(
    db: AsyncSession,
    project_id: UUID
) -> Optional[Project]:
    """Get a project by ID.
    
    Args:
        db: Database session
        project_id: UUID of the project
        
    Returns:
        Project if found, None otherwise
    """
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    return result.scalar_one_or_none()

# Constants in CAPS
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
```

### JavaScript Style

```javascript
// Use const/let, not var
const API_BASE = '/api';
let currentProject = null;

// Arrow functions for callbacks
const fetchProjects = async () => {
  const response = await fetch(`${API_BASE}/projects`);
  return response.json();
};

// Destructuring
const { name, description } = project;

// Template literals
const url = `/api/projects/${projectId}/images`;

// Async/await over promises
async function loadData() {
  try {
    const data = await fetchData();
    processData(data);
  } catch (error) {
    console.error('Failed to load:', error);
  }
}
```

### Linting

**Python:**
```bash
# Format with black
black backend/

# Sort imports
isort backend/

# Lint with flake8
flake8 backend/
```

**JavaScript:**
```bash
cd frontend
npm run lint
npm run format
```

## Security

### Security Checklist for Developers

- [ ] Validate all user inputs with Pydantic
- [ ] Use parameterized queries (SQLAlchemy handles this)
- [ ] Sanitize file uploads (check file type, size)
- [ ] Use presigned URLs for S3 access
- [ ] Never log sensitive data (passwords, tokens)
- [ ] Use HTTPS in production
- [ ] Implement rate limiting for sensitive endpoints
- [ ] Validate file extensions and MIME types
- [ ] Check group membership before granting access
- [ ] Use constant-time comparison for secrets

### Input Validation

**Always validate inputs:**
```python
from pydantic import BaseModel, validator, Field

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    meta_group_id: str = Field(..., min_length=1, max_length=255)
    
    @validator('name')
    def name_must_not_be_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()
```

### SQL Injection Prevention

SQLAlchemy ORM protects against SQL injection. Always use:

```python
# SAFE - parameterized
result = await db.execute(
    select(Project).where(Project.id == project_id)
)

# SAFE - ORM methods
project = Project(name=name, description=description)
db.add(project)

# NEVER - raw SQL with string interpolation
# UNSAFE: await db.execute(f"SELECT * FROM projects WHERE id = '{project_id}'")
```

### File Upload Security

Validate uploaded files:

```python
from utils.file_security import validate_file_type

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

async def upload_image(file: UploadFile):
    # Check file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large")
    
    # Check file extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Invalid file type")
    
    # Validate MIME type
    if not file.content_type.startswith('image/'):
        raise HTTPException(400, "Not an image file")
    
    # Proceed with upload
    # ...
```

### XSS Prevention

React automatically escapes values in JSX, preventing XSS:

```javascript
// SAFE - React escapes by default
<div>{userInput}</div>

// DANGEROUS - Only use for trusted HTML
<div dangerouslySetInnerHTML={{__html: trustedHtml}} />
```

## Contributing

### Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes** following code style guidelines

3. **Add tests** for new functionality

4. **Run tests:**
   ```bash
   ./test/run_tests.sh
   ```

5. **Commit changes:**
   ```bash
   git add .
   git commit -m "Add feature: description"
   ```

6. **Push to repository:**
   ```bash
   git push origin feature/my-feature
   ```

7. **Create pull request** with description of changes

### Commit Messages

Use clear, descriptive commit messages:

```
Add user profile feature

- Create profile model and schema
- Add profile API endpoints
- Implement profile UI component
- Add profile tests
```

**Format:**
- First line: Brief summary (50 chars or less)
- Blank line
- Detailed description if needed
- List of changes with bullet points

### Pull Request Guidelines

**Good PR:**
- Clear title and description
- References related issues
- Includes tests
- Updates documentation
- Small, focused changes
- All tests passing

**PR template:**
```markdown
## Description
Brief description of changes

## Related Issues
Fixes #123

## Changes
- Added feature X
- Updated component Y
- Fixed bug Z

## Testing
- [ ] Added unit tests
- [ ] Added integration tests
- [ ] Manual testing completed

## Documentation
- [ ] Updated README
- [ ] Updated API docs
- [ ] Added code comments
```

### Code Review

**As author:**
- Respond to all comments
- Make requested changes
- Keep discussions focused
- Be open to feedback

**As reviewer:**
- Be constructive and respectful
- Explain reasoning for suggestions
- Focus on code quality and correctness
- Approve when satisfied

## Additional Resources

### Documentation

- Main README: `/README.md`
- Admin Guide: `/docs/admin-guide.md`
- User Guide: `/docs/user-guide.md`
- Production Setup: `/docs/production/proxy-setup.md`

### External Resources

- FastAPI: https://fastapi.tiangolo.com/
- React: https://react.dev/
- SQLAlchemy: https://docs.sqlalchemy.org/
- PostgreSQL: https://www.postgresql.org/docs/
- MinIO: https://min.io/docs/

### Getting Help

- Check documentation first
- Search existing GitHub issues
- Create new issue with:
  - Clear description
  - Steps to reproduce
  - Expected vs actual behavior
  - Environment details (OS, versions, etc.)
