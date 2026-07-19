"""Atlas kb-MCP server (stdio). Read-only in V0. The ONLY door between voice stack and kb."""
from mcp.server.fastmcp import FastMCP
from kbmcp import kb_tools

app = FastMCP("kb")

@app.tool()
def queue_summary(state: str | None = None) -> dict:
    """Summarize kb task-card queues (counts + card list), optionally one state."""
    return kb_tools.queue_summary(kb_tools.kb_root(), state)

@app.tool()
def read_dashboard(name: str = "executive") -> str:
    """Read a kb dashboard markdown file (e.g. 'executive' or 'handover') by name."""
    return kb_tools.read_dashboard(kb_tools.kb_root(), name)

@app.tool()
def read_state(project: str) -> str:
    """Read a project's STATE.md under orgs/<project>. Reports known projects if the name is unrecognized."""
    root = kb_tools.kb_root()
    try:
        return kb_tools.read_state(root, project)
    except FileNotFoundError:
        return "Unknown project: " + project + ". Known: " + ", ".join(
            p.name for p in (root / "orgs").iterdir())

@app.tool()
def ledger_rollup() -> dict:
    """Roll up today's ledger activity: total cost in USD and count of activity rows."""
    return kb_tools.ledger_rollup(kb_tools.kb_root())

@app.tool()
def running_work() -> list[dict]:
    """List task cards currently in the 'working' state across the queue."""
    return kb_tools.running_work(kb_tools.kb_root())

if __name__ == "__main__":
    app.run()   # stdio transport
