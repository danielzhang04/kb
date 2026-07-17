"""Task cards — the coordination unit. Schema: governance/card-schema.md (spec section 5)."""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

STATES = ("inbox", "blocked", "working", "done", "approvals", "approved", "rejected",
          # Steering-floor transient states (D1.3, dashboard plan): a files-only
          # cooperative stop ladder a WORKING card can be walked through --
          # stop-requested (asked to stop) -> halting (acknowledged, winding down)
          # -> halted (stopped; terminal). SIGKILL is the backstop if a worker
          # never polls for stop-requested. Purely additive: no existing state,
          # dir mapping, or transition is changed by this.
          "stop-requested", "halting", "halted")
RISK_TIERS = ("T1", "T2", "T3")
ROLES = ("scout", "manage", "work", "inspect", "consolidate")
REQUIRED = ("id", "project", "action", "target", "risk-tier", "state")
STATE_DIR = {
    "inbox": "inbox", "blocked": "inbox",
    "working": "working",
    "done": "done", "rejected": "done",
    "approvals": "approvals", "approved": "approvals",
    # All three steering-floor states resolve to working/: an in-flight card
    # being stopped stays visible where it ran rather than jumping to a new
    # directory mid-stop (design choice, D1.3/D1.4).
    "stop-requested": "working", "halting": "working", "halted": "working",
}
LEGAL = {
    "inbox": {"working", "blocked"},
    "blocked": {"inbox"},
    # working may additionally be walked into the stop ladder; every other
    # existing target (done/approvals/blocked) is untouched.
    "working": {"done", "approvals", "blocked", "stop-requested"},
    "approvals": {"approved", "rejected"},
    "approved": {"done"},
    "done": set(), "rejected": set(),
    # The stop ladder itself: working -> stop-requested -> halting -> halted.
    # No state other than "working" may transition INTO stop-requested (their
    # target sets above are unchanged), and halted is terminal -- no transition
    # out of it (SIGKILL is the only way past it, and that is not a queue-state
    # transition at all).
    "stop-requested": {"halting"},
    "halting": {"halted"},
    "halted": set(),
}


class ValidationError(Exception):
    pass


@dataclass
class Card:
    meta: dict
    body: str
    path: Path | None = None


def new_id() -> str:
    return f"{int(time.time()):08x}-{secrets.token_hex(4)}"


def _validate(meta: dict) -> None:
    for key in REQUIRED:
        if meta.get(key) in (None, ""):
            raise ValidationError(f"missing required field: {key}")
    if meta["risk-tier"] not in RISK_TIERS:
        raise ValidationError(f"risk-tier must be one of {RISK_TIERS}")
    if meta["state"] not in STATES:
        raise ValidationError(f"unknown state: {meta['state']}")
    if meta.get("role") and meta["role"] not in ROLES:
        raise ValidationError(f"role must be one of {ROLES}")


def new_card(project, action, target, risk_tier, body: str = "", **extra) -> Card:
    meta = {
        "id": new_id(), "project": project, "action": action, "target": target,
        "risk-tier": risk_tier, "owner": None, "claim-token": None,
        "state": "inbox", "approval": None, "workflow": None,
        "depends-on": [], "variant-group": None, "role": "work",
        # The Plane-A<->Plane-B join key (D1.1/D1.4): the EXECUTING worker's
        # Claude Code session id, stamped by the worker runner at
        # transition-to-working (D1.2), or by the dispatcher itself only for
        # the cloud self-executing carve-out case (D1.1's stamp_session call
        # in dispatch.run()). Optional and inert -- never parsed/executed.
        "session-id": None,
    }
    meta.update(extra)
    _validate(meta)
    return Card(meta=meta, body=body)


def parse_text(text: str, path: Path | None = None) -> Card:
    """Parse card frontmatter+body from an in-memory string.

    The single source of truth for card parsing; ``parse`` reads a file and
    delegates here. Callers that already hold the exact bytes (e.g. the approval
    verifier reading ``git show <sha>:<rel>`` — the committed, signed object
    rather than the mutable working tree) parse without a filesystem round-trip.

    Newlines are normalised to ``\\n`` so parsing is identical whether the bytes
    came from ``read_text`` (universal-newline) or a raw ``git show`` blob that
    may carry CRLF.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise ValidationError(f"{path}: no frontmatter")
    _, fm, body = text.split("---\n", 2)
    meta = yaml.safe_load(fm)
    _validate(meta)
    return Card(meta=meta, body=body.lstrip("\n"), path=Path(path) if path else None)


def parse(path: Path) -> Card:
    return parse_text(Path(path).read_text(encoding="utf-8"), Path(path))


def save(card: Card, queue_root: Path) -> Path:
    _validate(card.meta)
    dest = Path(queue_root) / STATE_DIR[card.meta["state"]] / f"{card.meta['id']}.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    fm = yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True)
    dest.write_text(f"---\n{fm}---\n\n{card.body}", encoding="utf-8")
    card.path = dest
    return dest


def claim(card: Card, agent_id: str) -> None:
    card.meta["owner"] = agent_id
    card.meta["claim-token"] = secrets.token_hex(8)


def stamp_session(card: Card, session_id: str) -> None:
    """Set the Plane-A<->Plane-B join key. Inert metadata: never parsed/executed."""
    card.meta["session-id"] = session_id


def transition(card: Card, new_state: str, queue_root: Path) -> Path:
    old = card.meta["state"]
    if new_state not in LEGAL.get(old, set()):
        raise ValidationError(f"illegal transition {old} -> {new_state}")
    if new_state == "working" and not card.meta.get("owner"):
        raise ValidationError("cannot start working an unowned card (dispatchers assign)")
    old_path = card.path or (Path(queue_root) / STATE_DIR[old] / f"{card.meta['id']}.md")
    card.meta["state"] = new_state
    new_path = save(card, queue_root)
    if old_path.exists() and old_path != new_path:
        old_path.unlink()
    return new_path
