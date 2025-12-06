# MCP (Model Context Protocol) Backend Support

This document describes the MCP backend support added to VISTA for integration with AI assistants like atlas-ui-3.

## Overview

The MCP server provides a secure API for AI assistants to interact with VISTA's core functions. It exposes tools for:
- Getting projects (with pagination)
- Getting images in projects (with pagination)
- Getting detailed image information
- Getting presigned URLs for image download/viewing

## Authentication

MCP endpoints use a shared secret key for authentication along with a trusted username field.

### Configuration

Add these settings to your `.env` file:

```bash
# MCP Server Configuration
MCP_ENABLED=true
MCP_SECRET_KEY=your-secure-mcp-secret-key-here
```

**Security Notes:**
- Keep `MCP_SECRET_KEY` secret and use a strong, randomly generated value
- The username provided in the `X-Username` header is trusted - ensure only authorized clients can connect
- MCP endpoints bypass the regular authentication middleware and use their own authentication

### Headers Required

All MCP tool invocation requests must include:
- `X-MCP-Secret`: The shared secret key from configuration
- `X-Username`: The username of the user making the request (trusted field)

## Available Tools

### 1. get_projects

Get all projects that the user has access to.

**Arguments:**
- `skip` (optional, default: 0): Number of projects to skip for pagination
- `limit` (optional, default: 100, max: 100): Maximum number of projects to return

**Returns:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Project Name",
      "description": "Project description",
      "meta_group_id": "group-id",
      "created_at": "ISO 8601 timestamp",
      "updated_at": "ISO 8601 timestamp"
    }
  ],
  "total": 10,
  "skip": 0,
  "limit": 100,
  "has_more": false
}
```

### 2. get_images

Get images in a specific project.

**Arguments:**
- `project_id` (required): UUID of the project
- `skip` (optional, default: 0): Number of images to skip for pagination
- `limit` (optional, default: 100, max: 100): Maximum number of images to return
- `include_deleted` (optional, default: false): Whether to include soft-deleted images

**Returns:**
```json
{
  "project_id": "uuid",
  "images": [
    {
      "id": "uuid",
      "filename": "image.jpg",
      "content_type": "image/jpeg",
      "size_bytes": 12345,
      "object_storage_key": "project-id/image-id/image.jpg",
      "uploaded_by_user_id": "user@example.com",
      "created_at": "ISO 8601 timestamp",
      "updated_at": "ISO 8601 timestamp",
      "metadata": {...}
    }
  ],
  "count": 5,
  "skip": 0,
  "limit": 100
}
```

### 3. get_image_info

Get detailed information about a specific image.

**Arguments:**
- `image_id` (required): UUID of the image

**Returns:**
```json
{
  "id": "uuid",
  "filename": "image.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 12345,
  "object_storage_key": "project-id/image-id/image.jpg",
  "project_id": "uuid",
  "project_name": "Project Name",
  "uploaded_by_user_id": "user@example.com",
  "created_at": "ISO 8601 timestamp",
  "updated_at": "ISO 8601 timestamp",
  "metadata": {...}
}
```

### 4. get_image_url

Get a presigned URL to download/view an image.

**Arguments:**
- `image_id` (required): UUID of the image
- `expiry_seconds` (optional, default: 3600): URL expiry time in seconds (min: 60, max: 86400)

**Returns:**
```json
{
  "image_id": "uuid",
  "filename": "image.jpg",
  "content_type": "image/jpeg",
  "presigned_url": "https://s3.../image.jpg?...",
  "expires_in_seconds": 3600
}
```

## API Endpoints

### List Available Tools

```http
GET /mcp/tools
Headers:
  X-MCP-Secret: your-secret-key
  X-Username: user@example.com
```

**Response:**
```json
{
  "tools": [
    {
      "name": "get_projects",
      "description": "Get all projects that the user has access to with pagination support"
    },
    ...
  ]
}
```

### Invoke a Tool

```http
POST /mcp/tools/invoke
Headers:
  X-MCP-Secret: your-secret-key
  X-Username: user@example.com
Content-Type: application/json

