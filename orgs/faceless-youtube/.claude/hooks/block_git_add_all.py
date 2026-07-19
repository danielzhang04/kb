"""PreToolUse hook: block `git add -A / --all / .`.

Parallel terminals share this working tree; a blanket `git add` sweeps other sessions'
uncommitted WIP into your commit (this bit the project during the visual overhaul). Stage
explicit paths instead. Exit 2 tells Claude Code to block the tool call and surface stderr.
"""
import json
import re
import sys

_BANNED = re.compile(r"git\s+add\s+(-A\b|--all\b|\.(?:\s|$))")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never block on a parse error
    cmd = (data.get("tool_input") or {}).get("command", "")
    if _BANNED.search(cmd):
        print(
            "BLOCKED: never `git add -A / --all / .` — parallel terminals share this tree "
            "and it sweeps other sessions' WIP. Stage explicit paths: `git add path/to/file`.",
            file=sys.stderr,
        )
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
