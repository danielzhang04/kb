import subprocess
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


def test_maybe_run_usage_ledger_skips_when_file_exists(tmp_path, monkeypatch):
    root = tmp_path
    (root / "ledgers" / "usage").mkdir(parents=True)
    day = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    (root / "ledgers" / "usage" / f"{day}.tsv").write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "run", lambda *a, **k: calls.append(a) or None)
    preamble._maybe_run_usage_ledger(root)
    assert calls == []


def test_maybe_run_usage_ledger_calls_script_when_missing(tmp_path, monkeypatch):
    root = tmp_path
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "usage_ledger.py").write_text("", encoding="utf-8")
    calls = []
    monkeypatch.setattr(preamble.subprocess, "run", lambda *a, **k: calls.append((a, k)) or subprocess.CompletedProcess(a, 0))
    preamble._maybe_run_usage_ledger(root)
    assert len(calls) == 1
    assert calls[0][1]["timeout"] == 5
