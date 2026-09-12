"""tests/test_context_guard.py — scripts/hooks/context_guard.js (PreToolUse Read|Bash).

Fail-open everywhere EXCEPT the two named denial classes (exit 2 + '[context-guard BLOCK]' on
stderr). Every test drives the real committed hook + rules file as a subprocess -- never requires
the .js directly (same posture as tests/test_hard_ceiling_guard.py).

Fix round 1 (2026-09-11 review): the guard no longer reads or writes the context store's
'## Session model' note at all -- it ALWAYS tail-reads `event.transcript_path` fresh, and model
detection is structural (JSON.parse each complete tail line, walked from the end, first
`type === "assistant"` record whose `message.model` is a string wins), not a raw regex over the
bytes. Every Read test below supplies a `transcript_path` fixture instead of a store note."""
import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "context_guard.js"
RULES = REPO / "scripts" / "hooks" / "context_guard.rules.yaml"


def run_hook(tmp_path, event, extra_env=None):
    pf = tmp_path / "payload.json"
    pf.write_text(json.dumps(event), encoding="utf-8")
    env = {**os.environ}
    if extra_env:
        env.update(extra_env)
    return subprocess.run(["node", str(HOOK)], input=pf.read_bytes(), capture_output=True, env=env)


def assistant_line(model):
    return json.dumps({"type": "assistant", "message": {"model": model}})


def write_transcript(path_, lines):
    path_.write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_event(cwd, file_path, transcript_path=None):
    event = {"hook_event_name": "PreToolUse", "tool_name": "Read", "cwd": str(cwd),
             "tool_input": {"file_path": str(file_path)}}
    if transcript_path is not None:
        event["transcript_path"] = str(transcript_path)
    return event


def bash_event(command, cwd):
    return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(cwd),
            "tool_input": {"command": command}}


# ── Read: PDF/image + Fable/Opus (model read structurally from the transcript tail) ────────────

def test_pdf_read_denied_for_opus(tmp_path):
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [assistant_line("claude-opus-5")])
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, transcript))
    assert r.returncode == 2
    assert b"[context-guard BLOCK]" in r.stderr
    assert b"haiku" in r.stderr


def test_pdf_read_denied_for_fable(tmp_path):
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [assistant_line("claude-fable-5-1")])
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, transcript))
    assert r.returncode == 2


def test_pdf_read_allowed_for_sonnet(tmp_path):
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [assistant_line("claude-sonnet-5")])
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, transcript))
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_pdf_read_allowed_when_no_transcript(tmp_path):
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf))  # no transcript_path at all
    assert r.returncode == 0


def test_missing_transcript_file_allows(tmp_path):
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, tmp_path / "does-not-exist.jsonl"))
    assert r.returncode == 0


def test_txt_read_allowed_for_opus(tmp_path):
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [assistant_line("claude-opus-5")])
    txt = tmp_path / "notes.txt"
    txt.write_text("hi", encoding="utf-8")
    r = run_hook(tmp_path, read_event(tmp_path, txt, transcript))
    assert r.returncode == 0


# ── structural model detection: no caching, tail-only, tool-result echoes ignored ──────────────

def test_transcript_tail_uses_last_assistant_record_within_the_tail_not_the_head(tmp_path):
    """A huge transcript: a decoy (allowed) assistant model near byte 0, the real (denied) one
    only in the last 64 KB. Getting this right needs a TAIL read, not a head-capped one -- a
    head-capped read would see only the decoy and wrongly allow."""
    transcript = tmp_path / "big.jsonl"
    lines = [assistant_line("claude-sonnet-5")]
    lines += ["x" * 200] * 2000  # far more than 64 KB of non-JSON padding, skipped on parse
    lines.append(assistant_line("claude-fable-5-1"))
    transcript.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert transcript.stat().st_size > 128 * 1024

    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, transcript))
    assert r.returncode == 2  # the tail's fable record wins, not the head's sonnet decoy


