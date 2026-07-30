# Codex Subagent Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any kb Claude terminal can delegate a task to a codex worker (chosen model) via one background script call; the result returns as a task notification; a card + cost row lands on `ops` as the audit record.

**Architecture:** One new stdlib+repo-libs Python script (`scripts/codex_dispatch.py`) owns the whole lifecycle synchronously — gates → resolve model → spawn `codex exec` → card/ledger → best-effort ops push — and the *caller* backgrounds it via Bash `run_in_background`. A thin skill teaches the convention; one filter edit in `agent_runner.ps1` prevents double-execution; `.mcp.json` adds the blocking short-call lane.

**Tech Stack:** Python 3 (`py -3`; repo libs `cards.py`, `ledger.py`, `routing.py`, `preamble.py`, all import `yaml` which `py -3` has), pytest, codex-cli 0.145.0, git worktree ops-publish.

**Spec:** `docs/specs/2026-07-30-codex-subagent-dispatch-design.md` — binding; read it before any task.

## Global Constraints

- Interpreter is `py -3`, never `python` (MSYS python lacks yaml).
- All file reads/writes explicit UTF-8 (machine default is cp1252).
- Billing: refuse dispatch if `OPENAI_API_KEY` or `CODEX_API_KEY` set, or `codex login status` non-zero. Never metered fallback.
- Ops publish is best-effort: its failure NEVER fails the dispatch.
- Stage exact paths only — never `git add -A`, never `commit -a`.
- Governance files (`governance/*`) are human-edited only: Task 6 hands Daniel a diff, no agent edits them.
- Local state root: `%LOCALAPPDATA%\kb-codex-dispatch\{spool,logs,worktrees}`.
- Card constants: `runtime: codex`, `owner: codex-worker`, `risk-tier: T1`, `role: work`, `execution-controller: terminal`, ledger writer `codex-direct`.

---

### Task 1: `codex_dispatch.py` — gates, model resolution, spawn, CLI

**Files:**
- Create: `scripts/codex_dispatch.py`
- Test: `tests/test_codex_dispatch.py`

**Interfaces (later tasks rely on these exact names):**
- `codex_bin() -> str` — `shutil.which("codex")`, `SystemExit` if absent.
- `billing_guard(env: dict, login_check: bool = True) -> list[str]` — problem strings, empty = pass.
- `resolve_model(repo_root: Path, model_arg: str) -> str` — alias→concrete via policy `runtimes.codex.aliases`, then `routing.resolve({"runtime":"codex","model":concrete},"work","T1",policy,override)`; raises `routing.RoutingError` on unknown.
- `spawn(prompt_text: str, model: str, effort: str | None, cwd: Path, sandbox: str, out_file: Path, log_file: Path) -> int` — returns codex exit code.
- `main(argv: list[str] | None = None) -> int`
- CLI: `--prompt-file` (required) `--model` (default `codex`) `--effort` (choices low/medium/high/xhigh/max, default None) `--cwd` (default repo root) `--sandbox` (choices read-only/workspace-write, default workspace-write) `--worktree` (flag) `--project` (default `kb-ops`) `--label` (default `codex-dispatch`).

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `py -3 -m pytest tests/test_codex_dispatch.py -v`
Expected: FAIL — `ModuleNotFoundError: codex_dispatch` (collection error is the expected failure at this point).

- [ ] **Step 3: Write the implementation**

