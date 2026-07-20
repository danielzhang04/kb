"""Wave C — Dreaming: memory-consolidation dry-run reporter (design-gated).

Dreaming self-modifies fleet memory, so per the approved arc it ships behind a
DESIGN GATE: this build produces a REPORT ONLY and NEVER rewrites `memory/`.
A human — or, once the Proving Grounds trust gate opens, a trusted dream cadence
— applies any accepted operations on a branch (`claude/dream-YYYY-MM-DD`). This
script only *proposes*; it has no apply path at all.

`dream_report(repo_root)` reads every `memory/*.md` file plus recent grade-ledger
rows and emits, per memory file, a list of consolidation operations in the Mem0
router vocabulary — ADD / UPDATE / DELETE / NOOP — following the Anthropic Dreams
contract (merge-dupes / replace-stale / prune). The heuristics are deterministic
and LLM-free:

* merge-dupes  (UPDATE) — two entries whose normalized first lines are near
  duplicates (token-set Jaccard >= threshold) and the later one carries no
  "change" marker: the older folds into the newer.
* replace-stale (UPDATE) — an open item (`REMAINS`/`TODO`/…) whose referenced
  card id is graded *pass* in the recent grade ledger, OR an entry a later
  near-duplicate explicitly supersedes (a "change" marker: correction/rolled
  back/superseded/…).
* prune         (DELETE) — a dead reference (names a repo path that is absent),
  or a resolved TODO (a later near-duplicate entry carries a success verb).
* NOOP — everything else is kept verbatim.

ADD is part of the router vocabulary and appears in the summary table, but it is
reserved for the trusted apply path (proposing brand-new facts from evidence);
the dry-run's consolidation scope over EXISTING memory is UPDATE / DELETE / NOOP.

CLI: `py -3 scripts/dream.py --dry-run [--repo .] [--out PATH]`. STOP-file
supremacy is enforced FIRST (the shared preamble). Running WITHOUT `--dry-run`
refuses: apply-mode is design-gated pending Proving Grounds trust — it prints a
short message and exits non-zero, having done nothing.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import preamble

try:  # cost hook for the preamble gate; optional so dream imports standalone.
    import ledger
    _COST_FN = ledger.cost_today
except Exception:  # noqa: BLE001 — a missing ledger must not break dream import.
    ledger = None  # type: ignore[assignment]
    _COST_FN = None

# Exit codes (documented contract):
EXIT_OK = 0         # dry-run produced a report
EXIT_PREAMBLE = 2   # STOP / budget / API-key gate blocked the run (did nothing)
EXIT_GATED = 3      # apply-mode requested but design-gated (did nothing)

DEFAULT_THRESHOLD = 0.6
DEFAULT_SINCE_DAYS = 30

# --------------------------------------------------------------------------- #
# marker vocabularies (module-level data, not code paths — extend freely)
# --------------------------------------------------------------------------- #

# An entry that reads like an open item / unfinished work.
_TODO_MARKERS = (
    "remains", "todo", "to-do", "pending", "resume point", "resume from",
    "next =", "next:", "owed", "still owed", "still pending", "blocks",
)
# A later entry carrying one of these RE-STATES an earlier one (replace-stale).
_CHANGE_MARKERS = (
    "supersede", "superseded", "supersedes", "correction", "corrected",
    "rolled back", "rollback", "erased", "deprecated", "no longer",
    "now instead", "revised", "revision", "update:", "updated:", "actually",
)
# A later entry carrying one of these RESOLVES an earlier open item (prune).
_SUCCESS_MARKERS = (
    "done", "complete", "completed", "merged", "landed", "shipped", "closed",
    "resolved", "built", "passed", "green", "executed", "finished",
)

# Tiny stopword set for normalization (so trivial glue words never dominate a
# Jaccard score). Kept small on purpose — this is data, not a linguistics model.
_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "was",
    "are", "be", "by", "with", "as", "at", "it", "its", "this", "that", "via",
    "not", "no", "but", "so", "than", "then", "per", "run", "ran", "from",
})

# Meta/status tokens (todo / change / success markers) are stripped from the
# dupe-key so they never dilute the SUBSTANCE similarity between two entries —
# the whole point is to match an open item against its later resolution, or an
# old fact against its correction, where only the status word differs.
_META_TOKENS = frozenset({
    "remains", "todo", "pending", "resume", "owed", "blocks", "still",
    "supersede", "superseded", "supersedes", "correction", "corrected",
    "rolled", "rollback", "back", "erased", "deprecated", "longer", "instead",
    "now", "revised", "revision", "update", "updated", "actually",
    "done", "complete", "completed", "merged", "landed", "shipped", "closed",
    "resolved", "built", "passed", "green", "executed", "finished",
    "lesson", "note", "reminder", "plan", "decided", "worked", "friction",
})

# A repo-relative artifact path: has a `/`, an extension, no glob/placeholder
# markers (the charclass already bars <,>,*,?). Mirrors sentinel's path shape.
_PATH_RE = re.compile(r"(?<![\w./])([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]+)")
# A fleet card id: `int(time.time()):08x` + '-' + 8 hex (cards.new_id shape).
_CARD_ID_RE = re.compile(r"\b([0-9a-f]{8}-[0-9a-f]{8})\b")
_SECTION_DATE_RE = re.compile(r"^\s*##\s+(\d{4}-\d{2}-\d{2})")
_BULLET_RE = re.compile(r"^-\s+(.*)$")
_LABEL_RE = re.compile(r"^\s*(?:\*\*)?([A-Za-z][A-Za-z /()'-]*?)(?:\*\*)?:\s")


# --------------------------------------------------------------------------- #
# small pure helpers
# --------------------------------------------------------------------------- #

def _today() -> datetime.date:
    return datetime.datetime.now(datetime.timezone.utc).date()


def _passed(value) -> bool:
    """Fail-closed truthiness matching grade/promotion semantics."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes", "pass", "passed")


