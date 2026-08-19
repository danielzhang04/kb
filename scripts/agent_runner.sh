#!/bin/sh
# POSIX entry point for the closed codex-worker queue runner.
set -eu

agent=''
repo_root=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) agent=$2; shift 2 ;;
    --repo-root) repo_root=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$agent" ] || { echo '--agent is required' >&2; exit 2; }
[ -n "$repo_root" ] || repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python_bin=${KB_PYTHON:-python3}
exec "$python_bin" "$repo_root/scripts/agent_runner.py" --agent "$agent" --repo-root "$repo_root"
