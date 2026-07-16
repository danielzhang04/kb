"""Task 2.5 — end-to-end (fake-transport) rehearsal of the Telegram approval
invariants, run before HUMAN GATE 2.7-2.9 stand the real bot up.

This is deliberately NOT a re-statement of tests/test_telegram_poll.py's unit
tests. Each test here drives ``telegram_poll.poll`` through a small multi-tap,
multi-restart SCENARIO — the shape an actual rehearsal dry-run would exercise
— asserting the invariants hold in combination, not just in isolation:

  1. STOP halts polling before any I/O (checked first, no partial work).
  2. The git-native offset cursor is idempotent across a stateless restart,
     even when the batch mixes rejected/quarantined/minted taps.
  3. A non-allowlisted ``from.id`` is rejected and mints nothing.
  4. A hash-prefix mismatch quarantines the card rather than trusting the
     stale ``callback_data``.

Deviation note (see report to boss): the implementation plan's one-line gloss
for this task says hash-mismatch "writes a wake-me" card. The already-merged
``scripts/telegram_poll.py`` (ground truth for this task — out of the allowed
touch-list) only sets ``card.meta["quarantine"] / "quarantine-reason"`` and
audits ``hash_mismatch``; it does not emit a ``queue/inbox/`` wake-me card.
Tests below assert the actual merged behaviour and explicitly document the gap
rather than silently asserting undelivered behaviour.
"""
import datetime

import approvals
import cards
import ledger
import telegram_poll


class FakeTransport:
    """No-network fake Telegram transport (test double) — mirrors
    tests/test_telegram_poll.py's fake so getUpdates(offset) semantics
    (only update_id >= offset returned) match the real transport contract."""

    def __init__(self, updates):
        self.updates = updates
        self.get_updates_calls: list[int] = []
        self.answered: list[tuple] = []
        self.edited: list[tuple] = []

    def get_updates(self, offset):
        self.get_updates_calls.append(offset)
        return [u for u in self.updates if u["update_id"] >= offset]

    def answer_callback_query(self, callback_query_id, text=None):
        self.answered.append((callback_query_id, text))

    def edit_message_text(self, chat_id, message_id, text):
        self.edited.append((chat_id, message_id, text))


def _cb_update(update_id, from_id, data, chat_id=1, message_id=1, cq_id="cbq"):
    return {
        "update_id": update_id,
        "callback_query": {
            "id": f"{cq_id}{update_id}",
            "from": {"id": from_id},
            "data": data,
            "message": {"chat": {"id": chat_id}, "message_id": message_id},
        },
    }


def _make_repo(tmp_path, telegram_ids=(111,)):
    repo = tmp_path / "repo"
    (repo / "governance").mkdir(parents=True)
    (repo / "queue" / "approvals").mkdir(parents=True)
    ids = "".join(f"  - {i}\n" for i in telegram_ids)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\ntelegram_id:\n' + ids, encoding="utf-8")
    return repo


def _new_card(repo, target, risk_tier="T2"):
    card = cards.new_card("proj", "deploy", target, risk_tier,
                           body="## Work order\ndo the approved thing\n",
                           state="approvals")
    cards.save(card, repo / "queue")
    return card


def _today_rows(repo):
    return ledger.read_day(repo, "approvals", datetime.date.today().isoformat())


# --- rehearsal 1: STOP halts polling before any I/O -------------------------

def test_rehearsal_stop_halts_polling_before_any_io(tmp_path):
    repo = _make_repo(tmp_path)
    card = _new_card(repo, "svc-a")
    (repo / "STOP").touch()

    prefix = approvals.payload_hash(card)[:8]
    transport = FakeTransport([_cb_update(1, 111, f"{card.meta['id']}|approve|{prefix}")])

    returned = telegram_poll.poll(repo, transport, offset=0)

    assert transport.get_updates_calls == [], "STOP must gate before getUpdates is ever called"
    assert transport.answered == [] and transport.edited == []
    assert _today_rows(repo) == [], "no audit rows while frozen"
    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals", "no mint while frozen"
    assert saved.meta.get("assurance") != "possession"
    # STOP-gated poll returns the (unchanged) offset it was handed, not a
    # cursor advance — the run performed no work to persist.
    assert returned == 0
    assert ledger.read_cursor(repo, "telegram") == 0


# --- rehearsal 2: offset idempotent across a stateless restart, mixed batch --

