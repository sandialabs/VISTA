# VISTA MCP Integration Guide for Atlas-UI-3

This guide explains how Atlas-UI-3 integrates with VISTA through the Model Context Protocol (MCP) server.

## Overview

VISTA exposes its backend functionality through an MCP server, allowing Atlas-UI-3 to:
- Manage projects and images
- Add and retrieve metadata
- Apply classifications
- Add and view comments
- Access all VISTA features without direct database access

## Architecture

```
Atlas-UI-3 (Client) <--HTTP/SSE with API Key--> VISTA MCP Server <---> VISTA Backend
                                                        |
                                                        v
                                                PostgreSQL + MinIO
```

### Authentication Flow

1. **Atlas-UI-3** authenticates users using its own authentication system
2. **Atlas-UI-3** connects to VISTA MCP server using HTTP with API key in Authorization header
3. **VISTA MCP Server** validates the API key before processing requests
4. **Atlas-UI-3** passes the authenticated username to each MCP tool call
5. **VISTA MCP Server** validates access using VISTA's group membership system
6. Users are auto-created in VISTA if they don't exist

This design provides secure API key authentication for the HTTP connection while allowing Atlas to manage user authentication and VISTA to handle authorization.

## Available MCP Tools

### Project Management

#### `get_projects`
Get all projects accessible to a user.

**Parameters:**
- `username` (string): User's email/username
- `skip` (int, optional): Pagination offset (default: 0)
- `limit` (int, optional): Max results (default: 100)

**Returns:** List of projects with id, name, description, meta_group_id, timestamps

#### `get_project`
Get details of a specific project.

**Parameters:**
- `username` (string): User's email/username
- `project_id` (string): UUID of the project

**Returns:** Project details or error message

#### `create_project`
Create a new project.

**Parameters:**
- `username` (string): User's email/username
- `name` (string): Project name
- `meta_group_id` (string): Group ID for access control
- `description` (string, optional): Project description

**Returns:** Created project details or error

### Image Management

#### `get_images`
List images in a project.

**Parameters:**
- `username` (string): User's email/username
- `project_id` (string): UUID of the project
- `skip` (int, optional): Pagination offset (default: 0)
- `limit` (int, optional): Max results (default: 100)
- `include_deleted` (bool, optional): Include soft-deleted images (default: false)

**Returns:** List of images with metadata

#### `get_image_info`
Get detailed information about an image, including a download URL.

**Parameters:**
- `username` (string): User's email/username
- `image_id` (string): UUID of the image

**Returns:** Image details with presigned download URL

#### `add_image_metadata`
Add or update a metadata field on an image.

**Parameters:**
- `username` (string): User's email/username
- `image_id` (string): UUID of the image
- `key` (string): Metadata key
- `value` (any): Metadata value (string, number, object, etc.)

**Returns:** Success status and updated metadata

### Classification Management

#### `get_image_classes`
Get all classification labels available for a project.

**Parameters:**
- `username` (string): User's email/username
- `project_id` (string): UUID of the project

**Returns:** List of available classification labels

#### `add_image_classification`
Apply a classification label to an image.

**Parameters:**
- `username` (string): User's email/username
- `image_id` (string): UUID of the image
- `class_id` (string): UUID of the classification label

**Returns:** Success status and classification details

### Comment Management

#### `get_image_comments`
Get all comments on an image.

**Parameters:**
- `username` (string): User's email/username
- `image_id` (string): UUID of the image

**Returns:** List of comments with author and timestamp

#### `add_image_comment`
Add a comment to an image.

**Parameters:**
- `username` (string): User's email/username
- `image_id` (string): UUID of the image
- `text` (string): Comment text

**Returns:** Success status and comment details

### Project Metadata

#### `get_project_metadata`
Get all metadata key-value pairs for a project.

**Parameters:**
- `username` (string): User's email/username
- `project_id` (string): UUID of the project

**Returns:** List of metadata entries

#### `add_project_metadata`
Add or update a metadata key-value pair for a project.

**Parameters:**
- `username` (string): User's email/username
- `project_id` (string): UUID of the project
- `key` (string): Metadata key
- `value` (string): Metadata value