def test_tool_result_echoing_a_model_string_does_not_flip_the_guard(tmp_path):
    """The LAST line in the transcript is a user/tool_result record whose text happens to contain
    the literal substring `"model":"claude-opus-5"` -- a raw regex/substring scan over the tail
    bytes would pick THAT up as "the model" (it sorts last) and wrongly deny a haiku session. The
    structural walk must skip it (type is "user", not "assistant") and keep looking backward until
    it finds the real assistant record."""
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [
        assistant_line("claude-haiku-4-5-20251001"),
        json.dumps({
            "type": "user",
            "message": {
                "content": [{
                    "type": "tool_result",
                    "content": 'echoed payload containing the literal text "model":"claude-opus-5"',
                }],
            },
        }),
    ])
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, read_event(tmp_path, pdf, transcript))
    assert r.returncode == 0  # real model is haiku (unguarded); the opus substring must not count


def test_transcript_is_reread_every_call_not_cached(tmp_path):
    """No store, no cache: two calls against the SAME session/transcript path, where the
    transcript's model changes between them (simulating a /resume onto a different model), must
    see the NEW model on the second call, not a stale first-call result."""
    transcript = tmp_path / "session.jsonl"
    write_transcript(transcript, [assistant_line("claude-sonnet-5")])
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    event = read_event(tmp_path, pdf, transcript)

    r1 = run_hook(tmp_path, event)
    assert r1.returncode == 0  # sonnet -- allowed

    write_transcript(transcript, [assistant_line("claude-fable-5-1")])
    r2 = run_hook(tmp_path, event)
    assert r2.returncode == 2  # fable now -- denied; proves no stale cached value survived


# ── Bash: pytest / git log / find / — with escapes ───────────────────────────────────────────

def test_pytest_without_filter_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/", tmp_path))
    assert r.returncode == 2
    assert b"pytest -q" in r.stderr


def test_pytest_with_q_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/ -q", tmp_path))
    assert r.returncode == 0


def test_pytest_piped_to_tail_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/ | tail -n 30", tmp_path))
    assert r.returncode == 0


def test_git_log_unbounded_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("git log", tmp_path))
    assert r.returncode == 2


def test_git_log_with_n_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("git log -n 20", tmp_path))
    assert r.returncode == 0


def test_git_log_oneline_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("git log --oneline -n 20", tmp_path))
    assert r.returncode == 0


def test_find_root_denied(tmp_path):
    r = run_hook(tmp_path, bash_event("find / -name '*.log'", tmp_path))
    assert r.returncode == 2


def test_find_scoped_allowed(tmp_path):
    r = run_hook(tmp_path, bash_event("find . -name '*.log'", tmp_path))
    assert r.returncode == 0


def test_cat_large_file_denied(tmp_path):
    big = tmp_path / "big.log"
    big.write_bytes(b"x" * (60 * 1024))
    r = run_hook(tmp_path, bash_event(f"cat {big.name}", tmp_path))
    assert r.returncode == 2
    assert b"50 KB" in r.stderr


def test_cat_small_file_allowed(tmp_path):
    small = tmp_path / "small.log"
    small.write_bytes(b"x" * 100)
    r = run_hook(tmp_path, bash_event(f"cat {small.name}", tmp_path))
    assert r.returncode == 0


def test_cat_large_file_piped_to_tail_allowed(tmp_path):
    big = tmp_path / "big.log"
    big.write_bytes(b"x" * (60 * 1024))
    r = run_hook(tmp_path, bash_event(f"cat {big.name} | tail -n 50", tmp_path))
    assert r.returncode == 0


def test_cat_nonexistent_file_fails_open(tmp_path):
    r = run_hook(tmp_path, bash_event("cat does-not-exist.log", tmp_path))
    assert r.returncode == 0  # can't stat it -> not this hook's job to say so


def test_benign_bash_silent(tmp_path):
    r = run_hook(tmp_path, bash_event("echo hello", tmp_path))
    assert r.returncode == 0 and r.stderr.strip() == b""


# ── limit_bytes: 0 must mean zero, not unlimited (fix round 1, Minor) ───────────────────────────

