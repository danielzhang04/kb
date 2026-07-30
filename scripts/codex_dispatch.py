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
    # preamble.check only runs the budget gate when handed a cost function
    # (its signature is check(repo_root, env=None, cost_today_fn=None)); the
    # spec makes the daily budget a pre-spawn gate, so pass it explicitly.
    problems = (preamble.check(repo_root, cost_today_fn=ledger.cost_today)
                + billing_guard(os.environ, login_check=args.repo_root is None))
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