def _normalize_tokens(line: str) -> set[str]:
    """Normalized token set of a single line: strip a leading label, lowercase,
    drop markdown/punctuation, drop stopwords and <=2-char tokens."""
    line = line.strip()
    line = _LABEL_RE.sub("", line, count=1)  # drop a leading `WORKED:` / `**Lesson**:`
    line = line.lower()
    toks = re.findall(r"[a-z0-9]+", line)
    return {t for t in toks
            if len(t) > 2 and t not in _STOPWORDS and t not in _META_TOKENS}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _contains_any(text: str, markers) -> bool:
    low = text.lower()
    return any(m in low for m in markers)


# --------------------------------------------------------------------------- #
# memory parsing
# --------------------------------------------------------------------------- #

@dataclass
class Entry:
    index: int
    date: str | None          # dated `## YYYY-MM-DD` section this entry sits under
    text: str                 # full entry text (bullet + continuation lines)
    summary: str              # first line, label stripped, for display
    tokens: set[str]          # normalized first-line tokens (dupe key)
    is_todo: bool
    has_change: bool
    has_success: bool
    paths: list[str]
    card_ids: list[str]

    @property
    def sort_key(self) -> tuple[str, int]:
        """Chronological order: section date (missing sorts first), then position."""
        return (self.date or "0000-00-00", self.index)


def _first_line(text: str) -> str:
    body = _BULLET_RE.sub(r"\1", text.splitlines()[0]) if text.splitlines() else ""
    return body.strip()


def parse_memory(text: str) -> list[Entry]:
    """Parse a memory markdown file into top-level bullet entries. Sub-bullets and
    wrapped lines fold into their parent entry. `## YYYY-MM-DD` headings set the
    date context; a bare `# memory: <id>` title is ignored."""
    lines = text.splitlines()
    entries: list[Entry] = []
    cur_date: str | None = None
    i = 0
    idx = 0
    while i < len(lines):
        line = lines[i]
        m = _SECTION_DATE_RE.match(line)
        if m:
            cur_date = m.group(1)
            i += 1
            continue
        if _BULLET_RE.match(line):
            block = [line]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if _BULLET_RE.match(nxt) or re.match(r"^\s*#{1,6}\s", nxt):
                    break
                block.append(nxt)
                i += 1
            entry_text = "\n".join(block).strip()
            first = _first_line(entry_text)
            entries.append(Entry(
                index=idx,
                date=cur_date,
                text=entry_text,
                summary=first,
                tokens=_normalize_tokens(first),
                is_todo=_contains_any(entry_text[:160], _TODO_MARKERS),
                has_change=_contains_any(entry_text, _CHANGE_MARKERS),
                has_success=_contains_any(entry_text, _SUCCESS_MARKERS),
                paths=_extract_paths(entry_text),
                card_ids=_CARD_ID_RE.findall(entry_text),
            ))
            idx += 1
            continue
        i += 1
    return entries


