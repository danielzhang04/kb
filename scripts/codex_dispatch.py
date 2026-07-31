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
DEFAULT_MODEL = "codex"  # applied post-parse: --model absent must stay distinguishable
ORPHAN_SLACK = 600  # grace past a pidless marker's own timeout before it is presumed dead


def codex_bin() -> str:
    exe = shutil.which("codex")
    if not exe:
        raise SystemExit("codex CLI not on PATH")
    return exe


def marker_path(dispatch_id: str) -> Path:
    return STATE_ROOT / "pending" / f"{dispatch_id}.json"


def write_marker(path: Path, marker: dict) -> None:
    """The in-flight trace of one dispatch, written BEFORE codex is spawned and
    deleted only once a durable record exists. A marker that outlives its
    dispatch process is an orphan by definition — the next dispatch's sweep is
    what turns it into a card."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(marker, indent=1), encoding="utf-8")


def update_marker(path: Path | None, **fields) -> None:
    """Merge fields into an existing marker. Best-effort in every part: the
    marker serves the record, and must never be able to fail a live worker."""
    if not path:
        return
    try:
        marker = json.loads(Path(path).read_text(encoding="utf-8"))
        marker.update(fields)
        Path(path).write_text(json.dumps(marker, indent=1), encoding="utf-8")
    except (OSError, ValueError) as err:
        print(f"pending marker {path} not updated: {err}", file=sys.stderr)


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
          timeout: int = DEFAULT_TIMEOUT, marker: Path | None = None) -> tuple[int, bool]:
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
    # exec mode cannot serve approval prompts (live-proven 2026-07-30: the user
    # config's `approval_policy = "untrusted"` made every file_change fail with
    # "file change approval is not supported in exec mode"). Pin approvals off
    # for dispatch; the sandbox stays the enforcement boundary. Applied on both
    # paths — a resumed session re-reads config.toml, so resume needs it too.
    cmd += ["-c", "approval_policy=never"]
    if effort:
        cmd += ["-c", f"model_reasoning_effort={effort}"]
    with open(log_file, "wb") as log:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=log, stderr=log)
        # The worker tree's own pid: a human killing a survivor needs it, but the
        # sweep probes the DISPATCH pid — a codex child outlives a killed parent.
        update_marker(marker, codex_pid=proc.pid)
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


def load_threads() -> dict:
    """{thread_id: concrete model} — what each resumable session actually ran on.
    A missing or corrupt map is empty, never fatal: it rebuilds from later
    dispatches, and an unknown session just falls back to the default tier."""
    try:
        threads = json.loads((STATE_ROOT / "threads.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return threads if isinstance(threads, dict) else {}


def remember_thread(thread_id: str | None, model: str) -> None:
    """Record a session's model so `--follow-up` without `--model` resumes on the
    SAME model (Agent-tool semantics) instead of the default tier."""
    if not thread_id:
        return
    threads = load_threads()
    if threads.get(thread_id) == model:
        return
    threads[thread_id] = model
    try:
        (STATE_ROOT / "threads.json").parent.mkdir(parents=True, exist_ok=True)
        (STATE_ROOT / "threads.json").write_text(json.dumps(threads, indent=1),
                                                 encoding="utf-8")
    except OSError as err:
        print(f"session model map not written: {err} — a later --follow-up on "
              f"{thread_id} will need an explicit --model", file=sys.stderr)


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


def _record(project: str, label: str, target: str, prompt_text: str, result_text: str,
            session_id: str, model: str, rc: int | None, log_file: Path | None):
    """Card + cost row for one dispatch leg, whatever ended it. Shared by the
    normal post-exit path and the orphan sweep so a killed leg lands the same
    shape as a finished one — the cost row's keys must match exactly, since the
    day's first row fixes the ledger header."""
    body = (f"## Work order\n\n{_inert(prompt_text.strip())}\n\n"
            f"## Result\n\n{_inert(result_text.strip())}\n")
    card = cards.new_card(project, label, target, "T1",
                          body=body, **{"execution-controller": "terminal"})
    cards.claim(card, "codex-worker")
    cards.stamp_session(card, session_id)
    cards.stamp_routing(card, "codex", model)
    card.meta["workflow"] = parse_thread_id(log_file) if log_file else None
    walk_state(card)
    record = {"usd": 0.0, "billing": "subscription", "model": model,
              "card_id": card.meta["id"], "codex_exit": rc}
    return card, record


