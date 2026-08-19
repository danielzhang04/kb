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
          "stop-requested", "halting", "halted",
          # Terminal state for the daemon stranded-archiver: a card owned by a
          # real agent, idle in inbox/working past the stranded window with BOTH the
          # card AND its owner showing no observable activity for the window, is MOVED
          # out of the active queue into queue/archived/ rather than surfaced. Absence
          # of an observable owner runner is NOT evidence of abandonment. Terminal but
          # REVERSIBLE -- a human un-archives by walking it back to inbox (see LEGAL).
          "archived")
RISK_TIERS = ("T1", "T2", "T3")
ROLES = ("scout", "manage", "work", "inspect", "consolidate")
# Execution runtimes a card may be routed to (Phase R1). Validated only when the
# `runtime` field is present/truthy -- exactly the `role`/`ROLES` rule -- so
# legacy cards (no `runtime` key) and freshly-minted cards (runtime: None) stay
# valid. Concrete `model` ids are NOT enum-checked here: they are validated
# against the runtime registry by scripts/routing.resolve(), so cards.py need
# not couple to governance/model-routing.yaml. Gemini is deferred (memory).
RUNTIMES = ("claude", "codex")
CARD_SCHEMA_VERSION = 1
SUPPORTED_CARD_SCHEMA_VERSIONS = frozenset({0, CARD_SCHEMA_VERSION})
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
    # The stranded-archiver's terminal sink -- its own physical directory so an
    # auto-archived card leaves the active inbox/working scan surfaces entirely.
    "archived": "archived",
}
LEGAL = {
    # inbox may additionally be auto-archived (stranded sink); working/blocked
    # are the pre-existing targets.
    "inbox": {"working", "blocked", "archived"},
    "blocked": {"inbox"},
    # working may additionally be walked into the stop ladder or the archived
    # sink; every other existing target (done/approvals/blocked) is untouched.
    "working": {"done", "approvals", "blocked", "stop-requested", "archived"},
    "approvals": {"approved", "rejected"},
    "approved": {"done"},
    "done": set(), "rejected": set(),
    # archived is terminal but REVERSIBLE: the only legal move out is back to
    # inbox, so a human can un-archive (reopen) a card the archiver retired. No
    # other transition out exists -- it never re-enters working/approvals directly.
    "archived": {"inbox"},
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


def card_schema_version(meta: dict) -> int:
    value = meta.get("schema-version", 0)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError("schema-version must be an integer")
    if value not in SUPPORTED_CARD_SCHEMA_VERSIONS:
        raise ValidationError(f"unsupported card schema-version: {value}")
    return value


def migrate_card(card: Card, target_version: int = CARD_SCHEMA_VERSION) -> Card:
    if target_version != CARD_SCHEMA_VERSION:
        raise ValidationError(f"unsupported card migration target: {target_version}")
    card_schema_version(card.meta)
    return Card(meta={**card.meta, "schema-version": target_version}, body=card.body)


def new_id() -> str:
    return f"{int(time.time()):08x}-{secrets.token_hex(4)}"


def _validate(meta: dict) -> None:
    card_schema_version(meta)
    for key in REQUIRED:
        if meta.get(key) in (None, ""):
            raise ValidationError(f"missing required field: {key}")
    if meta["risk-tier"] not in RISK_TIERS:
        raise ValidationError(f"risk-tier must be one of {RISK_TIERS}")
    if meta["state"] not in STATES:
        raise ValidationError(f"unknown state: {meta['state']}")
    if meta.get("role") and meta["role"] not in ROLES:
        raise ValidationError(f"role must be one of {ROLES}")
    # Routing runtime (Phase R1): validate only when present/truthy, mirroring
    # the `role`/`ROLES` rule above. runtime: None / absent (legacy) is valid.
    if meta.get("runtime") and meta["runtime"] not in RUNTIMES:
        raise ValidationError(f"runtime must be one of {RUNTIMES}")


def new_card(project, action, target, risk_tier, body: str = "", **extra) -> Card:
    meta = {
        "schema-version": CARD_SCHEMA_VERSION,
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
        # Phase R1 routing fields. SET BY the dispatcher/routing layer ONLY
        # (never parsed from untrusted card text -- same rule as action/target);
        # resolved at claim time from the routing precedence and stamped via
        # stamp_routing. null on a fresh card and on every legacy card. `model`
        # is a concrete id (validated against the runtime registry by
        # routing.resolve, not here). Inert metadata; never executed.
        "runtime": None,
        "model": None,
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
    # newline="\n" pins the canonical byte form on every platform; the default would
    # translate to CRLF on Windows and break byte-for-byte origin-blob validation.
    dest.write_text(f"---\n{fm}---\n\n{card.body}", encoding="utf-8", newline="\n")
    card.path = dest
    return dest


def claim(card: Card, agent_id: str) -> None:
    card.meta["owner"] = agent_id
    card.meta["claim-token"] = secrets.token_hex(8)


def stamp_session(card: Card, session_id: str) -> None:
    """Set the Plane-A<->Plane-B join key. Inert metadata: never parsed/executed."""
    card.meta["session-id"] = session_id


def stamp_routing(card: Card, runtime: str, model: str) -> None:
    """Persist the resolved routing decision onto the card (Phase R1), mirroring
    stamp_session: a two-line setter that mutates card.meta but does not save.
    The dispatcher calls this at the claim anchor with the concrete
    (runtime, model) that routing.resolve() returned. Inert metadata."""
    card.meta["runtime"] = runtime
    card.meta["model"] = model


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
