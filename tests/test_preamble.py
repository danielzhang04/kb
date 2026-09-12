import os
import sys
import time
from datetime import datetime, timedelta, timezone

import pytest

import preamble


def test_clean_environment_passes(tmp_path):
    problems = preamble.check(tmp_path, env={}, cost_today_fn=lambda root: 0.0)
    assert problems == []


def test_stop_file_blocks(tmp_path):
    (tmp_path / "STOP").write_text("halt", encoding="utf-8")
    problems = preamble.check(tmp_path, env={}, cost_today_fn=lambda root: 0.0)
    assert any("STOP" in p for p in problems)


def test_api_key_blocks(tmp_path):
    problems = preamble.check(tmp_path, env={"ANTHROPIC_API_KEY": "sk-x"},
                              cost_today_fn=lambda root: 0.0)
    assert any("ANTHROPIC_API_KEY" in p for p in problems)


def test_budget_breach_blocks(tmp_path):
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "budget.yaml").write_text("daily_usd_limit: 1.0", encoding="utf-8")
    problems = preamble.check(tmp_path, env={}, cost_today_fn=lambda root: 2.5)
    assert any("budget" in p.lower() for p in problems)


def test_budget_reads_the_scoped_key(tmp_path):
    """The renamed key must be honoured, not silently ignored in favour of DEFAULT_LIMIT.

    Without this, renaming the key in governance/budget.yaml would make the gate fall back
    to DEFAULT_LIMIT (5.00) while still reporting success — swapping one control that
    measures nothing for another. A limit of 1.0 against 2.5 spent must breach; if the key
    were ignored, 2.5 < 5.00 and this would pass silently.
    """
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "budget.yaml").write_text(
        "daily_subscription_usd_limit: 1.0", encoding="utf-8")
    problems = preamble.check(tmp_path, env={}, cost_today_fn=lambda root: 2.5)
    assert any("budget" in p.lower() for p in problems)


def test_scoped_key_wins_over_the_legacy_key(tmp_path):
    """During the rename both keys may be present; the scoped one is authoritative."""
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "budget.yaml").write_text(
        "daily_usd_limit: 100.0\ndaily_subscription_usd_limit: 1.0", encoding="utf-8")
    problems = preamble.check(tmp_path, env={}, cost_today_fn=lambda root: 2.5)
    assert any("budget" in p.lower() for p in problems)


class _FakePopen:
    def __init__(self, *a, **k):
        pass


def test_maybe_run_usage_ledger_skips_when_file_exists(tmp_path, monkeypatch):
    root = tmp_path
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    (root / "ledgers" / "usage").mkdir(parents=True)
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    (root / "ledgers" / "usage" / f"{day}.tsv").write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    preamble._maybe_run_usage_ledger(root)
    assert calls == []


def test_maybe_run_usage_ledger_launches_detached_when_missing(tmp_path, monkeypatch):
    """fix round 1, C1c: the call is now a detached, non-blocking Popen -- not a synchronous
    subprocess.run(timeout=5) -- and it is guarded by a lock file under the state dir."""
    root = tmp_path
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    preamble._maybe_run_usage_ledger(root)
    assert len(calls) == 1
    # never a blocking timeout kwarg -- this call must not wait on the child at all.
    assert "timeout" not in calls[0][1]
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    assert (appdata / "kb-usage-ledger" / f"{day}.lock").exists()


def test_maybe_run_usage_ledger_skips_when_lock_is_fresh(tmp_path, monkeypatch):
    root = tmp_path
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    state_dir = appdata / "kb-usage-ledger"
    state_dir.mkdir(parents=True)
    (state_dir / f"{day}.lock").write_text("recent", encoding="utf-8")  # fresh mtime (just written)
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    preamble._maybe_run_usage_ledger(root)
    assert calls == []  # another launcher is presumed already running -- no duplicate parser


