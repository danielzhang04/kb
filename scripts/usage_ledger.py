#!/usr/bin/env python3
"""scripts/usage_ledger.py — daily Claude Code + Codex token usage ledger (measure only).

Read-only over ~/.claude/projects/**/*.jsonl (+ subagents/*.jsonl) and the DATE-PARTITIONED
~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl directories for target_day-1 and target_day
(NOT a full-tree rglob -- fix round 1, C1a: real transcript volume on an operator's machine made a
full-tree walk the dominant cost). Writes one row per (runtime, model, session, top|subagent) to
ledgers/usage/<YYYY-MM-DD>.tsv, plus a `_totals` row, then publishes the file to the ops branch via
a detached worktree -- same contention handling as scripts/codex_dispatch.py's publish_ops (ported,
not re-derived: rebuild-on-conflict, ancestry check instead of head-equality), PLUS (fix round 1,
C2) a same-content short-circuit before ever committing, so a retry that finds the file already
correct on origin/ops reports success without an empty commit.

COLUMN SPLIT (fix round 1, C4 ruling): `max_ctx_tokens` (per-turn peak of input+cache_read, a
CONTEXT-WINDOW signal) is Claude-only; Codex rows carry that column empty and instead populate
`codex_cumulative_total` (`total_token_usage.total_tokens`, max per rollout file) -- the two
runtimes' token-accounting models are not comparable, so they get separate columns rather than
one column silently mixing two different signals. `_totals` reports the Claude-only peak in
`max_ctx_tokens` and the summed Codex cumulative total in `codex_cumulative_total`; `--summary`
prints them as "peak ctx <N>k" (Claude) and "codex total <N>M" (Codex), separately.

stdlib only. Invoked as `py -3 scripts/usage_ledger.py [--date YYYY-MM-DD] [--summary]
[--no-publish] [--root <path>] [--full]`. Ruling 2026-09-11 Section 0.1: measure only -- this
script enforces nothing, warns nothing, and never blocks anything it is called from.

`--full` disables the 64 MB per-file skip (fix round 1, C1b): by default a transcript over that
size is skipped with a one-line stderr note rather than streamed, so a still-growing multi-hundred-
MB session file (a long-lived boss terminal) does not dominate every single run.

NEVER run this from inside a Codex worker's shell: it reads ~/.codex/sessions/**/rollout-*.jsonl,
and a worker that reads its OWN rollout file mid-session can inject megabytes of its own history
back into its context (openai/codex#27131). The STRUCTURAL guard: scripts/codex_dispatch.py's
spawn() sets KB_INSIDE_CODEX_WORKER=1 in every worker's environment; this script refuses
immediately (exit 3, one stderr line, no file touched) whenever that variable is set. This is a
belt, not the buckle -- the real guard is that no dispatch-codex brief, SKILL.md instruction, or
fleet cadence ever names this script as a worker's job. The daily preamble.py call launches it
DETACHED (fix round 1, C1c) from the operator's own shell, which never carries that variable.
"""
from __future__ import annotations

import argparse
import os
import random
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024

# ---------------------------------------------------------------------------
# Pricing -- an ESTIMATE for cross-session comparison, not a real bill (subscription usage is
# not metered in dollars). Ported from the Task 0 evidence prototype
# (docs/superpowers/specs/2026-09-11-token-discipline-evidence/analyze_tokens.py) -- same rates,
# same caveats. Every derived column is named est_... so nobody mistakes it for an invoice.
# ---------------------------------------------------------------------------
CLAUDE_PRICING = {  # model_class -> (input $/1M, output $/1M)
    "opus": (15.00, 75.00),
    "sonnet": (3.00, 15.00),
    "haiku": (0.80, 4.00),
    "fable": (15.00, 75.00),  # ASSUMPTION: no public Fable price; Opus-tier used (flagged)
    "default": (3.00, 15.00),
}
CACHE_READ_MULT = 0.10
CACHE_CREATE_MULT = 1.25
CODEX_INPUT_PRICE = 1.25
CODEX_OUTPUT_PRICE = 10.00
CODEX_CACHE_MULT = 0.50