```python
"""Direct codex dispatch — a Claude terminal's codex subagent spawner.

Spec: docs/specs/2026-07-30-codex-subagent-dispatch-design.md. Synchronous in
this process; the CALLER backgrounds it (Bash run_in_background) and the
harness notification carries stdout back into the calling conversation.
Card + ledger row are an audit RECORD, never a gate.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards       # noqa: E402
import ledger      # noqa: E402
import preamble    # noqa: E402
import routing     # noqa: E402

STATE_ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "kb-codex-dispatch"
WRITER = "codex-direct"
EFFORTS = ("low", "medium", "high", "xhigh", "max")


def codex_bin() -> str:
    exe = shutil.which("codex")
    if not exe:
        raise SystemExit("codex CLI not on PATH")
    return exe


def billing_guard(env: dict, login_check: bool = True) -> list[str]:
    """Same law as agent_runner.ps1 step 5: subscription only, never metered."""
    problems = [f"{k} is set in the environment — metered billing risk; unset it"
                for k in ("OPENAI_API_KEY", "CODEX_API_KEY") if env.get(k)]
    if login_check and not problems:
        rc = subprocess.run([codex_bin(), "login", "status"], capture_output=True).returncode
        if rc != 0:
            problems.append(f"codex login status exited {rc} — subscription auth missing/stale")
    return problems


def resolve_model(repo_root: Path, model_arg: str) -> str:
    """Alias -> concrete id, then the real routing engine's unknown-model guard.

    Card-rung models are never alias-resolved by routing.resolve, so the alias
    lookup happens here before the card_meta is built."""
    policy = routing.load_policy(repo_root)
    aliases = ((policy.get("runtimes") or {}).get("codex") or {}).get("aliases") or {}
    concrete = str(aliases.get(model_arg, model_arg))
    routed = routing.resolve({"runtime": "codex", "model": concrete}, "work", "T1",
                             policy, routing.load_override(repo_root))
    return routed.model


def spawn(prompt_text: str, model: str, effort: str | None, cwd: Path,
          sandbox: str, out_file: Path, log_file: Path) -> int:
    cmd = [codex_bin(), "exec", "-", "--model", model, "--json",
           "--output-last-message", str(out_file), "--cd", str(cwd), "-s", sandbox]
    if effort:
        cmd += ["-c", f"model_reasoning_effort={effort}"]
    with open(log_file, "wb") as log:
        return subprocess.run(cmd, input=prompt_text.encode("utf-8"),
                              stdout=log, stderr=subprocess.STDOUT).returncode


def ran_model(log_file: Path, fallback: str) -> str:
    """Best-effort read-back of the model id from the JSONL stream (routed-vs-ran)."""
    try:
        m = re.search(r'"model"\s*:\s*"([^"]+)"',
                      log_file.read_text(encoding="utf-8", errors="replace"))
        return m.group(1) if m else fallback
    except OSError:
        return fallback


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--model", default="codex")
    ap.add_argument("--effort", choices=EFFORTS, default=None)
    ap.add_argument("--cwd", default=None)
    ap.add_argument("--sandbox", choices=("read-only", "workspace-write"),
                    default="workspace-write")
    ap.add_argument("--worktree", action="store_true")
    ap.add_argument("--project", default="kb-ops")
    ap.add_argument("--label", default="codex-dispatch")
    ap.add_argument("--repo-root", default=None, help="tests only")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo_root) if args.repo_root else Path(__file__).resolve().parents[1]
    problems = preamble.check(repo_root) + billing_guard(os.environ,
                                                         login_check=args.repo_root is None)
    if problems:
        print("DISPATCH REFUSED: " + "; ".join(problems))
        return 2
    try:
        model = resolve_model(repo_root, args.model)
    except routing.RoutingError as err:
        print(f"DISPATCH REFUSED: {err}")
        return 2

    dispatch_id = cards.new_id()
    for sub in ("spool", "logs", "worktrees"):
        (STATE_ROOT / sub).mkdir(parents=True, exist_ok=True)
    prompt_text = Path(args.prompt_file).read_text(encoding="utf-8")

    cwd = Path(args.cwd) if args.cwd else repo_root
    if args.worktree:
        cwd = STATE_ROOT / "worktrees" / dispatch_id
        subprocess.run(["git", "worktree", "add", "--detach", str(cwd)],
                       cwd=repo_root, check=True)

    spool_path = STATE_ROOT / "spool" / f"{dispatch_id}.json"
    started = time.time()
    spool_path.write_text(json.dumps({
        "id": dispatch_id, "model": model, "effort": args.effort,
        "prompt_file": str(args.prompt_file), "cwd": str(cwd),
        "started": started}, indent=1), encoding="utf-8")

    out_file = STATE_ROOT / "logs" / f"{dispatch_id}.last.md"
    log_file = STATE_ROOT / "logs" / f"{dispatch_id}.jsonl"
    rc = spawn(prompt_text, model, args.effort, cwd, args.sandbox, out_file, log_file)
    result_text = (out_file.read_text(encoding="utf-8") if rc == 0 and out_file.exists()
                   else f"FAILED: codex exec exit {rc}; JSONL log: {log_file}")

    card, record = build_record(args, repo_root, dispatch_id, model, rc,
                                prompt_text, result_text, log_file)
    published, publish_note = publish_ops(repo_root, card, record)
    if published:
        spool_path.unlink(missing_ok=True)

    print(result_text)
    print(f"\n--- codex-dispatch {dispatch_id} | model {ran_model(log_file, model)} | "
          f"exit {rc} | {time.time() - started:.0f}s | ops publish: {publish_note}"
          + (f" | worktree: {cwd} (yours to sweep)" if args.worktree else "")
          + f" | log: {log_file}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
```