def build_record(args, cwd: Path, dispatch_id: str, model: str, rc: int,
                 prompt_text: str, result_text: str, log_file: Path):
    """The audit card + cost row for one finished dispatch. Post-hoc record —
    built after codex exits, never gating anything. `cwd` is the directory the
    worker ACTUALLY ran in (a --worktree run is not the caller's repo root); a
    RESUMED session runs in its own recorded cwd, which this process does not
    know, so its target names the session rather than lying about a directory."""
    target = f"resumed-session:{args.follow_up}" if args.follow_up else str(cwd)
    return _record(args.project, args.label, target, prompt_text, result_text,
                   os.environ.get("CLAUDE_SESSION_ID", dispatch_id), model, rc, log_file)


def log_tail(log_file, count: int = 5) -> list[str]:
    """Last non-empty lines of a dispatch's JSONL. A log that is missing,
    truncated or unreadable yields nothing — an orphan record must survive the
    absence of the very thing it is describing."""
    try:
        text = Path(log_file).read_text(encoding="utf-8", errors="replace")
    except (OSError, TypeError):
        return []
    return [line for line in text.splitlines() if line.strip()][-count:]


def orphan_result(marker: dict, tail: list[str]) -> str:
    """Result text for a swept orphan. Opens with the same `FAILED:` prefix as
    every other failure record, so one grep still finds them all."""
    head = ("FAILED: orphaned — dispatch parent died before completion "
            f"(model {marker.get('model') or 'unknown'}, "
            f"started {marker.get('started_utc') or 'unknown'}, "
            f"log {marker.get('log_file') or 'unknown'})")
    return f"{head}\n\nLast log lines:\n\n" + ("\n".join(tail) if tail else "(none)") + "\n"


def build_orphan_record(marker: dict):
    """The record a killed dispatch could not write for itself, rebuilt from its
    pending marker. The exit code is left EMPTY, not 124 or 1: this process never
    observed the worker exit and must not invent a code for it."""
    try:
        prompt_text = Path(marker["prompt_file"]).read_text(encoding="utf-8")
    except (OSError, KeyError, TypeError):  # scratchpad briefs are routinely swept
        prompt_text = f"(prompt file {marker.get('prompt_file')} no longer readable)"
    log_file = Path(marker["log_file"]) if marker.get("log_file") else None
    target = (f"resumed-session:{marker['follow_up']}" if marker.get("follow_up")
              else str(marker.get("cwd") or "unknown"))
    return _record(marker.get("project") or "kb-ops",
                   marker.get("label") or "codex-dispatch", target, prompt_text,
                   orphan_result(marker, log_tail(log_file)),
                   marker.get("session") or marker.get("dispatch_id") or cards.new_id(),
                   marker.get("model") or "unknown", None, log_file)


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


def pid_alive(pid: int) -> bool:
    """Dependency-free liveness probe (tasklist; no psutil). An unrunnable or
    unparsable probe answers ALIVE — a sweep that cannot see must never
    manufacture an orphan card for a dispatch that is still working."""
    try:
        probe = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}", "/FO", "CSV", "/NH"],
                               capture_output=True, text=True, timeout=30)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return True
    if probe.returncode != 0:
        return True
    for line in probe.stdout.splitlines():  # "image.exe","1234","Console","1","9,000 K"
        fields = [f.strip('" ') for f in line.split('","')]
        if len(fields) > 1 and fields[1] == str(int(pid)):
            return True
    return False


def is_orphan(marker: dict, now: float, alive=None) -> bool:
    """Did this marker outlive its dispatch? A live dispatch pid is the only
    proof it did not — including a parallel dispatch's, which is why a live pid
    always means SKIP. A marker with no pid never reached that write, so age is
    the only evidence left: past its own timeout plus slack, nothing can still
    be running."""
    pid = marker.get("pid")
    if pid:
        return not (alive or pid_alive)(pid)
    limit = marker.get("timeout") or DEFAULT_TIMEOUT
    return now - float(marker.get("started") or 0) > limit + ORPHAN_SLACK