def test_maybe_run_usage_ledger_retries_when_lock_is_stale(tmp_path, monkeypatch):
    root = tmp_path
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    state_dir = appdata / "kb-usage-ledger"
    state_dir.mkdir(parents=True)
    lock_file = state_dir / f"{day}.lock"
    lock_file.write_text("stale", encoding="utf-8")
    stale_time = time.time() - preamble._LOCK_STALE_SECONDS - 1
    os.utime(lock_file, (stale_time, stale_time))
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    preamble._maybe_run_usage_ledger(root)
    assert len(calls) == 1  # a lock older than 10 minutes is treated as abandoned, not active


# ── fix round 2, item 1: _acquire_lock is atomic (os.O_CREAT|O_EXCL), not exists()-then-write() ──

def test_acquire_lock_succeeds_on_an_absent_lock(tmp_path):
    lock = tmp_path / "day.lock"
    assert preamble._acquire_lock(lock) is True
    assert lock.exists()


def test_acquire_lock_fails_when_a_fresh_lock_already_exists(tmp_path):
    lock = tmp_path / "day.lock"
    lock.write_text("held", encoding="utf-8")  # fresh mtime (just written)
    assert preamble._acquire_lock(lock) is False


def test_acquire_lock_removes_and_retries_once_on_a_stale_lock(tmp_path):
    lock = tmp_path / "day.lock"
    lock.write_text("stale", encoding="utf-8")
    stale_time = time.time() - preamble._LOCK_STALE_SECONDS - 1
    os.utime(lock, (stale_time, stale_time))
    assert preamble._acquire_lock(lock) is True
    # the retry created a FRESH lock (not the stale one) -- a second immediate call must now fail.
    assert preamble._acquire_lock(lock) is False


# ── fix round 2, item 2: Windows detach requests CREATE_BREAKAWAY_FROM_JOB, with a fallback ──────

@pytest.mark.skipif(sys.platform != "win32", reason="Windows-only Job Object creationflags")
def test_maybe_run_usage_ledger_includes_breakaway_flag_on_windows(tmp_path, monkeypatch):
    root = tmp_path
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    preamble._maybe_run_usage_ledger(root)
    assert len(calls) == 1
    flags = calls[0][1].get("creationflags", 0)
    assert flags & preamble.subprocess.CREATE_BREAKAWAY_FROM_JOB
    assert flags & preamble.subprocess.DETACHED_PROCESS
    assert flags & preamble.subprocess.CREATE_NEW_PROCESS_GROUP


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-only Job Object creationflags")
def test_maybe_run_usage_ledger_retries_without_breakaway_when_rejected(tmp_path, monkeypatch):
    root = tmp_path
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []

    def fake_popen(*a, **k):
        calls.append((a, k))
        if k.get("creationflags", 0) & preamble.subprocess.CREATE_BREAKAWAY_FROM_JOB:
            raise OSError("breakaway not permitted by this job object")
        return _FakePopen()

    monkeypatch.setattr(preamble.subprocess, "Popen", fake_popen)
    preamble._maybe_run_usage_ledger(root)
    # first attempt (with breakaway) failed and was retried once without it -- not abandoned.
    assert len(calls) == 2
    assert calls[0][1].get("creationflags", 0) & preamble.subprocess.CREATE_BREAKAWAY_FROM_JOB
    assert not (calls[1][1].get("creationflags", 0) & preamble.subprocess.CREATE_BREAKAWAY_FROM_JOB)
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    log_bytes = (appdata / "kb-usage-ledger" / f"{day}.log").read_bytes()
    assert b"BREAKAWAY" in log_bytes


# ── fix wave F1a: the ledger launch is OPT-IN (KB_USAGE_LEDGER=1), never implicit ───────────────

def _ledger_launch_fixture(tmp_path, monkeypatch):
    """A root where the launch WOULD fire: the script exists, yesterday's ledger does not."""
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (tmp_path / "scripts").mkdir(parents=True)
    (tmp_path / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "Popen", lambda *a, **k: calls.append((a, k)) or _FakePopen())
    return appdata, calls


