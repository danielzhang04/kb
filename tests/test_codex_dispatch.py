"""tests/test_codex_dispatch.py — codex_dispatch unit tests (subprocess always mocked)."""
import io
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import codex_dispatch
import routing


@pytest.fixture
def repo(tmp_path):
    """Minimal kb repo: governance policy mirroring the real codex alias table."""
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "model-routing.yaml").write_text(
        "version: 1\n"
        "runtimes:\n"
        "  codex:\n"
        "    default_worker: codex-worker\n"
        "    aliases: {codex-cheap: gpt-5.6-luna, codex: gpt-5.6-terra,"
        " codex-deep: gpt-5.6-sol}\n"
        "    known_models: [gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol]\n",
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def prompt_file(tmp_path):
    p = tmp_path / "p.md"
    p.write_text("hi", encoding="utf-8")
    return p


def _main_env(monkeypatch, tmp_path, result="ok", rc=0):
    """Run main() fully offline: STATE_ROOT redirected, spawn + publish faked.

    Returns the dict the fake spawn records its arguments into."""
    seen = {}
    monkeypatch.setattr(codex_dispatch, "STATE_ROOT", tmp_path / "state")

    def fake_spawn(prompt_text, model, effort, cwd, sandbox, out_file, log_file,
                   follow_up=None, timeout=None):
        seen.update(model=model, effort=effort, cwd=cwd, sandbox=sandbox,
                    follow_up=follow_up, timeout=timeout)
        log_file.write_text("", encoding="utf-8")
        if rc == 0:
            out_file.write_text(result, encoding="utf-8")
        return rc

    monkeypatch.setattr(codex_dispatch, "spawn", fake_spawn)
    monkeypatch.setattr(codex_dispatch, "publish_ops", lambda *a, **k: (True, "pushed"))
    return seen


class _Recorder(io.StringIO):
    """A stdout that records reconfigure() calls (io.StringIO alone has none)."""

    reconfigured = None

    def reconfigure(self, **kw):
        self.reconfigured = kw


def test_billing_guard_refuses_metered_keys():
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
        problems = codex_dispatch.billing_guard({key: "sk-x"}, login_check=False)
        assert problems and key in problems[0]


def test_billing_guard_clean_env_passes():
    assert codex_dispatch.billing_guard({}, login_check=False) == []


def test_billing_guard_login_check_is_bounded(monkeypatch):
    """A wedged `codex login status` must not hang the dispatch forever."""
    seen = {}

    def fake_run(cmd, **kw):
        seen.update(kw)
        class R: returncode = 0
        return R()

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    assert codex_dispatch.billing_guard({}, login_check=True) == []
    assert seen["timeout"] == 15


def test_billing_guard_login_timeout_is_a_problem(monkeypatch):
    def fake_run(cmd, **kw):
        raise codex_dispatch.subprocess.TimeoutExpired(cmd=cmd, timeout=15)

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    problems = codex_dispatch.billing_guard({}, login_check=True)
    assert problems and "timed out" in problems[0]


def test_main_reconfigures_stdout_utf8_and_tolerates_plain_streams(
        repo, prompt_file, tmp_path, monkeypatch):
    """cp1252 stdout crashed on ✓/→/CJK in worker answers; reconfigure kills it."""
    _main_env(monkeypatch, tmp_path, result="✓ → 完了")
    rec = _Recorder()
    monkeypatch.setattr(sys, "stdout", rec)
    assert codex_dispatch.main(["--prompt-file", str(prompt_file),
                                "--repo-root", str(repo)]) == 0
    assert rec.reconfigured == {"encoding": "utf-8", "errors": "replace"}
    assert "✓ → 完了" in rec.getvalue()

    plain = io.StringIO()  # no .reconfigure — must be guarded, not crash
    assert not hasattr(plain, "reconfigure")
    monkeypatch.setattr(sys, "stdout", plain)
    assert codex_dispatch.main(["--prompt-file", str(prompt_file),
                                "--repo-root", str(repo)]) == 0
    assert "✓ → 完了" in plain.getvalue()


def test_main_has_no_budget_cost_gate(repo, prompt_file, tmp_path, monkeypatch):
    """Every dispatch row is structurally $0.0 subscription — a cost gate here
    measures nothing, so preamble.check must be called without a cost function."""
    seen = {}
    _main_env(monkeypatch, tmp_path)

    def fake_check(root, **kw):
        seen.update(kw)
        return []

    monkeypatch.setattr(codex_dispatch.preamble, "check", fake_check)
    assert codex_dispatch.main(["--prompt-file", str(prompt_file),
                                "--repo-root", str(repo)]) == 0
    assert "cost_today_fn" not in seen


def test_spawn_timeout_kills_tree_and_returns_124(tmp_path, monkeypatch):
    killed = {}

    class FakeProc:
        pid = 4242
        returncode = None

        def communicate(self, input=None, timeout=None):
            killed["input"], killed["timeout"] = input, timeout
            raise codex_dispatch.subprocess.TimeoutExpired(cmd="codex", timeout=timeout)

        def wait(self):
            killed["waited"] = True

    def fake_run(cmd, **kw):
        killed["kill_cmd"] = cmd
        class R: returncode = 0
        return R()

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "Popen", lambda *a, **k: FakeProc())
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    rc = codex_dispatch.spawn("x", "gpt-5.6-terra", None, tmp_path, "workspace-write",
                              tmp_path / "o.md", tmp_path / "l.jsonl", timeout=17)
    assert rc == 124
    assert killed["timeout"] == 17 and killed["input"] == b"x" and killed["waited"]
    assert killed["kill_cmd"][:2] == ["taskkill", "/PID"]
    assert "4242" in killed["kill_cmd"]
    assert "/T" in killed["kill_cmd"] and "/F" in killed["kill_cmd"]


