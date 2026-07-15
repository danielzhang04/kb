"""Shared preamble — every loop/agent runs this first (constitution: CLAUDE.md)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

DEFAULT_LIMIT = 5.00


def _daily_limit(repo_root: Path) -> float:
    f = Path(repo_root) / "governance" / "budget.yaml"
    if f.exists():
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        return float(data.get("daily_usd_limit", DEFAULT_LIMIT))
    return DEFAULT_LIMIT


def check(repo_root: Path, env: dict | None = None, cost_today_fn=None) -> list[str]:
    env = os.environ if env is None else env
    problems: list[str] = []
    if (Path(repo_root) / "STOP").exists():
        problems.append("STOP file present — fleet is frozen")
    if env.get("ANTHROPIC_API_KEY"):
        problems.append("ANTHROPIC_API_KEY is set — would silently bill to API; unset it")
    if cost_today_fn is not None:
        spent = cost_today_fn(repo_root)
        limit = _daily_limit(repo_root)
        if spent >= limit:
            problems.append(f"daily budget breached: ${spent:.2f} >= ${limit:.2f}")
    return problems


def main() -> int:
    root = Path.cwd()
    try:
        import ledger
        cost_fn = ledger.cost_today
    except ImportError:
        cost_fn = None
    problems = check(root, cost_today_fn=cost_fn)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems))
        return 2
    print("PREAMBLE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
