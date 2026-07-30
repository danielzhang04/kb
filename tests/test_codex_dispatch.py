"""tests/test_codex_dispatch.py — codex_dispatch unit tests (subprocess always mocked)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import codex_dispatch
import routing


@pytest.fixture
def repo(tmp_path):
    """Minimal kb repo: governance policy naming only gpt-5.6-sol + codex alias."""
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "model-routing.yaml").write_text(
        "version: 1\n"
        "runtimes:\n"
        "  codex:\n"
        "    default_worker: codex-worker\n"
        "    aliases: {codex: gpt-5.6-sol}\n"
        "    known_models: [gpt-5.6-sol]\n",
        encoding="utf-8",
    )
    return tmp_path


def test_billing_guard_refuses_metered_keys():
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
        problems = codex_dispatch.billing_guard({key: "sk-x"}, login_check=False)
        assert problems and key in problems[0]


def test_billing_guard_clean_env_passes():
    assert codex_dispatch.billing_guard({}, login_check=False) == []


def test_resolve_model_alias_and_concrete(repo):
    assert codex_dispatch.resolve_model(repo, "codex") == "gpt-5.6-sol"
    assert codex_dispatch.resolve_model(repo, "gpt-5.6-sol") == "gpt-5.6-sol"


def test_resolve_model_unknown_fails_loud(repo):
    with pytest.raises(routing.RoutingError):
        codex_dispatch.resolve_model(repo, "gpt-5.4-mini")  # not in known_models yet


def test_spawn_builds_exact_command(tmp_path, monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        class R: returncode = 0
        return R()

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "C:/npm/codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    out, log = tmp_path / "out.md", tmp_path / "run.jsonl"
    rc = codex_dispatch.spawn("do the thing", "gpt-5.6-sol", "xhigh",
                              tmp_path, "workspace-write", out, log)
    assert rc == 0
    assert seen["cmd"][:4] == ["C:/npm/codex.cmd", "exec", "-", "--model"]
    assert "gpt-5.6-sol" in seen["cmd"] and "--json" in seen["cmd"]
    assert "--output-last-message" in seen["cmd"] and str(out) in seen["cmd"]
    assert "-s" in seen["cmd"] and "workspace-write" in seen["cmd"]
    assert "-c" in seen["cmd"] and "model_reasoning_effort=xhigh" in seen["cmd"]
    assert seen["kw"]["input"] == b"do the thing"


def test_main_unknown_model_refuses_before_spawn(repo, tmp_path, monkeypatch, capsys):
    called = []
    monkeypatch.setattr(codex_dispatch, "spawn", lambda *a, **k: called.append(1) or 0)
    prompt = tmp_path / "p.md"
    prompt.write_text("hi", encoding="utf-8")
    rc = codex_dispatch.main(["--prompt-file", str(prompt), "--model", "nope",
                              "--repo-root", str(repo)])
    assert rc == 2 and not called
    assert "nope" in capsys.readouterr().out


def _mk_args(**over):
    import argparse
    base = dict(prompt_file="p.md", model="codex", effort=None, cwd=None,
                sandbox="workspace-write", worktree=False, project="kb-ops",
                label="codex-dispatch", repo_root=None)
    base.update(over)
    return argparse.Namespace(**base)


def test_walk_state_done_and_halted():
    import cards
    for final, expect in (("done", "done"), ("halted", "halted")):
        card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
        cards.claim(card, "codex-worker")
        codex_dispatch.walk_state(card, final)
        assert card.meta["state"] == expect


def test_walk_state_unowned_refuses():
    import cards
    card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
    with pytest.raises(cards.ValidationError):
        codex_dispatch.walk_state(card, "done")


def test_build_record_card_shape(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text('{"model":"gpt-5.6-sol"}\n', encoding="utf-8")
    card, record = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-sol", 0,
        "PROMPT BODY", "RESULT BODY", log)
    m = card.meta
    assert (m["runtime"], m["model"]) == ("codex", "gpt-5.6-sol")
    assert m["owner"] == "codex-worker" and m["risk-tier"] == "T1"
    assert m["execution-controller"] == "terminal" and m["state"] == "done"
    assert "## Work order" in card.body and "PROMPT BODY" in card.body
    assert "## Result" in card.body and "RESULT BODY" in card.body
    assert record["usd"] == 0.0 and record["billing"] == "subscription"
    assert record["card_id"] == m["id"] and record["codex_exit"] == 0


def test_build_record_failure_is_halted(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text("", encoding="utf-8")
    card, _ = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-sol", 1,
        "P", "FAILED: exit 1", log)
    assert card.meta["state"] == "halted"


def test_publish_ops_sequence_and_spool_fallback(repo, monkeypatch, tmp_path):
    import cards
    calls = []

    def fake_run(cmd, **kw):
        calls.append((tuple(cmd), kw.get("cwd")))
        class R: returncode = 0 if cmd[1] != "push" else 1
        return R()

    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    monkeypatch.setattr(codex_dispatch, "STATE_ROOT", tmp_path / "state")
    (tmp_path / "state" / "spool").mkdir(parents=True)
    card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
    cards.claim(card, "codex-worker")
    codex_dispatch.walk_state(card, "done")
    ok, note = codex_dispatch.publish_ops(repo, card, {"usd": 0.0})
    assert not ok and "push" in note
    verbs = [c[0][1] for c in calls]
    assert verbs[:2] == ["fetch", "worktree"]          # fetch ops, then temp worktree
    assert "push" in verbs and "add" in verbs and "commit" in verbs
    add_call = next(c for c in calls if c[0][1] == "add")
    assert add_call[0][2] == "--"                      # exact-path staging only
