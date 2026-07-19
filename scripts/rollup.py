"""Chief-of-Staff end-of-day rollup — propose-only renderer (Wave A).

``render_rollup(repo_root, date) -> str`` produces the EOD rollup markdown:

* Today's completions: ``queue/done`` cards whose file mtime falls on ``date``,
  cross-referenced with the day's ``dispatch``/``grades`` ledger rows.
* Unfinished ``queue/working`` + ``queue/inbox`` cards, each listed with its
  ``deferred_count`` frontmatter counter; 3+ deferrals are flagged prominently.
* A PROPOSALS section — "re-queue X", "archive Y" — that a human or the
  dispatcher acts on. The rollup is PROPOSE-ONLY: it NEVER mutates a card, never
  re-queues on its own authority.

``write_rollup(repo_root, date)`` writes ``dashboards/rollup-YYYY-MM-DD.md``
idempotently (identical content is never rewritten). Same CLI + preamble
discipline as ``brief.py``.

``increment_deferral(card_path)`` is a pure card-frontmatter edit (via
``cards.parse``/``cards.save``) that bumps a card's ``deferred_count`` in place
and returns the new count. It is used LATER by the dispatcher when it re-queues a
card — the rollup itself never calls it (propose-only).
"""
from __future__ import annotations

import argparse
import datetime
from pathlib import Path

import cards
import ledger
import preamble

_TIER_RANK = {"T3": 3, "T2": 2, "T1": 1}


# --------------------------------------------------------------------------- #
# small pure helpers (shared shape with brief.py, kept local to avoid coupling)#
# --------------------------------------------------------------------------- #

def _deferred_count(card: cards.Card) -> int:
    raw = card.meta.get("deferred_count")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


def _card_age(card: cards.Card) -> int:
    cid = str(card.meta.get("id") or "")
    head = cid.split("-", 1)[0]
    try:
        return int(head, 16)
    except ValueError:
        pass
    if card.path is not None:
        try:
            return int(Path(card.path).stat().st_mtime)
        except OSError:
            return 0
    return 0


def _rank_key(card: cards.Card) -> tuple[int, int]:
    return (-_TIER_RANK.get(card.meta.get("risk-tier"), 0), _card_age(card))


def _iter_cards(repo_root, state: str):
    d = Path(repo_root) / "queue" / state
    if not d.exists():
        return
    for path in sorted(d.glob("*.md")):
        try:
            yield cards.parse(path)
        except Exception:  # noqa: BLE001 — a bad card is skipped, never fatal
            continue


def _mtime_day(path: Path) -> str | None:
    try:
        ts = path.stat().st_mtime
    except OSError:
        return None
    return datetime.date.fromtimestamp(ts).isoformat()


# --------------------------------------------------------------------------- #
# section builders                                                            #
# --------------------------------------------------------------------------- #

def _completed_today(repo_root, date: str) -> list[cards.Card]:
    """``queue/done`` cards whose file mtime lands on ``date``."""
    out: list[cards.Card] = []
    for card in _iter_cards(repo_root, "done"):
        if card.path is not None and _mtime_day(Path(card.path)) == date:
            out.append(card)
    out.sort(key=_rank_key)
    return out


def _unfinished(repo_root) -> list[cards.Card]:
    """In-flight cards: everything in ``queue/working`` + ``queue/inbox``."""
    out: list[cards.Card] = []
    for state in ("working", "inbox"):
        out.extend(_iter_cards(repo_root, state))
    out.sort(key=lambda c: (-_deferred_count(c), *_rank_key(c)))
    return out


def _completed_section(completed: list[cards.Card], grades: list[dict]) -> list[str]:
    if not completed:
        return ["No cards completed today."]
    graded_ids = {r.get("card_id") for r in grades}
    lines = []
    for card in completed:
        m = card.meta
        graded = " [graded]" if m.get("id") in graded_ids else ""
        lines.append(
            f"- `{m.get('id')}`: {m.get('action')} -> {m.get('target')} "
            f"({m.get('risk-tier')}){graded}"
        )
    return lines


