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


def _acquire_lock(lock_file: Path) -> bool:
    """Atomic, TOCTOU-free lock acquisition (fix round 2, item 1): the previous version checked
    `lock_file.exists()` and then `write_text()`'d it as two separate operations, leaving a window
    where two concurrent preamble invocations could both see "no lock" and both launch a parser.
    `os.O_CREAT | os.O_EXCL` makes the create-if-absent check atomic at the OS level -- exactly one
    caller among any number racing on the same path gets `True`.

    A lock that already exists is normally treated as held (return False, no launch). If it is
    older than `_LOCK_STALE_SECONDS`, it is presumed abandoned (a previous launcher crashed or was
    killed without cleanup) and this function removes it and retries the exclusive create ONCE --
    not in an unbounded loop, so a lock that keeps reappearing (e.g. two callers racing on the
    stale path at once) still converges to at most one winner per call rather than spinning.
    """
    for attempt in range(2):
        try:
            fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            # `os.fdopen` TAKES OWNERSHIP of `fd` only once it returns; if it raises (fix wave M1)
            # the descriptor is still ours and leaks unless we close it here. `adopted` is set
            # inside the `with` header's body, so it is True only on the path where fdopen
            # returned and the `with` block owns the close.
            adopted = False
            try:
                with os.fdopen(fd, "w") as f:
                    adopted = True
                    f.write(str(time.time()))
            finally:
                if not adopted:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            return True
        except FileExistsError:
            if attempt == 0:
                try:
                    age = time.time() - lock_file.stat().st_mtime
                except OSError:
                    continue  # the file vanished between our failed create and stat -- retry now
                if age >= _LOCK_STALE_SECONDS:
                    try:
                        lock_file.unlink()
                    except OSError:
                        pass
                    continue  # retry the exclusive create exactly once
            return False
        except OSError:
            return False
    return False


def _launch_usage_ledger(args: list[str], cwd: str, log) -> None:
    """One subprocess.Popen call, detached. On Windows (fix round 2, item 2), also requests
    `CREATE_BREAKAWAY_FROM_JOB`: a parent process running inside a kill-on-close Job Object (common
    for a harness-spawned terminal or subagent) would otherwise have this "detached" child killed
    the instant the parent's job is torn down, defeating the entire point of detaching it. Some job
    objects refuse breakaway (JOB_OBJECT_LIMIT_BREAKAWAY_OK not set on that job) and CreateProcess
    fails outright with that flag set -- caught here and retried ONCE without it, noted in the log
    file rather than silently swallowed. `getattr(..., 0)` guards a subprocess module that somehow
    lacks the constant (not expected on any real Windows Python, but never assumed).
    """
    kwargs = dict(cwd=cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    if sys.platform == "win32":
        base_flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        breakaway = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
        try:
            subprocess.Popen(args, creationflags=base_flags | breakaway, **kwargs)
            return
        except OSError:
            if not breakaway:
                raise
            log.write(
                b"usage_ledger: CREATE_BREAKAWAY_FROM_JOB rejected by this job object, "
                b"retrying detached launch without it\n"
            )
            subprocess.Popen(args, creationflags=base_flags, **kwargs)
            return
    kwargs["start_new_session"] = True
    subprocess.Popen(args, **kwargs)


def _maybe_run_usage_ledger(root: Path, env: dict | None = None) -> None:
    """Best-effort, NON-BLOCKING, fail-open: launches usage_ledger.py DETACHED for yesterday if
    that day's file doesn't exist yet, then returns immediately -- the ledger file appears in time
    for the NEXT session, not this one. NEVER affects preamble's PASS/FAIL verdict (ruling:
    measure only) -- called only from main(), never from check(), so a library caller
    (codex_dispatch.py calls preamble.check() on every dispatch) never pays this cost.

    OPT-IN (fix wave F1, CRITICAL). Nothing happens at all unless `KB_USAGE_LEDGER=1` is in the
    environment. `main()` here is not only run by the operator's shell: the VM runs it too, via
    dashboard/server/write/preambleGate.ts and broker/preambleGate.ts, in a checkout with no
    `ledgers/usage/` and a near-empty `~/.claude/projects`. There the detached parser computed a
    ~zero-row day and `publish_to_ops` OVERWROTE the operator's real TSV + sidecar on ops. The
    variable is set ONLY in the project `.claude/settings.json` `env` block, which is loaded by
    Claude Code sessions on the operator machine and by nothing else -- the VM gates shell out to
    this file without it, so they now skip the launch entirely. (usage_ledger.py additionally
    refuses to write or publish a day with zero Claude rows; belt and buckle.)

    fix round 1, C1c: this used to call `subprocess.run(..., timeout=5)` SYNCHRONOUSLY. On a real
    machine with real transcript volume, usage_ledger.py's own collection step alone measured
    28-37s (task-1-report.md's live run) -- every preamble run hit the 5s timeout and the daily
    ledger never landed. A detached launch removes the wait entirely; `_acquire_lock` (`<date>.lock`,
    stale after 10 minutes) under this state dir keeps concurrent preamble invocations (many
    dispatches in flight at once) from launching a duplicate parser for the same day. Log output
    goes to `<date>.log` in the same dir -- nothing is printed here, since nothing is waited on.
    """
    env = os.environ if env is None else env
    if env.get("KB_USAGE_LEDGER") != "1":
        return

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
    if not _acquire_lock(lock_file):
        return  # another launcher holds the lock (or the atomic create otherwise failed)

    log_path = state_dir / f"{yesterday}.log"
    for bin_name in ("py", "python"):
        args = [bin_name] + (["-3"] if bin_name == "py" else []) + [str(script), "--date", yesterday]
        try:
            with open(log_path, "ab") as log:
                _launch_usage_ledger(args, str(root), log)
            return
        except OSError:
            continue

    # fix wave M1: BOTH interpreters failed to launch, so no parser is running and nothing will
    # ever clear this lock -- holding it would suppress every retry for the next 10 minutes
    # (_LOCK_STALE_SECONDS) for no reason. Release it so the next session tries again immediately.
    try:
        lock_file.unlink()
    except OSError:
        pass


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
