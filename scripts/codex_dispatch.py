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
import random
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
DEFAULT_TIMEOUT = 2700  # 45 min — past this a dispatch is hung, not thinking


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
        try:
            rc = subprocess.run([codex_bin(), "login", "status"],
                                capture_output=True, timeout=15).returncode
        except subprocess.TimeoutExpired:
            return ["codex login status timed out after 15s — auth check wedged"]
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


def spawn(prompt_text: str, model: str | None, effort: str | None, cwd: Path,
          sandbox: str, out_file: Path, log_file: Path, follow_up: str | None = None,
          timeout: int = DEFAULT_TIMEOUT) -> tuple[int, bool]:
    """Run one codex exec; returns (exit code, timed_out). The flag is the ONLY
    timeout signal — a worker may genuinely exit 124 (coreutils convention)."""
    if follow_up:
        # `resume` restores the session's own cwd/sandbox; it REJECTS --cd/-s
        # (verified live: "error: unexpected argument '--cd' found", exit 2).
        cmd = [codex_bin(), "exec", "resume", follow_up, "-", "--json",
               "--output-last-message", str(out_file)]
        if model:
            # A resumed session does NOT carry its model — unpinned, the CLI
            # default silently takes over (live-proven). `-c model=` is the only
            # form resume accepts; --model is a fresh-exec flag.
            cmd += ["-c", f"model={model}"]
    else:
        cmd = [codex_bin(), "exec", "-", "--model", model, "--json",
               "--output-last-message", str(out_file), "--cd", str(cwd), "-s", sandbox]
    if effort:
        cmd += ["-c", f"model_reasoning_effort={effort}"]
    with open(log_file, "wb") as log:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            proc.communicate(input=prompt_text.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            try:  # /T kills the whole tree: codex spawns children that outlive it
                kill = subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                      capture_output=True, timeout=30)
                if kill.returncode != 0:
                    print(f"taskkill exited {kill.returncode} for pid {proc.pid} — "
                          "the worker tree may have outlived the dispatch", file=sys.stderr)
            except (FileNotFoundError, subprocess.TimeoutExpired):
                proc.kill()  # no taskkill (non-Windows) or it wedged: kill what we own
            try:
                proc.wait(timeout=30)  # bounded: a wedged reap must not hang the dispatch
            except subprocess.TimeoutExpired:
                pass
            return 124, True  # coreutils timeout convention
        return proc.returncode, False


def parse_thread_id(log_file: Path) -> str | None:
    """Scan a dispatch's JSONL log for the first `thread.started` event and
    return its thread_id, tolerating unparsable lines. None if never found."""
    try:
        text = log_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "thread.started" and event.get("thread_id"):
            return event["thread_id"]
    return None


def _inert(text: str) -> str:
    """Escape headings in embedded text: a `## Result` inside a brief or answer
    must never masquerade as one of the card's own sections. Matched as LAXLY as
    the real consumers parse — sentinel.extract_result uses `^\\s*##\\s+Result`
    and brief._section_text compares the STRIPPED line — so leading indent, a
    tab separator and trailing spaces are all escaped (leading whitespace is
    preserved; only the `#` run is defanged)."""
    return re.sub(r"(?m)^([ \t]*)(#{1,6}[ \t])", r"\1\\\2", text)


def walk_state(card: cards.Card) -> None:
    """Walk the card working -> done through cards.LEGAL, in memory (one save
    happens later, in the publish worktree); legality is asserted per hop so the
    record can never claim a transition the queue forbids. ALWAYS `done` — a
    failed dispatch is still a finished one, and its failure lives in the Result
    text and the ledger's codex_exit."""
    for nxt in ("working", "done"):
        cur = card.meta["state"]
        if nxt not in cards.LEGAL[cur]:
            raise cards.ValidationError(f"illegal transition {cur} -> {nxt}")
        if nxt == "working" and not card.meta.get("owner"):
            raise cards.ValidationError("cannot start working an unowned card")
        card.meta["state"] = nxt


