"""Shape tests for the deferred Linux owned-card runner boundary."""
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "agent_runner.py"
WRAPPER = SCRIPT.with_suffix(".sh")


def test_posix_runner_is_wrapped_and_keeps_exact_ownership_arbitration():
    shell = WRAPPER.read_text(encoding="utf-8")
    text = SCRIPT.read_text(encoding="utf-8")
    assert "KB_PYTHON" in shell
    assert 'if (not card.meta.get("execution-controller")' in text
    assert 'card.meta.get("owner") == agent' in text


def test_posix_runner_keeps_stop_preamble_and_subscription_guards():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'repo / "STOP"' in text
    assert '"scripts/preamble.py"' in text
    assert '"OPENAI_API_KEY"' in text
    assert '"CODEX_API_KEY"' in text
    assert '["codex", "login", "status"]' in text


def test_posix_runner_activation_and_publication_remain_deferred():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "runner-activation-deferred" in text
    assert "codex exec" not in text
    assert "git push" not in text
    assert "origin/ops" not in text