def _unfinished_section(unfinished: list[cards.Card]) -> list[str]:
    if not unfinished:
        return ["Nothing in flight — `queue/working/` and `queue/inbox/` are clear."]
    lines = []
    for card in unfinished:
        m = card.meta
        n = _deferred_count(card)
        mark = "  **[3+ DEFERRALS]**" if n >= 3 else ""
        lines.append(
            f"- [{m.get('state')}] `{m.get('id')}`: {m.get('action')} -> "
            f"{m.get('target')} ({m.get('risk-tier')}) — {n} deferral(s){mark}"
        )
    return lines


def _stuck(unfinished: list[cards.Card]) -> list[cards.Card]:
    return [c for c in unfinished if _deferred_count(c) >= 3]


def _proposals_section(completed: list[cards.Card], stuck: list[cards.Card]) -> list[str]:
    proposals: list[str] = []
    for card in stuck:
        n = _deferred_count(card)
        proposals.append(
            f"- re-queue or escalate `{card.meta.get('id')}` "
            f"({n} deferrals — decide: re-queue, block, or drop)"
        )
    for card in completed:
        proposals.append(f"- archive completed card `{card.meta.get('id')}`")
    if not proposals:
        return ["No proposals — nothing stuck and nothing to archive."]
    return proposals


# --------------------------------------------------------------------------- #
# public API                                                                  #
# --------------------------------------------------------------------------- #

def render_rollup(repo_root, date: str) -> str:
    """Render the EOD rollup markdown for ``date`` (``YYYY-MM-DD``). Pure,
    deterministic, propose-only — never mutates a card."""
    repo_root = Path(repo_root)
    completed = _completed_today(repo_root, date)
    unfinished = _unfinished(repo_root)
    stuck = _stuck(unfinished)
    grades = ledger.read_day(repo_root, "grades", date)

    out: list[str] = []
    out.append(f"# EOD rollup — {date}")
    out.append("")
    out.append("_Chief of Staff · deterministic render (no LLM) · propose-only (never mutates cards)_")
    out.append("")
    out.append(f"## Completed today ({date})")
    out.extend(_completed_section(completed, grades))
    out.append("")
    out.append("## Unfinished (working + inbox)")
    out.extend(_unfinished_section(unfinished))
    out.append("")
    out.append("## 3+ deferrals (needs a decision)")
    if stuck:
        for card in stuck:
            m = card.meta
            out.append(
                f"- `{m.get('id')}`: {_deferred_count(card)} deferrals — "
                f"{m.get('action')} -> {m.get('target')}"
            )
    else:
        out.append("None.")
    out.append("")
    out.append("## Proposals (for a human or the dispatcher — this rollup does not act)")
    out.extend(_proposals_section(completed, stuck))
    out.append("")
    return "\n".join(out)


def rollup_path(repo_root, date: str) -> Path:
    return Path(repo_root) / "dashboards" / f"rollup-{date}.md"


def write_rollup(repo_root, date: str) -> Path:
    """Write ``dashboards/rollup-YYYY-MM-DD.md`` idempotently."""
    content = render_rollup(repo_root, date)
    path = rollup_path(repo_root, date)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def increment_deferral(card_path) -> int:
    """Bump a card's ``deferred_count`` by one, in place, and return the new
    count. Pure frontmatter edit through ``cards.parse``/``cards.save`` — the
    card's state (hence its on-disk location) is unchanged, so it is rewritten to
    exactly the same path. NOT called by the rollup (which is propose-only); this
    is the helper the dispatcher uses when it actually re-queues a card."""
    card_path = Path(card_path)
    card = cards.parse(card_path)
    card.meta["deferred_count"] = _deferred_count(card) + 1
    # The card lives at <queue>/<state-dir>/<id>.md; queue_root is two parents
    # up, and cards.save recomputes the same <state-dir>/<id>.md path.
    cards.save(card, card_path.parents[1])
    return card.meta["deferred_count"]


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def _run_preamble(repo_root) -> list[str]:
    return preamble.check(repo_root, cost_today_fn=ledger.cost_today)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Render the Chief-of-Staff EOD rollup.")
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="rollup date YYYY-MM-DD (default: today)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the rendered rollup instead of writing the file")
    args = ap.parse_args(argv)

    repo_root = Path.cwd()
    problems = _run_preamble(repo_root)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems))
        return 1

    if args.dry_run:
        print(render_rollup(repo_root, args.date))
        return 0

    path = write_rollup(repo_root, args.date)
    print(str(path))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
