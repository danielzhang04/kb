import datetime

import approvals
import cards
import ledger
import telegram_poll


class FakeTransport:
    """No-network fake Telegram transport (test double).

    ``get_updates`` mimics real Telegram ``getUpdates(offset)`` semantics —
    only updates with ``update_id >= offset`` are returned — so idempotency
    tests exercise the same contract the real transport would.
    """

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


def _cb_update(update_id, from_id, data, chat_id=1, message_id=1, cq_id="cbq1"):
    return {
        "update_id": update_id,
        "callback_query": {
            "id": cq_id,
            "from": {"id": from_id},
            "data": data,
            "message": {"chat": {"id": chat_id}, "message_id": message_id},
        },
    }


def _make_repo(tmp_path, telegram_ids=(111,), risk_tier="T2", state="approvals"):
    repo = tmp_path / "repo"
    (repo / "governance").mkdir(parents=True)
    (repo / "queue" / "approvals").mkdir(parents=True)
    ids = "".join(f"  - {i}\n" for i in telegram_ids)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\ntelegram_id:\n' + ids, encoding="utf-8")
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", "deploy", "svc-a", risk_tier, body=body, state=state)
    cards.save(card, repo / "queue")
    return repo, card


def _today_rows(repo):
    return ledger.read_day(repo, "approvals", datetime.date.today().isoformat())


# --- 2.1: allowlist / hash-prefix / mint / STOP-gate --------------------------

def test_from_id_allowlist_enforced(tmp_path):
    repo, card = _make_repo(tmp_path, telegram_ids=(111,))
    prefix = approvals.payload_hash(card)[:8]
    update = _cb_update(1, from_id=999, data=f"{card.meta['id']}|approve|{prefix}")
    transport = FakeTransport([update])

    telegram_poll.poll(repo, transport, offset=0)

    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals"
    assert saved.meta.get("assurance") != "possession"
    rows = _today_rows(repo)
    assert any(r["result"] == "not_allowlisted" for r in rows)


def test_hash_prefix_verified_against_reread_card(tmp_path):
    repo, card = _make_repo(tmp_path, telegram_ids=(111,))
    # Wrong prefix — does not match the re-read card's real payload_hash.
    update = _cb_update(1, from_id=111, data=f"{card.meta['id']}|approve|deadbeef")
    transport = FakeTransport([update])

    telegram_poll.poll(repo, transport, offset=0)

    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals"
    assert saved.meta.get("quarantine") is True
    rows = _today_rows(repo)
    assert any(r["result"] == "hash_mismatch" for r in rows)


def test_mints_possession_record(tmp_path):
    repo, card = _make_repo(tmp_path, telegram_ids=(111,))
    prefix = approvals.payload_hash(card)[:8]
    update = _cb_update(5, from_id=111, data=f"{card.meta['id']}|approve|{prefix}")
    transport = FakeTransport([update])

    new_offset = telegram_poll.poll(repo, transport, offset=0)

    assert new_offset == 6  # advanced past update_id 5
    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approved"
    assert saved.meta["assurance"] == "possession"
    assert saved.meta["approval"] == approvals.payload_hash(card)
    assert saved.meta.get("expires")
    assert transport.answered and transport.edited
    rows = _today_rows(repo)
    assert any(r["result"] == "approved" and r["card_id"] == card.meta["id"] for r in rows)


def test_stop_gated(tmp_path):
    repo, card = _make_repo(tmp_path, telegram_ids=(111,))
    (repo / "STOP").touch()
    prefix = approvals.payload_hash(card)[:8]
    update = _cb_update(1, from_id=111, data=f"{card.meta['id']}|approve|{prefix}")
    transport = FakeTransport([update])

    telegram_poll.poll(repo, transport, offset=0)

    assert transport.get_updates_calls == []  # no getUpdates at all
    saved = cards.parse(repo / "queue" / "approvals" / f"{card.meta['id']}.md")
    assert saved.meta["state"] == "approvals"  # no mint
    assert _today_rows(repo) == []


# --- 2.3: git-native cursor idempotency across a stateless restart -----------

def test_offset_idempotent_across_restart(tmp_path):
    repo, card = _make_repo(tmp_path, telegram_ids=(111,))
    prefix = approvals.payload_hash(card)[:8]
    update = _cb_update(1, from_id=111, data=f"{card.meta['id']}|approve|{prefix}")
    transport = FakeTransport([update])

    # First run: offset not passed -> read from the persisted (fresh) cursor.
    telegram_poll.poll(repo, transport)
    assert len(_today_rows(repo)) == 1
    assert ledger.read_cursor(repo, "telegram") == 2

    # Simulated stateless restart: a brand-new poll() call, offset again not
    # passed -> must resume from the persisted cursor. The fake transport
    # (mimicking real getUpdates(offset) semantics) yields nothing already
    # acked, so nothing new is minted.
    telegram_poll.poll(repo, transport)
    assert len(_today_rows(repo)) == 1
    assert transport.get_updates_calls[-1] == 2
