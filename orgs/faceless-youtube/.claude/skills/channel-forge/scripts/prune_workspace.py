"""Remove a channel's ephemeral .workspace/ (channel-forge spec §6, clause F)."""
import shutil
import sys
from pathlib import Path


def prune(channel_dir):
    """Remove <channel_dir>/.workspace/. Return the list of removed paths."""
    ws = Path(channel_dir) / ".workspace"
    if not ws.exists():
        return []
    removed = [str(ws)]
    shutil.rmtree(ws)
    return removed


if __name__ == "__main__":
    removed = prune(sys.argv[1])
    print(f"pruned {len(removed)} workspace path(s)")
