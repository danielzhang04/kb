"""Task 2.2 — outbound Telegram sendMessage + inline-keyboard helper.

Fake injected transport only: no real network in tests (constitution — tests
use a FAKE injected transport). `build_buttons` derives each button's
`callback_data` from `approvals.payload_hash(card)[:8]` (REUSED from Wave-1
1.1, never reimplemented) and must fail loud rather than silently truncate
when the result would exceed Telegram's 64-byte `callback_data` cap.
"""
import pytest

import cards
import telegram_send


class FakeTransport:
    """Records every send_message call; performs no real network I/O."""

    def __init__(self):
        self.calls = []

    def send_message(self, chat_id, text, reply_markup=None):
        self.calls.append(
            {"chat_id": chat_id, "text": text, "reply_markup": reply_markup}
        )
        return {"ok": True}


def _make_card(card_id=None, action="deploy", target="svc-a"):
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", action, target, "T2", body=body)
    if card_id is not None:
        card.meta["id"] = card_id
    return card


def test_inline_keyboard_callback_data_shape():
    card = _make_card()
    buttons = telegram_send.build_buttons(card, decisions=("approve", "reject"))
    hash_prefix = telegram_send.approvals.payload_hash(card)[:8]

    assert buttons[0]["callback_data"] == f"{card.meta['id']}|approve|{hash_prefix}"
    assert buttons[1]["callback_data"] == f"{card.meta['id']}|reject|{hash_prefix}"
    for button in buttons:
        assert len(button["callback_data"].encode("utf-8")) <= 64


def test_callback_data_helper_matches_expected_shape_directly():
    data = telegram_send.callback_data("card-123", "approve", "deadbeef")
    assert data == "card-123|approve|deadbeef"
    assert len(data.encode("utf-8")) <= 64


def test_callback_data_rejects_long_card_id_instead_of_truncating():
    # A card_id long enough to blow the 64-byte callback_data budget must FAIL
    # LOUD, not silently truncate the hash prefix (which would weaken the
    # poller's re-read hash verification — see telegram_poll task 2.1).
    long_id = "x" * 100
    card = _make_card(card_id=long_id)
    with pytest.raises(telegram_send.CallbackDataTooLong):
        telegram_send.build_buttons(card)


def test_send_uses_injected_transport():
    transport = FakeTransport()
    result = telegram_send.send(transport, chat_id=12345, text="hello")

    assert result == {"ok": True}
    assert transport.calls == [
        {"chat_id": 12345, "text": "hello", "reply_markup": None}
    ]


def test_send_with_buttons_builds_single_row_reply_markup():
    card = _make_card()
    transport = FakeTransport()
    buttons = telegram_send.build_buttons(card)

    telegram_send.send(transport, chat_id=1, text="approve?", buttons=buttons)

    assert transport.calls[0]["reply_markup"] == {"inline_keyboard": [buttons]}


def test_send_never_touches_real_network(monkeypatch):
    # Fail the test if send() ever tries to open a real socket/URL — proves
    # the hermetic path never falls through to HTTPTransport internals.
    import urllib.request

    def _boom(*args, **kwargs):
        raise AssertionError("send() must not perform real network I/O in tests")

    monkeypatch.setattr(urllib.request, "urlopen", _boom)
    transport = FakeTransport()
    telegram_send.send(transport, chat_id=1, text="hi")
    assert transport.calls