def _extract_paths(text: str) -> list[str]:
    """Concrete repo-relative artifact paths named in `text` (URLs/globs excluded)."""
    found: list[str] = []
    for m in _PATH_RE.finditer(text):
        tok = m.group(1)
        start = m.start(1)
        if "://" in text[max(0, start - 8):start + len(tok)]:
            continue
        if tok not in found:
            found.append(tok)
    return found


# --------------------------------------------------------------------------- #
# recent ledger evidence
# --------------------------------------------------------------------------- #

def passed_card_ids(repo_root, *, now: datetime.date | None = None,
                    since_days: int = DEFAULT_SINCE_DAYS) -> set[str]:
    """Card ids graded `pass` in the grade ledger within the recent window
    (rows whose `ts` date >= now - since_days). Reads via promotion.read_grades
    when available, else globs the shards directly — never a parallel ledger."""
    now = now or _today()
    cutoff = (now - datetime.timedelta(days=since_days)).isoformat()
    rows = _read_grade_rows(repo_root)
    ids: set[str] = set()
    for row in rows:
        ts = str(row.get("ts") or "")
        if ts and ts[:10] < cutoff:
            continue
        if _passed(row.get("pass")) and row.get("card_id"):
            ids.add(str(row["card_id"]).strip())
    return ids


def _read_grade_rows(repo_root) -> list[dict]:
    try:
        import promotion
        return promotion.read_grades(repo_root)
    except Exception:  # noqa: BLE001 — fall back to a direct glob if promotion absent.
        d = Path(repo_root) / "ledgers" / "grades"
        rows: list[dict] = []
        if not d.exists():
            return rows
        for shard in sorted(d.glob("*.tsv")):
            try:
                with shard.open(encoding="utf-8", newline="") as f:
                    rows.extend(csv.DictReader(f, delimiter="\t"))
            except OSError:
                continue
        return rows


# --------------------------------------------------------------------------- #
# consolidation analysis (the Mem0 router)
# --------------------------------------------------------------------------- #

# op letter -> reason(s); reason -> op letter for rendering/counting.
_REASON_OP = {
    "prune-dead-ref": "DELETE",
    "prune-resolved": "DELETE",
    "replace-stale": "UPDATE",
    "merge-dupes": "UPDATE",
    "keep": "NOOP",
}
OP_LETTERS = ("ADD", "UPDATE", "DELETE", "NOOP")


@dataclass
class Op:
    op: str          # ADD | UPDATE | DELETE | NOOP
    reason: str      # merge-dupes | replace-stale | prune-dead-ref | prune-resolved | keep
    summary: str     # the entry's display summary
    detail: str      # human explanation of the proposal
    date: str | None = None


