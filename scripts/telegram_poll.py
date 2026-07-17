"""Telegram possession-approval poller (Wave 2, tasks 2.1 + 2.3).

PROCESS-ISOLATION INVARIANT (Wave-2 decision 3 / architecture D0, D2):
this process holds the Telegram **bot token** and mints ``assurance:
possession`` approval records. It MUST NEVER, in the same process or run,
ingest untrusted external web content, and MUST NEVER be granted Custom/Full
network egress. Co-locating token custody + possession-minting with a
prompt-injection surface (e.g. live web research) would let injected content
drive possession-approval minting and ops writes. Keep this module narrow:
verified Telegram taps in, verified approval records out — nothing else.

Token custody = DESKTOP (Windows Credential Manager). The real transport
(injected, not this module) reads the bot token from Credential Manager;
this module never handles the token as a repo object and never prints,
copies, or persists it.

The ``transport`` is injected and must expose:
  - ``get_updates(offset) -> list[dict]``            (Telegram ``Update``s)
  - ``answer_callback_query(callback_query_id, text=None)``
  - ``edit_message_text(chat_id, message_id, text)``

Idempotency (2.3): the ``getUpdates`` offset is a git-native cursor at
``ledgers/approvals/<name>-cursor`` (see ``ledger.read_cursor``/
``write_cursor``), so a stateless restart resumes exactly where the last run
left off — a caller may omit ``offset`` entirely to use it. Every processed
tap is additionally written to the dedicated ``approvals`` ledger kind (never
``activity`` — that stream feeds the integrity-relevant grade reconcile and
must not absorb telegram-poll noise).
"""
from __future__ import annotations

import datetime
from pathlib import Path

import yaml

import approvals
import cards
import ledger
import preamble

CURSOR_NAME = "telegram"


def _now() -> datetime.datetime:
    """Current UTC time — a seam so tests can pin 'now' deterministically."""
    return datetime.datetime.now(datetime.timezone.utc)


def _stop_gated(repo_root: Path) -> bool:
    """True iff the shared STOP-file gate (constitution) is tripped.

    Delegates to ``preamble.check`` with an empty env and no cost function so
    this is exactly the STOP-file check — independent of the
    ANTHROPIC_API_KEY / daily-budget concerns the outer ``preamble.py`` run
    already covers before this loop starts. Keeping one STOP check reused
    (rather than re-implemented) avoids the two drifting apart.
    """
    return bool(preamble.check(repo_root, env={}))


def _telegram_allowlist(repo_root: Path) -> set[int]:
    """Allow-listed Telegram user ids from ``governance/humans.yaml``'s
    ``telegram_id`` field (top-level list, mirroring ``emails:``'s shape; a
    per-human ``telegram_id`` key under ``humans:`` is also honoured for
    forward compatibility with the ``emails`` allow-list pattern).

    HUMAN GATE 2.9 introduces this field — until then it is absent, and this
    returns an EMPTY set, so EVERY tap is rejected. Fail closed, never open.
    """
    path = Path(repo_root) / "governance" / "humans.yaml"
    if not path.exists():
        return set()
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return set()
    if not isinstance(data, dict):
        return set()
    ids: set[int] = set()
    for raw in data.get("telegram_id", []) or []:
        try:
            ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    for human in data.get("humans", []) or []:
        if isinstance(human, dict) and human.get("telegram_id") is not None:
            try:
                ids.add(int(human["telegram_id"]))
            except (TypeError, ValueError):
                continue
    return ids


def _find_card(repo_root: Path, card_id: str):
    """The pending card for ``card_id`` — expected at
    ``queue/approvals/<card_id>.md`` (state ``approvals``, awaiting a
    decision — see ``cards.STATE_DIR``). ``(None, path)`` if missing/unparsable."""
    path = Path(repo_root) / "queue" / "approvals" / f"{card_id}.md"
    if not path.exists():
        return None, path
    try:
        return cards.parse(path), path
    except Exception:  # noqa: BLE001 — any parse/validation failure rejects
        return None, path


def _audit(repo_root, agent, update_id, card_id, decision, from_id, result) -> None:
    """Append one row to the dedicated ``approvals`` ledger kind (2.3) —
    never ``activity``, which the exact-stream reconcile treats as
    integrity-relevant."""
    ledger.append(repo_root, "approvals", agent, {
        "ts": _now().isoformat(),
        "update_id": update_id,
        "card_id": card_id,
        "decision": decision,
        "from_id": from_id,
        "result": result,
    })


