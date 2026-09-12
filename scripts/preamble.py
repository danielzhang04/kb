"""Shared preamble — every loop/agent runs this first (constitution: CLAUDE.md)."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

DEFAULT_LIMIT = 5.00


def _daily_limit(repo_root: Path) -> float:
    """The daily ceiling this gate enforces, in USD.

    Accepts `daily_subscription_usd_limit` first, falling back to the older
    `daily_usd_limit`. The rename is the point, not cosmetic: this gate compares against
    today's rows in `ledgers/cost/`, and API image/TTS spend is never written there — so
    it only ever measures subscription steps, which log 0.0. Read as a general spend cap
    it was a control that measured nothing: a $5.00 limit standing next to a $17-27 video
    that it passed every time. Scoping the key name to what it actually governs makes that
    legible. API spend is governed per-run by card authorisation instead.

    Both keys are read so `governance/` (human-edited only) can be renamed independently of
    this file, in either order, with no window where the gate silently falls back to
    DEFAULT_LIMIT and quietly stops reflecting the configured value.
    """
    f = Path(repo_root) / "governance" / "budget.yaml"
    if f.exists():
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        for key in ("daily_subscription_usd_limit", "daily_usd_limit"):
            if key in data:
                return float(data[key])
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


def _usage_ledger_state_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "kb-usage-ledger"


_LOCK_STALE_SECONDS = 600  # 10 minutes


def _maybe_run_usage_ledger(root: Path) -> None:
    """Best-effort, NON-BLOCKING, fail-open: launches usage_ledger.py DETACHED for yesterday if
    that day's file doesn't exist yet, then returns immediately -- the ledger file appears in time
    for the NEXT session, not this one. NEVER affects preamble's PASS/FAIL verdict (ruling:
    measure only) -- called only from main(), never from check(), so a library caller
    (codex_dispatch.py calls preamble.check() on every dispatch) never pays this cost.

    fix round 1, C1c: this used to call `subprocess.run(..., timeout=5)` SYNCHRONOUSLY. On a real
    machine with real transcript volume, usage_ledger.py's own collection step alone measured
    28-37s (task-1-report.md's live run) -- every preamble run hit the 5s timeout and the daily
    ledger never landed. A detached launch removes the wait entirely; a lock file (`<date>.lock`,
    stale after 10 minutes) under this state dir keeps concurrent preamble invocations (many
    dispatches in flight at once) from launching a duplicate parser for the same day. Log output
    goes to `<date>.log` in the same dir -- nothing is printed here, since nothing is waited on.
    """
    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    ledger_file = Path(root) / "ledgers" / "usage" / f"{yesterday}.tsv"
    if ledger_file.exists():
        return
    script = Path(root) / "scripts" / "usage_ledger.py"
    if not script.exists():
        return

    state_dir = _usage_ledger_state_dir()
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    lock_file = state_dir / f"{yesterday}.lock"
    now = time.time()
    try:
        if lock_file.exists() and (now - lock_file.stat().st_mtime) < _LOCK_STALE_SECONDS:
            return  # another launcher started recently -- do not launch a second parser
        lock_file.write_text(str(now), encoding="utf-8")
    except OSError:
        return

    log_path = state_dir / f"{yesterday}.log"
    for bin_name in ("py", "python"):
        args = [bin_name] + (["-3"] if bin_name == "py" else []) + [str(script), "--date", yesterday]
        try:
            with open(log_path, "ab") as log:
                kwargs = dict(cwd=str(root), stdin=subprocess.DEVNULL, stdout=log, stderr=log)
                if sys.platform == "win32":
                    kwargs["creationflags"] = (
                        subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                    )
                else:
                    kwargs["start_new_session"] = True
                subprocess.Popen(args, **kwargs)
            return
        except OSError:
            continue


def main() -> int:
    root = Path.cwd()
    _maybe_run_usage_ledger(root)
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
