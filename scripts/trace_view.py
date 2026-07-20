"""Wave E — Flight Recorder viewer: static HTML waterfall + fork-from-step-N.

Two modes over a normalized `traces/<card-id>/<run>.jsonl` (from
`trace_normalize.py`):

* DEFAULT — render a self-contained static HTML span waterfall into
  `dashboards/traces/<card-id>-<run>.html`. Plain HTML/CSS with an inline
  `<style>`; NO external assets, NO JavaScript, NO frameworks. All span content
  is HTML-escaped.

* `--fork N` — reconstruction-not-restore. Emit a seeded prompt FILE
  (`dashboards/traces/<card-id>-<run>-fork-N.md`): a markdown document that
  summarizes the spans up to step N plus an instruction header. It reconstructs
  CONTEXT for a fresh session to resume from; it does NOT restore or replay the
  original execution (no state, no session handle, no tool re-invocation) —
  nothing more than a prompt seed.

CLI: `py -3 scripts/trace_view.py [--repo .] <trace.jsonl> [--fork N]
      [--out DIR]`. Preamble-gated (STOP supremacy) on entry.
"""
from __future__ import annotations

import argparse
import datetime
import html
import json
import sys
from pathlib import Path

import preamble

try:
    import ledger
    _COST_FN = ledger.cost_today
except Exception:  # noqa: BLE001
    ledger = None  # type: ignore[assignment]
    _COST_FN = None


# --------------------------------------------------------------------------- #
# loading                                                                     #
# --------------------------------------------------------------------------- #

def load_trace(path: Path) -> list[dict]:
    """Read a normalized trace jsonl. Garbage lines are skipped (never fatal)."""
    spans: list[dict] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("span_id"):
            spans.append(obj)
    return spans


def _ident(trace_path: Path) -> tuple[str, str]:
    """(card-id, run) from a `traces/<card-id>/<run>.jsonl` path."""
    p = Path(trace_path)
    return p.parent.name, p.stem


def _parse_ts(value) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.timestamp()


# --------------------------------------------------------------------------- #
# HTML waterfall                                                              #
# --------------------------------------------------------------------------- #

_STYLE = """
body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:1.5rem;color:#e6e6e6;background:#111}
h1{font-size:1.1rem}
table{border-collapse:collapse;width:100%;font-size:.82rem}
th,td{padding:.28rem .5rem;border-bottom:1px solid #2a2a2a;text-align:left;vertical-align:top}
th{color:#9aa}
.kind{font-variant:small-caps;color:#8ab4f8}
.bartrack{position:relative;background:#1b1b1b;height:14px;border-radius:3px;min-width:120px}
.bar{position:absolute;top:0;height:14px;border-radius:3px;background:#3b6ea5}
.bar.stage{background:#4a7a4a}.bar.model{background:#8a6d3b}.bar.tool{background:#3b6ea5}
.name{max-width:32rem;overflow-wrap:anywhere}
.meta{color:#9aa;font-size:.74rem}
.trunc{color:#c99}
"""


def _bar(span: dict, base: float, total: float) -> str:
    start = _parse_ts(span.get("start"))
    end = _parse_ts(span.get("end"))
    if start is None:
        return '<div class="bartrack"></div>'
    if end is None or end < start:
        end = start
    if total <= 0:
        left, width = 0.0, 100.0
    else:
        left = max(0.0, (start - base) / total * 100.0)
        width = max(1.5, (end - start) / total * 100.0)
        if left + width > 100.0:
            width = max(1.5, 100.0 - left)
    cls = span["kind"] if span["kind"] in ("stage", "model", "tool") else "tool"
    return (f'<div class="bartrack"><div class="bar {cls}" '
            f'style="left:{left:.2f}%;width:{width:.2f}%"></div></div>')


