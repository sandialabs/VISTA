#!/usr/bin/env python3
"""
Test script to verify MCP server can be imported and lists tools correctly.
"""

import sys
from pathlib import Path

import pytest

# Add backend directory to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from core.config import settings


def test_mcp_server_import():
    """Test that the MCP server can be imported."""
    print("Testing MCP server import...")
    try:
        settings.VISTA_MCP_API_KEY = "local-test-mcp-key-for-script"
        print("✓ MCP server imported successfully")
    except Exception as e:
        print(f"✗ Failed to import MCP server: {e}")
        import traceback

        traceback.print_exc()
        pytest.fail(f"Failed to import MCP server: {e}")


@pytest.mark.asyncio
async def test_mcp_tools_available():
    """Test that MCP tools are registered."""
    print("\nTesting MCP tools registration...")
    try:
        settings.VISTA_MCP_API_KEY = "local-test-mcp-key-for-script"
        import mcp_server

        # Get the MCP instance
        mcp = mcp_server.mcp

        expected_tools = [
            "get_projects",
            "get_project",
            "get_images",
            "get_image_info",
            "add_image_metadata",
            "get_image_classes",
            "add_image_classification",
            "get_image_comments",
            "add_image_comment",
            "create_project",
            "get_project_metadata",
            "add_project_metadata",
        ]
        tools = {
            tool_name: getattr(mcp_server, tool_name)
            for tool_name in expected_tools
            if hasattr(mcp_server, tool_name)
        }

        print(f"\n✓ MCP server '{mcp.name}' exposes the following tool functions:")
        for tool_name, tool in tools.items():
            desc = (
                tool.__doc__.strip().split("\n")[0]
                if tool.__doc__
                else "No description"
            )
            print(f"  - {tool_name}: {desc}")

        assert set(tools) == set(expected_tools)

    except Exception as e:
        print(f"✗ Failed to list MCP tools: {e}")
        import traceback

        traceback.print_exc()
        pytest.fail(f"Failed to list MCP tools: {e}")

    assert tools


def main():
    """Run all tests."""
    print("=" * 60)
    print("VISTA MCP Server Test Suite")
    print("=" * 60)

    results = []

    # Test 1: Import
    try:
        test_mcp_server_import()
        results.append(True)
    except Exception:
        results.append(False)

    # Test 2: Tools (async)
    if results[0]:  # Only test tools if import succeeded
        import asyncio

        result = asyncio.run(test_mcp_tools_available())
        results.append(result)

    # Summary
    print("\n" + "=" * 60)
    print(f"Tests Passed: {sum(results)}/{len(results)}")
    print("=" * 60)

    return all(results)


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