def build_record(args, cwd: Path, dispatch_id: str, model: str, rc: int,
                 prompt_text: str, result_text: str, log_file: Path):
    """The audit card + cost row for one finished dispatch. Post-hoc record —
    built after codex exits, never gating anything. `cwd` is the directory the
    worker ACTUALLY ran in (a --worktree run is not the caller's repo root); a
    RESUMED session runs in its own recorded cwd, which this process does not
    know, so its target names the session rather than lying about a directory."""
    body = (f"## Work order\n\n{_inert(prompt_text.strip())}\n\n"
            f"## Result\n\n{_inert(result_text.strip())}\n")
    target = f"resumed-session:{args.follow_up}" if args.follow_up else str(cwd)
    card = cards.new_card(args.project, args.label, target, "T1",
                          body=body, **{"execution-controller": "terminal"})
    cards.claim(card, "codex-worker")
    cards.stamp_session(card, os.environ.get("CLAUDE_SESSION_ID", dispatch_id))
    cards.stamp_routing(card, "codex", model)
    card.meta["workflow"] = parse_thread_id(log_file)
    walk_state(card)
    record = {"usd": 0.0, "billing": "subscription", "model": model,
              "card_id": card.meta["id"], "codex_exit": rc}
    return card, record


def publish_ops(repo_root: Path, card: cards.Card, record: dict):
    """One best-effort commit to ops: card + cost row, via a temp detached
    worktree (never touches the caller's checkout or branch). Failure spools
    the card locally and reports — it NEVER fails the dispatch.

    Contention is handled by REBUILDING, never rebasing: each attempt resets to
    freshly fetched origin/ops and re-derives the card + row on top, so a racing
    appender's rows can never be dropped by a conflicted rebase. Success is
    claimed only once origin/ops actually CONTAINS the commit — tested by
    ancestry, never by head equality: a third party pushing on top of our landed
    commit moves the head, and reading that as failure re-lands the same record
    once per attempt (live-confirmed triple publish)."""
    def git(*a, cwd=repo_root):
        try:  # a wedged origin must not make a bounded dispatch unbounded
            return subprocess.run(["git", *a], cwd=str(cwd), capture_output=True,
                                  text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(a, 1, "", "git timed out after 120s")

    def landed(sha):
        return bool(sha) and git("merge-base", "--is-ancestor", sha,
                                 "FETCH_HEAD").returncode == 0

    wt = Path(tempfile.mkdtemp(prefix="codex-dispatch-")) / "wt"
    local = ""
    try:
        for attempt in range(3):
            if attempt:
                time.sleep(random.uniform(0.5, 2.0))  # de-sync racing appenders
            if git("fetch", "origin", "ops").returncode != 0:
                continue
            # a push the server accepted but whose rc we lost is already done
            if landed(local):
                return True, "pushed"
            if wt.exists():
                git("reset", "--hard", "origin/ops", cwd=wt)
                git("clean", "-fdq", cwd=wt)  # drop the discarded attempt's files
            elif git("worktree", "add", "--detach", str(wt), "origin/ops").returncode != 0:
                continue
            card_path = cards.save(card, wt / "queue")
            led_path = ledger.append(wt, "cost", WRITER, record)
            git("add", "--", str(card_path), str(led_path), cwd=wt)
            if git("commit", "-m", f"chore(codex-direct): record {card.meta['id']}",
                   cwd=wt).returncode != 0:
                continue
            local = git("rev-parse", "HEAD", cwd=wt).stdout.strip()
            if git("push", "origin", "HEAD:refs/heads/ops", cwd=wt).returncode != 0:
                continue
            if git("fetch", "origin", "ops").returncode == 0 and landed(local):
                return True, "pushed"
        return False, _spool_note(card, "publish failed after 3 rebuilt attempts")
    finally:
        git("worktree", "remove", "--force", str(wt))
        # a failed remove leaves the registration under .git/worktrees forever
        git("worktree", "prune")
        shutil.rmtree(wt.parent, ignore_errors=True)


def _spool_note(card: cards.Card, why: str) -> str:
    """Park an unpublished card on disk as a REAL card (cards.save, so it parses
    back), for a human to re-publish by copying it into the ops queue."""
    dest = cards.save(card, STATE_ROOT / "spool")
    return f"FAILED ({why}) — card spooled at {dest}; re-publish it manually"


def _positive_seconds(value: str) -> int:
    """`--timeout 0` (or negative) times every dispatch out instantly."""
    seconds = int(value)
    if seconds <= 0:
        raise argparse.ArgumentTypeError("--timeout must be a positive number of seconds")
    return seconds


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):  # worker answers carry ✓ / → / CJK
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--model", default="codex")
    ap.add_argument("--effort", choices=EFFORTS, default=None)
    ap.add_argument("--cwd", default=None)
    ap.add_argument("--sandbox", choices=("read-only", "workspace-write"),
                    default=None, help="default workspace-write; refused on --follow-up")
    ap.add_argument("--worktree", action="store_true")
    ap.add_argument("--project", default="kb-ops")
    ap.add_argument("--label", default="codex-dispatch")
    ap.add_argument("--repo-root", default=None, help="tests only")
    ap.add_argument("--follow-up", default=None,
                    help="thread id from a prior dispatch's footer; resumes that session")
    ap.add_argument("--timeout", type=_positive_seconds, default=DEFAULT_TIMEOUT,
                    help="seconds before the worker's process tree is killed (exit 124)")
    args = ap.parse_args(argv)

    if args.follow_up:
        # resume restores the session's own cwd/sandbox and rejects --cd/-s, so
        # honouring these would lie about where the worker runs. --model is NOT
        # refused: it is pinned via `-c model=` (see spawn).
        bad = [f for f, given in (("--worktree", args.worktree), ("--cwd", args.cwd),
                                  ("--sandbox", args.sandbox)) if given]
        if bad:
            print("DISPATCH REFUSED: --follow-up resumes the worker's own session "
                  f"(its cwd and sandbox are fixed); drop {', '.join(bad)}")
            return 2
    sandbox = args.sandbox or "workspace-write"

    repo_root = Path(args.repo_root) if args.repo_root else Path(__file__).resolve().parents[1]
    # STOP + ANTHROPIC-key only: no cost_today_fn, deliberately. Every dispatch
    # cost row is structurally $0.0 subscription, so a daily-budget gate here
    # measures nothing; API spend is governed per-run by card authorization.
    # The login check is waived ONLY under the test env var — --repo-root is a
    # path argument, never an auth waiver (a prod caller passing it stays checked).
    problems = (preamble.check(repo_root)
                + billing_guard(os.environ,
                                login_check=os.environ.get("KB_DISPATCH_TEST") != "1"))
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
    rc, timed_out = spawn(prompt_text, model, args.effort, cwd, sandbox, out_file,
                          log_file, follow_up=args.follow_up, timeout=args.timeout)
    if timed_out:  # never rc == 124: a worker may genuinely exit with that code
        result_text = f"FAILED: timeout after {args.timeout}s; JSONL log: {log_file}"
    elif rc == 0 and out_file.exists():
        result_text = out_file.read_text(encoding="utf-8")
    else:
        result_text = f"FAILED: codex exec exit {rc}; JSONL log: {log_file}"

    card, record = build_record(args, cwd, dispatch_id, model, rc,
                                prompt_text, result_text, log_file)
    # stdout is the ONLY channel the answer reaches the caller on: print it
    # BEFORE the audit publish, which is best-effort and may raise.
    print(result_text)
    try:
        published, publish_note = publish_ops(repo_root, card, record)
    except Exception as err:
        published = False
        try:
            publish_note = _spool_note(card, f"publish raised {type(err).__name__}: {err}")
        except Exception:
            publish_note = f"FAILED (publish raised {type(err).__name__}; unspooled)"
    if published:
        spool_path.unlink(missing_ok=True)

    thread_id = card.meta.get("workflow")
    print(f"\n--- codex-dispatch card {card.meta['id']} | model {model} | "
          f"exit {rc} | {time.time() - started:.0f}s | ops publish: {publish_note}"
          + (f" | worktree: {cwd} (yours to sweep)" if args.worktree else "")
          + f" | log: {log_file}"
          + (f" | session {thread_id} (follow up with --follow-up {thread_id})"
             if thread_id else ""))
    return rc


if __name__ == "__main__":
    sys.exit(main())