def test_limit_bytes_zero_means_zero_not_unlimited(tmp_path):
    rules_file = tmp_path / "zero-limit-rules.yaml"
    rules_file.write_text(
        "read_extensions: []\n"
        "read_models: []\n"
        "read_message: n/a\n"
        "rules:\n"
        "  - id: bash-cat-zero-limit\n"
        "    tool: Bash\n"
        "    kind: cat-size\n"
        "    trigger: ^\\s*cat\\s+(\\S+)\n"
        "    limit_bytes: 0\n"
        "    message: any cat is too big under this test rule\n",
        encoding="utf-8",
    )
    tiny = tmp_path / "tiny.log"
    tiny.write_bytes(b"x")  # 1 byte -- over a limit of 0
    r = run_hook(tmp_path, bash_event(f"cat {tiny.name}", tmp_path),
                 extra_env={"KB_CONTEXT_GUARD_RULES_PATH": str(rules_file)})
    assert r.returncode == 2
    assert b"any cat is too big" in r.stderr


# ── fail-open ─────────────────────────────────────────────────────────────────────────────────

def test_fail_open_on_garbage(tmp_path):
    r = subprocess.run(["node", str(HOOK)], input=b"not json", capture_output=True)
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_empty_stdin(tmp_path):
    r = subprocess.run(["node", str(HOOK)], input=b"", capture_output=True)
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_foreign_event(tmp_path):
    r = run_hook(tmp_path, {"hook_event_name": "Stop"})
    assert r.returncode == 0 and r.stderr.strip() == b""