{
  "tool": "get_projects",
  "arguments": {
    "skip": 0,
    "limit": 10
  }
}
```

**Response:**
```json
{
  "success": true,
  "tool": "get_projects",
  "result": {
    "projects": [...],
    "total": 10,
    "skip": 0,
    "limit": 10,
    "has_more": false
  }
}
```

### Health Check

```http
GET /mcp/health
```

**Response:**
```json
{
  "status": "healthy",
  "mcp_enabled": true,
  "service": "VISTA MCP Server"
}
```

## Access Control

The MCP server respects VISTA's group-based access control:
- Users can only see projects they have access to (based on group membership)
- Users can only access images in projects they have access to
- All operations check group membership before returning data

## Error Handling

The MCP server returns standard HTTP status codes:
- `200 OK`: Successful request
- `400 Bad Request`: Invalid arguments (e.g., malformed UUID)
- `401 Unauthorized`: Missing authentication headers
- `403 Forbidden`: Invalid secret key or insufficient permissions
- `404 Not Found`: Resource not found (e.g., project or image doesn't exist)
- `500 Internal Server Error`: Server error or tool execution error
- `503 Service Unavailable`: MCP server is disabled in configuration

Error responses include a `detail` field with a human-readable error message.

## Example Usage (Python)

```python
import requests

MCP_BASE_URL = "http://localhost:8000/mcp"
MCP_SECRET = "your-secret-key"
USERNAME = "user@example.com"

headers = {
    "X-MCP-Secret": MCP_SECRET,
    "X-Username": USERNAME,
}

# List available tools
response = requests.get(f"{MCP_BASE_URL}/tools", headers=headers)
tools = response.json()["tools"]
print(f"Available tools: {[t['name'] for t in tools]}")

# Get projects
response = requests.post(
    f"{MCP_BASE_URL}/tools/invoke",
    headers=headers,
    json={
        "tool": "get_projects",
        "arguments": {"skip": 0, "limit": 10}
    }
)
result = response.json()
if result["success"]:
    projects = result["result"]["projects"]
    print(f"Found {len(projects)} projects")
    
    # Get images from first project
    if projects:
        project_id = projects[0]["id"]
        response = requests.post(
            f"{MCP_BASE_URL}/tools/invoke",
            headers=headers,
            json={
                "tool": "get_images",
                "arguments": {
                    "project_id": project_id,
                    "skip": 0,
                    "limit": 10
                }
            }
        )
        images_result = response.json()
        if images_result["success"]:
            images = images_result["result"]["images"]
            print(f"Found {len(images)} images in project {project_id}")
            
            # Get presigned URL for first image
            if images:
                image_id = images[0]["id"]
                response = requests.post(
                    f"{MCP_BASE_URL}/tools/invoke",
                    headers=headers,
                    json={
                        "tool": "get_image_url",
                        "arguments": {
                            "image_id": image_id,
                            "expiry_seconds": 3600
                        }
                    }
                )
                url_result = response.json()
                if url_result["success"]:
                    presigned_url = url_result["result"]["presigned_url"]
                    print(f"Image URL: {presigned_url}")
```

## Testing

Run MCP server tests:

```bash
cd backend
pytest tests/test_mcp_server.py -v
```

All 15 tests should pass, covering:
- Authentication (missing/invalid secret, missing username)
- Tool listing
- Tool invocation (valid/invalid arguments)
- Project retrieval with pagination
- Image retrieval with pagination
- Image info retrieval
- Presigned URL generation

## Security Considerations

1. **Secret Key Management**: Store `MCP_SECRET_KEY` securely (environment variables, secrets manager)
2. **Trusted Username**: The username in `X-Username` is trusted - ensure only authorized clients can provide this header
3. **Transport Security**: Use HTTPS in production to protect the secret key in transit
4. **OAuth 2.0 with PKCE**: Future enhancement - current implementation uses shared secret, OAuth 2.0 authentication planned
5. **Rate Limiting**: Consider adding rate limiting for MCP endpoints in production
6. **Logging**: All MCP requests are logged with username for audit purposes

## Integration with atlas-ui-3

The MCP server follows the atlas-ui-3 protocol for exposing tools to AI assistants. See the attached `atlas-ui-3-docs.zip` in the issue for complete protocol documentation.

Key integration points:
- Tool discovery via `/mcp/tools`
- Tool invocation via `/mcp/tools/invoke`
- Pagination support in all list operations
- Standardized error responses
- Health checks for monitoring

## Future Enhancements

- [ ] OAuth 2.0 with PKCE authentication support
- [ ] Additional tools (create project, upload image, add metadata)
- [ ] Batch operations support
- [ ] WebSocket support for real-time updates
- [ ] Rate limiting per user/client
- [ ] Tool usage analytics