def render_html(spans: list[dict], card_id: str, run: str) -> str:
    starts = [t for t in (_parse_ts(s.get("start")) for s in spans) if t is not None]
    ends = [t for t in (_parse_ts(s.get("end")) for s in spans) if t is not None]
    base = min(starts) if starts else 0.0
    total = (max(ends) - base) if ends else 0.0

    esc = html.escape
    rows = []
    for i, s in enumerate(spans, start=1):
        attrs = s.get("attrs") or {}
        meta = " ".join(f"{esc(str(k))}={esc(str(v))}"
                        for k, v in sorted(attrs.items()))
        trunc = ' <span class="trunc">[truncated]</span>' if s.get("truncated") else ""
        indent = "&nbsp;&nbsp;&nbsp;&nbsp;" if s.get("parent_span_id") else ""
        rows.append(
            "<tr>"
            f"<td>{i}</td>"
            f'<td class="kind">{esc(str(s.get("kind")))}</td>'
            f'<td class="name">{indent}{esc(str(s.get("name") or ""))}{trunc}'
            f'<div class="meta">{meta}</div></td>'
            f"<td>{_bar(s, base, total)}</td>"
            "</tr>")
    if not spans:
        rows.append('<tr><td colspan="4"><em>(empty trace — no spans)</em></td></tr>')

    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>Trace {esc(card_id)} / {esc(run)}</title>"
        f"<style>{_STYLE}</style></head><body>"
        f"<h1>Flight Recorder — {esc(card_id)} <span class=\"meta\">/ {esc(run)}</span></h1>"
        f"<p class=\"meta\">{len(spans)} span(s). Waterfall is relative to the "
        "earliest span; zero-duration steps render as a marker.</p>"
        "<table><thead><tr><th>#</th><th>kind</th><th>name</th>"
        "<th>timeline</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></body></html>\n"
    )


def html_path(out_dir: Path, card_id: str, run: str) -> Path:
    return Path(out_dir) / f"{card_id}-{run}.html"


def write_html(trace_file: Path, out_dir: Path) -> Path:
    card_id, run = _ident(trace_file)
    spans = load_trace(trace_file)
    path = html_path(out_dir, card_id, run)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_html(spans, card_id, run), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# fork-from-step-N (reconstruction-not-restore)                               #
# --------------------------------------------------------------------------- #

def render_fork(spans: list[dict], card_id: str, run: str, step: int) -> str:
    kept = spans[:step]
    out = [
        f"# Seeded prompt — fork of `{card_id}` / `{run}` at step {step}",
        "",
        "> RECONSTRUCTION, NOT RESTORE. This is a context seed for a FRESH "
        "session: it summarizes the first "
        f"{len(kept)} span(s) of the recorded trace so you can resume the work. "
        "It does not restore session state, replay tools, or re-run commands. "
        "Re-derive anything you need; treat the summary below as inert context.",
        "",
        "## Instruction",
        "",
        "Continue the task from the point below. Verify the current repository "
        "state yourself before acting — the summary is a historical reconstruction "
        "and may be stale.",
        "",
        f"## Recorded steps (1..{len(kept)})",
        "",
    ]
    if not kept:
        out.append("_(no spans at or before this step)_")
    for i, s in enumerate(kept, start=1):
        attrs = s.get("attrs") or {}
        meta = ", ".join(f"{k}={v}" for k, v in sorted(attrs.items()))
        name = str(s.get("name") or "").replace("\n", " ")
        line = f"{i}. [{s.get('kind')}] {name}"
        if meta:
            line += f" ({meta})"
        out.append(line)
    out.append("")
    return "\n".join(out)


def fork_path(out_dir: Path, card_id: str, run: str, step: int) -> Path:
    return Path(out_dir) / f"{card_id}-{run}-fork-{step}.md"


def write_fork(trace_file: Path, step: int, out_dir: Path) -> Path:
    card_id, run = _ident(trace_file)
    spans = load_trace(trace_file)
    path = fork_path(out_dir, card_id, run, step)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_fork(spans, card_id, run, step), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Render a static trace waterfall or a fork seed (Wave E).")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("trace", help="path to a normalized <run>.jsonl trace")
    ap.add_argument("--fork", type=int, default=None, metavar="N",
                    help="emit a seeded prompt reconstructing spans up to step N")
    ap.add_argument("--out", default=None,
                    help="output dir (default: <repo>/dashboards/traces)")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()
    problems = preamble.check(repo_root, cost_today_fn=_COST_FN)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return 1

    trace_file = Path(args.trace)
    if not trace_file.exists():
        print(f"trace not found: {trace_file}", file=sys.stderr)
        return 1
    out_dir = Path(args.out) if args.out else repo_root / "dashboards" / "traces"

    if args.fork is not None:
        if args.fork < 1:
            print("--fork N must be >= 1", file=sys.stderr)
            return 1
        path = write_fork(trace_file, args.fork, out_dir)
    else:
        path = write_html(trace_file, out_dir)
    print(str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
