"""Chief-of-Staff morning brief — pure, deterministic, LLM-free renderer (Wave A).

``render_brief(repo_root, date) -> str`` produces the morning-brief markdown:

* Overnight fleet activity from the ``ledgers/{dispatch,cost,activity,grades}``
  shards for the *trailing day* (the calendar day before ``date`` — a brief for
  the morning of D summarizes the night of D-1).
* Pending ``queue/approvals`` + wake-me ``queue/inbox`` cards, ranked
  ``T3 > T2 > T1`` then oldest-first.
* Deferral flags read from each pending card's ``deferred_count`` frontmatter.
* One "#1 win" = the single highest-ranked actionable pending item, with a
  one-line why.
* Calendar / inbox sections render as graceful "unavailable — Google gates
  pending" placeholders until the WS2 Google gates (G1/G2) clear.

``write_brief(repo_root, date)`` writes ``dashboards/brief-YYYY-MM-DD.md``
idempotently: identical content is never rewritten.

CLI: ``py -3 scripts/brief.py [--date YYYY-MM-DD] [--dry-run]``. The CLI runs the
shared preamble FIRST (STOP-file supremacy); on failure it prints the failure and
exits 1. The pure render/write functions never run the preamble — only the CLI
entry point does, so the renderer stays a small, hermetic, testable primitive.
"""
from __future__ import annotations

import argparse
import datetime
import re
import time
from pathlib import Path

import cards
import ledger
import preamble

# Ledger streams summarized as "overnight" activity.
OVERNIGHT_KINDS = ("dispatch", "cost", "activity", "grades")

# The FOUR physical queue directories cards.py actually writes to (cards.STATE_DIR
# values). `blocked` lives under inbox/, and all three stop-ladder states (incl.
# terminal `halted`) under working/ — there is NO queue/blocked or queue/halted
# directory, so scanning a state-named dir is the N1 trap. Scan these physical
# dirs and filter by PARSED state instead.
_PHYSICAL_QUEUE_DIRS = ("inbox", "working", "approvals", "done")

# --- inbox-gate classification, mirrored EXACTLY from dashboard humanInbox.ts --- #
# These predicates and the stranded threshold must stay byte-for-byte equivalent to
# the dashboard `classify`; the shared fixture tests/fixtures/inbox-gates-parity.json
# (consumed by BOTH pytest and vitest) turns any drift into a red test.
_HUMAN_INPUT_ACTION = re.compile(
    r"(?:^|[:/_-])(?:needs?-?input|human-?input|input-?required|question|"
    r"human-?review|review-?required)(?:$|[:/_-])",
    re.I,
)
_WAKE_ACTION = re.compile(r"^wake-me(?::|$)", re.I)
# A card is STRANDED once it is owned by a real agent yet has made no progress for
# this long — the same 24h threshold and hex-epoch age source as humanInbox.ts.
STRANDED_AGE_MS = 24 * 60 * 60 * 1000
_CARD_ID_EPOCH_RE = re.compile(r"^([0-9a-f]{8})-")

# The exact marker prefix write/cardRespond.ts writes into a halted card's
# ## Result section when an operator resolves it inline (no state transition). It
# must be matched ONLY inside ## Result — never elsewhere in the body — or inert
# ## Evidence text could spoof a resolution. Byte-identical to humanInbox.ts
# RESOLVE_RECORDED so both surfaces hide a resolved halted card in lockstep.
_RESOLVE_RECORDED = "Resolved by operator ("

# One canonical category (dashboard vocabulary) -> the brief's presentation "kind"
# label. The category IS the shared truth; "kind" is only how the brief renders it.
_CATEGORY_KIND = {
    "decision": "approval",
    "gate": "human-gate",
    "input": "input",
    "intervention": "intervention",
    "stranded": "stranded",
}

_TIER_RANK = {"T3": 3, "T2": 2, "T1": 1}
# Placeholder text for the still-gated Google surfaces (brainstorm-doc
# graceful-degradation requirement). Rendered every day so the brief's shape is
# stable whether or not the gates are cleared.
_CALENDAR_PLACEHOLDER = "unavailable — Google calendar gate (G1) pending."
_INBOX_PLACEHOLDER = "unavailable — Google inbox gate (G2) pending."


# --------------------------------------------------------------------------- #
# small pure helpers                                                          #
# --------------------------------------------------------------------------- #