def test_fail_open_on_unrecognised_tool(tmp_path):
    r = run_hook(tmp_path, {"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}})
    assert r.returncode == 0


# ── config shape pin ──────────────────────────────────────────────────────────────────────────

def test_rules_file_has_required_rule_ids():
    """Pin the config's shape: context_guard.js's hand-rolled parser (same pattern as
    lib/model_audit.js's parseAllowedModels) has no schema validation -- a reformat that drops a
    field fails OPEN (silently fewer rules), never crashes, so this is the safety net."""
    text = RULES.read_text(encoding="utf-8")
    assert "read_extensions:" in text and "read_models:" in text and "rules:" in text
    for required in ("bash-pytest-no-filter", "bash-git-log-unbounded", "bash-find-root", "bash-cat-large-file"):
        assert f"id: {required}" in text


# ── malformed rules file → fail open ─────────────────────────────────────────────────────────

def test_malformed_rules_file_allows_everything(tmp_path):
    bad_rules = tmp_path / "bad-rules.yaml"
    bad_rules.write_text("this is not: [valid, at, all\nrandom prose with no structure\n", encoding="utf-8")
    r = run_hook(tmp_path, bash_event("pytest tests/", tmp_path),
                 extra_env={"KB_CONTEXT_GUARD_RULES_PATH": str(bad_rules)})
    assert r.returncode == 0


def test_missing_rules_file_allows_everything(tmp_path):
    r = run_hook(tmp_path, bash_event("pytest tests/", tmp_path),
                 extra_env={"KB_CONTEXT_GUARD_RULES_PATH": str(tmp_path / "nope.yaml")})
    assert r.returncode == 0


def test_malformed_rules_file_debug_line_only_with_kb_debug_hooks(tmp_path):
    bad_rules = tmp_path / "bad-rules.yaml"
    bad_rules.write_text("nonsense\n", encoding="utf-8")

    silent = run_hook(tmp_path, bash_event("echo hi", tmp_path),
                       extra_env={"KB_CONTEXT_GUARD_RULES_PATH": str(bad_rules)})
    assert silent.returncode == 0 and silent.stderr.strip() == b""

    loud = run_hook(tmp_path, bash_event("echo hi", tmp_path),
                     extra_env={"KB_CONTEXT_GUARD_RULES_PATH": str(bad_rules), "KB_DEBUG_HOOKS": "1"})
    assert loud.returncode == 0
    assert b"context-guard debug" in loud.stderr
    assert b"[context-guard BLOCK]" not in loud.stderr


# ── settings registration ────────────────────────────────────────────────────────────────────

def test_settings_registers_context_guard_without_dropping_existing_entries():
    settings_path = REPO / ".claude" / "settings.json"
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    pre = data["hooks"]["PreToolUse"]

    matches = [
        entry for entry in pre
        if entry.get("matcher") == "Read|Bash"
        and any("context_guard.js" in h.get("command", "") for h in entry.get("hooks", []))
    ]
    assert len(matches) == 1

    all_commands = " ".join(h["command"] for entry in pre for h in entry.get("hooks", []))
    for expected in (
        "block_no_verify.js",
        "hard_ceiling_guard.js",
        "config_protection.js",
        "model_verify_pretooluse.js",
    ):
        assert expected in all_commands


# ── fix wave M4: a subagent is judged by ITS OWN transcript, not its parent's ──────────────────
#
# Payload shape captured verbatim from a live haiku child on 2026-09-12:
#   {"session_id": "a17f3a89-...", "transcript_path": "...\\C--Users-danie-kb-worktrees-token-
#    discipline\\a17f3a89-....jsonl", "cwd": "...", "agent_id": "a2f82da3ee1efcfea",
#    "agent_type": "general-purpose", "hook_event_name": "PreToolUse", "tool_name": "Read"}
# -- i.e. transcript_path is the PARENT'S, and the child's own transcript lives at
# <dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl (verified on disk,
# assistant records carrying "claude-haiku-4-5-20251001").

def _subagent_layout(tmp_path, parent_model, child_model, session="sess-1", agent="a2f82da3ee1"):
    """The real on-disk shape: <project>/<session>.jsonl next to <project>/<session>/subagents/."""
    project = tmp_path / "C--Users-danie-kb"
    project.mkdir(parents=True, exist_ok=True)
    parent = project / f"{session}.jsonl"
    write_transcript(parent, [assistant_line(parent_model)])
    if child_model is not None:
        subagents = project / session / "subagents"
        subagents.mkdir(parents=True, exist_ok=True)
        write_transcript(subagents / f"agent-{agent}.jsonl", [assistant_line(child_model)])
    return parent, session, agent


def _subagent_read_event(cwd, file_path, parent, session, agent):
    event = read_event(cwd, file_path, parent)
    event["session_id"] = session
    event["agent_id"] = agent
    event["agent_type"] = "general-purpose"
    return event


def test_haiku_subagent_of_an_opus_parent_may_read_a_pdf(tmp_path):
    """THE M4 bug, live-reproduced before the fix: the guard read the PARENT'S transcript for the
    child's Read, found opus, and denied the haiku extractor -- so the very delegation its own
    denial message prescribes ("delegate to a haiku extractor and read its summary") was itself
    blocked. The escape hatch has to work or the rule is just a wall."""
    parent, session, agent = _subagent_layout(tmp_path, "claude-opus-5", "claude-haiku-4-5-20251001")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, _subagent_read_event(tmp_path, pdf, parent, session, agent))
    assert r.returncode == 0, r.stderr


def test_opus_subagent_is_still_denied(tmp_path):
    """Resolution, not exemption: a child that is itself Opus gets the same denial as any Opus."""
    parent, session, agent = _subagent_layout(tmp_path, "claude-haiku-4-5-20251001", "claude-opus-5")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, _subagent_read_event(tmp_path, pdf, parent, session, agent))
    assert r.returncode == 2
    assert b"haiku extractor" in r.stderr


def test_subagent_without_its_own_transcript_falls_back_to_the_parent(tmp_path):
    """A child whose transcript does not exist yet degrades to the OLD behaviour (judge by the
    parent), never to "no model found" -- a fallback that silently disabled the guard would be a
    strictly worse bug than the one being fixed."""
    parent, session, agent = _subagent_layout(tmp_path, "claude-opus-5", None)
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    r = run_hook(tmp_path, _subagent_read_event(tmp_path, pdf, parent, session, agent))
    assert r.returncode == 2


