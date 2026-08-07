"""POSIX migration coverage for scripts/codex_dispatch.py."""
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codex_dispatch  # noqa: E402


class _Process:
    pid = 4242

    def kill(self):
        raise AssertionError("POSIX group kill must not fall back to proc.kill()")


def test_posix_timeout_kills_the_process_group(monkeypatch):
    calls = []
    monkeypatch.setattr(codex_dispatch.os, "getpgid", lambda pid: 9001, raising=False)
    monkeypatch.setattr(codex_dispatch.os, "killpg",
                        lambda pgid, sig: calls.append((pgid, sig)), raising=False)
    monkeypatch.setattr(codex_dispatch.time, "sleep", lambda seconds: None)

    codex_dispatch._terminate_worker_tree(_Process(), platform="posix")

    assert calls == [(9001, signal.SIGTERM), (9001, 9)]


def test_windows_timeout_keeps_taskkill_and_never_uses_killpg(monkeypatch):
    calls = []
    monkeypatch.setattr(codex_dispatch.subprocess, "run",
                        lambda *args, **kwargs: type("Done", (), {"returncode": 0})())
    monkeypatch.setattr(codex_dispatch.os, "killpg",
                        lambda *args: calls.append(args), raising=False)

    codex_dispatch._terminate_worker_tree(_Process(), platform="nt")

    assert calls == []


def test_posix_liveness_rejects_a_reused_or_stale_pid(monkeypatch):
    monkeypatch.setattr(codex_dispatch, "process_start_time", lambda pid: 12345)

    assert not codex_dispatch.pid_alive(4242, expected_start_time=12340, platform="posix")


def test_posix_liveness_accepts_a_matching_pid_and_start_time(monkeypatch):
    monkeypatch.setattr(codex_dispatch, "process_start_time", lambda pid: 12345)

    assert codex_dispatch.pid_alive(4242, expected_start_time=12345, platform="posix")


def test_posix_liveness_rejects_a_dead_pid(monkeypatch):
    monkeypatch.setattr(codex_dispatch, "process_start_time", lambda pid: None)

    assert not codex_dispatch.pid_alive(4242, expected_start_time=12345, platform="posix")


def test_state_root_resolution_env_and_platform_defaults():
    assert codex_dispatch.resolve_state_root(
        {"KB_CODEX_DISPATCH_STATE": "C:/override"}, platform="posix"
    ) == Path("C:/override")
    assert codex_dispatch.resolve_state_root({}, platform="posix") == (
        Path.home() / ".local" / "state" / "kb-codex-dispatch"
    )
    assert codex_dispatch.resolve_state_root(
        {"LOCALAPPDATA": "C:/state"}, platform="nt"
    ) == Path("C:/state") / "kb-codex-dispatch"