**Returns:** Success status and metadata details

## Integration Steps for Atlas-UI-3

### 1. Install MCP Python SDK

```bash
pip install mcp
```

### 2. Configure Connection

Create a connection to the VISTA MCP server via HTTP:

```python
from mcp import ClientSession
from mcp.client.sse import sse_client

# Connect to VISTA MCP server over HTTP/SSE
async with sse_client(
    url="http://localhost:8001/sse",  # VISTA MCP server URL
    headers={
        "Authorization": "Bearer your-api-key-here"  # API key authentication
    },
) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        # Use session to call tools
```

### 3. Call MCP Tools

```python
# Get projects for a user
result = await session.call_tool(
    "get_projects", arguments={"username": "user@example.com", "skip": 0, "limit": 20}
)
projects = json.loads(result.content[0].text)

# Get images in a project
result = await session.call_tool(
    "get_images",
    arguments={
        "username": "user@example.com",
        "project_id": projects[0]["id"],
        "skip": 0,
        "limit": 50,
    },
)
images = json.loads(result.content[0].text)

# Add metadata to an image
result = await session.call_tool(
    "add_image_metadata",
    arguments={
        "username": "user@example.com",
        "image_id": images[0]["id"],
        "key": "analysis_date",
        "value": "2024-12-07",
    },
)
```

### 4. Error Handling

All tools return either successful results or error messages:

```python
result = await session.call_tool(
    "get_project",
    arguments={"username": "user@example.com", "project_id": "invalid-uuid"},
)
data = json.loads(result.content[0].text)

if "error" in data:
    print(f"Error: {data['error']}")
else:
    print(f"Project: {data['name']}")
```

Common error messages:
- `"Invalid UUID format"` - Malformed UUID parameter
- `"Project not found"` - Resource doesn't exist
- `"Access denied"` - User doesn't have permission
- `"User does not have access to group"` - Group membership issue

## Development and Testing

### Running the MCP Server

```bash
# Ensure environment is configured
cd vista
cp .env.example .env
# Edit .env with your settings

# Start infrastructure
podman compose up -d postgres minio

# Run migrations
cd backend
alembic upgrade head

# Set API key for MCP server
export VISTA_MCP_API_KEY="your-secure-api-key-here"

# Optional: Configure host and port
export MCP_HOST="0.0.0.0"
export MCP_PORT="8001"

# Start MCP server
python mcp_server.py
```

The server will start on http://0.0.0.0:8001 (or your configured host/port).

### Testing Tools

```bash
# Run MCP server tests
python test/test_mcp_server.py

# View example usage
python examples/mcp_client_example.py
```

## Security Considerations

1. **Trusted Username**: The MCP server trusts the username parameter from Atlas. Ensure Atlas properly authenticates users before making MCP calls.

2. **Group Membership**: Access control is enforced through VISTA's group membership system. Users can only access projects in groups they belong to.

3. **Database Isolation**: Atlas doesn't need direct database access - all operations go through the MCP server which enforces access control.

4. **Environment Variables**: Sensitive configuration (database credentials, S3 keys) should be kept in environment variables, not passed in MCP calls.

## Performance Considerations

1. **Pagination**: Use `skip` and `limit` parameters to paginate large result sets
2. **Caching**: Consider caching frequently accessed data in Atlas
3. **Batch Operations**: For bulk operations, make multiple parallel MCP calls
4. **Connection Pooling**: Reuse MCP client connections when possible

## Troubleshooting

### "Database connection failed"
- Ensure PostgreSQL is running
- Check DATABASE_URL in .env
- Verify network connectivity

### "S3 bucket not found"
- Ensure MinIO is running
- Check S3 configuration in .env
- Verify bucket exists

### "Access denied to this project"
- Check user's group membership
- Verify project's meta_group_id
- Review VISTA's group configuration

### "User not found" or auto-creation issues
- Ensure username format is consistent
- Check database user creation permissions
- Review logs for detailed error messages

## Additional Resources

- [MCP Server Documentation](mcp-server.md)
- [VISTA Developer Guide](developer-guide.md)
- [Example Client Code](../examples/mcp_client_example.py)
