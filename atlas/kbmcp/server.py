"""Atlas kb-MCP server (stdio). Read-only in V0. The ONLY door between voice stack and kb.

Tools come from the single registry in `worker.toolreg` (shared with fastlane and the LiveKit
worker) — registration is a loop over `REGISTRY`, so a new tool is a one-place edit. Importing
`worker.toolreg` does NOT pull in the voice stack: it has no module-level livekit import.
"""
from mcp.server.fastmcp import FastMCP
from worker import toolreg

app = FastMCP("kb")

for _spec in toolreg.REGISTRY:
    app.add_tool(toolreg.mcp_tool(_spec), name=_spec.name, description=_spec.description)

if __name__ == "__main__":
    app.run()   # stdio transport