def sweep_pending(repo_root: Path, now: float | None = None, alive=None,
                  publish=None) -> list[str]:
    """Publish the record every orphaned dispatch owes, at the START of the next
    dispatch. Best-effort throughout: this runs for a leg nobody is waiting on,
    and must never fail or delay the dispatch that triggered it. A marker is
    deleted only once publish_ops RETURNS — pushed or spooled, both durable; a
    raised publish leaves the marker for the next sweep."""
    publish, alive = publish or publish_ops, alive or pid_alive
    now = time.time() if now is None else now
    swept = []
    for path in sorted((STATE_ROOT / "pending").glob("*.json")):
        try:
            marker = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(marker, dict) or not is_orphan(marker, now, alive):
                continue
            card, record = build_orphan_record(marker)
            publish(repo_root, card, record)
        except Exception as err:
            print(f"orphan sweep left {path.name} pending: "
                  f"{type(err).__name__}: {err}", file=sys.stderr)
            continue
        path.unlink(missing_ok=True)
        swept.append(card.meta["id"])
    return swept


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
    ap.add_argument("--model", default=None,
                    help=f"default {DEFAULT_MODEL}; on --follow-up, defaults to the "
                         "model that session already ran on")
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
    # A resumed session does not carry its own model, so an unpinned --follow-up
    # silently drops to the default tier. Pin it from what the session actually
    # ran on; an explicit --model always wins (and re-pins the map below).
    wanted = args.model
    if args.follow_up and not wanted:
        wanted = load_threads().get(args.follow_up)
        if not wanted:
            print(f"no recorded model for session {args.follow_up} (dispatched before "
                  f"the session map existed?) — resuming on the {DEFAULT_MODEL} default; "
                  "pass --model to pin it", file=sys.stderr)
    try:
        model = resolve_model(repo_root, wanted or DEFAULT_MODEL)
    except routing.RoutingError as err:
        print(f"DISPATCH REFUSED: {err}")
        return 2

    dispatch_id = cards.new_id()
    for sub in ("spool", "logs", "worktrees", "pending"):
        (STATE_ROOT / sub).mkdir(parents=True, exist_ok=True)
    try:  # a dead parent's record is owed by the NEXT dispatch, and only by it
        swept = sweep_pending(repo_root)
        if swept:
            print(f"orphan sweep published {len(swept)} record(s) for dead dispatches: "
                  + ", ".join(swept), file=sys.stderr)
    except Exception as err:
        print(f"orphan sweep skipped: {type(err).__name__}: {err}", file=sys.stderr)
    prompt_text = Path(args.prompt_file).read_text(encoding="utf-8")

    cwd = Path(args.cwd) if args.cwd else repo_root
    if args.worktree:
        cwd = STATE_ROOT / "worktrees" / dispatch_id
        subprocess.run(["git", "worktree", "add", "--detach", str(cwd)],
                       cwd=repo_root, check=True)

    out_file = STATE_ROOT / "logs" / f"{dispatch_id}.last.md"
    log_file = STATE_ROOT / "logs" / f"{dispatch_id}.jsonl"
    started = time.time()
    pending = marker_path(dispatch_id)
    # Written BEFORE the spawn: from here until a durable record exists, this
    # marker is the only thing that knows a leg is in flight. `pid` is THIS
    # process — the one whose death orphans the leg.
    write_marker(pending, {
        "dispatch_id": dispatch_id, "pid": os.getpid(), "model": model,
        "effort": args.effort, "cwd": str(cwd), "sandbox": sandbox,
        "prompt_file": str(args.prompt_file), "log_file": str(log_file),
        "out_file": str(out_file), "follow_up": args.follow_up,
        "project": args.project, "label": args.label, "timeout": args.timeout,
        "session": os.environ.get("CLAUDE_SESSION_ID", dispatch_id),
        "started": started,
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))})

    rc, timed_out = spawn(prompt_text, model, args.effort, cwd, sandbox, out_file,
                          log_file, follow_up=args.follow_up, timeout=args.timeout,
                          marker=pending)
    if timed_out:  # never rc == 124: a worker may genuinely exit with that code
        result_text = f"FAILED: timeout after {args.timeout}s; JSONL log: {log_file}"
    elif rc == 0 and out_file.exists():
        result_text = out_file.read_text(encoding="utf-8")
    else:
        result_text = f"FAILED: codex exec exit {rc}; JSONL log: {log_file}"

    card, record = build_record(args, cwd, dispatch_id, model, rc,
                                prompt_text, result_text, log_file)
    thread_id = card.meta.get("workflow")
    # so an unpinned --follow-up keeps this model; a resume whose log never named
    # the thread is still the session the caller asked to resume
    remember_thread(thread_id or args.follow_up, model)
    # stdout is the ONLY channel the answer reaches the caller on: print it
    # BEFORE the audit publish, which is best-effort and may raise.
    print(result_text)
    recorded = False
    try:
        published, publish_note = publish_ops(repo_root, card, record)
        recorded = True  # returned at all = pushed OR spooled; both are durable
    except Exception as err:
        published = False
        try:
            publish_note = _spool_note(card, f"publish raised {type(err).__name__}: {err}")
            recorded = True
        except Exception:
            publish_note = f"FAILED (publish raised {type(err).__name__}; unspooled)"
    if recorded:  # the marker's whole job is done the moment a record exists
        pending.unlink(missing_ok=True)

    print(f"\n--- codex-dispatch card {card.meta['id']} | model {model} | "
          f"exit {rc} | {time.time() - started:.0f}s | ops publish: {publish_note}"
          + (f" | worktree: {cwd} (yours to sweep)" if args.worktree else "")
          + f" | log: {log_file}"
          + (f" | session {thread_id} (follow up with --follow-up {thread_id})"
             if thread_id else ""))
    return rc


if __name__ == "__main__":
    sys.exit(main())
