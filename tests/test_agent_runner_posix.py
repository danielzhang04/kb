"""Shape tests for the deferred Linux owned-card runner boundary."""
from pathlib import Path
import sys


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "agent_runner.py"
WRAPPER = SCRIPT.with_suffix(".sh")
sys.path.insert(0, str(SCRIPT.parent))
import agent_runner  # noqa: E402


def test_posix_runner_log_path_keeps_dashboard_and_xdg_precedence(tmp_path: Path):
    dashboard_root = tmp_path / "dashboard-state"
    xdg_root = tmp_path / "xdg-state"
    assert agent_runner.log_path({
        "DASHBOARD_STATE_ROOT": str(dashboard_root),
        "XDG_STATE_HOME": str(xdg_root),
    }) == dashboard_root / "agent-runner.log"
    assert agent_runner.log_path({
        "XDG_STATE_HOME": str(xdg_root),
    }) == xdg_root / "kb-dashboard" / "agent-runner.log"


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