def test_rehearsal_offset_idempotent_across_restart_with_mixed_batch(tmp_path):
    repo = _make_repo(tmp_path, telegram_ids=(111,))
    card_a = _new_card(repo, "svc-a")  # target of a rejected (not-allowlisted) tap
    card_b = _new_card(repo, "svc-b")  # target of a hash-mismatch tap
    card_c = _new_card(repo, "svc-c")  # target of a legitimately minted tap

    good_prefix_c = approvals.payload_hash(card_c)[:8]
    updates = [
        _cb_update(1, from_id=999, data=f"{card_a.meta['id']}|approve|deadbeef"),
        _cb_update(2, from_id=111, data=f"{card_b.meta['id']}|approve|deadbeef"),
        _cb_update(3, from_id=111, data=f"{card_c.meta['id']}|approve|{good_prefix_c}"),
    ]
    transport = FakeTransport(updates)

    # First run — offset omitted, resumes from the (fresh) persisted cursor.
    first_offset = telegram_poll.poll(repo, transport)
    assert first_offset == 4
    assert ledger.read_cursor(repo, "telegram") == 4
    rows_after_first = _today_rows(repo)
    assert len(rows_after_first) == 3
    results = {r["card_id"]: r["result"] for r in rows_after_first}
    assert results[card_a.meta["id"]] == "not_allowlisted"
    assert results[card_b.meta["id"]] == "hash_mismatch"
    assert results[card_c.meta["id"]] == "approved"

    # Simulated stateless restart: a brand-new poll() call with the SAME
    # transport (mimicking getUpdates(offset) semantics) and offset again
    # omitted -> must resume from the persisted cursor and mint nothing new.
    second_offset = telegram_poll.poll(repo, transport)
    assert second_offset == 4
    assert transport.get_updates_calls[-1] == 4
    assert len(_today_rows(repo)) == 3, "restart must not re-process already-acked updates"

    saved_c = cards.parse(repo / "queue" / "approvals" / f"{card_c.meta['id']}.md")
    assert saved_c.meta["state"] == "approved"
    assert saved_c.meta["assurance"] == "possession"


# --- rehearsal 3: non-Daniel from.id rejected -------------------------------

def test_rehearsal_non_daniel_from_id_rejected(tmp_path):
    repo = _make_repo(tmp_path, telegram_ids=(111,))  # 111 == Daniel's telegram_id
    card = _new_card(repo, "svc-a")
    prefix = approvals.payload_hash(card)[:8]

    intruder_update = _cb_update(1, from_id=222, data=f"{card.meta['id']}|approve|{prefix}")
    transport = FakeTransport([intruder_update])

    telegram_poll.poll(repo, transport, offset=0)

    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals", "unauthorised tap must not advance card state"
    assert saved.meta.get("assurance") != "possession"
    assert saved.meta.get("quarantine") is not True, "wrong-user tap is a rejection, not a quarantine"
    rows = _today_rows(repo)
    assert len(rows) == 1
    assert rows[0]["result"] == "not_allowlisted"
    assert int(rows[0]["from_id"]) == 222  # ledger rows round-trip through TSV as strings
    # The tapper still gets an ack — silence would look like a hang, not a rejection.
    assert transport.answered and "not allow-listed" in transport.answered[0][1].lower()


def test_rehearsal_empty_allowlist_rejects_everyone(tmp_path):
    """HUMAN GATE 2.9 has not landed yet on a fresh checkout: no `telegram_id`
    field in governance/humans.yaml at all. Fail-closed means EVERY tap is
    rejected, never approved-by-default."""
    repo = tmp_path / "repo"
    (repo / "governance").mkdir(parents=True)
    (repo / "queue" / "approvals").mkdir(parents=True)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\n', encoding="utf-8")
    card = _new_card(repo, "svc-a")
    prefix = approvals.payload_hash(card)[:8]
    transport = FakeTransport([_cb_update(1, from_id=111, data=f"{card.meta['id']}|approve|{prefix}")])

    telegram_poll.poll(repo, transport, offset=0)

    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals"
    assert _today_rows(repo)[0]["result"] == "not_allowlisted"


# --- rehearsal 4: hash-mismatch quarantines the card ------------------------

def test_rehearsal_hash_mismatch_quarantines_card_out_of_actionable_path(tmp_path):
    repo = _make_repo(tmp_path, telegram_ids=(111,))
    card = _new_card(repo, "svc-a")

    stale_update = _cb_update(1, from_id=111, data=f"{card.meta['id']}|approve|deadbeef")
    transport = FakeTransport([stale_update])

    telegram_poll.poll(repo, transport, offset=0)

    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    # Quarantined: flagged and NOT transitioned to "approved" — a quarantined
    # card cannot be picked up by any downstream "approved" consumer, which is
    # what "moved out of the actionable path" means operationally here.
    assert saved.meta["state"] == "approvals"
    assert saved.meta["quarantine"] is True
    assert saved.meta["quarantine-reason"] == "telegram hash prefix mismatch"
    assert saved.meta.get("assurance") != "possession"
    rows = _today_rows(repo)
    assert rows[0]["result"] == "hash_mismatch"
    assert rows[0]["card_id"] == card.meta["id"]

    # A second tap replaying the SAME stale prefix must not un-quarantine or
    # mint — the quarantine is sticky, not a one-shot flag that a retry clears.
    transport2 = FakeTransport([_cb_update(2, from_id=111,
                                            data=f"{card.meta['id']}|approve|deadbeef")])
    telegram_poll.poll(repo, transport2, offset=2)
    saved2 = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved2.meta["quarantine"] is True
    assert saved2.meta.get("assurance") != "possession"