def test_main_timeout_reports_failure(repo, prompt_file, tmp_path, monkeypatch, capsys):
    seen = _main_env(monkeypatch, tmp_path, rc=124)
    rc = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                              "--timeout", "30"])
    assert rc == 124 and seen["timeout"] == 30
    assert "FAILED: timeout after 30s" in capsys.readouterr().out


def test_main_timeout_defaults_to_45_minutes(repo, prompt_file, tmp_path, monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    assert codex_dispatch.main(["--prompt-file", str(prompt_file),
                                "--repo-root", str(repo)]) == 0
    assert seen["timeout"] == 2700
    assert seen["sandbox"] == "workspace-write"  # the None sentinel resolves post-parse


def test_resolve_model_alias_and_concrete(repo):
    assert codex_dispatch.resolve_model(repo, "codex") == "gpt-5.6-terra"
    assert codex_dispatch.resolve_model(repo, "codex-deep") == "gpt-5.6-sol"
    assert codex_dispatch.resolve_model(repo, "gpt-5.6-sol") == "gpt-5.6-sol"


def test_resolve_model_unknown_fails_loud(repo):
    with pytest.raises(routing.RoutingError):
        codex_dispatch.resolve_model(repo, "gpt-5.4-mini")  # not in known_models yet


def _fake_popen(monkeypatch, seen, which="codex.cmd"):
    """Capture the exact argv spawn() hands to Popen; never runs anything."""
    class FakeProc:
        pid = 1
        returncode = 0

        def communicate(self, input=None, timeout=None):
            seen["input"], seen["timeout"] = input, timeout
            return b"", b""

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: which)
    monkeypatch.setattr(codex_dispatch.subprocess, "Popen",
                        lambda cmd, **kw: seen.update(cmd=cmd, kw=kw) or FakeProc())


