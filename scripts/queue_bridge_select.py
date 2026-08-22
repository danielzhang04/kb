"""Queue -> dashboard-engine bridge selector and bounded wake helper.

A card belongs to the governed dashboard executor **iff** all three hold:

  * ``execution-controller`` is exactly the literal ``"dashboard"`` (an absent/null
    controller does NOT belong here),
  * ``state`` is ``inbox`` or ``working``.

This is the complement, on the ``execution-controller`` axis, of the legacy runner's
filter in ``scripts/agent_runner.ps1`` (step 6), which claims a card iff
``execution-controller != "dashboard" and owner == agent and state in (inbox, working)``.
The two predicates PARTITION the controller/state-matched card space with no overlap and no
gap: ``!= "dashboard"`` -> legacy runner, ``== "dashboard"`` -> this bridge. That single
frontmatter flag is the double-execution guard; keeping this selector's controller test
an EXACT string equality (never a truthiness or "not legacy" test) is what preserves it.

Parse semantics are identical to the legacy runner's: both enumerate ``queue/inbox`` and
``queue/working``, parse each ``*.md`` with ``cards.parse`` (skipping unparseable files),
and filter on the parsed ``meta`` -- so a ``blocked`` card physically sitting in the
``inbox/`` directory is excluded on both sides (its ``state`` meta is ``blocked``).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "scripts")
import cards  # noqa: E402  (path insert must precede the fleet import, mirroring agent_runner.ps1)
import agent_runner  # noqa: E402

DASHBOARD_CONTROLLER = "dashboard"
CLAIMABLE_STATES = ("inbox", "working")


def claims_card(meta: dict) -> bool:
    """True iff the dashboard controller owns this claimable card."""
    return (
        meta.get("execution-controller") == DASHBOARD_CONTROLLER
        and meta.get("state") in CLAIMABLE_STATES
    )


def select_owned_dashboard_cards(queue_root: Path) -> list[dict]:
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
            if claims_card(card.meta):
                owned.append({
                    "id": card.meta["id"],
                    "path": str(path),
                    "state": card.meta["state"],
                })
    return owned


def main(argv: list[str]) -> int:
    op = json.loads(argv[1]) if len(argv) > 1 else {}
    if op.get("operation", "select") == "wake":
        repo_root = op.get("repoRoot")
        reason = op.get("reason")
        detail = op.get("detail")
        if not all(isinstance(value, str) and value for value in (repo_root, reason, detail)):
            raise ValueError("queue bridge wake requires repoRoot, reason, and detail")
        card_id = agent_runner.wake_me(Path(repo_root).resolve(), reason, detail)
        print(json.dumps({"cardId": card_id}))
        return 0
    queue_root = Path(op.get("queueRoot", "queue"))
    print(json.dumps(select_owned_dashboard_cards(queue_root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
