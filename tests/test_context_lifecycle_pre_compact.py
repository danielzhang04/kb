# tests/test_context_lifecycle_pre_compact.py
"""Context-lifecycle PreCompact hook (U8) — deterministic extraction, ZERO spend, fail-open.

The zero-spend assertion is the one that matters: ECC's equivalent shells out to `claude -p` to have
a model write the summary. This hook must contain no subprocess reference at all, so a compaction can
never quietly bill. If someone reintroduces spawnSync/exec here, this file fails.
"""
import json
import os
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "scripts" / "hooks" / "context_lifecycle_pre_compact.js"
STORE = REPO / "scripts" / "hooks" / "lib" / "context_store.js"

SESSION = "precompact-session"


def transcript(tmp_path: Path, turns: int = 4) -> Path:
    path = tmp_path / "transcript.jsonl"
    rows = []
    for i in range(turns):
        rows.append(
            json.dumps({"type": "user", "message": {"content": [{"type": "text", "text": f"do step {i}"}]}})
        )
        rows.append(
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {"type": "text", "text": f"working on step {i}"},
                            {"type": "tool_use", "name": "Read", "input": {"file_path": "x.md"}},
                        ]
                    },
                }
            )
        )
    rows.append("{ this line is not json")  # a live transcript's partial trailing line
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return path


def run_hook(store_dir: Path, payload: bytes, turns=None):
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)}
    if turns is not None:
        env["KB_PRECOMPACT_TURNS"] = str(turns)
    return subprocess.run(["node", str(HOOK)], input=payload, capture_output=True, env=env)


def event(transcript_path, session=SESSION):
    return json.dumps(
        {
            "hook_event_name": "PreCompact",
            "session_id": session,
            "transcript_path": str(transcript_path),
            "trigger": "auto",
        }
    ).encode()


def summary_of(store_dir: Path, session=SESSION):
    body = (
        f"const store = require({json.dumps(str(STORE))});"
        f"const s = store.readStore({json.dumps(session)});"
        "process.stdout.write(JSON.stringify(store.sectionBody(s, store.HEADINGS.RESUMED_SUMMARY)));"
    )
    result = subprocess.run(
        ["node", "-e", body],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)},
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    return json.loads(result.stdout.decode("utf-8"))


def test_hook_source_makes_no_subprocess_call():
    """No LLM, no shell-out — the deliberate divergence from ECC's `claude -p` summarizer."""
    source = HOOK.read_text(encoding="utf-8")
    code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", source)  # strip comments; the rationale mentions them
    for forbidden in ("spawnSync", "spawn(", "execFile", "execSync", "exec(", "child_process", "claude -p"):
        assert forbidden not in code, forbidden
    assert "require(\"http" not in code and "require(\"net\"" not in code


def test_writes_the_resumed_summary_section(tmp_path):
    store_dir = tmp_path / "store"
    r = run_hook(store_dir, event(transcript(tmp_path)))
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"  # PreCompact takes no structured output
    assert r.stderr == b""

    summary = summary_of(store_dir)
    assert summary is not None
    assert "- user: do step 3" in summary
    assert "- assistant: working on step 3 [tool: Read]" in summary
    # Tool INPUT is never recorded — only the tool name.
    assert "x.md" not in summary


def test_keeps_only_the_last_n_turns(tmp_path):
    store_dir = tmp_path / "store"
    run_hook(store_dir, event(transcript(tmp_path, turns=20)), turns=5)
    lines = summary_of(store_dir).splitlines()
    assert len(lines) == 5
    assert lines[-1] == "- assistant: working on step 19 [tool: Read]"


def test_extraction_is_deterministic(tmp_path):
    path = transcript(tmp_path)
    a, b = tmp_path / "a", tmp_path / "b"
    run_hook(a, event(path))
    run_hook(b, event(path))
    assert (a / f"{SESSION}.ctx.md").read_bytes() == (b / f"{SESSION}.ctx.md").read_bytes()


def test_summary_is_redacted(tmp_path):
    path = tmp_path / "secret.jsonl"
    path.write_text(
        json.dumps(
            {
                "type": "user",
                "message": {"content": [{"type": "text", "text": "use AKIA0123456789ABCDEF now"}]},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    store_dir = tmp_path / "store"
    run_hook(store_dir, event(path))
    summary = summary_of(store_dir)
    assert "AKIA0123456789ABCDEF" not in summary
    assert "<REDACTED>" in summary


def test_missing_transcript_is_a_noop(tmp_path):
    store_dir = tmp_path / "store"
    r = run_hook(store_dir, event(tmp_path / "nope.jsonl"))
    assert r.returncode == 0
    assert r.stdout.decode("utf-8").strip() == "{}"
    assert r.stderr == b""
    assert not store_dir.exists() or not list(store_dir.glob("*.ctx.md"))


def test_existing_sections_survive_a_write(tmp_path):
    store_dir = tmp_path / "store"
    seed = (
        f"const store = require({json.dumps(str(STORE))});"
        f"store.writeStore({json.dumps(SESSION)}, [{{heading: 'North star', body: 'keep me'}}]);"
    )
    subprocess.run(
        ["node", "-e", seed],
        capture_output=True,
        env={**os.environ, "KB_CONTEXT_STORE_DIR": str(store_dir)},
        check=True,
    )
    run_hook(store_dir, event(transcript(tmp_path)))
    text = (store_dir / f"{SESSION}.ctx.md").read_text(encoding="utf-8")
    assert "## North star" in text and "keep me" in text
    assert "## Resumed-session summary" in text


def test_malformed_stdin_and_bad_session_id_are_noops(tmp_path):
    store_dir = tmp_path / "store"
    bad = run_hook(store_dir, b"{not json")
    assert bad.returncode == 0 and bad.stdout.decode("utf-8").strip() == "{}"

    unsafe = run_hook(store_dir, event(transcript(tmp_path), session="../../escape"))
    assert unsafe.returncode == 0 and unsafe.stdout.decode("utf-8").strip() == "{}"
    assert not list(tmp_path.glob("**/*escape*"))
