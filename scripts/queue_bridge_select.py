"""Queue -> dashboard-engine bridge selector and bounded wake helper.

A card belongs to the governed dashboard executor **iff** all three hold:

  * ``execution-controller`` is exactly the literal ``"dashboard"`` (an absent/null
    controller does NOT belong here),
  * ``state`` is ``inbox`` or ``working``,
  * ``workflow`` is unset/null -- a card carrying a workflow run ref is an
    ENGINE-OWNED stage card, minted and driven by the workflow engine's own hops
    (managed-root activation -> attempt -> canonical result integration). The
    bridge is the trigger-card front door, not a second launch path into a run
    that is already executing; see ``bridgeClaimsCard`` in
    ``dashboard/server/control/queueBridge.ts`` for the TS mirror.

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
        # An engine-owned stage card (``workflow: <runId>``) is driven by the
        # workflow engine's canonical hops. Claiming it here is a second launch
        # path into a live run and, when its stage owner is not a declared agent,
        # a wake-me storm at every poll tick.
        and not meta.get("workflow")
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


def _wake_card_ids(repo: Path) -> set[str]:
    """The ids of every card already filed under ``queue/``, read before a wake attempt.

    ``agent_runner.wake_me`` deduplicates and returns an EXISTING card's id without
    writing anything; comparing against this set is how the caller tells a fresh file
    from a dedupe hit without changing that shared helper.
    """
    seen: set[str] = set()
    for path in (repo / "queue").glob("*/*.md"):
        try:
            seen.add(str(cards.parse(path).meta.get("id")))
        except Exception:
            continue
    return seen


def _wake_card_path(repo: Path, card_id: str | None) -> str | None:
    """Repo-relative POSIX path of the wake card ``card_id``, or None when absent."""
    if not card_id:
        return None
    for path in (repo / "queue").glob("*/*.md"):
        try:
            if str(cards.parse(path).meta.get("id")) == card_id:
                return path.relative_to(repo).as_posix()
        except Exception:
            continue
    return None


def main(argv: list[str]) -> int:
    op = json.loads(argv[1]) if len(argv) > 1 else {}
    if op.get("operation", "select") == "wake":
        repo_root = op.get("repoRoot")
        reason = op.get("reason")
        detail = op.get("detail")
        if not all(isinstance(value, str) and value for value in (repo_root, reason, detail)):
            raise ValueError("queue bridge wake requires repoRoot, reason, and detail")
        repo = Path(repo_root).resolve()
        before = _wake_card_ids(repo)
        card_id = agent_runner.wake_me(repo, reason, detail)
        path = _wake_card_path(repo, card_id)
        print(json.dumps({
            "cardId": card_id,
            "path": path,
            # ``created`` is the ONLY signal the caller has that a NEW file now sits in the
            # working tree and must be committed + spooled before the checkout is dirty.
            # A dedupe hit (``wake_me`` returned an existing id) creates nothing, and neither
            # does a best-effort wake that failed inside the helper (no id, no path).
            "created": bool(path) and card_id not in before,
        }))
        return 0
    queue_root = Path(op.get("queueRoot", "queue"))
    print(json.dumps(select_owned_dashboard_cards(queue_root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