def _overnight_day(date: str) -> str:
    """The trailing calendar day (``date`` minus one day), ISO formatted."""
    d = datetime.date.fromisoformat(date)
    return (d - datetime.timedelta(days=1)).isoformat()


def _passed(value) -> bool:
    """Fail-closed truthiness matching promotion._passed / grade semantics."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes", "pass", "passed")


def _to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _deferred_count(card: cards.Card) -> int:
    raw = card.meta.get("deferred_count")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


def _card_age(card: cards.Card) -> int:
    """A deterministic age key: the unix-seconds prefix baked into the card id
    (``cards.new_id`` = ``f"{int(time.time()):08x}-..."``). Older cards have a
    smaller value and rank first. Falls back to the file mtime, then 0, so a
    hand-authored or legacy id never raises."""
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
    """Sort ascending: highest tier first (``-rank``), then oldest first."""
    return (-_TIER_RANK.get(card.meta.get("risk-tier"), 0), _card_age(card))


def _iter_cards(repo_root, state: str):
    """Yield parsed cards from ``queue/<state>/``; silently skip anything that
    does not parse (a malformed file must never crash the brief). Only valid for
    the PHYSICAL dirs (inbox/working/approvals/done) — never a state-named dir."""
    d = Path(repo_root) / "queue" / state
    if not d.exists():
        return
    for path in sorted(d.glob("*.md")):
        try:
            yield cards.parse(path)
        except Exception:  # noqa: BLE001 — a bad card is skipped, never fatal
            continue


def _iter_all_cards(repo_root):
    """Yield every parsed card across the FOUR physical queue dirs. Callers filter
    on the PARSED ``state`` field — never on the directory name — so a `halted`
    card (physically under working/) is found without ever globbing a nonexistent
    ``queue/halted/`` (the N1 lesson, Python side)."""
    for d in _PHYSICAL_QUEUE_DIRS:
        yield from _iter_cards(repo_root, d)


def _is_wake_me(card: cards.Card) -> bool:
    return bool(_WAKE_ACTION.match(str(card.meta.get("action") or "")))


def _is_human_gate(card: cards.Card) -> bool:
    """An inbox card only a human can move: owned by the human operator (the
    OAuth/governance gate pattern) or an explicit ``approve:*`` action. Kept
    byte-identical to the dashboard ``isHumanGate`` two-limb test."""
    return (str(card.meta.get("owner") or "") == "human-operator"
            or str(card.meta.get("action") or "").startswith("approve:"))


def _card_age_ms(card: cards.Card, now_ms: int):
    """Age of a card in ms derived PURELY from its id's 8-hex unix-epoch-seconds
    prefix (``cards.new_id``), or ``None`` when the id does not carry one — the
    exact mirror of humanInbox.ts ``cardAgeMs``. A non-8-hex id yields an UNKNOWN
    age and is therefore NEVER classified stranded (Decision 1)."""
    m = _CARD_ID_EPOCH_RE.match(str(card.meta.get("id") or ""))
    if not m:
        return None
    return now_ms - int(m.group(1), 16) * 1000


def _dependencies(card: cards.Card) -> list:
    value = card.meta.get("depends-on")
    return value if isinstance(value, list) else []


def _section_text(body: str, section: str) -> str:
    """Return the text of one ``## <section>`` block (up to the next ``## `` header
    or EOF), or ``""`` if absent. Byte-for-byte mirror of humanInbox.ts
    ``sectionText`` — the header line is matched STRIPPED (``line.strip() ==
    header``) and the block ends at the next line that STARTSWITH ``## ``, so a
    marker is only ever counted inside its own named section and inert
    ## Evidence text cannot spoof it."""
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


