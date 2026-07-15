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
