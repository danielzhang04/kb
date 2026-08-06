"""Shape tests for the Linux-only owned-card runner."""
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "agent_runner.py"


def test_runner_is_posix_wrapped_and_keeps_the_exclusive_controller_filter():
    shell = SCRIPT.with_suffix(".sh").read_text(encoding="utf-8")
    text = SCRIPT.read_text(encoding="utf-8")
    assert "KB_PYTHON" in shell
    assert 'if (not card.meta.get("execution-controller")' in text
    assert 'card.meta.get("owner") == agent' in text


def test_runner_keeps_stop_and_subscription_billing_guards():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'repo / "STOP"' in text
    assert '"OPENAI_API_KEY"' in text
    assert '"CODEX_API_KEY"' in text
    assert '["codex", "login", "status"]' in text
    assert '"usd": 0.0' in text
    assert '"billing": "subscription"' in text
