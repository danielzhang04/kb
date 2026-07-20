"""Wave E — Flight Recorder: normalize control-plane events into a span trace.

Reads the dashboard control-plane store and emits, per execution (run), a
`traces/<card-id>/<run>.jsonl` file of GenAI-semconv-shaped span records:

    {span_id, parent_span_id, name, kind, start, end, attrs, truncated}

    kind  is one of "stage" | "model" | "tool":
      * stage  — a workflow Stage (top-level under the run).
      * model  — an Attempt (a runtime/model invocation), parented to its stage.
      * tool   — an OperationalEvent (tool/command/file/... step), parented to
                 its attempt (or stage) span.
    attrs carries only { state?, model?, runtime?, source?, event_kind?,
                         diff_bytes? } — operational metadata, never payloads.

Bloat guard (design, §Wave E): text fields are truncated at 2KB and RAW FILE
CONTENTS are never emitted — an event's `diff` (which carries file content) is
represented only by its byte length (`attrs.diff_bytes`), never its text. Any
truncation sets the span's `truncated` flag.

Store format (READ-ONLY; discovered from dashboard/server/control/store.ts +
types.ts, resolved via composer/store.ts `resolveDashboardStateRoot`):
  * Path: `<stateRoot>/control/control-plane.json`, where stateRoot =
    $DASHBOARD_STATE_ROOT, else %LOCALAPPDATA%/kb/dashboard, else ~/.kb/dashboard.
  * A single JSON object `{version, nextEventCursor, proposals, runs, stages,
    attempts, sessions, humanRequests, events, quarantine}`. Every run/stage/
    attempt/session/event carries a `subject` (the per-card tenant key, used
    here as <card-id>) and a `runRef`. Events are the closed public boundary:
    they carry NO tokens/usage/prompts (provider payloads are unrepresentable at
    that persistence boundary), so `attrs.tokens` is simply absent — recorded
    honestly rather than invented.

The engine has never been activated, so the store normally has NO runs; that is
a clean "no executions found" exit, and the format is exercised by synthetic
fixtures in tests. LIVE WIRING (documented, NOT built — activation is
human-gated): a post-run hook in `dashboard/server/control/claudeWorkerAdapter.ts`
would call this normalizer from the stored events once the execution engine is
activated. This tool always reads from the persisted store; it never taps a live
transcript.

CLI: `py -3 scripts/trace_normalize.py [--repo .] [--store PATH]
      [--subject CARD_ID] [--run RUNREF] [--out DIR]`. Preamble-gated (STOP
supremacy) on entry.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import preamble

try:
    import ledger
    _COST_FN = ledger.cost_today
except Exception:  # noqa: BLE001
    ledger = None  # type: ignore[assignment]
    _COST_FN = None

TRUNCATE_LIMIT = 2048  # 2KB cap, measured in UTF-8 BYTES (not codepoints) for
                       # names / operational text fields — a multi-byte
                       # (e.g. emoji) string is cut on a whole-codepoint
                       # boundary, never split mid-character.
_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


# --------------------------------------------------------------------------- #
# store location + loading                                                    #
# --------------------------------------------------------------------------- #

def resolve_store_path(env: dict | None = None) -> Path:
    """The control-plane store path, mirroring the dashboard's
    `resolveDashboardStateRoot` precedence (READ-ONLY; we never write here)."""
    env = os.environ if env is None else env
    configured = (env.get("DASHBOARD_STATE_ROOT") or "").strip()
    if configured:
        root = configured
    else:
        localapp = (env.get("LOCALAPPDATA") or "").strip()
        if localapp:
            root = os.path.join(localapp, "kb", "dashboard")
        else:
            root = os.path.join(os.path.expanduser("~"), ".kb", "dashboard")
    return Path(root) / "control" / "control-plane.json"


def load_store(path: Path) -> dict | None:
    """Load the store document. Returns None for a missing OR unreadable store
    (both are 'no executions found', never a crash — the engine may simply have
    never run). A present-but-garbage file is treated as absent, not fatal."""
    path = Path(path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _rows(document: dict, key: str) -> list[dict]:
    """The list under `key`, keeping only dict rows (garbage is skipped)."""
    value = document.get(key)
    if not isinstance(value, list):
        return []
    return [row for row in value if isinstance(row, dict)]


def list_runs(document: dict, *, subject: str | None = None,
              run: str | None = None) -> list[dict]:
    """Runs in the store, optionally filtered by subject and/or runRef."""
    out = []
    for r in _rows(document, "runs"):
        if not r.get("runRef"):
            continue
        if subject is not None and r.get("subject") != subject:
            continue
        if run is not None and r.get("runRef") != run:
            continue
        out.append(r)
    return out


# --------------------------------------------------------------------------- #
# normalization (pure)                                                        #
# --------------------------------------------------------------------------- #

def _truncate(text, flag: list[bool]) -> str | None:
    if text is None:
        return None
    s = str(text)
    encoded = s.encode("utf-8")
    if len(encoded) <= TRUNCATE_LIMIT:
        return s
    flag[0] = True
    # Cut at the byte cap, then back off one byte at a time until the tail
    # decodes cleanly — never emit a split/invalid codepoint.
    chunk = encoded[:TRUNCATE_LIMIT]
    while chunk:
        try:
            return chunk.decode("utf-8")
        except UnicodeDecodeError:
            chunk = chunk[:-1]
    return ""


def _span(span_id, parent, name, kind, start, end, attrs, truncated) -> dict:
    return {
        "span_id": span_id,
        "parent_span_id": parent,
        "name": name,
        "kind": kind,
        "start": start,
        "end": end,
        "attrs": {k: v for k, v in attrs.items() if v is not None},
        "truncated": truncated,
    }


def _sort_key(span: dict) -> tuple:
    kind_rank = {"stage": 0, "model": 1, "tool": 2}
    return (str(span.get("start") or ""), kind_rank.get(span["kind"], 9),
            str(span.get("span_id") or ""))


def normalize_run(document: dict, run: dict) -> list[dict]:
    """Build the span list for one run. Individual malformed stage/attempt/event
    rows are skipped, never fatal. Chronologically ordered so a step index is
    meaningful for `trace_view --fork`."""
    subject = run.get("subject")
    run_ref = run.get("runRef")
    spans: list[dict] = []

    def belongs(row: dict) -> bool:
        return row.get("subject") == subject and row.get("runRef") == run_ref

    for stage in _rows(document, "stages"):
        if not belongs(stage) or not stage.get("stageRef"):
            continue
        flag = [False]
        name = _truncate(stage.get("title") or stage.get("stageId"), flag)
        spans.append(_span(
            stage["stageRef"], None, name, "stage",
            stage.get("createdAt"), stage.get("updatedAt"),
            {"state": stage.get("state")}, flag[0]))

    for attempt in _rows(document, "attempts"):
        if not belongs(attempt) or not attempt.get("attemptRef"):
            continue
        flag = [False]
        runtime = attempt.get("runtime")
        model = attempt.get("model")
        name = _truncate(f"{runtime}/{model}" if runtime or model else "attempt", flag)
        spans.append(_span(
            attempt["attemptRef"], attempt.get("stageRef"), name, "model",
            attempt.get("createdAt"), attempt.get("updatedAt"),
            {"state": attempt.get("state"), "model": model, "runtime": runtime},
            flag[0]))

    for event in _rows(document, "events"):
        if not belongs(event):
            continue
        cursor = event.get("cursor")
        if cursor is None:
            continue
        flag = [False]
        label = (event.get("toolName") or event.get("command")
                 or event.get("summary") or event.get("kind"))
        name = _truncate(label, flag)
        # A diff carries raw file content: emit its size, NEVER its text.
        diff = event.get("diff")
        diff_bytes = len(str(diff).encode("utf-8")) if diff else None
        parent = event.get("attemptRef") or event.get("stageRef")
        spans.append(_span(
            f"event-{cursor}", parent, name, "tool",
            event.get("createdAt"), event.get("createdAt"),
            {"state": event.get("status"), "source": event.get("source"),
             "event_kind": event.get("kind"),
             "path": _truncate(event.get("path"), flag),
             "diff_bytes": diff_bytes},
            flag[0]))

    spans.sort(key=_sort_key)
    return spans


# --------------------------------------------------------------------------- #
# writing                                                                     #
# --------------------------------------------------------------------------- #

def _safe(name: str) -> str:
    return _SAFE_RE.sub("_", str(name or "unknown")).strip("_") or "unknown"


def trace_path(out_dir: Path, subject: str, run_ref: str) -> Path:
    return Path(out_dir) / _safe(subject) / f"{_safe(run_ref)}.jsonl"


def write_trace(out_dir: Path, subject: str, run_ref: str,
                spans: list[dict]) -> Path:
    path = trace_path(out_dir, subject, run_ref)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(s, sort_keys=True, separators=(",", ":")) for s in spans]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return path


def normalize(document: dict, out_dir: Path, *, subject: str | None = None,
              run: str | None = None) -> list[Path]:
    """Normalize every matching run in `document` into `out_dir`. Returns the
    written trace paths (empty when there are no matching executions)."""
    written: list[Path] = []
    for r in list_runs(document, subject=subject, run=run):
        spans = normalize_run(document, r)
        written.append(write_trace(out_dir, r.get("subject") or "unknown",
                                   r.get("runRef"), spans))
    return written


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Normalize control-plane events into span traces (Wave E).")
    ap.add_argument("--repo", default=".", help="repo root (default trace out dir)")
    ap.add_argument("--store", default=None,
                    help="control-plane.json path (default: dashboard state root)")
    ap.add_argument("--subject", default=None, help="filter to one card-id/subject")
    ap.add_argument("--run", default=None, help="filter to one runRef")
    ap.add_argument("--out", default=None,
                    help="trace output dir (default: <repo>/traces)")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()
    problems = preamble.check(repo_root, cost_today_fn=_COST_FN)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return 1

    store_path = Path(args.store) if args.store else resolve_store_path()
    out_dir = Path(args.out) if args.out else repo_root / "traces"

    document = load_store(store_path)
    if document is None:
        print(f"no executions found (no control-plane store at {store_path})")
        return 0

    written = normalize(document, out_dir, subject=args.subject, run=args.run)
    if not written:
        print("no executions found (store has no matching runs)")
        return 0
    for path in written:
        print(str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
