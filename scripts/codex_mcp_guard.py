"""codex_mcp_guard.py — billing guard for the MCP short-call codex lane.

.mcp.json launches this instead of `codex mcp-server` directly so the same
subscription-only law as scripts/codex_dispatch.py:billing_guard applies to
the inline lane too. Stdio is inherited; this process becomes the server.
"""
import os
import shutil
import subprocess
import sys

METERED_KEYS = ("OPENAI_API_KEY", "CODEX_API_KEY")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    set_keys = [k for k in METERED_KEYS if os.environ.get(k)]
    if set_keys:
        print(f"codex-mcp-guard: refused — {', '.join(set_keys)} set in the "
              "environment (metered billing risk; unset it)", file=sys.stderr)
        return 2
    exe = shutil.which("codex")
    if not exe:
        print("codex-mcp-guard: codex CLI not on PATH", file=sys.stderr)
        return 2
    try:
        rc = subprocess.run([exe, "login", "status"],
                             capture_output=True, timeout=15).returncode
    except subprocess.TimeoutExpired:
        print("codex-mcp-guard: refused — codex login status timed out after "
              "15s (auth check wedged)", file=sys.stderr)
        return 2
    if rc != 0:
        print(f"codex-mcp-guard: refused — codex login status exited {rc} "
              "(subscription auth missing/stale)", file=sys.stderr)
        return 2
    return subprocess.run([exe, "mcp-server", *argv]).returncode


if __name__ == "__main__":
    sys.exit(main())
