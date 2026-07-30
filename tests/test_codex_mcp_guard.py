"""tests/test_codex_mcp_guard.py — codex_mcp_guard unit tests (subprocess mocked)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import codex_mcp_guard


def test_refuses_when_openai_key_set(monkeypatch, capsys):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    rc = codex_mcp_guard.main([])
    assert rc == 2
    assert "OPENAI_API_KEY" in capsys.readouterr().err


def test_refuses_when_codex_api_key_set(monkeypatch, capsys):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("CODEX_API_KEY", "sk-y")
    rc = codex_mcp_guard.main([])
    assert rc == 2
    assert "CODEX_API_KEY" in capsys.readouterr().err


def test_execs_codex_mcp_server_when_env_clean(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.setattr(codex_mcp_guard.shutil, "which", lambda _: "C:/npm/codex.cmd")
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        class R: returncode = 0
        return R()

    monkeypatch.setattr(codex_mcp_guard.subprocess, "run", fake_run)
    rc = codex_mcp_guard.main([])
    assert rc == 0
    assert seen["cmd"] == ["C:/npm/codex.cmd", "mcp-server"]


def test_refuses_when_codex_not_on_path(monkeypatch, capsys):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.setattr(codex_mcp_guard.shutil, "which", lambda _: None)
    rc = codex_mcp_guard.main([])
    assert rc == 2
    assert "not on PATH" in capsys.readouterr().err