def test_a_top_level_session_is_unaffected_by_the_subagent_path(tmp_path):
    """No agent_id -> the parent transcript is read exactly as before."""
    parent, session, _ = _subagent_layout(tmp_path, "claude-opus-5", "claude-haiku-4-5-20251001")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    event = read_event(tmp_path, pdf, parent)
    event["session_id"] = session
    r = run_hook(tmp_path, event)
    assert r.returncode == 2


def test_a_traversal_shaped_agent_id_is_ignored(tmp_path):
    """Ids come from the harness; one that is not id-shaped is never pasted into a path."""
    parent, session, agent = _subagent_layout(tmp_path, "claude-opus-5", "claude-haiku-4-5-20251001")
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    event = _subagent_read_event(tmp_path, pdf, parent, session, "../../elsewhere")
    r = run_hook(tmp_path, event)
    assert r.returncode == 2  # falls back to the parent (opus), never resolves the odd path


# ── fix wave F2: triggers are anchored to COMMAND POSITION; escapes cover real usage ────────────
#
# A `\bpytest\b` that matched the word anywhere denied `grep pytest`, `cat pytest.ini` and
# `git commit -m "pytest"` -- commands that run no tests at all -- with advice to add `-q`. A
# guard that blocks what it does not understand gets routed around, and then it guards nothing.

import pytest as _pytest  # noqa: E402  (parametrize only; the guard itself is driven as a subprocess)


ALLOWED_COMMANDS = [
    # the three false positives named in the final review
    "grep pytest scripts/hooks/context_guard.js",
    "cat pytest.ini",
    'git commit -m "pytest"',
    # the same shape for the other rules
    'grep -rn "git log" docs/',
    "echo find / is dangerous",
    # real pytest invocations that already bound their own output
    "pytest tests/ -qq",
    "py -3 -m pytest tests/ -q",
    "pytest tests/ --maxfail=1",
    "pytest tests/ -x",
    "pytest --tb=short tests/",
    "pytest tests/test_context_guard.py::test_benign_bash_silent",
    # real git log invocations that are already bounded
    "git log --max-count=5",
    "git log -3",
    "git log main..HEAD",
    "git log -p -- scripts/preamble.py",
    # a bounded find
    "find / -maxdepth 2 -name kb",
]


@_pytest.mark.parametrize("command", ALLOWED_COMMANDS)
def test_command_is_allowed(tmp_path, command):
    (tmp_path / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")  # small, real, stat-able
    r = run_hook(tmp_path, bash_event(command, tmp_path))
    assert r.returncode == 0, f"{command!r} was blocked: {r.stderr!r}"


DENIED_COMMANDS = [
    "pytest tests/",
    "py -3 -m pytest tests/",
    "python -m pytest tests/",
    "git log",
    "find /",
    "find / -name '*.log'",
]


@_pytest.mark.parametrize("command", DENIED_COMMANDS)
def test_command_is_still_denied(tmp_path, command):
    """The widened escapes must not have widened a hole: every command the guard exists for
    still exits 2."""
    r = run_hook(tmp_path, bash_event(command, tmp_path))
    assert r.returncode == 2, f"{command!r} was allowed"
    assert b"[context-guard BLOCK]" in r.stderr


def test_cat_of_a_large_file_is_still_denied(tmp_path):
    big = tmp_path / "big.jsonl"
    big.write_bytes(b"x" * 60_000)
    r = run_hook(tmp_path, bash_event("cat big.jsonl", tmp_path))
    assert r.returncode == 2
    assert b"over 50 KB" in r.stderr


def test_trigger_fires_after_a_command_separator(tmp_path):
    """Command position is not only the start of the line: `;`, `&&`, `||` and `$(...)` all begin
    a new command, and the second command in a chain floods the context exactly as much."""
    for command in ("cd /tmp; pytest tests/", "git fetch && git log", "echo $(git log)"):
        r = run_hook(tmp_path, bash_event(command, tmp_path))
        assert r.returncode == 2, f"{command!r} was allowed"