def test_usage_ledger_does_not_launch_without_the_opt_in(tmp_path, monkeypatch):
    """THE critical one. preamble.main() also runs on the VM (dashboard/server/write/preambleGate.ts,
    broker/preambleGate.ts) in a checkout with no ledgers/usage/ and a near-empty ~/.claude/projects,
    where the parser computes a ~zero-row day and publishes it OVER the operator's real ledger on
    ops. Without KB_USAGE_LEDGER=1 in the environment nothing may launch and no lock may appear --
    and the VM gates shell out to preamble.py without that variable, which only the project
    .claude/settings.json env block sets."""
    appdata, calls = _ledger_launch_fixture(tmp_path, monkeypatch)
    monkeypatch.delenv("KB_USAGE_LEDGER", raising=False)
    preamble._maybe_run_usage_ledger(tmp_path)
    assert calls == []
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    assert not (appdata / "kb-usage-ledger" / f"{day}.lock").exists()


def test_usage_ledger_launches_with_the_opt_in(tmp_path, monkeypatch):
    appdata, calls = _ledger_launch_fixture(tmp_path, monkeypatch)
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    preamble._maybe_run_usage_ledger(tmp_path)
    assert len(calls) == 1


def test_usage_ledger_opt_in_only_accepts_exactly_1(tmp_path, monkeypatch):
    """"true"/"yes"/"0" are not the opt-in: a half-configured environment stays off, not on."""
    appdata, calls = _ledger_launch_fixture(tmp_path, monkeypatch)
    for value in ("0", "", "true", "yes"):
        monkeypatch.setenv("KB_USAGE_LEDGER", value)
        preamble._maybe_run_usage_ledger(tmp_path)
    assert calls == []


def test_maybe_run_usage_ledger_reads_the_injected_env_not_the_process_env(tmp_path, monkeypatch):
    """The gate is readable by a caller that passes its own env mapping (same seam as check())."""
    appdata, calls = _ledger_launch_fixture(tmp_path, monkeypatch)
    monkeypatch.delenv("KB_USAGE_LEDGER", raising=False)
    preamble._maybe_run_usage_ledger(tmp_path, env={"KB_USAGE_LEDGER": "1"})
    assert len(calls) == 1


# ── fix wave M1: no fd leak, and no lock kept after a launch that never happened ────────────────

def test_acquire_lock_closes_the_fd_when_fdopen_raises(tmp_path, monkeypatch):
    """os.fdopen takes ownership of the descriptor only once it RETURNS; if it raises, the fd is
    still ours and leaks (a preamble runs on every dispatch -- these add up)."""
    lock = tmp_path / "day.lock"
    closed = []
    real_close = os.close

    def fake_fdopen(fd, *a, **k):
        raise OSError("simulated fdopen failure")

    def fake_close(fd):
        closed.append(fd)
        real_close(fd)

    monkeypatch.setattr(preamble.os, "fdopen", fake_fdopen)
    monkeypatch.setattr(preamble.os, "close", fake_close)
    assert preamble._acquire_lock(lock) is False
    assert len(closed) == 1, "the descriptor opened by os.open was never closed"


def test_lock_is_released_when_every_launch_attempt_fails(tmp_path, monkeypatch):
    """Both `py` and `python` failing to spawn means no parser is running, so nothing will ever
    clear the lock -- keeping it would suppress every retry for the next 10 minutes for nothing."""
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("KB_USAGE_LEDGER", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(appdata))
    (tmp_path / "scripts").mkdir(parents=True)
    (tmp_path / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")

    def always_fails(*a, **k):
        raise OSError("no such interpreter")

    monkeypatch.setattr(preamble.subprocess, "Popen", always_fails)
    preamble._maybe_run_usage_ledger(tmp_path)
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    assert not (appdata / "kb-usage-ledger" / f"{day}.lock").exists()
