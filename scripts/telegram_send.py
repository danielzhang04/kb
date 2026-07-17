"""Outbound Telegram sendMessage + inline-keyboard helper (Wave 2, task 2.2).

``send(transport, chat_id, text, buttons=None)`` never performs I/O itself —
the transport is injected, so tests exercise a FAKE transport and never touch
the network (constitution: tests use a FAKE injected transport, no network).

Buttons are built by ``build_buttons(card, decisions)``. Each button's
``callback_data`` has the fixed shape ``f"{card_id}|{decision}|{hash_prefix}"``
where ``hash_prefix`` is ``approvals.payload_hash(card)[:8]`` — REUSED from
Wave-1 task 1.1, never reimplemented (that hash is what ``telegram_poll``
re-verifies against the re-read card). Telegram hard-caps ``callback_data`` at
64 bytes; a ``card_id`` long enough to blow that budget FAILS LOUD
(``CallbackDataTooLong``) rather than silently truncating the hash prefix,
which would weaken the poller's tap-verification binding.

Real-path token custody: this module never reads a credential store directly
(constitution — never handle credentials as objects: create/read stores/
modify). ``HTTPTransport`` takes an injected ``token_loader`` callable; the
default reads the ambient ``KB_TELEGRAM_BOT_TOKEN`` environment variable,
which the desktop launcher populates from Windows Credential Manager outside
this process. The token is used ambiently at send time, never fetched from
the store by this module.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Callable, Sequence

import approvals
import cards

CALLBACK_DATA_MAX_BYTES = 64
DEFAULT_DECISIONS = ("approve", "reject")


class CallbackDataTooLong(ValueError):
    """Raised when a built callback_data would exceed Telegram's 64-byte cap."""


def callback_data(card_id: str, decision: str, hash_prefix: str) -> str:
    """Build and validate one button's callback_data.

    Shape is fixed: ``f"{card_id}|{decision}|{hash_prefix}"``. Fails loud
    (raises ``CallbackDataTooLong``) rather than truncating ``hash_prefix`` or
    ``card_id`` — a silent truncation would let two different cards collide
    on the same callback_data, or would weaken telegram_poll's re-read hash
    verification.
    """
    data = f"{card_id}|{decision}|{hash_prefix}"
    size = len(data.encode("utf-8"))
    if size > CALLBACK_DATA_MAX_BYTES:
        raise CallbackDataTooLong(
            f"callback_data {data!r} is {size} bytes, exceeds Telegram's "
            f"{CALLBACK_DATA_MAX_BYTES}-byte cap (card_id too long?)"
        )
    return data


def build_buttons(
    card: cards.Card, decisions: Sequence[str] = DEFAULT_DECISIONS
) -> list[dict]:
    """Build inline-keyboard buttons for ``card``, one per decision.

    ``hash_prefix`` is derived from ``approvals.payload_hash(card)[:8]`` —
    REUSED from Wave-1 task 1.1, never reimplemented. Raises
    ``CallbackDataTooLong`` if any resulting callback_data would exceed 64
    bytes (fail loud; see module docstring).
    """
    card_id = card.meta["id"]
    hash_prefix = approvals.payload_hash(card)[:8]
    return [
        {
            "text": decision.capitalize(),
            "callback_data": callback_data(card_id, decision, hash_prefix),
        }
        for decision in decisions
    ]


def send(transport, chat_id, text, buttons=None):
    """sendMessage via the injected ``transport``; buttons become one
    inline-keyboard row.

    ``transport`` must expose ``.send_message(chat_id, text,
    reply_markup=None)``. This function performs no I/O of its own — real
    network access happens only inside a real transport implementation (e.g.
    ``HTTPTransport`` below), so this path is fully hermetic under test with a
    fake transport.
    """
    reply_markup = None
    if buttons:
        reply_markup = {"inline_keyboard": [list(buttons)]}
    return transport.send_message(chat_id, text, reply_markup=reply_markup)


def default_token_loader() -> str:
    """Ambient runtime credential source for the real path.

    Reads ``KB_TELEGRAM_BOT_TOKEN`` from the process environment. This module
    never reads Windows Credential Manager (or any credential store) directly
    — the desktop launcher is responsible for populating this env var from
    Credential Manager before invoking the send path.
    """
    token = os.environ.get("KB_TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError(
            "KB_TELEGRAM_BOT_TOKEN is not set. The desktop launcher must "
            "populate this ambient env var from Windows Credential Manager "
            "before the real Telegram send path runs; this module never "
            "reads the credential store directly."
        )
    return token


class HTTPTransport:
    """Real Telegram Bot API transport. Never instantiated or used in tests.

    The token comes from an injected ``token_loader`` (default:
    ``default_token_loader``, the ambient env var) — never read from a
    credential store by this class itself.
    """

    API_ROOT = "https://api.telegram.org"

    def __init__(self, token_loader: Callable[[], str] = default_token_loader):
        self._token_loader = token_loader

    def send_message(self, chat_id, text, reply_markup=None):
        token = self._token_loader()
        url = f"{self.API_ROOT}/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