def classify_category(card: cards.Card, stop_present: bool = False, now: int | None = None):
    """Return the canonical inbox category for one card — the dashboard vocabulary
    ``decision | gate | input | intervention | stranded`` or ``None`` — mirroring
    dashboard ``classify`` limb-for-limb and in the same order.

    ``now`` is unix epoch MILLISECONDS, used only for the stranded age gate; when it
    is ``None`` the stranded limb is SKIPPED (so ``render_brief`` stays clock-free and
    deterministic — stranded is advisory and surfaced live by the dashboard, not the
    brief). ``stop_present`` is accepted for parity with the dashboard projection
    entry point; the STOP freeze item is SYNTHETIC (never a card) so it does not
    affect any real card's category here."""
    del stop_present  # STOP is synthetic, not a card — see docstring.
    state = str(card.meta.get("state") or "").lower()
    action = str(card.meta.get("action") or "")
    owner = str(card.meta.get("owner") or "")

    if state == "approvals":
        return "decision"
    if state == "inbox" and _HUMAN_INPUT_ACTION.search(action):
        return "input"
    if state == "inbox" and _WAKE_ACTION.match(action):
        return "intervention"
    if state == "inbox" and _is_human_gate(card):
        return "gate"
    if state == "halted":
        # An operator who resolved this terminal card inline recorded the marker in
        # ## Result (cardRespond, no transition). humanInbox.ts then HIDES it; the
        # brief must too, or it would re-list a resolved halted card forever.
        if _RESOLVE_RECORDED in _section_text(str(card.body or ""), "Result"):
            return None
        return "intervention"
    if state in ("stop-requested", "halting"):
        return "intervention"

    explicitly_human = (
        bool(_WAKE_ACTION.match(action))
        or bool(_HUMAN_INPUT_ACTION.search(action))
        or _is_human_gate(card)
    )
    unowned_root_block = (
        state == "blocked" and card.meta.get("owner") is None and not _dependencies(card)
    )
    if state == "blocked" and (explicitly_human or unowned_root_block):
        return "intervention"

    # Stranded — only when a clock is supplied (see docstring). Excludes operator
    # gates (already surfaced) and unowned cards; a non-8-hex id => unknown age =>
    # never stranded.
    if now is not None and state in ("inbox", "working") and owner not in ("", "human-operator"):
        age = _card_age_ms(card, now)
        if age is not None and age > STRANDED_AGE_MS:
            return "stranded"

    return None


# --------------------------------------------------------------------------- #
# section builders                                                            #
# --------------------------------------------------------------------------- #

def _actionable_pending(repo_root) -> list[tuple[str, cards.Card]]:
    """Ranked list of ``(kind, card)`` a human must act on, derived through the
    SAME ``classify_category`` the dashboard uses so the two surfaces agree: every
    approval (decision), every operator gate, every input/wake/halted/stop-ladder
    card, and every unowned root-blocked card. Scans the physical dirs and filters
    by parsed state (so `halted`/`blocked` are surfaced without the N1 dir trap).

    Stranded (advisory) is intentionally OMITTED: `classify_category` is called with
    ``now=None`` so the brief stays clock-free, and the dashboard surfaces stranded
    live. The rendered ``kind`` is a display mapping off the canonical category."""
    items: list[tuple[str, cards.Card]] = []
    for card in _iter_all_cards(repo_root):
        category = classify_category(card)  # now=None -> stranded skipped, deterministic
        if category is None:
            continue
        items.append((_CATEGORY_KIND[category], card))
    items.sort(key=lambda kc: _rank_key(kc[1]))
    return items


def _overnight_section(repo_root, overnight_day: str) -> list[str]:
    lines: list[str] = []

    dispatch = ledger.read_day(repo_root, "dispatch", overnight_day)
    grades = ledger.read_day(repo_root, "grades", overnight_day)
    activity = ledger.read_day(repo_root, "activity", overnight_day)
    cost = ledger.read_day(repo_root, "cost", overnight_day)

    if not (dispatch or grades or activity or cost):
        return [f"No overnight activity recorded for {overnight_day}."]

    if dispatch:
        by_cadence: dict[str, int] = {}
        for row in dispatch:
            by_cadence[row.get("cadence") or "?"] = by_cadence.get(row.get("cadence") or "?", 0) + 1
        detail = ", ".join(f"{name} x{n}" for name, n in sorted(by_cadence.items()))
        lines.append(f"- Dispatched: {len(dispatch)} card(s) ({detail}).")

    if grades:
        passes = sum(1 for r in grades if _passed(r.get("pass")))
        fails = len(grades) - passes
        scores = [_to_float(r.get("score")) for r in grades]
        avg = sum(scores) / len(scores) if scores else 0.0
        lines.append(f"- Grades: {len(grades)} ({passes} pass / {fails} fail, avg {avg:.1f}).")

    if activity:
        by_kind: dict[str, int] = {}
        for row in activity:
            by_kind[row.get("kind") or "?"] = by_kind.get(row.get("kind") or "?", 0) + 1
        detail = ", ".join(f"{name} x{n}" for name, n in sorted(by_kind.items()))
        lines.append(f"- Activity: {len(activity)} row(s) ({detail}).")

    total = round(sum(_to_float(r.get("usd")) for r in cost), 6)
    lines.append(f"- Cost: ${total:.2f} over {len(cost)} logged step(s).")
    return lines