def _process_callback(repo_root: Path, transport, allowlist: set[int],
                       update: dict, agent: str) -> None:
    """Handle one ``callback_query`` update. Never raises — every outcome is
    both audited (2.3) and acknowledged back to the tapper."""
    cq = update.get("callback_query") or {}
    cq_id = cq.get("id")
    from_id = (cq.get("from") or {}).get("id")
    data = cq.get("data") or ""
    message = cq.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    message_id = message.get("message_id")
    update_id = update.get("update_id")

    def _ack(text: str) -> None:
        if cq_id is not None:
            transport.answer_callback_query(cq_id, text=text)
        if chat_id is not None and message_id is not None:
            transport.edit_message_text(chat_id, message_id, text)

    # callback_data == "card_id|decision|hash_prefix(8-hex)" (architecture D2).
    parts = data.split("|")
    if len(parts) != 3:
        _audit(repo_root, agent, update_id, None, None, from_id, "malformed_callback_data")
        _ack("Malformed approval tap — ignored.")
        return
    card_id, decision, hash_prefix = parts

    if from_id not in allowlist:
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "not_allowlisted")
        _ack("You are not allow-listed for approvals.")
        return

    card, _card_path = _find_card(repo_root, card_id)
    if card is None:
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "card_not_found")
        _ack("Card not found or unreadable — ignored.")
        return

    try:
        full_hash = approvals.payload_hash(card)
    except ValueError:
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "no_work_order")
        _ack("Card has no work order — ignored.")
        return

    # Re-read + full-hash re-verify against the tap's prefix; a mismatch
    # quarantines the card rather than trusting the stale callback_data.
    if not hash_prefix or full_hash[:len(hash_prefix)] != hash_prefix:
        card.meta["quarantine"] = True
        card.meta["quarantine-reason"] = "telegram hash prefix mismatch"
        cards.save(card, Path(repo_root) / "queue")
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "hash_mismatch")
        _ack("Hash mismatch — card quarantined.")
        return

    if decision == "approve":
        card.meta["assurance"] = "possession"
        card.meta["approval"] = full_hash
        card.meta["expires"] = (_now() + approvals.MAX_AGE).isoformat()
        cards.transition(card, "approved", Path(repo_root) / "queue")
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "approved")
        _ack(f"Approved {card_id}.")
    elif decision == "reject":
        cards.transition(card, "rejected", Path(repo_root) / "queue")
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "rejected")
        _ack(f"Rejected {card_id}.")
    else:
        _audit(repo_root, agent, update_id, card_id, decision, from_id, "invalid_decision")
        _ack("Unrecognized decision — ignored.")


def poll(repo_root, transport, offset: int | None = None,
         agent: str = "telegram-poll") -> int:
    """Ingest Telegram taps and mint possession approvals.

    STOP-gated (checked BEFORE any ``getUpdates`` call — a frozen fleet
    performs no Telegram I/O and mints nothing) and idempotent across
    stateless restarts via the git-native ``update_id`` cursor.

    ``offset`` may be given explicitly (tests, or a caller sharing one cursor
    across desktop/cloud pollers); when ``None`` it is read from the
    persisted cursor so a fresh process resumes where the last one left off.
    Returns the new offset (also persisted, unless STOP-gated).
    """
    repo_root = Path(repo_root)

    if _stop_gated(repo_root):
        return offset if offset is not None else ledger.read_cursor(repo_root, CURSOR_NAME)

    if offset is None:
        offset = ledger.read_cursor(repo_root, CURSOR_NAME)

    updates = transport.get_updates(offset) or []
    allowlist = _telegram_allowlist(repo_root)

    max_update_id = offset - 1
    for update in updates:
        uid = update.get("update_id")
        if uid is not None:
            max_update_id = max(max_update_id, uid)
        if "callback_query" in update:
            _process_callback(repo_root, transport, allowlist, update, agent)
        # plain 'message' updates carry no approval action; ack-only via offset.

    new_offset = max_update_id + 1
    ledger.write_cursor(repo_root, CURSOR_NAME, new_offset)
    return new_offset