RATE_TABLE_HEADER = (
    "# est_ rates (per 1M tokens, comparison-only, NOT a real subscription bill): "
    "claude opus 15/75 sonnet 3/15 haiku 0.8/4 fable 15/75(assumed) cache-read 10% cache-create 125% "
    "| codex input 1.25 output 10.00 cached-input 50% "
    "| max_ctx_tokens = Claude-only per-turn peak (input+cache_read); codex_cumulative_total = "
    "Codex-only total_token_usage.total_tokens max-per-file -- the two are NOT the same signal, "
    "hence separate columns (fix round 1, C4)"
)

# runtime-specific columns: max_ctx_tokens is Claude-only (empty for codex rows);
# codex_cumulative_total is Codex-only (empty for claude rows). See module docstring "COLUMN SPLIT".
TSV_FIELDS = [
    "runtime", "model", "session", "kind", "project",
    "input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens",
    "turns", "max_ctx_tokens", "codex_cumulative_total", "est_usd",
]


def classify_claude_model(model_name):
    m = (model_name or "").lower()
    for key in ("opus", "haiku", "fable", "sonnet"):
        if key in m:
            return key
    return "default"


def claude_cost(model_class, inp, cache_create, cache_read, out):
    in_p, out_p = CLAUDE_PRICING.get(model_class, CLAUDE_PRICING["default"])
    return (
        (inp / 1e6) * in_p
        + (cache_create / 1e6) * in_p * CACHE_CREATE_MULT
        + (cache_read / 1e6) * in_p * CACHE_READ_MULT
        + (out / 1e6) * out_p
    )


def codex_cost(input_tok, cached_tok, output_tok):
    uncached = max(0, input_tok - cached_tok)
    return (
        (uncached / 1e6) * CODEX_INPUT_PRICE
        + (cached_tok / 1e6) * CODEX_INPUT_PRICE * CODEX_CACHE_MULT
        + (output_tok / 1e6) * CODEX_OUTPUT_PRICE
    )


# ---------------------------------------------------------------------------
# True line-by-line JSONL streaming. Holds at most ONE line buffered (never loads a whole
# transcript into memory) and drops a final line with no trailing newline -- a session file the
# current terminal is still writing is a NORMAL input, not an error ("skips a partial last line").
# ---------------------------------------------------------------------------

def _ends_with_newline(path: Path) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return True
    if size == 0:
        return True
    try:
        with path.open("rb") as fb:
            fb.seek(-1, os.SEEK_END)
            return fb.read(1) == b"\n"
    except OSError:
        return True  # fail open: treat as complete rather than silently drop everything


def _iter_complete_json_lines(path: Path):
    import json
    complete_tail = _ends_with_newline(path)
    try:
        f = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        pending = None
        for line in f:
            if pending is not None:
                stripped = pending.strip()
                if stripped:
                    try:
                        yield json.loads(stripped)
                    except json.JSONDecodeError:
                        pass
            pending = line
        if pending is not None and complete_tail:
            stripped = pending.strip()
            if stripped:
                try:
                    yield json.loads(stripped)
                except json.JSONDecodeError:
                    pass


# ---------------------------------------------------------------------------
# Claude Code transcripts
# ---------------------------------------------------------------------------