def test_spawn_builds_exact_command(tmp_path, monkeypatch):
    seen = {}
    _fake_popen(monkeypatch, seen, which="C:/npm/codex.cmd")
    out, log = tmp_path / "out.md", tmp_path / "run.jsonl"
    rc = codex_dispatch.spawn("do the thing", "gpt-5.6-sol", "xhigh",
                              tmp_path, "workspace-write", out, log)
    assert rc == 0
    assert seen["cmd"][:4] == ["C:/npm/codex.cmd", "exec", "-", "--model"]
    assert "gpt-5.6-sol" in seen["cmd"] and "--json" in seen["cmd"]
    assert "--output-last-message" in seen["cmd"] and str(out) in seen["cmd"]
    assert "-s" in seen["cmd"] and "workspace-write" in seen["cmd"]
    assert "-c" in seen["cmd"] and "model_reasoning_effort=xhigh" in seen["cmd"]
    assert seen["input"] == b"do the thing"
    assert seen["timeout"] == codex_dispatch.DEFAULT_TIMEOUT


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


def test_walk_state_always_lands_on_done():
    """Records are records: every dispatch card ends `done`; failure lives in
    the Result text and the ledger's codex_exit, not in a `halted` state."""
    import cards
    card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
    cards.claim(card, "codex-worker")
    codex_dispatch.walk_state(card)
    assert card.meta["state"] == "done"


def test_walk_state_unowned_refuses():
    import cards
    card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
    with pytest.raises(cards.ValidationError):
        codex_dispatch.walk_state(card)


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


def test_build_record_failure_is_a_done_record(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text("", encoding="utf-8")
    card, record = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-sol", 1,
        "P", "FAILED: exit 1", log)
    assert card.meta["state"] == "done"
    assert "FAILED: exit 1" in card.body and record["codex_exit"] == 1


class _FakeGit:
    """A git that models ops as a single remote sha, so `publish_ops` can be
    judged on what it actually LANDED rather than on push's exit code."""

    def __init__(self, push_failures=0, remote_lands=True):
        self.calls, self.push_failures, self.remote_lands = [], push_failures, remote_lands
        self.head = 0

    def __call__(self, cmd, **kw):
        cwd = kw.get("cwd")
        self.calls.append((tuple(cmd), cwd))
        verb, out, rc = cmd[1], "", 0
        if verb == "worktree" and cmd[2] == "add":
            Path(cmd[-2]).mkdir(parents=True, exist_ok=True)
        elif verb == "commit":
            self.head += 1
        elif verb == "rev-parse":
            out = f"sha{self.head}\n"
        elif verb == "push":
            if self.push_failures:
                self.push_failures -= 1
                rc = 1
        elif verb == "ls-remote":
            landed = f"sha{self.head}" if self.remote_lands else "sha-someone-else"
            out = f"{landed}\trefs/heads/ops\n"

        class R:
            returncode, stdout, stderr = rc, out, ""
        return R()

    @property
    def verbs(self):
        return [c[0][1] for c in self.calls]


def _publish(monkeypatch, tmp_path, repo, git, card=None):
    import cards
    monkeypatch.setattr(codex_dispatch.subprocess, "run", git)
    monkeypatch.setattr(codex_dispatch, "STATE_ROOT", tmp_path / "state")
    monkeypatch.setattr(codex_dispatch.time, "sleep", lambda _s: None)
    (tmp_path / "state" / "spool").mkdir(parents=True, exist_ok=True)
    if card is None:
        card = cards.new_card("kb-ops", "codex-dispatch", "x", "T1")
        cards.claim(card, "codex-worker")
        codex_dispatch.walk_state(card)
    return codex_dispatch.publish_ops(repo, card, {"usd": 0.0})


def test_publish_ops_happy_path_verifies_the_landing(repo, monkeypatch, tmp_path):
    git = _FakeGit()
    ok, note = _publish(monkeypatch, tmp_path, repo, git)
    assert (ok, note) == (True, "pushed")
    assert git.verbs[:2] == ["fetch", "worktree"]      # fetch ops, then temp worktree
    assert "push" in git.verbs and "commit" in git.verbs
    # the landing is CONFIRMED against the remote, not assumed from push's rc
    assert git.verbs.index("rev-parse") < git.verbs.index("push") < git.verbs.index("ls-remote")
    add_call = next(c for c in git.calls if c[0][1] == "add")
    assert add_call[0][2] == "--"                      # exact-path staging only


