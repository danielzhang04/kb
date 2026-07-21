"""Stranded-archive report — the weekly-audit surface's count of auto-archived cards.

The daemon stranded-archiver v2 (dashboard/server/write/strandedArchiver.ts), in its
LIVE mode, MOVES an abandoned card — owned by a REAL agent, with BOTH the card AND its
owner idle in inbox/working past the stranded window (default 7 days) — into
``queue/archived/`` and records a ``## Result`` marker line carrying the ISO archive
timestamp::

    Auto-archived by the stranded-archiver (2026-07-21T00:00:00.000Z):
    auto-archived: stranded — card idle 200h AND owner codex-worker idle 200h, both past the 168h window (reversible: move to inbox to reopen)

NOTE: the archiver currently ships DRY-RUN-ONLY and DEFAULT-OFF (it reports what it would
archive and moves nothing), so ``queue/archived/`` stays empty and this report prints 0
until a human enables live archiving. The report is forward-compatible: it keys only on the
``Auto-archived by the stranded-archiver (<ISO>)`` marker prefix, unchanged across v1/v2.

``report(repo_root, since, until)`` scans ``queue/archived/`` and returns the cards whose
archive timestamp falls in the ``[since, until]`` window (both optional; default window is
the trailing 7 days ending now). ``render(items, ...)`` formats the one-line-per-card block
the weekly-audit cadence pastes in, headed ``N cards auto-archived as stranded this period``.

This has NO code seam into the weekly-audit cadence (it is a PROMPT executed by an agent),
so the intended usage is: the weekly-audit agent runs ``py -3 scripts/stranded_report.py``
and pastes the output. A one-line prompt addition is proposed in
docs/proposals/2026-07-21-weekly-audit-stranded-report.md (HEARTBEAT.md is not edited here).

CLI: ``py -3 scripts/stranded_report.py [--days N | --since ISO --until ISO] [--repo PATH]``.
"""
from __future__ import annotations

import argparse
import datetime
import re
from dataclasses import dataclass
from pathlib import Path

import cards

# Byte-identical to strandedArchiver.ts ARCHIVE_MARKER. The `(...)` captures the ISO
# timestamp the archiver stamps; matched ONLY inside the ## Result section so inert
# ## Evidence text can never spoof an archive record.
ARCHIVE_MARKER = "Auto-archived by the stranded-archiver"
_MARKER_RE = re.compile(
    re.escape(ARCHIVE_MARKER) + r"\s*\(([^)]+)\)"
)
ARCHIVED_DIR = "archived"
_DEFAULT_WINDOW_DAYS = 7


@dataclass
class ArchivedCard:
    id: str
    owner: str
    action: str
    target: str
    archived_at: datetime.datetime | None  # None => marker missing/unparseable


def _section_text(body: str, section: str) -> str:
    """Text of one ``## <section>`` block (up to the next ``## `` header / EOF), or ""
    — the same stripped-header / startswith-``## `` rule the other surfaces use, so a
    marker is only ever read inside its own named section."""
    lines = str(body or "").split("\n")
    header = f"## {section}"
    start = next((i for i, ln in enumerate(lines) if ln.strip() == header), -1)
    if start == -1:
        return ""
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    return "\n".join(lines[start + 1:end])


def _parse_iso(raw: str) -> datetime.datetime | None:
    """Parse the archiver's ISO timestamp into an aware UTC datetime, or None. Accepts a
    trailing ``Z`` (which ``datetime.fromisoformat`` rejects before 3.11)."""
    s = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def _archived_at(card: cards.Card) -> datetime.datetime | None:
    match = _MARKER_RE.search(_section_text(str(card.body or ""), "Result"))
    return _parse_iso(match.group(1)) if match else None


def _iter_archived(repo_root) -> list[ArchivedCard]:
    d = Path(repo_root) / "queue" / ARCHIVED_DIR
    out: list[ArchivedCard] = []
    if not d.exists():
        return out
    for path in sorted(d.glob("*.md")):
        try:
            card = cards.parse(path)
        except Exception:  # noqa: BLE001 — a malformed archived card never crashes the report
            continue
        m = card.meta
        out.append(ArchivedCard(
            id=str(m.get("id") or path.stem),
            owner=str(m.get("owner") or ""),
            action=str(m.get("action") or ""),
            target=str(m.get("target") or ""),
            archived_at=_archived_at(card),
        ))
    return out


def report(
    repo_root,
    since: datetime.datetime | None = None,
    until: datetime.datetime | None = None,
) -> list[ArchivedCard]:
    """Archived cards whose archive timestamp is within ``[since, until]``. A card whose
    marker timestamp is missing/unparseable is INCLUDED only when no window is given (so a
    windowed audit never silently swallows an un-timestamped record — it just cannot place
    it in a period). Sorted oldest-first by archive time (undated last)."""
    items = _iter_archived(repo_root)
    if since is not None or until is not None:
        def in_window(c: ArchivedCard) -> bool:
            if c.archived_at is None:
                return False
            if since is not None and c.archived_at < since:
                return False
            if until is not None and c.archived_at > until:
                return False
            return True
        items = [c for c in items if in_window(c)]
    items.sort(key=lambda c: (c.archived_at is None, c.archived_at or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)))
    return items


def render(items: list[ArchivedCard], period_label: str = "this period") -> str:
    """The weekly-audit block: a count headline + one line per archived card."""
    lines = [f"{len(items)} card(s) auto-archived as stranded {period_label}."]
    for c in items:
        when = c.archived_at.isoformat() if c.archived_at else "unknown time"
        owner = c.owner or "(no owner)"
        lines.append(f"- `{c.id}` — {c.action} -> {c.target} (owner {owner}, archived {when})")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Report cards auto-archived as stranded in a window.")
    ap.add_argument("--repo", default=".", help="repo root (default: cwd)")
    ap.add_argument("--days", type=int, default=_DEFAULT_WINDOW_DAYS,
                    help=f"trailing window in days ending now (default: {_DEFAULT_WINDOW_DAYS}); ignored if --since given")
    ap.add_argument("--since", default=None, help="window start ISO-8601 (overrides --days)")
    ap.add_argument("--until", default=None, help="window end ISO-8601 (default: now)")
    args = ap.parse_args(argv)

    now = datetime.datetime.now(datetime.timezone.utc)
    until = _parse_iso(args.until) if args.until else now
    if args.since:
        since = _parse_iso(args.since)
        label = f"since {args.since}"
    else:
        since = (until or now) - datetime.timedelta(days=args.days)
        label = f"in the last {args.days} day(s)"

    items = report(args.repo, since=since, until=until)
    print(render(items, period_label=label))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