def process_claude_file(path: Path, kind: str, session_id: str, project: str, target_day: str):
    """Rows (one per model class actually seen) for ONE Claude transcript, filtered to records
    whose OWN timestamp falls on target_day -- a long-lived session file spans many days, and
    attributing its whole history to whichever day it was last touched would misreport "yesterday".
    `codex_cumulative_total` is always None here -- that column is Codex-only (C4)."""
    per_model = defaultdict(lambda: defaultdict(float))
    ctx_per_turn = []
    for rec in _iter_complete_json_lines(path):
        if not isinstance(rec, dict) or rec.get("type") != "assistant":
            continue
        ts = rec.get("timestamp") or ""
        if ts[:10] != target_day:
            continue
        msg = rec.get("message") or {}
        usage = msg.get("usage") or {}
        if not usage:
            continue
        mclass = classify_claude_model(msg.get("model"))
        inp = usage.get("input_tokens", 0) or 0
        cc = usage.get("cache_creation_input_tokens", 0) or 0
        cr = usage.get("cache_read_input_tokens", 0) or 0
        out = usage.get("output_tokens", 0) or 0
        row = per_model[mclass]
        row["input"] += inp
        row["cache_creation"] += cc
        row["cache_read"] += cr
        row["output"] += out
        row["turns"] += 1
        ctx_per_turn.append(inp + cr)
    if not per_model:
        return []
    max_ctx = max(ctx_per_turn) if ctx_per_turn else 0
    rows = []
    for mclass, row in per_model.items():
        rows.append({
            "runtime": "claude", "model": mclass, "session": session_id, "kind": kind, "project": project,
            "input_tokens": int(row["input"]), "cache_creation_tokens": int(row["cache_creation"]),
            "cache_read_tokens": int(row["cache_read"]), "output_tokens": int(row["output"]),
            "turns": int(row["turns"]), "max_ctx_tokens": int(max_ctx), "codex_cumulative_total": None,
            "est_usd": round(claude_cost(mclass, row["input"], row["cache_creation"], row["cache_read"], row["output"]), 4),
        })
    return rows


# ---------------------------------------------------------------------------
# Codex rollouts -- session-level attribution (spec: "total_token_usage = max per rollout file"),
# NOT per-record like Claude: a session is attributed to its OWN start day only, matching table A3's
# "cumulative session totals attributed to session-start day".
# ---------------------------------------------------------------------------

def process_codex_file(path: Path, target_day: str):
    """`max_ctx_tokens` is always None here -- that column is Claude-only (C4). The Codex signal
    (`total_token_usage.total_tokens`, max per file) lives in `codex_cumulative_total` instead."""
    session_id = None
    model = None
    turns = 0
    max_usage = None
    start_day = None
    for rec in _iter_complete_json_lines(path):
        if not isinstance(rec, dict):
            continue
        rtype = rec.get("type")
        if rtype == "session_meta":
            p = rec.get("payload") or {}
            session_id = p.get("session_id") or p.get("id") or session_id
            ts = p.get("timestamp") or rec.get("timestamp")
            if ts:
                start_day = str(ts)[:10]
        elif rtype == "turn_context":
            model = (rec.get("payload") or {}).get("model") or model
        elif rtype == "event_msg":
            p = rec.get("payload") or {}
            if p.get("type") == "task_started":
                turns += 1
                model = p.get("model") or model
            elif p.get("type") == "token_count":
                info = p.get("info") or {}
                tu = info.get("total_token_usage")
                if tu and (max_usage is None or (tu.get("total_tokens", 0) or 0) > (max_usage.get("total_tokens", 0) or 0)):
                    max_usage = tu
    if start_day != target_day or max_usage is None:
        return None
    input_tok = max_usage.get("input_tokens", 0) or 0
    cached_tok = max_usage.get("cached_input_tokens", 0) or 0
    output_tok = max_usage.get("output_tokens", 0) or 0
    return {
        "runtime": "codex", "model": model or "unknown", "session": session_id or path.stem,
        "kind": "top", "project": "-",
        "input_tokens": int(input_tok), "cache_creation_tokens": 0,
        "cache_read_tokens": int(cached_tok), "output_tokens": int(output_tok),
        "turns": turns, "max_ctx_tokens": None,
        "codex_cumulative_total": int(max_usage.get("total_tokens", 0) or 0),
        "est_usd": round(codex_cost(input_tok, cached_tok, output_tok), 4),
    }


# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------

def _home(env) -> Path:
    return Path(env.get("USERPROFILE") or env.get("HOME") or str(Path.home()))


def _claude_projects_dir(env) -> Path:
    return Path(env.get("KB_CLAUDE_PROJECTS_DIR") or (_home(env) / ".claude" / "projects"))


def _codex_sessions_dir(env) -> Path:
    return Path(env.get("KB_CODEX_SESSIONS_DIR") or (_home(env) / ".codex" / "sessions"))


def _day_start_epoch(day: str) -> float:
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


def collect_claude_rows(env, target_day: str, full: bool = False) -> list[dict]:
    """C1b: the mtime filter is now a WINDOW, not just a floor -- [start_epoch, start_epoch +
    2 days) -- so a session file that is still being touched long after target_day (a live boss
    terminal, mtime always "now") stops being rescanned once its relevant window has passed.
    Files over MAX_TRANSCRIPT_BYTES are skipped with a one-line stderr note unless `full=True`
    (`--full`): a still-growing multi-hundred-MB transcript must not be streamed every run."""
    root = _claude_projects_dir(env)
    if not root.is_dir():
        return []
    start_epoch = _day_start_epoch(target_day)
    end_epoch = start_epoch + 2 * 86400
    max_bytes = None if full else MAX_TRANSCRIPT_BYTES

    def _maybe_process(entry: Path, kind: str, session_id: str, project: str) -> list[dict]:
        try:
            st = entry.stat()
        except OSError:
            return []
        if not (start_epoch <= st.st_mtime < end_epoch):
            return []
        if max_bytes is not None and st.st_size > max_bytes:
            print(
                f"usage_ledger: skipping {entry} ({st.st_size / 1e6:.0f} MB > 64 MB; "
                "pass --full to include)",
                file=sys.stderr,
            )
            return []
        return process_claude_file(entry, kind, session_id, project, target_day)

    rows: list[dict] = []
    for proj_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        project = proj_dir.name
        for entry in sorted(proj_dir.iterdir()):
            try:
                if entry.is_file() and entry.suffix == ".jsonl":
                    rows.extend(_maybe_process(entry, "top", entry.stem, project))
                elif entry.is_dir():
                    sub = entry / "subagents"
                    if sub.is_dir():
                        for sf in sorted(sub.iterdir()):
                            if sf.suffix == ".jsonl":
                                rows.extend(_maybe_process(sf, "subagent", entry.name, project))
            except OSError:
                continue
    return rows


def _codex_day_dirs(root: Path, target_day: str) -> list[Path]:
    """Rollout files are date-partitioned into <root>/<yyyy>/<mm>/<dd>/ by LOCAL wall-clock day at
    file-creation, while a session's OWN start_day (the value actually used for attribution, in
    process_codex_file) is read from the session_meta record's timestamp, which IS UTC.

    EMPIRICALLY VERIFIED on the operator's own machine (fix round 1 correction -- the first
    version of this function scanned target_day and target_day+1, which was backwards and
    silently dropped every Codex row for a day; caught by the live-run wall-time check, not by a
    unit test, because the fixtures matched the wrong assumption too):

        ~/.codex/sessions/2026/09/10/rollout-2026-09-10T23-55-32-....jsonl
        -> first record timestamp "2026-09-11T03:57:57Z"

    This machine's local clock is UTC-4. A session created at 23:55 LOCAL on day D is already
    03:57 UTC on day D+1 -- so the LOCAL-day directory D can hold a session whose UTC start_day is
    D+1. Directory D never holds a session whose UTC start_day is D-1 (local never runs AHEAD of
    UTC here). So for a UTC target_day T, the candidate directories are T (most sessions: created
    early enough in local day T that UTC hadn't rolled over yet) and T-1 (a session created in the
    last few hours of local day T-1, after UTC had already rolled over to T) -- NOT T+1.

    Content-based attribution, not directory-based: process_codex_file's own
    `start_day != target_day: return None` check never depends on which directory holds the file,
    so scanning fewer directories can only ever risk MISSING a target_day session filed a day
    early in this sense -- it can never wrongly attribute a different day's session to this one.

    ASSUMPTION, stated plainly: this covers a local clock BEHIND UTC (this machine: UTC-4, and any
    positive UTC offset in the Americas). A host whose local clock runs AHEAD of UTC (local day
    later than the UTC start_day) would need T and T+1 instead -- the exact reverse -- and is not
    covered here; not observed on kb's machines, flagged rather than silently assumed away.
    """
    d = date.fromisoformat(target_day)
    dirs = []
    for delta in (-1, 0):
        dd = d + timedelta(days=delta)
        dirs.append(root / f"{dd.year:04d}" / f"{dd.month:02d}" / f"{dd.day:02d}")
    return dirs