def test_publish_ops_rebuilds_on_rejected_push(repo, monkeypatch, tmp_path):
    """A rejected push discards the attempt and REBUILDS on fresh ops — the
    record is re-derived from the new base, never rebased onto it."""
    git = _FakeGit(push_failures=1)
    ok, note = _publish(monkeypatch, tmp_path, repo, git)
    assert (ok, note) == (True, "pushed")
    assert git.verbs.count("push") == 2
    assert git.verbs.count("fetch") == 2               # each attempt re-fetches ops
    assert ("reset", "--hard", "origin/ops") == next(
        c[0][1:4] for c in git.calls if c[0][1] == "reset")
    # a rebuild is FRESH: the discarded attempt's untracked card/row files are
    # cleaned, so the re-append cannot double-write a brand-new day's shard
    second_commit = [i for i, v in enumerate(git.verbs) if v == "commit"][1]
    assert git.verbs.index("reset") < git.verbs.index("clean") < second_commit
    assert git.verbs.count("commit") == 2              # card + row re-applied on top


def test_publish_ops_unlanded_push_is_never_reported_pushed(repo, monkeypatch, tmp_path):
    """REGRESSION (silent destruction): a push whose commit is not on origin/ops
    must never be called 'pushed'. The old rebase+`Everything up-to-date` path
    reported success while the record had been dropped by a conflicted rebase."""
    git = _FakeGit(remote_lands=False)                 # push exits 0, nothing lands
    ok, note = _publish(monkeypatch, tmp_path, repo, git)
    assert not ok
    assert "3 rebuilt attempts" in note and "spooled" in note
    assert git.verbs.count("push") == 3                # tried thrice, believed none
    spooled = list((tmp_path / "state" / "spool").glob("card-*.md"))
    assert len(spooled) == 1 and "## Work order" not in ""  # record survives on disk
    assert spooled[0].read_text(encoding="utf-8").startswith("---")


def test_publish_ops_never_rebases(repo, monkeypatch, tmp_path):
    git = _FakeGit(push_failures=2)
    _publish(monkeypatch, tmp_path, repo, git)
    assert not any("pull" in c[0] or "rebase" in c[0] for c in git.calls)
    source = Path(codex_dispatch.__file__).read_text(encoding="utf-8")
    assert "pull --rebase" not in source and '"pull"' not in source


def test_parse_thread_id(tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text('{"type":"thread.started","thread_id":"019f-abc"}\n'
                   '{"type":"turn.started"}\n', encoding="utf-8")
    assert codex_dispatch.parse_thread_id(log) == "019f-abc"
    log2 = tmp_path / "empty.jsonl"
    log2.write_text("", encoding="utf-8")
    assert codex_dispatch.parse_thread_id(log2) is None


def test_spawn_follow_up_builds_resume_command(tmp_path, monkeypatch):
    seen = {}
    _fake_popen(monkeypatch, seen)
    out, log = tmp_path / "o.md", tmp_path / "l.jsonl"
    rc = codex_dispatch.spawn("more work", None, None, tmp_path, "workspace-write",
                              out, log, follow_up="019f-abc")
    assert rc == 0
    assert seen["cmd"][:5] == ["codex.cmd", "exec", "resume", "019f-abc", "-"]
    assert "--json" in seen["cmd"] and "--output-last-message" in seen["cmd"]
    assert "--model" not in seen["cmd"]
    # resume restores the session's own cwd/sandbox and REJECTS these (live-verified):
    assert "--cd" not in seen["cmd"] and "-s" not in seen["cmd"]


def test_spawn_follow_up_pins_the_model(tmp_path, monkeypatch):
    """A resumed session does NOT keep its model — unpinned, the CLI default
    silently takes over (live-proven), so resume carries `-c model=`."""
    seen = {}
    _fake_popen(monkeypatch, seen)
    codex_dispatch.spawn("more work", "gpt-5.6-terra", "high", tmp_path, "workspace-write",
                         tmp_path / "o.md", tmp_path / "l.jsonl", follow_up="019f-abc")
    assert seen["cmd"][:5] == ["codex.cmd", "exec", "resume", "019f-abc", "-"]
    assert "model=gpt-5.6-terra" in seen["cmd"]
    assert "model_reasoning_effort=high" in seen["cmd"]
    assert "--model" not in seen["cmd"]  # resume rejects the flag; -c is the way


def test_main_follow_up_pins_default_and_explicit_models(repo, prompt_file, tmp_path,
                                                         monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    assert codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                                "--follow-up", "019f-abc"]) == 0
    assert (seen["follow_up"], seen["model"]) == ("019f-abc", "gpt-5.6-terra")
    assert codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                                "--follow-up", "019f-abc", "--model", "codex-deep"]) == 0
    assert seen["model"] == "gpt-5.6-sol"


