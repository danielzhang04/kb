import time
from datetime import datetime, timedelta, timezone

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
    import os
    root = tmp_path
    appdata = tmp_path / "appdata"
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