def collect_codex_rows(env, target_day: str) -> list[dict]:
    """C1a: lists only the (at most two) date-partitioned directories that could hold a
    target_day session -- see `_codex_day_dirs` -- instead of an `rglob` over the entire
    ~/.codex/sessions tree, which on a real machine can span months of accumulated history."""
    root = _codex_sessions_dir(env)
    if not root.is_dir():
        return []
    rows: list[dict] = []
    seen: set[Path] = set()
    for day_dir in _codex_day_dirs(root, target_day):
        if not day_dir.is_dir():
            continue
        for path in sorted(day_dir.glob("rollout-*.jsonl")):
            if path in seen:
                continue
            seen.add(path)
            row = process_codex_file(path, target_day)
            if row:
                rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Totals, TSV I/O, summary
# ---------------------------------------------------------------------------

def build_totals_row(rows: list[dict]) -> dict:
    """C4: `max_ctx_tokens` in the totals row is the PEAK across Claude rows only (never summed --
    it is a context-window signal, not a token-volume signal); `codex_cumulative_total` is the SUM
    across Codex rows (each row is already a per-session max, so summing rows aggregates sessions)."""
    totals = defaultdict(float)
    claude_peak = 0
    codex_total = 0
    for r in rows:
        for f in ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens", "turns", "est_usd"):
            totals[f] += r[f]
        if r["runtime"] == "claude" and r.get("max_ctx_tokens"):
            claude_peak = max(claude_peak, r["max_ctx_tokens"])
        if r["runtime"] == "codex" and r.get("codex_cumulative_total"):
            codex_total += r["codex_cumulative_total"]
    return {
        "runtime": "_totals", "model": "-", "session": "-", "kind": "-", "project": "-",
        "input_tokens": int(totals["input_tokens"]), "cache_creation_tokens": int(totals["cache_creation_tokens"]),
        "cache_read_tokens": int(totals["cache_read_tokens"]), "output_tokens": int(totals["output_tokens"]),
        "turns": int(totals["turns"]), "max_ctx_tokens": int(claude_peak),
        "codex_cumulative_total": int(codex_total),
        "est_usd": round(totals["est_usd"], 4),
    }


def _cell(value) -> str:
    """None -> empty TSV cell (the runtime-specific columns, C4); everything else -> str()."""
    return "" if value is None else str(value)