def test_main_follow_up_refuses_session_shape_flags(repo, prompt_file, tmp_path,
                                                    monkeypatch, capsys):
    """Resume restores the session's own cwd/sandbox and rejects --cd/-s, so
    accepting these silently would lie about where the worker runs."""
    called = []
    monkeypatch.setattr(codex_dispatch, "spawn", lambda *a, **k: called.append(1) or 0)
    for extra in (["--worktree"], ["--sandbox", "read-only"], ["--cwd", str(tmp_path)]):
        rc = codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                                  "--follow-up", "019f-abc"] + extra)
        out = capsys.readouterr().out
        assert rc == 2 and not called
        assert "follow-up" in out and extra[0] in out


def test_ran_model_readback_is_gone(repo, tmp_path):
    """The routed model is now pinned on every path, so it IS the truth — the
    best-effort JSONL read-back that could disagree with it is deleted."""
    assert not hasattr(codex_dispatch, "ran_model")
    log = tmp_path / "l.jsonl"
    log.write_text('{"model":"gpt-5.6-luna"}\n', encoding="utf-8")
    _, record = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-terra", 0, "P", "R", log)
    assert record["model"] == "gpt-5.6-terra"


def test_build_record_escapes_embedded_headings(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text("", encoding="utf-8")
    card, _ = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-terra", 0,
        "## Result\nnot a section", "### Notes\nreal answer", log)
    headings = [ln for ln in card.body.splitlines() if re.match(r"^#{1,6} ", ln)]
    assert headings == ["## Work order", "## Result"]   # only the card's own two
    assert "\\## Result" in card.body and "\\### Notes" in card.body


def test_build_record_target_is_the_actual_cwd(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text("", encoding="utf-8")
    wt = tmp_path / "worktrees" / "0000aaaa"
    card, _ = codex_dispatch.build_record(
        _mk_args(), wt, "0000aaaa-11112222", "gpt-5.6-terra", 0, "P", "R", log)
    assert card.meta["target"] == str(wt)


def test_main_worktree_target_is_the_worktree(repo, prompt_file, tmp_path, monkeypatch):
    seen = _main_env(monkeypatch, tmp_path)
    published = {}
    monkeypatch.setattr(codex_dispatch, "publish_ops",
                        lambda root, card, rec: published.update(card=card) or (True, "pushed"))
    monkeypatch.setattr(codex_dispatch.subprocess, "run",
                        lambda *a, **k: type("R", (), {"returncode": 0})())
    assert codex_dispatch.main(["--prompt-file", str(prompt_file), "--repo-root", str(repo),
                                "--worktree"]) == 0
    target = published["card"].meta["target"]
    assert target == str(seen["cwd"]) and "worktrees" in target


def test_build_record_stamps_workflow_thread(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text('{"type":"thread.started","thread_id":"019f-abc"}\n', encoding="utf-8")
    card, _ = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-terra", 0, "P", "R", log)
    assert card.meta["workflow"] == "019f-abc"
