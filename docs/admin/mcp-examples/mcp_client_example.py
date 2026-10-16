#!/usr/bin/env python3
"""
Example MCP client that demonstrates how Atlas-UI-3 would connect to VISTA MCP server.

This shows the basic patterns for calling VISTA MCP tools from a client application
using HTTP with API key authentication.
"""

import asyncio
import json


async def run_example():
    """Run example MCP client interactions."""

    print("=" * 60)
    print("VISTA MCP Client Example - HTTP/SSE with API Key")
    print("=" * 60)
    print()

    print("Connection Setup:")
    print("-" * 60)
    print("URL: http://localhost:8001/sse")
    print("Headers: Authorization: Bearer <MCP_API_KEY>")
    print()

    # Example 1: Get projects for a user
    print("Example 1: Get all projects for user alice@example.com")
    print("-" * 60)
    print("Tool: get_projects")
    print("Parameters:")
    print(
        json.dumps({"username": "alice@example.com", "skip": 0, "limit": 10}, indent=2)
    )
    print()

    # Example 2: Get images in a project
    print("Example 2: Get images in a project")
    print("-" * 60)
    print("Tool: get_images")
    print("Parameters:")
    print(
        json.dumps(
            {
                "username": "alice@example.com",
                "project_id": "123e4567-e89b-12d3-a456-426614174000",
                "skip": 0,
                "limit": 50,
                "include_deleted": False,
            },
            indent=2,
        )
    )
    print()

    # Example 3: Add metadata to an image
    print("Example 3: Add metadata to an image")
    print("-" * 60)
    print("Tool: add_image_metadata")
    print("Parameters:")
    print(
        json.dumps(
            {
                "username": "alice@example.com",
                "image_id": "789e0123-e89b-12d3-a456-426614174000",
                "key": "camera_model",
                "value": "Canon EOS R5",
            },
            indent=2,
        )
    )
    print()

    print("=" * 60)
    print("Note: These are example calls showing the MCP tool interface.")
    print("To actually connect to a running VISTA MCP server, use:")
    print()
    print("  from mcp.client.sse import sse_client")
    print("  from mcp import ClientSession")
    print()
    print("  async with sse_client(")
    print("      url='http://localhost:8001/sse',")
    print("      headers={'Authorization': 'Bearer <API_KEY>'})")
    print("  ) as (read, write):")
    print("      async with ClientSession(read, write) as session:")
    print("          await session.initialize()")
    print("          result = await session.call_tool(...)")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_example())
