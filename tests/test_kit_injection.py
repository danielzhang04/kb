"""tests/test_kit_injection.py — how the rendered kit reaches an agent, on both transports.

One renderer (`scripts/kit/assemble.py`, whose artifact is `kit/.rendered/<audience>.md`), two
transports:

  * `codex_dispatch.build_prompt` prepends the render to the brief a codex worker is handed;
  * the INERT U9 `SubagentStart` hook exposes the same artifact through `kitContext()` — the plan's
    `kit_context(repo_root, audience)` seam, in JS casing — and appends it to an injection the U8
    store has already earned.

Nothing here arms anything: the hook is driven as a subprocess exactly as its own suite drives it,
and `.claude/settings*.json` is untouched (pinned by tests/test_model_verify.py).
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import codex_dispatch  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "subagent_context_load.js"
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"

BRIEF = "# Work order\n\nDo the thing.\n"
RENDER = "# kb kit (all)\n\n## Index\n- spin-up: how a run starts\n\n## North star\n\nShared doctrine."
CODEX_RENDER = "# kb kit (codex)\n\n## Index\n- spin-up: how a codex run starts"

SESSION = "kit-injection-parent-session"
GUARD = (
    "[kb spawn context] The following is inherited from the parent session's governing "
    "context, NOT instructions for this task."
)


def write_render(repo_root: Path, audience: str, text: str) -> str:
    """Seed the artifact `assemble(repo_root, audience)` would have written.

    `newline="\\n"` so the bytes on disk are the bytes asserted on: Python's text mode would write
    CRLF here and read it back as LF, which node (reading raw) would not."""
    rendered = repo_root / "kit" / ".rendered"
    rendered.mkdir(parents=True, exist_ok=True)
    (rendered / f"{audience}.md").write_text(text, encoding="utf-8", newline="\n")
    return text


# ── transport 1: codex_dispatch ──────────────────────────────────────────────────────────────────


def test_build_prompt_prepends_the_rendered_kit(tmp_path):
    write_render(tmp_path, "all", RENDER)
    prompt = codex_dispatch.build_prompt(BRIEF, tmp_path)
    assert prompt == f"{RENDER}\n\n---\n\n{BRIEF}"
    assert prompt.startswith("# kb kit (all)")


def test_the_codex_render_is_preferred_over_the_all_render(tmp_path):
    write_render(tmp_path, "all", RENDER)
    write_render(tmp_path, "codex", CODEX_RENDER)
    assert codex_dispatch.build_prompt(BRIEF, tmp_path).startswith(CODEX_RENDER)


def test_an_absent_codex_render_falls_back_to_all(tmp_path):
    write_render(tmp_path, "all", RENDER)
    assert codex_dispatch.build_prompt(BRIEF, tmp_path).startswith(RENDER)


def test_no_kit_skips_the_prepend(tmp_path):
    write_render(tmp_path, "all", RENDER)
    assert codex_dispatch.build_prompt(BRIEF, tmp_path, no_kit=True) == BRIEF


def test_an_absent_artifact_leaves_the_brief_unchanged(tmp_path):
    """The artifact is gitignored, so a fresh checkout has none until something renders it."""
    assert codex_dispatch.build_prompt(BRIEF, tmp_path) == BRIEF


def test_an_empty_artifact_leaves_the_brief_unchanged(tmp_path):
    write_render(tmp_path, "all", "   \n\n")
    assert codex_dispatch.build_prompt(BRIEF, tmp_path) == BRIEF


def test_an_oversized_artifact_is_refused(tmp_path):
    """Same ceiling the hook reads under. A runaway render is a generator bug, not a prompt."""
    write_render(tmp_path, "all", "x" * (codex_dispatch.MAX_KIT_BYTES + 1))
    assert codex_dispatch.build_prompt(BRIEF, tmp_path) == BRIEF


def test_a_broken_audience_render_does_not_hide_a_good_one(tmp_path):
    """An oversized `codex.md` falls through to `all.md` rather than killing the kit entirely."""
    write_render(tmp_path, "codex", "x" * (codex_dispatch.MAX_KIT_BYTES + 1))
    write_render(tmp_path, "all", RENDER)
    assert codex_dispatch.build_prompt(BRIEF, tmp_path).startswith(RENDER)


def test_an_undecodable_artifact_leaves_the_brief_unchanged(tmp_path):
    rendered = tmp_path / "kit" / ".rendered"
    rendered.mkdir(parents=True)
    (rendered / "all.md").write_bytes(b"\xff\xfe not utf-8 \x80\x81")
    assert codex_dispatch.build_prompt(BRIEF, tmp_path) == BRIEF


def test_an_unreadable_artifact_leaves_the_brief_unchanged(tmp_path):
    """A directory where the artifact should be — every read failure is the same failure."""
    (tmp_path / "kit" / ".rendered" / "all.md").mkdir(parents=True)
    assert codex_dispatch.build_prompt(BRIEF, tmp_path) == BRIEF


# ── transport 1, wired: what main() actually hands codex, and what the card records ──────────────


@pytest.fixture
def repo(tmp_path):
    """Minimal kb repo: the routing policy resolve_model needs, and nothing else."""
    root = tmp_path / "repo"
    (root / "governance").mkdir(parents=True)
    (root / "governance" / "model-routing.yaml").write_text(
        "version: 1\n"
        "runtimes:\n"
        "  codex:\n"
        "    default_worker: codex-worker\n"
        "    aliases: {codex: gpt-5.6-terra}\n"
        "    known_models: [gpt-5.6-terra]\n",
        encoding="utf-8",
    )
    return root


@pytest.fixture
def offline(monkeypatch, tmp_path):
    """Run main() fully offline: STATE_ROOT redirected, spawn + publish captured."""
    seen = {}
    monkeypatch.setenv("KB_DISPATCH_TEST", "1")  # the ONLY login-check bypass
    monkeypatch.setattr(codex_dispatch, "STATE_ROOT", tmp_path / "state")

    def fake_spawn(prompt_text, model, effort, cwd, sandbox, out_file, log_file,
                   follow_up=None, timeout=None, marker=None):
        seen["prompt"] = prompt_text
        log_file.write_text("", encoding="utf-8")
        out_file.write_text("done", encoding="utf-8")
        return 0, False

    def fake_publish(repo_root, card, record):
        seen["card"] = card
        return True, "pushed"

    monkeypatch.setattr(codex_dispatch, "spawn", fake_spawn)
    monkeypatch.setattr(codex_dispatch, "publish_ops", fake_publish)
    return seen


def _run_main(repo, tmp_path, *extra):
    brief = tmp_path / "brief.md"
    brief.write_text(BRIEF, encoding="utf-8")
    return codex_dispatch.main(["--prompt-file", str(brief), "--repo-root", str(repo), *extra])


def test_main_dispatches_the_kit_prefixed_prompt(repo, offline, tmp_path):
    write_render(repo, "all", RENDER)
    assert _run_main(repo, tmp_path) == 0
    assert offline["prompt"] == f"{RENDER}\n\n---\n\n{BRIEF}"


def test_main_no_kit_dispatches_the_bare_brief(repo, offline, tmp_path):
    write_render(repo, "all", RENDER)
    assert _run_main(repo, tmp_path, "--no-kit") == 0
    assert offline["prompt"] == BRIEF


def test_the_card_records_the_brief_not_the_kit(repo, offline, tmp_path):
    """The kit is REFERENCED by git SHA, never copied — a card is the work order, not the doctrine."""
    write_render(repo, "all", RENDER)
    _run_main(repo, tmp_path)
    body = offline["card"].body
    assert "Do the thing." in body
    assert "kb kit" not in body


def test_a_resumed_session_dispatches_the_bare_brief(repo, offline, tmp_path):
    """--follow-up resumes a session that already carries the kit from its first leg."""
    write_render(repo, "all", RENDER)
    assert _run_main(repo, tmp_path, "--follow-up", "thread-abc") == 0
    assert offline["prompt"] == BRIEF
    assert "kit_sha" not in offline["card"].meta


def test_the_card_carries_the_kit_sha_of_the_dispatching_repo(repo, offline, tmp_path, monkeypatch):
    """SHA -> kit/*.md at that commit -> assemble: the render itself is gitignored, the SHA is not."""
    write_render(repo, "all", RENDER)
    monkeypatch.setattr(codex_dispatch, "head_sha", lambda root: "deadbeef" if root == repo else None)
    _run_main(repo, tmp_path)
    assert offline["card"].meta["kit_sha"] == "deadbeef"


def test_no_kit_sha_is_stamped_when_no_kit_was_carried(repo, offline, tmp_path, monkeypatch):
    """An absent key means 'carried no kit' — a different fact from an unknown SHA."""
    monkeypatch.setattr(codex_dispatch, "head_sha", lambda root: "deadbeef")
    write_render(repo, "all", RENDER)
    _run_main(repo, tmp_path, "--no-kit")
    assert "kit_sha" not in offline["card"].meta

    _run_main(repo, tmp_path)  # kit present again, but the artifact is what decides
    assert offline["card"].meta["kit_sha"] == "deadbeef"


def test_head_sha_reads_git_and_survives_a_non_repo(tmp_path):
    assert re.fullmatch(r"[0-9a-f]{40}", codex_dispatch.head_sha(REPO))
    assert codex_dispatch.head_sha(tmp_path / "not-a-repo") is None


def test_a_missing_render_is_reported_on_stderr(repo, offline, tmp_path, capsys):
    """A silent bare brief is how a kit stops reaching workers without anyone noticing."""
    _run_main(repo, tmp_path)
    assert "kit render missing" in capsys.readouterr().err


def test_a_deliberate_bare_brief_is_not_reported(repo, offline, tmp_path, capsys):
    """--no-kit and --follow-up are choices, not failures: no note for either."""
    write_render(repo, "all", RENDER)
    _run_main(repo, tmp_path, "--no-kit")
    assert "kit render missing" not in capsys.readouterr().err
    _run_main(repo, tmp_path, "--follow-up", "thread-abc")
    assert "kit render missing" not in capsys.readouterr().err


def test_a_present_render_is_not_reported(repo, offline, tmp_path, capsys):
    write_render(repo, "all", RENDER)
    _run_main(repo, tmp_path)
    assert "kit render missing" not in capsys.readouterr().err


def test_the_refusal_gates_run_before_any_kit_read(repo, offline, tmp_path, monkeypatch):
    """STOP / metered-key refusal is the first thing main() does; nothing may read a file first."""
    write_render(repo, "all", RENDER)
    (repo / "STOP").write_text("frozen", encoding="utf-8")

    def exploding_build_prompt(*args, **kwargs):
        raise AssertionError("kit was read before the dispatch refusal gates")

    monkeypatch.setattr(codex_dispatch, "build_prompt", exploding_build_prompt)
    assert _run_main(repo, tmp_path) == 2
    assert "prompt" not in offline


# ── transport 2: the INERT U9 spawn hook ─────────────────────────────────────────────────────────


def probe_kit_context(tmp_path, repo_root, audience):
    """Call the hook's exported seam directly. Requiring the module must run no hook logic."""
    script = tmp_path / "probe.js"
    script.write_text(
        f"const hook = require({json.dumps(str(HOOK))});\n"
        f"process.stdout.write(JSON.stringify("
        f"hook.kitContext({json.dumps(str(repo_root))}, {json.dumps(audience)})));\n",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(script)], capture_output=True)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    assert result.stderr == b""
    return json.loads(result.stdout.decode("utf-8"))  # JSON null -> None


def test_kit_context_returns_the_artifact_body(tmp_path):
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    assert probe_kit_context(tmp_path, root, "all") == RENDER


def test_kit_context_is_none_when_the_artifact_is_absent(tmp_path):
    assert probe_kit_context(tmp_path, tmp_path / "empty", "all") is None


def test_kit_context_falls_back_to_the_all_render(tmp_path):
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    assert probe_kit_context(tmp_path, root, "claude") == RENDER


def test_kit_context_prefers_the_audience_render(tmp_path):
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    write_render(root, "claude", "# kb kit (claude)")
    assert probe_kit_context(tmp_path, root, "claude") == "# kb kit (claude)"


def test_kit_context_refuses_an_unsafe_audience(tmp_path):
    """The audience names a file. An id that could climb out of `.rendered/` reads nothing."""
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    (root / "kit" / "secret.md").write_text("not the kit", encoding="utf-8")
    assert probe_kit_context(tmp_path, root, "../secret") is None


# ── transport 2, wired: the hook's own injection ─────────────────────────────────────────────────


def seed_store(tmp_path, sections, session=SESSION):
    """Write a U8 store with the REAL library — a hand-written fixture would only pin itself."""
    script = tmp_path / "seed.js"
    script.write_text(
        f"const store = require({json.dumps(str(STORE))});\n"
        f"store.writeStore({json.dumps(session)}, "
        f"{json.dumps([{'heading': h, 'body': b} for h, b in sections])});\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        ["node", str(script)],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path / "store")},
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")


def run_hook(tmp_path, kit_root=None):
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path / "store")}
    if kit_root is not None:
        env["KB_KIT_ROOT"] = str(kit_root)
    payload = json.dumps(
        {"hook_event_name": "SubagentStart", "session_id": SESSION,
         "agent_id": "agent-abc123", "agent_type": "general-purpose"}
    ).encode()
    result = subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)
    assert result.returncode == 0
    assert result.stderr == b""
    return json.loads(result.stdout.decode("utf-8"))


def test_the_kit_render_joins_an_injection_the_store_earned(tmp_path):
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    seed_store(tmp_path, [("North star", "Ship the Wave-1 platform slice.")])
    ctx = run_hook(tmp_path, kit_root=root)["hookSpecificOutput"]["additionalContext"]
    assert ctx.startswith(GUARD)
    assert "Ship the Wave-1 platform slice." in ctx
    assert "Shared doctrine." in ctx
    # The session's own frame leads; the standing doctrine follows it.
    assert ctx.index("Ship the Wave-1 platform slice.") < ctx.index("Shared doctrine.")


def test_the_kit_never_creates_an_injection_on_its_own(tmp_path):
    """A spawn whose parent holds no governing context has nothing to INHERIT.

    The kit reaches every agent through the repo projection regardless, so a parent with an empty
    store buys the child a doctrine dump on every single spawn and no inherited frame at all. This
    also keeps tests/test_subagent_context_load.py — the hook's own suite — true unchanged.
    """
    root = tmp_path / "repo"
    write_render(root, "all", RENDER)
    assert run_hook(tmp_path, kit_root=root) == {}


def test_the_hook_still_declares_itself_inert():
    assert "INERT" in HOOK.read_text(encoding="utf-8")