`build_record` and `publish_ops` are Task 2; for THIS task's commit, stub them at module level so Task 1's tests pass without them being real:

```python
def build_record(*a, **k):  # implemented in Task 2 (same file, replaced wholesale)
    raise NotImplementedError


def publish_ops(*a, **k):  # implemented in Task 2
    raise NotImplementedError
```

(`test_main_unknown_model_refuses_before_spawn` exits before reaching them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `py -3 -m pytest tests/test_codex_dispatch.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/codex_dispatch.py tests/test_codex_dispatch.py
git commit -m "feat(dispatch): codex_dispatch gates, model resolution, spawn"
```

---

### Task 2: `codex_dispatch.py` — card record, ledger row, ops publish

**Files:**
- Modify: `scripts/codex_dispatch.py` (replace the two Task-1 stubs)
- Test: `tests/test_codex_dispatch.py` (append)

**Interfaces:**
- Consumes: `cards.new_card/claim/stamp_session/stamp_routing/save/LEGAL`, `ledger.append(repo, "cost", WRITER, record)`.
- Produces: `walk_state(card, final: str) -> None` (in-memory legal-transition walk, raises `cards.ValidationError` on illegal), `build_record(args, repo_root, dispatch_id, model, rc, prompt_text, result_text, log_file) -> tuple[cards.Card, dict]`, `publish_ops(repo_root, card, record) -> tuple[bool, str]`.

- [ ] **Step 1: Write the failing tests (append to test file)**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `py -3 -m pytest tests/test_codex_dispatch.py -v`
Expected: new tests FAIL with `NotImplementedError` / missing `walk_state`.

- [ ] **Step 3: Replace the stubs with the implementation**

```python
def walk_state(card: cards.Card, final: str) -> None:
    """Walk the card to its final state through cards.LEGAL, in memory (one
    save happens later, in the publish worktree). Legality is asserted per
    hop so the record can never claim a transition the queue forbids."""
    path = {"done": ("working", "done"),
            "halted": ("working", "stop-requested", "halting", "halted")}[final]
    for nxt in path:
        cur = card.meta["state"]
        if nxt not in cards.LEGAL[cur]:
            raise cards.ValidationError(f"illegal transition {cur} -> {nxt}")
        if nxt == "working" and not card.meta.get("owner"):
            raise cards.ValidationError("cannot start working an unowned card")
        card.meta["state"] = nxt


def build_record(args, repo_root: Path, dispatch_id: str, model: str, rc: int,
                 prompt_text: str, result_text: str, log_file: Path):
    """The audit card + cost row for one finished dispatch. Post-hoc record —
    built after codex exits, never gating anything."""
    body = (f"## Work order\n\n{prompt_text.strip()}\n\n"
            f"## Result\n\n{result_text.strip()}\n")
    card = cards.new_card(args.project, args.label, str(args.cwd or repo_root), "T1",
                          body=body, **{"execution-controller": "terminal"})
    cards.claim(card, "codex-worker")
    cards.stamp_session(card, os.environ.get("CLAUDE_SESSION_ID", dispatch_id))
    cards.stamp_routing(card, "codex", model)
    walk_state(card, "done" if rc == 0 else "halted")
    record = {"usd": 0.0, "billing": "subscription",
              "model": ran_model(log_file, model),
              "card_id": card.meta["id"], "codex_exit": rc}
    return card, record


def publish_ops(repo_root: Path, card: cards.Card, record: dict):
    """One best-effort commit to ops: card + cost row, via a temp detached
    worktree (never touches the caller's checkout or branch). Failure spools
    the card locally and reports — it NEVER fails the dispatch."""
    def git(*a, cwd=repo_root):
        return subprocess.run(["git", *a], cwd=str(cwd), capture_output=True, text=True)

    wt = Path(tempfile.mkdtemp(prefix="codex-dispatch-")) / "wt"
    try:
        if git("fetch", "origin", "ops").returncode != 0:
            return False, _spool_note(card, "fetch origin ops failed")
        if git("worktree", "add", "--detach", str(wt), "origin/ops").returncode != 0:
            return False, _spool_note(card, "worktree add failed")
        card_path = cards.save(card, wt / "queue")
        led_path = ledger.append(wt, "cost", WRITER, record)
        git("add", "--", str(card_path), str(led_path), cwd=wt)
        if git("commit", "-m", f"chore(codex-direct): record {card.meta['id']}",
               cwd=wt).returncode != 0:
            return False, _spool_note(card, "commit failed")
        for _ in range(2):
            if git("push", "origin", "HEAD:refs/heads/ops", cwd=wt).returncode == 0:
                return True, "pushed"
            git("pull", "--rebase", "origin", "ops", cwd=wt)
        return False, _spool_note(card, "push rejected twice")
    finally:
        git("worktree", "remove", "--force", str(wt))
        shutil.rmtree(wt.parent, ignore_errors=True)


def _spool_note(card: cards.Card, why: str) -> str:
    dest = STATE_ROOT / "spool" / f"card-{card.meta['id']}.md"
    fm = "\n".join(f"{k}: {v}" for k, v in card.meta.items())
    dest.write_text(f"---\n{fm}\n---\n\n{card.body}", encoding="utf-8")
    return f"FAILED ({why}) — card spooled at {dest}; re-publish it manually"
```

Delete the Task-1 `NotImplementedError` stubs in the same edit.

- [ ] **Step 4: Run the full test file**

Run: `py -3 -m pytest tests/test_codex_dispatch.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/codex_dispatch.py tests/test_codex_dispatch.py
git commit -m "feat(dispatch): card record, cost row, best-effort ops publish"
```

---

### Task 3: `agent_runner.ps1` claim-filter arbitration

**Files:**
- Modify: `scripts/agent_runner.ps1` (~line 219: the embedded-Python card scan)
- Test: `tests/test_agent_runner.py` (shape assertions on the script text)

**Interfaces:** none — text-level change; the runner claims only cards with NO `execution-controller` value.

- [ ] **Step 1: Update the shape test**

In `tests/test_agent_runner.py`, find the existing assertion(s) matching the scan filter (grep the file for `execution-controller`). Replace the expectation so the test requires the substring `not card.meta.get("execution-controller")` in the script and asserts the old `!= "dashboard"` comparison is GONE:

```python
def test_claim_filter_is_exact_string_arbitration(runner_text):
    assert 'not card.meta.get("execution-controller")' in runner_text
    assert '!= "dashboard"' not in runner_text
```

(Adapt to the file's existing fixture that loads the script text; keep its naming conventions.)

- [ ] **Step 2: Run to verify it fails**

Run: `py -3 -m pytest tests/test_agent_runner.py -v`
Expected: the new/updated assertion FAILS.

- [ ] **Step 3: Edit the runner**

In `scripts/agent_runner.ps1`, replace:

```python
            # Dashboard-managed cards are owned exclusively by the governed execution engine.
            # Legacy runners must never pick them up, even after canonical activation releases them.
            if (card.meta.get("execution-controller") != "dashboard"
```

with:

```python
            # Exact-string arbitration (queueBridge.ts pattern): this legacy runner
            # claims ONLY cards no other executor has stamped. "dashboard" cards belong
            # to the governed engine; "terminal" cards are direct-dispatch records
            # (scripts/codex_dispatch.py) that were already executed — re-running
            # either would double-execute.
            if (not card.meta.get("execution-controller")
```

- [ ] **Step 4: Run the whole runner test file**

Run: `py -3 -m pytest tests/test_agent_runner.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent_runner.ps1 tests/test_agent_runner.py
git commit -m "fix(runner): claim only unstamped cards — never re-execute dispatch records"
```

---

### Task 4: `dispatch-codex` skill

**Files:**
- Create: `skills/curated/dispatch-codex/SKILL.md`
- Regenerate mirrors: `py -3 scripts/sync_skills.py` (updates `.claude/skills/` + `.agents/skills/` + MANIFEST.json — check `--help` for the sync/write flag and use it; never hand-edit the mirrors)

**Interfaces:** consumes Task 1/2's CLI verbatim.

- [ ] **Step 1: Write the skill**

````markdown
---
name: dispatch-codex
description: Delegate a task from this Claude terminal to a background OpenAI Codex worker on a chosen model — Agent-tool feel through kb. Use for "hand this to codex", "codex subagent", "second implementation opinion at scale", or parallel grunt work on the codex side. The result returns as a task notification; a card + cost row lands on ops automatically. Do NOT use for quick sub-2-minute asks (use the codex MCP tool inline) or for Claude-runtime subagents (Agent tool).
---

# dispatch-codex

Spawn a codex worker like an Agent-tool subagent: dispatch, keep working, the
result arrives as a task notification.

## Convention

1. Write the brief to a scratchpad file (UTF-8). Same standard as an Agent-tool
   prompt: name the exact files/functions in scope, the norms to follow, what
   NOT to touch, acceptance criteria. The worker starts cold — the brief is all
   it knows.
2. Dispatch via Bash with `run_in_background: true` — NEVER foreground:

   ```
   py -3 scripts/codex_dispatch.py --prompt-file <brief.md> --model <tier> [--effort xhigh] [--cwd <dir>] [--sandbox read-only] [--worktree]
   ```

3. Keep working. The completion notification carries the worker's final message
   plus a footer (card id, model, duration, ops-publish status, log path).
4. Harvest: read the result, review any diffs yourself, commit yourself. The
   worker NEVER commits. If you passed `--worktree`, the footer names the
   worktree — harvest from it and `git worktree remove` it (leases, not
   real estate).

## Models

- `codex-cheap` (gpt-5.4-mini) — mechanical/bulk work
- `codex` (gpt-5.6-sol, default) — standard build/review work
- `codex-deep` (gpt-5.6-sol + `--effort xhigh`) — hard design/debugging
- Any concrete id in `governance/model-routing.yaml` `runtimes.codex.known_models`
  also works; unknown names refuse loudly before spawning.

## Rules

- Parallel dispatches are fine — each is its own process, card, and notification.
- Default cwd is the repo root with `workspace-write`; pass `--sandbox read-only`
  for pure research, `--worktree` when the task writes broadly or another writer
  shares the tree.
- The dispatch refuses on: STOP file, daily budget breach, `OPENAI_API_KEY`/
  `CODEX_API_KEY` in env, stale codex login, unknown model. Fix the cause; never
  work around a refusal.
- If the footer says ops publish FAILED, the card is spooled under
  `%LOCALAPPDATA%\kb-codex-dispatch\spool\` — surface that to the human.
````

- [ ] **Step 2: Regenerate mirrors**

Run: `py -3 scripts/sync_skills.py --help`, then the sync/write invocation it documents.
Expected: `dispatch-codex` appears in `.claude/skills/` and `.agents/skills/`, MANIFEST.json updated.

- [ ] **Step 3: Commit**

```bash
git add skills/curated/dispatch-codex/ .claude/skills/ .agents/skills/
git commit -m "feat(skills): dispatch-codex — terminal-to-codex delegation convention"
```

---

### Task 5: `.mcp.json` short-call lane

**Files:**
- Create: `.mcp.json` (repo root — none exists today)

- [ ] **Step 1: Write it**

```json
{
  "mcpServers": {
    "codex": {
      "command": "cmd",
      "args": ["/c", "codex", "mcp-server"]
    }
  }
}
```

(`cmd /c` because `codex` is an npm `.cmd` shim — direct spawn of `.cmd` files fails on native Windows.)

- [ ] **Step 2: Verify it loads**

Run: `claude mcp list` from the repo root.
Expected: `codex` listed as a project server (it may prompt for approval on first terminal start — that is expected Claude Code behavior for project `.mcp.json`).

- [ ] **Step 3: Commit**

```bash
git add .mcp.json
git commit -m "feat(mcp): codex mcp-server as the inline short-call lane"
```

---

### Task 6: HUMAN GATE — governance diff for Daniel

**Files (Daniel edits, agent only prepares the diff text):**
- `governance/model-routing.yaml`
- `governance/card-schema.md`

- [ ] **Step 1: Present this exact diff to Daniel** (in-terminal, not as a file):

`governance/model-routing.yaml`, codex block becomes:

```yaml
  codex:
    default_worker: codex-worker  # the identity agent_runner.ps1 -Agent codex-worker owns
    aliases:
      codex: gpt-5.6-sol          # standard worker tier (box default, ~/.codex/config.toml)
      codex-cheap: gpt-5.4-mini   # mechanical/bulk tier
      codex-deep: gpt-5.6-sol     # deep tier = sol; reasoning effort is a dispatch-layer
                                  #  dial (scripts/codex_dispatch.py --effort), never routing's
    known_models: [gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4,
                   gpt-5.4-mini, gpt-5.3-codex-spark]
```

(This also deletes the stale "the codex runner does NOT pass --model today" note — `agent_runner.ps1` passes `--model` when the card names one, and `codex_dispatch.py` always does.)

`governance/card-schema.md`, where `execution-controller` is documented, add the value:

```
`terminal` — direct dispatch record (scripts/codex_dispatch.py): already executed by an
interactive terminal's background worker; no executor may claim it.
```

- [ ] **Step 2: After Daniel applies + commits, verify**

Run: `py -3 -c "import sys; sys.path.insert(0,'scripts'); import codex_dispatch; from pathlib import Path; print(codex_dispatch.resolve_model(Path('.'), 'codex-cheap'))"`
Expected: `gpt-5.4-mini`.

---

### Task 7: Live smoke — the acceptance test

**Files:** none (evidence only). Run from a real kb Claude terminal (the boss session qualifies).

- [ ] **Step 1: Dispatch a trivial read-only task in background**

Brief file (scratchpad): "Read C:/Users/danie/kb/_index.md and reply with the number of projects listed and their names. Do not write any files." Then:

```
py -3 scripts/codex_dispatch.py --prompt-file <brief> --sandbox read-only --label smoke-readonly
```

via Bash `run_in_background: true`.

- [ ] **Step 2: Prove the terminal stays free**

Do any other action (e.g. `git status`) before the notification arrives.

- [ ] **Step 3: Verify the notification + record**

Expected, all four: (a) notification text contains the 3 project names; (b) footer says `ops publish: pushed`; (c) `git show origin/ops:queue/done/<card-id>.md` (after `git fetch origin ops`) shows the card with Work order + Result; (d) `git show origin/ops:ledgers/cost/codex-direct-<today>.tsv` has the row with `usd 0.0`.

- [ ] **Step 4: Parallel dispatch check**

Fire two dispatches in one message (two background Bash calls, different labels). Expected: two notifications, two distinct cards on ops.

- [ ] **Step 5: Record the result**

Append the smoke evidence (card ids, durations) to the PR body / handoff; on FAIL, stop and debug via `%LOCALAPPDATA%\kb-codex-dispatch\logs\<id>.jsonl` — never ship on a failed smoke.

---

## Delta wave (Daniel-approved 2026-07-30, same session): worker iteration parity

Goal: the SendMessage-equivalent — a boss terminal converses with a codex worker it spawned
(reprompt / advise / rescope, worker context intact) with the same background+notification feel.
Probed facts: `codex exec resume [SESSION_ID] [PROMPT]` accepts `-` (stdin) and `-c` overrides;
the session id is the FIRST JSONL event: `{"type":"thread.started","thread_id":"<uuid>"}`.

### Task 8: `codex_dispatch.py` — session capture + `--follow-up`

**Files:**
- Modify: `scripts/codex_dispatch.py`
- Test: `tests/test_codex_dispatch.py` (append)

**Interfaces:**
- Produces: `parse_thread_id(log_file: Path) -> str | None` (first `thread.started` event's
  `thread_id`); CLI gains `--follow-up <thread-id>` (mutually exclusive with `--worktree`;
  `--model` is ignored on follow-up — the session's model persists — refuse the combination
  loudly rather than silently dropping it).
- Card linking: EVERY card (first turn and follow-ups) sets `meta["workflow"] = thread_id`
  (already a schema field, null today). Footer appends `| session <thread_id> (follow up with
  --follow-up <thread_id>)` when a thread id was parsed.

- [ ] **Step 1: Failing tests (append to test file)**

```python
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

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        class R: returncode = 0
        return R()

    monkeypatch.setattr(codex_dispatch.shutil, "which", lambda _: "codex.cmd")
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)
    out, log = tmp_path / "o.md", tmp_path / "l.jsonl"
    rc = codex_dispatch.spawn("more work", None, None, tmp_path, "workspace-write",
                              out, log, follow_up="019f-abc")
    assert rc == 0
    assert seen["cmd"][:5] == ["codex.cmd", "exec", "resume", "019f-abc", "-"]
    assert "--json" in seen["cmd"] and "--output-last-message" in seen["cmd"]
    assert "--model" not in seen["cmd"]


def test_follow_up_refuses_model_and_worktree(repo, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(codex_dispatch, "spawn", lambda *a, **k: 0)
    prompt = tmp_path / "p.md"
    prompt.write_text("hi", encoding="utf-8")
    for extra in (["--model", "codex-deep"], ["--worktree"]):
        rc = codex_dispatch.main(["--prompt-file", str(prompt), "--repo-root", str(repo),
                                  "--follow-up", "019f-abc"] + extra)
        assert rc == 2
        assert "follow-up" in capsys.readouterr().out


def test_build_record_stamps_workflow_thread(repo, tmp_path):
    log = tmp_path / "l.jsonl"
    log.write_text('{"type":"thread.started","thread_id":"019f-abc"}\n', encoding="utf-8")
    card, _ = codex_dispatch.build_record(
        _mk_args(), repo, "0000aaaa-11112222", "gpt-5.6-terra", 0, "P", "R", log)
    assert card.meta["workflow"] == "019f-abc"
```

- [ ] **Step 2: Run — expect the 4 new tests FAIL** (`py -3 -m pytest tests/test_codex_dispatch.py -v`)

- [ ] **Step 3: Implement**

`spawn` gains keyword `follow_up: str | None = None`; when set, the command is
`[codex_bin(), "exec", "resume", follow_up, "-", "--json", "--output-last-message",
str(out_file), "--cd", str(cwd), "-s", sandbox]` (no `--model`; keep the effort `-c` when
given). `parse_thread_id` scans the log line-by-line (`json.loads` per line, tolerate parse
errors) for the first `thread.started` and returns its `thread_id`. `main`: validate up front —
if `args.follow_up` and (`args.worktree` or `args.model != "codex"`) print
`DISPATCH REFUSED: --follow-up keeps the worker's session; drop --model/--worktree` and return 2;
on follow-up skip `resolve_model` (model = session's; record the read-back id) and pass
`follow_up=args.follow_up` to `spawn`. After spawn: `thread_id = parse_thread_id(log_file) or
args.follow_up`; `build_record` takes the log file as today and stamps
`card.meta["workflow"] = parse_thread_id(log_file)` (None stays null); footer appends the
session segment when thread_id is truthy.

- [ ] **Step 4: Run full file — all pass** (15 expected)

- [ ] **Step 5: Commit**

```bash
git add scripts/codex_dispatch.py tests/test_codex_dispatch.py
git commit -m "feat(dispatch): session capture + --follow-up — converse with a spawned worker"
```

### Task 9: skill section + live iteration smoke

**Files:**
- Modify: `skills/curated/dispatch-codex/SKILL.md` (+ regenerate mirrors via `py -3 scripts/sync_skills.py`)

- [ ] **Step 1: Add to SKILL.md after the Models section:**

````markdown
## Iterating with your worker

Each dispatch footer names the worker's session id. To reprompt, add advice, or change scope —
the SendMessage equivalent, worker context intact — write the follow-up brief to a file and:

```
py -3 scripts/codex_dispatch.py --prompt-file <followup.md> --follow-up <thread-id>
```

Same background call, same notification return. Do not pass `--model`/`--worktree` on a
follow-up (the session keeps its own). Each turn writes its own card, linked by the shared
`workflow: <thread-id>` field. To stop a running worker: stop the background shell task
(kills the worker; no card is published — the spool trace under
`%LOCALAPPDATA%\kb-codex-dispatch\spool\` is the only record of a killed run).
````

- [ ] **Step 2: Sync mirrors, commit** (`git add skills/curated/dispatch-codex/ .claude/skills/ .agents/skills/`)

- [ ] **Step 3: Live iteration smoke (boss runs):** dispatch a read-only task, then
`--follow-up <thread-id>` with a question answerable ONLY from the first turn's context (e.g.
"without re-reading any file, repeat the project names you reported, reversed"). PASS = correct
answer + second card on ops with same `workflow` value.

- [ ] **Step 4: Live TaskStop probe (boss runs):** dispatch a deliberately long task, TaskStop
the background task, then verify no `codex` process survives (`Get-Process | findstr codex`)
and the spool trace remains. Record the observed behavior in the PR body.