def _pending_section(pending: list[tuple[str, cards.Card]]) -> list[str]:
    if not pending:
        return ["Nothing pending — `queue/approvals/` and the wake-me inbox are clear."]
    lines: list[str] = []
    for i, (kind, card) in enumerate(pending, start=1):
        m = card.meta
        lines.append(
            f"{i}. [{m.get('risk-tier')}] {kind} — {m.get('action')} -> "
            f"{m.get('target')} (card `{m.get('id')}`)"
        )
    return lines


def _deferrals_section(repo_root) -> list[str]:
    """Deferral flags across pending streams (inbox + approvals + working).
    3+ deferrals are flagged prominently."""
    flagged: list[tuple[cards.Card, int]] = []
    for state in ("approvals", "inbox", "working"):
        for card in _iter_cards(repo_root, state):
            n = _deferred_count(card)
            if n > 0:
                flagged.append((card, n))
    if not flagged:
        return ["No deferred cards."]
    flagged.sort(key=lambda cn: (-cn[1], _card_age(cn[0])))
    lines = []
    for card, n in flagged:
        mark = "  **[3+ DEFERRALS — needs a decision]**" if n >= 3 else ""
        lines.append(f"- `{card.meta.get('id')}`: {n} deferral(s){mark}")
    return lines


def _win_line(pending: list[tuple[str, cards.Card]]) -> str:
    if not pending:
        return "No actionable item pending — inbox and approvals are clear."
    kind, card = pending[0]
    m = card.meta
    if kind == "approval":
        why = "awaiting a human approval token"
    elif kind == "human-gate":
        why = "a one-time human gate — the card carries the exact steps"
    else:
        why = "flagged for human attention"
    return (
        f"{m.get('action')} -> {m.get('target')} (card `{m.get('id')}`, "
        f"{m.get('risk-tier')} {kind}) — highest-ranked pending item; {why}."
    )


# --------------------------------------------------------------------------- #
# public API                                                                  #
# --------------------------------------------------------------------------- #

def render_brief(repo_root, date: str) -> str:
    """Render the morning-brief markdown for ``date`` (``YYYY-MM-DD``). Pure and
    deterministic: no clock reads, no network, no LLM, no preamble."""
    repo_root = Path(repo_root)
    overnight_day = _overnight_day(date)
    pending = _actionable_pending(repo_root)

    out: list[str] = []
    out.append(f"# Morning brief — {date}")
    out.append("")
    out.append(f"_Chief of Staff · deterministic render (no LLM) · overnight = {overnight_day}_")
    out.append("")
    out.append("## #1 win")
    out.append(_win_line(pending))
    out.append("")
    out.append(f"## Overnight ({overnight_day})")
    out.extend(_overnight_section(repo_root, overnight_day))
    out.append("")
    out.append("## Pending (ranked T3 > T2 > T1, then oldest first)")
    out.extend(_pending_section(pending))
    out.append("")
    out.append("## Deferrals")
    out.extend(_deferrals_section(repo_root))
    out.append("")
    out.append("## Calendar")
    out.append(_CALENDAR_PLACEHOLDER)
    out.append("")
    out.append("## Inbox")
    out.append(_INBOX_PLACEHOLDER)
    out.append("")
    return "\n".join(out)


def brief_path(repo_root, date: str) -> Path:
    return Path(repo_root) / "dashboards" / f"brief-{date}.md"


def write_brief(repo_root, date: str) -> Path:
    """Write ``dashboards/brief-YYYY-MM-DD.md`` idempotently — identical content
    is never rewritten (so a re-run leaves the file's mtime untouched)."""
    content = render_brief(repo_root, date)
    path = brief_path(repo_root, date)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def _run_preamble(repo_root) -> list[str]:
    """STOP-file supremacy: the exact shared preamble check every actor runs."""
    return preamble.check(repo_root, cost_today_fn=ledger.cost_today)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Render the Chief-of-Staff morning brief.")
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="brief date YYYY-MM-DD (default: today)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the rendered brief instead of writing the file")
    args = ap.parse_args(argv)

    repo_root = Path.cwd()
    problems = _run_preamble(repo_root)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems))
        return 1

    if args.dry_run:
        print(render_brief(repo_root, args.date))
        return 0

    path = write_brief(repo_root, args.date)
    print(str(path))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
