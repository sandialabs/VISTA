#!/usr/bin/env python3
"""
Test script to verify MCP server can be imported and lists tools correctly.
"""

import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def test_mcp_server_import():
    """Test that the MCP server can be imported."""
    print("Testing MCP server import...")
    try:
        import mcp_server
        print("OK: MCP server imported successfully")
        return True
    except Exception as e:
        print(f"FAILED: Could not import MCP server: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_mcp_tools_available():
    """Test that MCP tools are registered."""
    print("\nTesting MCP tools registration...")
    try:
        import mcp_server
        
        # Get the MCP instance
        mcp = mcp_server.mcp
        
        # List all registered tools
        print(f"\nOK: MCP server '{mcp.name}' has the following tools registered:")
        
        # Use get_tools() method (it's async and returns a dict)
        tools = await mcp.get_tools()
        
        if tools:
            for tool_name in sorted(tools.keys()):
                tool = tools[tool_name]
                # Extract description
                if hasattr(tool, 'description'):
                    desc = tool.description.strip().split('\n')[0] if tool.description else "No description"
                elif hasattr(tool, '__doc__'):
                    desc = tool.__doc__.strip().split('\n')[0] if tool.__doc__ else "No description"
                else:
                    desc = "No description"
                print(f"  - {tool_name}: {desc}")
            print(f"\nTotal tools: {len(tools)}")
        else:
            print("  No tools registered")
        
        return True
    except Exception as e:
        print(f"FAILED: Could not list MCP tools: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests."""
    print("="*60)
    print("VISTA MCP Server Test Suite")
    print("="*60)
    
    results = []
    
    # Test 1: Import
    results.append(test_mcp_server_import())
    
    # Test 2: Tools (async)
    if results[0]:  # Only test tools if import succeeded
        import asyncio
        result = asyncio.run(test_mcp_tools_available())
        results.append(result)
    
    # Summary
    print("\n" + "="*60)
    print(f"Tests Passed: {sum(results)}/{len(results)}")
    print("="*60)
    
    return all(results)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
