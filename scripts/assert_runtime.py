"""assert_runtime.py -- CLI shim: a runner's pre-execution runtime assertion
(Phase R1.4, ordering-law 3).

Usage:
    py -3 scripts/assert_runtime.py <card_path> <my_runtime>

Why this exists: routing stamps the RESOLVED runtime onto a card at claim time
(dispatch.stamp_routing). Owner selection already routes a card to exactly one
runner, but a mis-owned card (a routing/registry bug, or a hand-edited owner)
must never be silently run under the WRONG runtime. So each runner asserts
`card.runtime == its own runtime` BEFORE transitioning the card to `working` and
refuses (non-zero exit) on a mismatch -- the codex runner must not run a
Claude-routed card, and vice versa. Keeps Python out of the PowerShell runner
inline, mirroring scripts/stamp_session.py.

Semantics (fail loud on a real mismatch, backward-compatible on legacy cards):
  * card.runtime set AND == <my_runtime>  -> exit 0 (proceed).
  * card.runtime set AND != <my_runtime>  -> exit 1 (REFUSE; the runner wakes a
    human and skips the card rather than running it under the wrong runtime).
  * card.runtime absent/null (legacy card) -> exit 0 (no field, no assertion --
    exactly the `role`/`session-id` backward-compatibility posture).
  * bad args / unreadable / unparseable card -> exit 2 (a shim/usage error,
    distinct from a genuine runtime refusal).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} <card_path> <my_runtime>", file=sys.stderr)
        return 2

    card_path = Path(argv[1])
    my_runtime = argv[2]

    if not card_path.exists():
        print(f"assert_runtime: card path does not exist: {card_path}", file=sys.stderr)
        return 2

    try:
        card = cards.parse(card_path)
    except Exception as exc:  # cards.ValidationError or a bad-file read
        print(f"assert_runtime: failed to parse card {card_path}: {exc}", file=sys.stderr)
        return 2

    card_runtime = card.meta.get("runtime")
    if not card_runtime:
        # Legacy / unrouted card: no runtime field -> no assertion to make.
        print(f"assert_runtime: card {card.meta.get('id')} has no runtime -- legacy, allowed")
        return 0

    if card_runtime != my_runtime:
        print(
            f"assert_runtime: REFUSING card {card.meta.get('id')} -- routed runtime "
            f"{card_runtime!r} != this runner's runtime {my_runtime!r}. A mis-owned "
            "card must never run under the wrong runtime.",
            file=sys.stderr,
        )
        return 1

    print(f"assert_runtime: card {card.meta.get('id')} runtime {card_runtime!r} OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