def write_ledger(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    totals = build_totals_row(rows)
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(RATE_TABLE_HEADER + "\n")
        f.write("\t".join(TSV_FIELDS) + "\n")
        for r in rows + [totals]:
            f.write("\t".join(_cell(r.get(k)) for k in TSV_FIELDS) + "\n")


def read_existing_rows(path: Path):
    """Idempotent-read path: an already-written day is read back, never recomputed.

    Returns None (fix round 1, Minor) when the file doesn't carry the expected `#`-prefixed
    rate-table header -- the caller then regenerates the day and logs one stderr line, instead of
    silently treating a corrupt/foreign/truncated file as "zero usage that day".
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or not lines[0].startswith("#"):
        return None
    header = lines[1].split("\t")
    rows = []
    for line in lines[2:]:
        if not line:
            continue
        values = line.split("\t")
        row = dict(zip(header, values))
        for k in ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens", "turns"):
            row[k] = int(row.get(k, 0) or 0)
        for k in ("max_ctx_tokens", "codex_cumulative_total"):
            row[k] = int(row[k]) if row.get(k) else None
        row["est_usd"] = float(row.get("est_usd", 0) or 0)
        rows.append(row)
    if rows and rows[-1]["runtime"] == "_totals":
        rows = rows[:-1]  # summary_line recomputes totals from the non-totals rows
    return rows


def summary_line(rows: list[dict], target_day: str) -> str:
    totals = build_totals_row(rows)
    claude_usd = sum(r["est_usd"] for r in rows if r["runtime"] == "claude")
    codex_usd = sum(r["est_usd"] for r in rows if r["runtime"] == "codex")
    peak_ctx_k = int(totals["max_ctx_tokens"]) // 1000
    codex_total_m = totals["codex_cumulative_total"] / 1e6
    line = (
        f"{target_day}: claude ${claude_usd:.2f}-eq / codex ${codex_usd:.2f}-eq "
        f"| {int(totals['turns'])} turns | peak ctx {peak_ctx_k}k | codex total {codex_total_m:.1f}M"
    )
    return line[:200]


# ---------------------------------------------------------------------------
# Ops publish -- PORTED from scripts/codex_dispatch.py:publish_ops (same contention handling:
# never rebase, rebuild from a fresh fetch; ancestry check, not head equality, decides "landed").
# fix round 1, C2: before ever committing, check whether the target path is already tracked AND
# identical to what we're about to write -- if so, this IS success (already on ops), and treating
# an empty "nothing to commit" as a retry-worthy failure was the bug. `git diff --quiet` alone is
# NOT enough: it reports "no difference" for an untracked path too (verified empirically -- git
# diff never looks at untracked files), which would have falsely reported "already on ops" for a
# BRAND NEW date's file that was never committed at all. `git ls-files --error-unmatch` first
# confirms the path is actually tracked before trusting the diff.
# ---------------------------------------------------------------------------

def publish_to_ops(repo_root: Path, file_path: Path, rel_path: str) -> tuple[bool, str]:
    def git(*a, cwd=repo_root, timeout=120):
        try:
            return subprocess.run(["git", *a], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(a, 1, "", "git timed out")

    def landed(sha):
        return bool(sha) and git("merge-base", "--is-ancestor", sha, "FETCH_HEAD").returncode == 0

    def already_identical(cwd) -> bool:
        tracked = git("ls-files", "--error-unmatch", "--", rel_path, cwd=cwd).returncode == 0
        return tracked and git("diff", "--quiet", "--", rel_path, cwd=cwd).returncode == 0

    content = file_path.read_bytes()
    wt = Path(tempfile.mkdtemp(prefix="usage-ledger-")) / "wt"
    local_sha = ""
    try:
        for attempt in range(3):
            if attempt:
                time.sleep(random.uniform(0.5, 2.0))
            if git("fetch", "origin", "ops").returncode != 0:
                continue
            if landed(local_sha):
                return True, "pushed"
            if wt.exists():
                git("reset", "--hard", "origin/ops", cwd=wt)
                git("clean", "-fdq", cwd=wt)
            elif git("worktree", "add", "--detach", str(wt), "origin/ops").returncode != 0:
                continue
            target = wt / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            if already_identical(wt):
                return True, "already on ops (identical content)"
            git("add", "--", str(target), cwd=wt)
            if git("commit", "-m", f"chore(usage-ledger): record {rel_path}", cwd=wt).returncode != 0:
                continue
            local_sha = git("rev-parse", "HEAD", cwd=wt).stdout.strip()
            if git("push", "origin", "HEAD:refs/heads/ops", cwd=wt).returncode != 0:
                continue
            if git("fetch", "origin", "ops").returncode == 0 and landed(local_sha):
                return True, "pushed"
        return False, "publish failed after 3 rebuilt attempts (local file kept)"
    finally:
        git("worktree", "remove", "--force", str(wt))
        git("worktree", "prune")


# ---------------------------------------------------------------------------
# fix round 1, C3: a failed publish is tracked in a small state dir so the NEXT invocation for the
# same date retries it, even though the day's TSV already exists (the normal idempotent-read path
# would otherwise never look at publish status again).
# ---------------------------------------------------------------------------

def _state_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "kb-usage-ledger"


def _pending_marker(target_day: str) -> Path:
    return _state_dir() / f"{target_day}.pending"


def _publish_and_track(root: Path, out_path: Path, rel_path: str, target_day: str) -> None:
    ok, msg = publish_to_ops(root, out_path, rel_path)
    marker = _pending_marker(target_day)
    if ok:
        try:
            marker.unlink()
        except OSError:
            pass
    else:
        try:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(msg, encoding="utf-8")
        except OSError:
            pass
        print(f"usage_ledger: publish failed for {rel_path}: {msg}", file=sys.stderr)


def _run(env, root: Path, target_day: str, full: bool = False) -> tuple[list[dict], Path]:
    rows = collect_claude_rows(env, target_day, full=full) + collect_codex_rows(env, target_day)
    rows.sort(key=lambda r: (r["runtime"], r["model"], r["session"], r["kind"]))
    out_path = root / "ledgers" / "usage" / f"{target_day}.tsv"
    write_ledger(out_path, rows)
    return rows, out_path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=None, help="YYYY-MM-DD, default yesterday (UTC)")
    parser.add_argument("--summary", action="store_true", help="print the one-line summary")
    parser.add_argument("--no-publish", action="store_true", help="skip the ops publish (tests, dry runs)")
    parser.add_argument("--root", default=None, help="repo root override (tests only)")
    parser.add_argument("--full", action="store_true", help="include transcripts over 64 MB (skipped by default)")
    args = parser.parse_args(argv)

    env = os.environ
    if env.get("KB_INSIDE_CODEX_WORKER"):
        print(
            "usage_ledger.py refuses to run inside a codex worker (KB_INSIDE_CODEX_WORKER=1) -- "
            "self-ingestion hazard (openai/codex#27131); run it from the operator shell instead.",
            file=sys.stderr,
        )
        return 3

    target_day = args.date or (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    try:
        date.fromisoformat(target_day)
    except ValueError:
        print(f"bad --date {target_day!r}, expected YYYY-MM-DD", file=sys.stderr)
        return 2

    root = Path(args.root) if args.root else REPO_ROOT
    out_path = root / "ledgers" / "usage" / f"{target_day}.tsv"
    rel_path = f"ledgers/usage/{target_day}.tsv"

    if out_path.exists():
        rows = read_existing_rows(out_path)
        if rows is None:
            print(f"usage_ledger: {out_path} missing the expected header, regenerating", file=sys.stderr)
            rows, out_path = _run(env, root, target_day, full=args.full)
            if not args.no_publish:
                _publish_and_track(root, out_path, rel_path, target_day)
        elif not args.no_publish and _pending_marker(target_day).exists():
            _publish_and_track(root, out_path, rel_path, target_day)
    else:
        rows, out_path = _run(env, root, target_day, full=args.full)
        if not args.no_publish:
            _publish_and_track(root, out_path, rel_path, target_day)

    if args.summary:
        print(summary_line(rows, target_day))
    else:
        print(f"wrote {out_path} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
