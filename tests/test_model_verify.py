# tests/test_model_verify.py
"""The model-verify hook pair (U9) — the audit rows, the routing check, and the never-block promise.

Subprocess idiom mirrors tests/test_regrounding_hook.py: drive the real node hooks with mock events
and read the audit log back off disk.

The single most important assertion in this file is the LAST one: neither hook may ever exit nonzero.
PreToolUse is the event that CAN deny a tool call, so a model-verify hook that ever returned a blocking
exit code would turn a bookkeeping check into a way to break dispatch.

SubagentStop payload fields used here (`agent_transcript_path`, `agent_id`, `agent_type`) are the
harness's own — verified against Claude Code 2.1.234's embedded schema; evidence in
docs/proposals/spawn-model-verify-hooks.md.
"""
import json
import os
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "scripts" / "hooks"
PRETOOLUSE = HOOKS / "model_verify_pretooluse.js"
SUBAGENTSTOP = HOOKS / "model_verify_subagentstop.js"
MODEL_AUDIT_LIB = HOOKS / "lib" / "model_audit.js"
ROUTING = REPO / "governance" / "model-routing.yaml"

SESSION = "session-under-test"


def audit_file(tmp_path: Path) -> Path:
    return tmp_path / "audit" / "model-audit.jsonl"


def run(hook: Path, payload, tmp_path: Path, env_extra=None):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    env = {
        **os.environ,
        "KB_MODEL_AUDIT_PATH": str(audit_file(tmp_path)),
        "KB_CONTEXT_STORE_DIR": str(tmp_path / "store"),
        **(env_extra or {}),
    }
    return subprocess.run(["node", str(hook)], input=raw, capture_output=True, env=env)


def rows(tmp_path: Path):
    path = audit_file(tmp_path)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def task_event(model="sonnet", subagent_type="general-purpose", tool_name="Agent", **extra):
    """A dispatch PreToolUse payload.

    TOOL NAME AND INPUT SHAPE ARE REAL, NOT AUTHORED. The canonical tool is `Agent` — the harness
    bundle declares `var di="Agent",Dj="Task"` and registers `{name:di, aliases:[Dj]}`, and across
    this machine's session transcripts every dispatch `tool_use` block is named "Agent" (80 in a
    12-file sample; zero named "Task"). The `tool_input` keys below are copied from a real block:

        {"type":"tool_use","id":"toolu_01MmNM3zVx9dypHAvCfsHmpg","name":"Agent",
         "input":{"subagent_type":"claude","model":"sonnet","description":"Run 10v10 W2-slice gen",
                  "prompt":"You are a generation conductor…"}}

    (from ~/.claude/projects/C--Users-danie-kb/18cb9b9c-34a2-4bcf-bc2d-2b1998822a77.jsonl)
    """
    event = {
        "hook_event_name": "PreToolUse",
        "session_id": SESSION,
        "tool_name": tool_name,
        "tool_input": {"subagent_type": subagent_type, "description": "do a thing", "prompt": "..."},
    }
    if model is not None:
        event["tool_input"]["model"] = model
    event.update(extra)
    return event


