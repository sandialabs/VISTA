# VISTA MCP Server

This directory contains the MCP (Model Context Protocol) server for VISTA. The MCP server exposes VISTA's backend functionality to external clients like Atlas-UI-3 via HTTP with API key authentication.

## What is MCP?

MCP (Model Context Protocol) is a protocol that allows AI assistants and other clients to interact with tools and data sources. The VISTA MCP server exposes a set of tools that Atlas-UI-3 can use to manage projects, images, classifications, and metadata.

## Installation

The MCP server requires the `fastmcp` package, which is included in `pyproject.toml`:

```bash
uv sync
```

## Running the MCP Server

To run the MCP server:

```bash
cd backend

# Set the API key (required)
export VISTA_MCP_API_KEY="your-secure-api-key-here"

# Optional: Configure host and port
export MCP_HOST="localhost"  # Default: localhost
export MCP_PORT="8001"     # Default: 8001

# Start the server
python mcp_server.py
```

The server will start as an HTTP service on the configured host and port (default: http://localhost:8001).

## Configuration

### Environment Variables

**Required:**
- `VISTA_MCP_API_KEY` - API key for authentication. The server refuses to start when this value is unset, empty, or the old example value `vista-default-key-change-me`.

**Optional:**
- `MCP_HOST` - Host to bind to (default: "localhost")
- `MCP_PORT` - Port to bind to (default: 8001)

### VISTA Configuration

The MCP server uses the same configuration as the main VISTA backend:

- Database connection settings from `.env` file
- S3/MinIO storage configuration
- Group authentication settings

Make sure you have:
1. PostgreSQL running (via `podman compose up -d postgres`)
2. MinIO running (via `podman compose up -d minio`)
3. Database migrations applied (`alembic upgrade head`)
4. `.env` file configured with necessary settings

## Available Tools

The VISTA MCP server exposes the following tools:

### Project Management
- `get_projects` - List all projects accessible to a user
- `get_project` - Get details of a specific project
- `create_project` - Create a new project

### Image Management
- `get_images` - List images in a project
- `get_image_info` - Get detailed information about an image (including download URL)
- `add_image_metadata` - Add or update a metadata field on an image

### Classification Management
- `get_image_classes` - Get classification labels for a project
- `add_image_classification` - Classify an image with a label

### Comments
- `get_image_comments` - Get comments on an image
- `add_image_comment` - Add a comment to an image

### Project Metadata
- `get_project_metadata` - Get all metadata key-value pairs for a project
- `add_project_metadata` - Add or update a metadata key-value pair

## Authentication

The MCP server uses **API key authentication** via HTTP headers:

1. Client (Atlas-UI-3) connects to the MCP server using HTTP
2. Client includes `Authorization: Bearer <MCP_API_KEY>` header in requests
3. Server validates the API key before processing requests
4. Client passes the authenticated username to each MCP tool call
5. The MCP server uses this username to check access permissions via VISTA's group membership system
6. Users are auto-created if they don't exist

This design provides secure API key authentication while still leveraging VISTA's access control.

## Usage Example

When Atlas-UI-3 connects to the MCP server over HTTP, it includes the API key in the Authorization header:

```python
import httpx
from mcp.client.sse import sse_client

# Connect to VISTA MCP server
async with sse_client(
    url="http://localhost:8001/sse",
    headers={"Authorization": "Bearer your-api-key-here"},
) as (read, write):
    from mcp import ClientSession

    async with ClientSession(read, write) as session:
        await session.initialize()

        # Get projects for a user
        result = await session.call_tool(
            "get_projects",
            arguments={"username": "alice@example.com", "skip": 0, "limit": 10},
        )

        # Get images in a project
        result = await session.call_tool(
            "get_images",
            arguments={
                "username": "alice@example.com",
                "project_id": "123e4567-e89b-12d3-a456-426614174000",
                "skip": 0,
                "limit": 50,
            },
        )

        # Add metadata to an image
        result = await session.call_tool(
            "add_image_metadata",
            arguments={
                "username": "alice@example.com",
                "image_id": "789e0123-e89b-12d3-a456-426614174000",
                "key": "camera_model",
                "value": "Canon EOS R5",
            },
        )
```
```

## Development

To add new tools to the MCP server:

1. Define a new function decorated with `@mcp.tool()`
2. Add appropriate type hints and docstrings
3. Implement database access using the CRUD utilities
4. Check user permissions using `is_user_in_group()`
5. Return results as dictionaries (JSON-serializable)

## Architecture

The MCP server:
- Is a standalone Python application that can run separately from the main FastAPI backend
- Shares the same database, models, and CRUD utilities as the main backend
- Uses async/await for all database operations
- Returns all results as JSON-serializable dictionaries
- Handles its own database session management

## Troubleshooting

**Error: "Database connection failed"**
- Make sure PostgreSQL is running: `podman compose up -d postgres`
- Check your `.env` file has correct `DATABASE_URL`

**Error: "S3 bucket not found"**
- Make sure MinIO is running: `podman compose up -d minio`
- Check your `.env` file has correct S3 settings

**Error: "Access denied"**
- The user may not have access to the requested project's group
- Check group membership configuration in the backend