def analyze_file(entries: list[Entry], repo_root,
                 passed_ids: set[str], *, threshold: float = DEFAULT_THRESHOLD) -> list[Op]:
    """One Op per entry, in file order. Deterministic precedence:
    dead-ref > ledger-replace-stale > pair-based (resolved/superseded/merge) > NOOP."""
    repo_root = Path(repo_root)
    n = len(entries)
    assigned: list[Op | None] = [None] * n

    # (1) dead reference — an absent named artifact path.
    for i, e in enumerate(entries):
        dead = [p for p in e.paths if not (repo_root / p).exists()]
        if dead:
            shown = ", ".join(f"`{p}`" for p in dead[:3])
            assigned[i] = Op("DELETE", "prune-dead-ref", e.summary,
                             f"references missing path(s): {shown}", e.date)

    # (2) replace-stale by ledger evidence — an open item whose card is graded pass.
    for i, e in enumerate(entries):
        if assigned[i] is not None or not e.is_todo:
            continue
        hit = [c for c in e.card_ids if c in passed_ids]
        if hit:
            assigned[i] = Op("UPDATE", "replace-stale", e.summary,
                             f"open item resolved by ledger evidence: card `{hit[0]}` graded pass",
                             e.date)

    # (3) pair-based: for each earlier entry i, the first later near-duplicate j.
    order = sorted(range(n), key=lambda k: entries[k].sort_key)
    pos = {k: p for p, k in enumerate(order)}
    for i in range(n):
        if assigned[i] is not None:
            continue
        ei = entries[i]
        best_j = None
        for j in range(n):
            if j == i or pos[j] <= pos[i]:   # j must be strictly LATER than i
                continue
            if _jaccard(ei.tokens, entries[j].tokens) >= threshold:
                if best_j is None or pos[j] < pos[best_j]:
                    best_j = j
        if best_j is None:
            continue
        ej = entries[best_j]
        loc = f"[{ej.date}]" if ej.date else "[later entry]"
        if ei.is_todo and ej.has_success:
            assigned[i] = Op("DELETE", "prune-resolved", ei.summary,
                             f"open item resolved by a later entry {loc}: \"{_clip(ej.summary)}\"",
                             ei.date)
        elif ej.has_change:
            assigned[i] = Op("UPDATE", "replace-stale", ei.summary,
                             f"superseded by a later entry {loc}: \"{_clip(ej.summary)}\"",
                             ei.date)
        else:
            assigned[i] = Op("UPDATE", "merge-dupes", ei.summary,
                             f"near-duplicate of a later entry {loc}: \"{_clip(ej.summary)}\" — fold together",
                             ei.date)

    # (4) NOOP — keep verbatim.
    for i, e in enumerate(entries):
        if assigned[i] is None:
            assigned[i] = Op("NOOP", "keep", e.summary, "", e.date)
    return [op for op in assigned]  # type: ignore[misc]


def _clip(s: str, n: int = 80) -> str:
    s = s.replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


# --------------------------------------------------------------------------- #
# report assembly + render
# --------------------------------------------------------------------------- #

@dataclass
class FileReport:
    path: str                 # repo-relative, e.g. "memory/claude-boss.md"
    entry_count: int
    ops: list[Op]

    def counts(self) -> dict[str, int]:
        c = {k: 0 for k in OP_LETTERS}
        for op in self.ops:
            c[op.op] = c.get(op.op, 0) + 1
        return c

    @property
    def proposals(self) -> list[Op]:
        return [op for op in self.ops if op.op != "NOOP"]


@dataclass
class DreamReport:
    files: list[FileReport] = field(default_factory=list)
    passed_id_count: int = 0
    since_days: int = DEFAULT_SINCE_DAYS
    generated: str = ""

    def totals(self) -> dict[str, int]:
        t = {k: 0 for k in OP_LETTERS}
        for f in self.files:
            for k, v in f.counts().items():
                t[k] += v
        return t


