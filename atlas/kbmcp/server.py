"""Atlas kb-MCP server (stdio). Read-only in V0. The ONLY door between voice stack and kb."""
from mcp.server.fastmcp import FastMCP
from kbmcp import kb_tools

app = FastMCP("kb")

@app.tool()
def queue_summary(state: str | None = None) -> dict:
    """Summarize kb task-card queues (counts + card list), optionally one state."""
    return kb_tools.queue_summary(kb_tools.kb_root(), state)

if __name__ == "__main__":
    app.run()   # stdio transport
