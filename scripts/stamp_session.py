"""stamp_session.py -- CLI shim: the Plane-A (cards) <-> Plane-B (session
transcript) join key (plan Task D1.2).

Usage:
    py -3 scripts/stamp_session.py <card_path> <session_id>

Why this exists: the dispatcher can never know a worker's Claude Code /
Codex session id (that session is spawned later, by the runner). The only
place the real value is known is the WORKER RUNNER itself, right after it
starts executing a claimed card -- so scripts/agent_runner.py's
``execute_card()`` shells out to
this tiny shim, after the card is selected and BEFORE it transitions to
`working`, rather than embedding Python logic inline in PowerShell.

Concurrency note: scripts/cards.py is gaining `cards.stamp_session(card,
session_id)` at the same time this file is being written (another agent,
same moment; mirrors `claim()` -- a two-line setter that mutates
`card.meta` but does not itself save). To stay correct regardless of
landing order, this shim calls `cards.stamp_session` when present and falls
back to setting `card.meta["session-id"]` directly when it is not -- the
two are semantically identical. Either way, this shim itself calls
`cards.save` so the on-disk card is actually updated; `cards.parse` /
`cards.save` are the only two card primitives guaranteed to exist already.

Validation:
  - <card_path> must exist and must parse as a valid card (cards.parse).
  - <session_id> must be a non-empty, printable token with no whitespace or
    control characters -- it lands verbatim in YAML frontmatter, and a
    stray newline/space/control char there could corrupt the card or open
    a frontmatter-injection path.
  - Any failure prints a clear message to stderr and exits non-zero.

Idempotent: re-stamping a card with a new session_id overwrites ONLY the
`session-id` field. `cards.parse` / `cards.save` round-trip every other
meta field and the body byte-for-byte, so nothing else in the card
changes.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards  # noqa: E402


def _is_valid_session_id(session_id: str) -> bool:
    """Reject empty tokens and anything carrying whitespace/control chars."""
    if not session_id:
        return False
    for ch in session_id:
        if ch.isspace() or not ch.isprintable():
            return False
    return True


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} <card_path> <session_id>", file=sys.stderr)
        return 2

    card_path = Path(argv[1])
    session_id = argv[2]

    if not card_path.exists():
        print(f"stamp_session: card path does not exist: {card_path}", file=sys.stderr)
        return 1

    if not _is_valid_session_id(session_id):
        print(
            "stamp_session: session_id must be a non-empty printable token with "
            "no whitespace/control characters (it lands in YAML frontmatter): "
            f"{session_id!r}",
            file=sys.stderr,
        )
        return 1

    try:
        card = cards.parse(card_path)
    except Exception as exc:  # cards.ValidationError or a bad-file read
        print(f"stamp_session: failed to parse card {card_path}: {exc}", file=sys.stderr)
        return 1

    if hasattr(cards, "stamp_session"):
        cards.stamp_session(card, session_id)
    else:
        # Fallback: cards.stamp_session hasn't landed in scripts/cards.py yet.
        # Semantically identical -- stamp_session is documented as a two-line
        # setter mirroring claim() (sets meta, does not save).
        card.meta["session-id"] = session_id

    try:
        # card_path is queue/<state>/<id>.md -- queue_root is its grandparent,
        # exactly like cards.save's own STATE_DIR-relative layout expects.
        queue_root = card_path.resolve().parent.parent
        cards.save(card, queue_root)
    except Exception as exc:
        print(f"stamp_session: failed to save card {card_path}: {exc}", file=sys.stderr)
        return 1

    print(f"stamped session-id={session_id} on {card_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
