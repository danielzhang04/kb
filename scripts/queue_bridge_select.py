"""Queue -> dashboard-engine bridge selector: the exact inverse of agent_runner.py's owned_cards().

A card belongs to the governed dashboard executor **iff** all three hold:

  * ``execution-controller`` is exactly the literal ``"dashboard"`` (an absent/null
    controller does NOT belong here),
  * ``owner`` equals the dashboard executor subject, and
  * ``state`` is ``inbox`` or ``working``.

This is the complement, on the ``execution-controller`` axis, of the legacy-compatible
runner's filter in ``scripts/agent_runner.py`` (``owned_cards()``), which claims a card iff
``execution-controller != "dashboard" and owner == agent and state in (inbox, working)``.
The two predicates PARTITION the owner/state-matched card space with no overlap and no
gap: ``!= "dashboard"`` -> legacy runner, ``== "dashboard"`` -> this bridge. That single
frontmatter flag is the double-execution guard; keeping this selector's controller test
an EXACT string equality (never a truthiness or "not legacy" test) is what preserves it.

Parse semantics are identical to the legacy-compatible runner's: both enumerate ``queue/inbox`` and
``queue/working``, parse each ``*.md`` with ``cards.parse`` (skipping unparseable files),
and filter on the parsed ``meta`` -- so a ``blocked`` card physically sitting in the
``inbox/`` directory is excluded on both sides (its ``state`` meta is ``blocked``).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "scripts")
import cards  # noqa: E402  (path insert must precede the fleet import, mirroring agent_runner.py)

DASHBOARD_CONTROLLER = "dashboard"
CLAIMABLE_STATES = ("inbox", "working")


def claims_card(meta: dict, subject: str) -> bool:
    """True iff the dashboard-engine bridge (not the legacy runner) owns this card."""
    return (
        meta.get("execution-controller") == DASHBOARD_CONTROLLER
        and meta.get("owner") == subject
        and meta.get("state") in CLAIMABLE_STATES
    )


def select_owned_dashboard_cards(queue_root: Path, subject: str) -> list[dict]:
    """Return ``[{id, path, state}]`` for every dashboard-owned inbox/working card.

    Sorted by directory then filename for deterministic output, exactly like the
    legacy runner's ``sorted(d.glob("*.md"))`` scan.
    """
    owned: list[dict] = []
    if not queue_root.exists():
        return owned
    for state_dir in CLAIMABLE_STATES:
        d = queue_root / state_dir
        if not d.exists():
            continue
        for path in sorted(d.glob("*.md")):
            try:
                card = cards.parse(path)
            except Exception:
                # A single unparseable file never aborts the scan (legacy-runner parity).
                continue
            if claims_card(card.meta, subject):
                owned.append({
                    "id": card.meta["id"],
                    "path": str(path),
                    "state": card.meta["state"],
                })
    return owned


def main(argv: list[str]) -> int:
    op = json.loads(argv[1]) if len(argv) > 1 else {}
    subject = op.get("subject")
    if not isinstance(subject, str) or subject == "":
        raise ValueError("queue_bridge_select requires a non-empty 'subject'")
    queue_root = Path(op.get("queueRoot", "queue"))
    print(json.dumps(select_owned_dashboard_cards(queue_root, subject)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