def transcript(tmp_path: Path, models, name="agent.jsonl") -> Path:
    """A subagent transcript.

    Record shape is real too: assistant records carry the id at `message.model` and carry no
    top-level `model` key — checked against live transcripts in the same project directory.
    """
    path = tmp_path / name
    path.write_text(
        "\n".join(
            json.dumps({"type": "assistant", "message": {"model": m, "content": [{"type": "text", "text": "hi"}]}})
            for m in models
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def stop_event(tmp_path: Path, models, agent_type="general-purpose", **extra):
    event = {
        "hook_event_name": "SubagentStop",
        "session_id": SESSION,
        "agent_id": "agent-abc123",
        "agent_type": agent_type,
        "stop_hook_active": False,
        # The subagent's OWN transcript. The base `transcript_path` is the PARENT's.
        "agent_transcript_path": str(transcript(tmp_path, models)),
        "transcript_path": str(tmp_path / "parent.jsonl"),
    }
    event.update(extra)
    return event


# ── PreToolUse: the requested half of the comparison ─────────────────────────────────────────────


def test_an_agent_dispatch_appends_an_audit_row(tmp_path):
    r = run(PRETOOLUSE, task_event(model="sonnet"), tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""

    assert rows(tmp_path) == [
        {
            "event": "PreToolUse",
            "tool": "Agent",
            "session_id": SESSION,
            "agent_id": None,
            "subagent_type": "general-purpose",
            "description": "do a thing",
            "requested_model": "sonnet",
            "verdict": "allowed",
        }
    ]


def test_the_task_alias_is_recorded_too(tmp_path):
    """`Agent` is canonical and `Task` is its registered alias.

    Watching only `Task` — the name the docs lead with — would have recorded NOTHING, forever, while
    the hook looked perfectly healthy. Both names are accepted, and the row keeps the name the
    harness actually sent so a future rename shows up in the log instead of hiding behind a constant.
    """
    run(PRETOOLUSE, task_event(model="sonnet", tool_name="Task"), tmp_path)
    row = rows(tmp_path)[0]
    assert row["tool"] == "Task"
    assert row["verdict"] == "allowed"


def test_rows_carry_no_timestamp(tmp_path):
    """Determinism over convenience: no hook event carries a clock, so no row invents one.

    Two identical dispatches must produce two byte-identical rows — that is what makes the audit
    testable at all. The FILE's mtime is what the dashboard reports as "last written".
    """
    run(PRETOOLUSE, task_event(), tmp_path)
    run(PRETOOLUSE, task_event(), tmp_path)
    written = audit_file(tmp_path).read_text(encoding="utf-8").splitlines()
    assert written[0] == written[1]
    for key in ("ts", "timestamp", "time", "at"):
        assert key not in rows(tmp_path)[0]


def test_every_routing_alias_and_known_model_is_allowed(tmp_path):
    """Both spellings count: a dispatch names an alias, a card may name the full model id."""
    for name in ("haiku", "sonnet", "opus", "fable", "codex", "codex-deep"):
        run(PRETOOLUSE, task_event(model=name), tmp_path)
    for name in ("claude-opus-5", "claude-sonnet-5", "gpt-5.6-terra"):
        run(PRETOOLUSE, task_event(model=name), tmp_path)
    assert [row["verdict"] for row in rows(tmp_path)] == ["allowed"] * 9


def test_an_unknown_model_is_flagged_but_never_blocked(tmp_path):
    r = run(PRETOOLUSE, task_event(model="gpt-4-turbo-typo"), tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"  # no deny decision, ever
    row = rows(tmp_path)[0]
    assert row["verdict"] == "unknown"
    assert row["requested_model"] == "gpt-4-turbo-typo"


def test_an_unnamed_model_is_unspecified_not_a_fault(tmp_path):
    """Omitting `model` means "let routing resolve it" — normal, not a violation."""
    run(PRETOOLUSE, task_event(model=None), tmp_path)
    row = rows(tmp_path)[0]
    assert row["verdict"] == "unspecified"
    assert row["requested_model"] is None


def test_an_unreadable_routing_policy_yields_unverified(tmp_path):
    run(PRETOOLUSE, task_event(model="sonnet"), tmp_path, {"KB_MODEL_ROUTING_PATH": str(tmp_path / "nope.yaml")})
    assert rows(tmp_path)[0]["verdict"] == "unverified"


def test_the_parser_reads_the_committed_governance_file(tmp_path):
    """Pinned against the REAL governance/model-routing.yaml — the hand-rolled scan is a limitation
    the proposal names, so a reformat there must fail a test rather than quietly degrade the audit."""
    script = tmp_path / "parse.js"
    script.write_text(
        f"const a = require({json.dumps(str(MODEL_AUDIT_LIB))});\n"
        f"const fs = require('fs');\n"
        f"const set = a.parseAllowedModels(fs.readFileSync({json.dumps(str(ROUTING))}, 'utf8'));\n"
        f"process.stdout.write(JSON.stringify(Array.from(set).sort()));\n",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(script)], capture_output=True, check=True)
    parsed = set(json.loads(result.stdout.decode("utf-8")))
    # Every alias key, every alias target, and every known_models entry.
    assert {"fable", "opus", "sonnet", "haiku", "codex", "codex-cheap", "codex-deep"} <= parsed
    assert {"claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"} <= parsed
    assert {"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"} <= parsed
    # Structural keys from the surrounding YAML must NOT leak in as model names.
    assert not parsed & {"runtimes", "policy", "aliases", "known_models", "role_default", "version"}


def test_a_non_task_tool_writes_nothing(tmp_path):
    r = run(PRETOOLUSE, {"hook_event_name": "PreToolUse", "session_id": SESSION, "tool_name": "Bash",
                         "tool_input": {"command": "git status"}}, tmp_path)
    assert r.returncode == 0
    assert rows(tmp_path) == []


def test_the_audit_path_env_override_is_honoured(tmp_path):
    elsewhere = tmp_path / "custom" / "log.jsonl"
    run(PRETOOLUSE, task_event(), tmp_path, {"KB_MODEL_AUDIT_PATH": str(elsewhere)})
    assert elsewhere.exists()
    assert audit_file(tmp_path).exists() is False


def test_the_default_audit_path_sits_beside_the_context_stores(tmp_path):
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path / "store")}
    env.pop("KB_MODEL_AUDIT_PATH", None)
    result = subprocess.run(
        ["node", str(PRETOOLUSE)], input=json.dumps(task_event()).encode(), capture_output=True, env=env
    )
    assert result.returncode == 0
    assert (tmp_path / "store" / "model-audit.jsonl").exists()


def test_the_default_audit_path_uses_dashboard_state_root(tmp_path):
    state_root = tmp_path / "daemon-state"
    env = {**os.environ, "DASHBOARD_STATE_ROOT": str(state_root)}
    env.pop("KB_MODEL_AUDIT_PATH", None)
    env.pop("KB_CONTEXT_STORE_DIR", None)
    result = subprocess.run(
        ["node", str(PRETOOLUSE)], input=json.dumps(task_event()).encode(), capture_output=True, env=env
    )
    assert result.returncode == 0
    assert (state_root / "context-lifecycle" / "model-audit.jsonl").exists()


# ── SubagentStop: the observed half ──────────────────────────────────────────────────────────────


def test_a_finished_subagent_appends_the_observed_models(tmp_path):
    r = run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-sonnet-5"]), tmp_path)
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""
    row = rows(tmp_path)[0]
    assert row["event"] == "SubagentStop"
    assert row["agent_id"] == "agent-abc123"
    assert row["agent_type"] == "general-purpose"
    assert row["observed_model"] == "claude-sonnet-5"
    assert row["observed_models"] == ["claude-sonnet-5"]
    # Nothing requested it in this log, so nothing is claimed.
    assert row["requested_model"] is None
    assert row["pairing"] == "none"
    assert row["verdict"] == "unverified"


def test_requested_and_observed_are_compared_when_both_are_known(tmp_path):
    run(PRETOOLUSE, task_event(model="sonnet"), tmp_path)
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-sonnet-5"]), tmp_path)
    row = rows(tmp_path)[-1]
    assert row["requested_model"] == "sonnet"
    assert row["observed_model"] == "claude-sonnet-5"
    # An alias is a substring of its own target throughout governance/model-routing.yaml.
    assert row["verdict"] == "match"
    assert row["pairing"] == "heuristic"


def test_a_subagent_that_ran_on_the_wrong_model_is_recorded_as_a_mismatch(tmp_path):
    """The failure BOSS.md's grading rule exists to catch: asked for opus, ran on haiku."""
    run(PRETOOLUSE, task_event(model="opus"), tmp_path)
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-haiku-4-5"]), tmp_path)
    row = rows(tmp_path)[-1]
    assert row["verdict"] == "mismatch"
    assert row["requested_model"] == "opus"
    assert row["observed_model"] == "claude-haiku-4-5"


def test_the_verdict_uses_the_first_RESPONDING_model_not_any_mentioned_string(tmp_path):
    """BOSS.md's semantics: which model actually served the turns, i.e. the first assistant response.

    A raw grep for `"model":` also matches model ids that are merely CONTENT — a subagent that read a
    settings file or quoted a routing YAML has them in its transcript, ahead of its own first reply.
    Here a haiku run quotes `"model": "claude-opus-5"` in a tool result BEFORE answering. The
    requested model was opus, so a text-grep verdict would report a false `match`; the structural
    read reports the mismatch that actually happened.
    """
    # A STRUCTURED tool result — the read returned an object, so the id sits in the transcript
    # unescaped and a raw `"model":` grep matches it. (A result returned as a plain string would be
    # JSON-escaped and slip past the grep instead; this is the shape that actually fools it.)
    path = tmp_path / "quoting.jsonl"
    path.write_text(
        json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_result", "content": {"file": "settings.json", "model": "claude-opus-5"}}]}}) + "\n"
        + json.dumps({"type": "assistant", "message": {"model": "claude-haiku-4-5",
                                                       "content": [{"type": "text", "text": "done"}]}}) + "\n",
        encoding="utf-8",
    )
    run(PRETOOLUSE, task_event(model="opus"), tmp_path)
    run(SUBAGENTSTOP, {"hook_event_name": "SubagentStop", "session_id": SESSION, "agent_id": "a",
                       "agent_type": "general-purpose", "agent_transcript_path": str(path)}, tmp_path)
    row = rows(tmp_path)[-1]
    assert row["observed_model"] == "claude-haiku-4-5"
    assert row["verdict"] == "mismatch"
    # The quoted id is still reported — supplementary data, never a verdict input.
    assert "claude-opus-5" in row["observed_models"]


def test_a_transcript_with_no_assistant_model_is_unverified_not_matched(tmp_path):
    """Mentions without a response cannot attest anything, however tempting the strings look."""
    path = tmp_path / "mentions-only.jsonl"
    path.write_text(
        json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_result", "content": {"model": "claude-opus-5"}}]}}) + "\n",
        encoding="utf-8",
    )
    run(PRETOOLUSE, task_event(model="opus"), tmp_path)
    run(SUBAGENTSTOP, {"hook_event_name": "SubagentStop", "session_id": SESSION, "agent_id": "a",
                       "agent_type": "general-purpose", "agent_transcript_path": str(path)}, tmp_path)
    row = rows(tmp_path)[-1]
    assert row["observed_model"] is None
    assert row["observed_models"] == ["claude-opus-5"]
    assert row["verdict"] == "unverified"


def test_a_model_switch_mid_run_keeps_the_first_responder_as_the_verdict(tmp_path):
    """The supplementary list is what surfaces the switch; the verdict stays about who answered."""
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-sonnet-5", "claude-opus-5"]), tmp_path)
    row = rows(tmp_path)[-1]
    assert row["observed_model"] == "claude-sonnet-5"
    assert row["observed_models"] == ["claude-sonnet-5", "claude-opus-5"]


def test_pairing_does_not_cross_sessions_or_agent_types(tmp_path):
    run(PRETOOLUSE, task_event(model="opus", subagent_type="Explore"), tmp_path)
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-haiku-4-5"], agent_type="general-purpose"), tmp_path)
    assert rows(tmp_path)[-1]["requested_model"] is None


def test_distinct_models_are_deduplicated_in_first_seen_order(tmp_path):
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-opus-5", "claude-opus-5", "claude-haiku-4-5"]), tmp_path)
    assert rows(tmp_path)[-1]["observed_models"] == ["claude-opus-5", "claude-haiku-4-5"]


def test_a_non_dispatch_tool_is_still_ignored_under_both_names(tmp_path):
    for name in ("Bash", "Read", "TaskCreate", "TaskUpdate"):
        r = run(PRETOOLUSE, {"hook_event_name": "PreToolUse", "session_id": SESSION,
                             "tool_name": name, "tool_input": {"command": "x"}}, tmp_path)
        assert r.returncode == 0, name
    assert rows(tmp_path) == []


def test_the_parent_transcript_is_only_a_fallback(tmp_path):
    """`agent_transcript_path` is the subagent's own; `transcript_path` is the parent session's."""
    parent = transcript(tmp_path, ["claude-fable-5"], name="parent.jsonl")
    event = {
        "hook_event_name": "SubagentStop",
        "session_id": SESSION,
        "agent_id": "agent-abc123",
        "agent_type": "general-purpose",
        "transcript_path": str(parent),
    }
    run(SUBAGENTSTOP, event, tmp_path)
    assert rows(tmp_path)[-1]["observed_models"] == ["claude-fable-5"]


def test_a_missing_or_empty_transcript_writes_no_row(tmp_path):
    missing = {
        "hook_event_name": "SubagentStop",
        "session_id": SESSION,
        "agent_id": "a",
        "agent_type": "t",
        "agent_transcript_path": str(tmp_path / "does-not-exist.jsonl"),
    }
    assert run(SUBAGENTSTOP, missing, tmp_path).returncode == 0
    assert rows(tmp_path) == []

    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    assert run(SUBAGENTSTOP, {**missing, "agent_transcript_path": str(empty)}, tmp_path).returncode == 0
    assert rows(tmp_path) == []


def test_no_transcript_content_reaches_the_audit_log(tmp_path):
    """The hook greps for model ids. It must not carry message text into a log an operator will read."""
    path = tmp_path / "secretive.jsonl"
    path.write_text(
        json.dumps(
            {"type": "assistant", "message": {"model": "claude-opus-5",
                                              "content": [{"type": "text", "text": "SENSITIVE-PAYLOAD-STRING"}]}}
        )
        + "\n",
        encoding="utf-8",
    )
    run(SUBAGENTSTOP, {"hook_event_name": "SubagentStop", "session_id": SESSION, "agent_id": "a",
                       "agent_type": "t", "agent_transcript_path": str(path)}, tmp_path)
    assert "SENSITIVE-PAYLOAD-STRING" not in audit_file(tmp_path).read_text(encoding="utf-8")


# ── both hooks ───────────────────────────────────────────────────────────────────────────────────


def test_both_hooks_fail_open_on_every_junk_input(tmp_path):
    for hook in (PRETOOLUSE, SUBAGENTSTOP):
        for payload in (b"", b"  ", b"{not json", b'"string"', b"[]",
                        json.dumps({"hook_event_name": "SomethingElse"}).encode()):
            r = run(hook, payload, tmp_path)
            assert r.returncode == 0, (hook.name, payload)
            assert r.stdout.decode("utf-8").strip() == "{}", (hook.name, payload)
            assert r.stderr == b"", (hook.name, payload, r.stderr)
        assert rows(tmp_path) == []


def test_an_unwritable_audit_log_never_breaks_the_hook(tmp_path):
    """A directory where the log should be: appendFileSync fails, the hook still answers `{}` / 0."""
    blocked = tmp_path / "blocked.jsonl"
    blocked.mkdir()
    r = run(PRETOOLUSE, task_event(), tmp_path, {"KB_MODEL_AUDIT_PATH": str(blocked)})
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""


def test_neither_hook_ever_exits_nonzero(tmp_path):
    """The never-block promise, asserted over every input any other test in this file uses.

    PreToolUse exit code 2 is how a hook DENIES a tool call. These hooks are report-only, so no path
    may reach it — not a malformed event, not an unknown model, not an unwritable log.
    """
    payloads = [
        b"", b"{not json", b"[]", b"null",
        json.dumps(task_event()).encode(),
        json.dumps(task_event(model="not-a-real-model")).encode(),
        json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Task"}).encode(),
        json.dumps(stop_event(tmp_path, ["claude-opus-5"])).encode(),
    ]
    for hook in (PRETOOLUSE, SUBAGENTSTOP):
        for payload in payloads:
            assert run(hook, payload, tmp_path).returncode == 0, (hook.name, payload)


def test_neither_hook_nor_the_audit_library_makes_a_subprocess_call():
    """Same zero-spend, zero-side-channel guarantee the PreCompact hook carries.

    `child_process` is the load-bearing name: nothing in node reaches a subprocess without it, so its
    absence is the real proof and the spawn/exec spellings below are belt-and-braces. The bare
    `exec(` probe the PreCompact suite uses is deliberately NOT repeated here — the SubagentStop hook
    scans its transcript with `RegExp.prototype.exec`, which is an unrelated use of the same four
    letters, and a probe that fires on it would be noise rather than a guarantee.
    """
    for path in (PRETOOLUSE, SUBAGENTSTOP, MODEL_AUDIT_LIB, HOOKS / "subagent_context_load.js"):
        code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", path.read_text(encoding="utf-8"))
        for forbidden in ("child_process", "spawnSync", "spawn(", "execFile", "execSync", "claude -p"):
            assert forbidden not in code, (path.name, forbidden)
        # No dynamic require can smuggle one in either — every require here is a static literal path.
        for call in re.findall(r"require\(([^)]*)\)", code):
            assert call.strip().startswith(('"', "'")), (path.name, call)


def test_committed_route_fixture_matches_the_writer(tmp_path):
    """The dashboard route's test fixture is generated by THESE hooks, not hand-written.

    `dashboard/server/modelAudit/__fixtures__/model-audit.jsonl` is what the route's parser is pinned
    against. If it were hand-written, the route could pass its tests while the hooks wrote something
    else entirely. Regenerating it here and comparing is what keeps the two implementations honest.

    To REGENERATE after an intentional row-shape change, run this test once with REWRITE=1:
        REWRITE=1 py -3 -m pytest tests/test_model_verify.py -k route_fixture
    """
    fixture = REPO / "dashboard" / "server" / "modelAudit" / "__fixtures__" / "model-audit.jsonl"
    transcript(tmp_path, ["claude-haiku-4-5"])
    # Order matters: the SubagentStop row pairs back to the most recent PreToolUse row with the same
    # session and agent type, so the 'Explore' dispatch in between must NOT be the one it finds.
    run(PRETOOLUSE, task_event(model="opus", subagent_type="general-purpose"), tmp_path)
    run(PRETOOLUSE, task_event(model="gpt-4-turbo-typo", subagent_type="Explore"), tmp_path)
    run(SUBAGENTSTOP, stop_event(tmp_path, ["claude-haiku-4-5"]), tmp_path)

    written = audit_file(tmp_path).read_text(encoding="utf-8")
    # The transcript path is machine-specific, so it never appears in a row — assert that, then compare.
    assert str(tmp_path) not in written
    if os.environ.get("REWRITE"):
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_text(written, encoding="utf-8", newline="\n")
    assert fixture.read_text(encoding="utf-8") == written


def test_the_u9_hook_family_is_inert():
    """The acceptance condition for this unit: BUILT, not armed.

    Nothing in `.claude/**` may reference these hooks, and this unit may not have touched that
    directory at all — a hook that arms itself is the failure mode the whole family is shaped around.
    """
    family = ["subagent_context_load", "model_verify_pretooluse", "model_verify_subagentstop",
              "model_audit", "hook_io"]
    for settings in (REPO / ".claude").glob("settings*.json"):
        text = settings.read_text(encoding="utf-8")
        for name in family:
            assert name not in text, (settings.name, name)

    def git(*args):
        result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return result.stdout

    assert git("diff", "--", ".claude/").strip() == ""
    assert git("diff", "--cached", "--", ".claude/").strip() == ""
    assert git("status", "--porcelain", "--", ".claude/").strip() == ""
    # governance/ is human-edited (CLAUDE.md). This unit reads model-routing.yaml and never edits it.
    assert git("status", "--porcelain", "--", "governance/").strip() == ""


def test_every_new_hook_declares_itself_inert():
    for name in ("subagent_context_load.js", "model_verify_pretooluse.js", "model_verify_subagentstop.js"):
        assert "INERT" in (HOOKS / name).read_text(encoding="utf-8"), name


def test_governance_is_never_written():
    """The routing policy is READ-ONLY to these hooks — governance/ is human-edited (CLAUDE.md)."""
    for path in (PRETOOLUSE, SUBAGENTSTOP, MODEL_AUDIT_LIB):
        code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", path.read_text(encoding="utf-8"))
        for forbidden in ("writeFileSync", "renameSync", "unlinkSync", "rmSync"):
            assert forbidden not in code, (path.name, forbidden)