def dream_report(repo_root, *, now: datetime.date | None = None,
                 since_days: int = DEFAULT_SINCE_DAYS,
                 threshold: float = DEFAULT_THRESHOLD) -> DreamReport:
    """Build the consolidation proposal over every `memory/*.md` file. PURE apart
    from reads — never writes to `memory/`. `now` is a seam for deterministic tests."""
    repo_root = Path(repo_root)
    now = now or _today()
    passed_ids = passed_card_ids(repo_root, now=now, since_days=since_days)

    files: list[FileReport] = []
    mem_dir = repo_root / "memory"
    if mem_dir.exists():
        for path in sorted(mem_dir.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            entries = parse_memory(text)
            ops = analyze_file(entries, repo_root, passed_ids, threshold=threshold)
            rel = path.relative_to(repo_root).as_posix()
            files.append(FileReport(rel, len(entries), ops))

    return DreamReport(
        files=files,
        passed_id_count=len(passed_ids),
        since_days=since_days,
        generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )


def render(report: DreamReport) -> str:
    out: list[str] = []
    out.append("# Dream — memory consolidation PROPOSAL (dry-run)")
    out.append("")
    out.append("> Generated by `scripts/dream.py --dry-run`. This is a **PROPOSAL ONLY** —")
    out.append("> it makes **no** changes to `memory/`. A human (or, once the Proving")
    out.append("> Grounds trust gate opens, a trusted dream cadence) applies any accepted")
    out.append("> operations on a branch (`claude/dream-YYYY-MM-DD`) — never this script.")
    out.append(">")
    out.append("> Router vocabulary (Mem0): ADD · UPDATE · DELETE · NOOP. ADD is reserved")
    out.append("> for the trusted apply path; this dry-run's scope is UPDATE / DELETE / NOOP.")
    out.append("")
    out.append(f"generated: {report.generated}")
    out.append(f"inputs: {len(report.files)} memory file(s); "
               f"{report.passed_id_count} passed-card id(s) over the last {report.since_days} day(s)")
    out.append("")

    # summary table
    out.append("## Summary")
    out.append("")
    out.append("| file | entries | ADD | UPDATE | DELETE | NOOP |")
    out.append("|---|---|---|---|---|---|")
    for f in report.files:
        c = f.counts()
        out.append(f"| {f.path} | {f.entry_count} | {c['ADD']} | {c['UPDATE']} "
                   f"| {c['DELETE']} | {c['NOOP']} |")
    t = report.totals()
    total_entries = sum(f.entry_count for f in report.files)
    out.append(f"| **total** | **{total_entries}** | **{t['ADD']}** | **{t['UPDATE']}** "
               f"| **{t['DELETE']}** | **{t['NOOP']}** |")
    if not report.files:
        out.append("")
        out.append("_No `memory/*.md` files found — nothing to consolidate._")
    out.append("")

    # per-file proposals
    for f in report.files:
        out.append(f"## {f.path}")
        proposals = f.proposals
        if not proposals:
            out.append(f"All {f.entry_count} entr{'y' if f.entry_count == 1 else 'ies'} "
                       f"kept (NOOP) — no consolidation proposed.")
            out.append("")
            continue
        for op in proposals:
            loc = f" [{op.date}]" if op.date else ""
            out.append(f"- **{op.op}** ({op.reason}){loc}: \"{_clip(op.summary)}\" — {op.detail}")
        noop = f.counts()["NOOP"]
        out.append(f"- _NOOP: {noop} entr{'y' if noop == 1 else 'ies'} kept verbatim._")
        out.append("")

    return "\n".join(out)


def write_report(path, text: str) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# --------------------------------------------------------------------------- #
# CLI (preamble-gated on entry — STOP supremacy)
# --------------------------------------------------------------------------- #

_GATED_MESSAGE = (
    "dream: apply-mode is design-gated pending Proving Grounds trust. This build "
    "ships the dry-run reporter ONLY — it never rewrites memory/. Re-run with "
    "--dry-run to produce the consolidation proposal (a human applies it on a branch)."
)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Dream — memory-consolidation dry-run reporter (Wave C, design-gated)")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("--dry-run", action="store_true",
                    help="produce the consolidation PROPOSAL report (the only supported mode)")
    ap.add_argument("--out", default=None,
                    help="also write the report to this path (as well as stdout)")
    ap.add_argument("--since-days", type=int, default=DEFAULT_SINCE_DAYS,
                    help="grade-ledger window for staleness evidence (default 30)")
    ap.add_argument("--dupe-threshold", type=float, default=DEFAULT_THRESHOLD,
                    help="token-set Jaccard threshold for near-duplicate lessons")
    args = ap.parse_args(argv)

    # The report echoes memory summaries that can contain non-cp1252 characters
    # (e.g. `→`); force UTF-8 so a redirected Windows stdout never crashes.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass

    repo_root = Path(args.repo).resolve()

    # STOP supremacy: the shared preamble gate runs FIRST, before any mode logic.
    problems = preamble.check(repo_root, cost_today_fn=_COST_FN)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_PREAMBLE

    # Apply-mode is design-gated: refuse anything that is not an explicit dry-run.
    if not args.dry_run:
        print(_GATED_MESSAGE, file=sys.stderr)
        return EXIT_GATED

    report = dream_report(repo_root, since_days=args.since_days,
                          threshold=args.dupe_threshold)
    text = render(report)
    print(text)
    if args.out:
        path = write_report(args.out, text)
        print(f"\nwrote {path}", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
