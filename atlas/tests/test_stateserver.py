"""Local read-only /state HTTP surface (Task 5, design §3).

Tests drive a REAL aiohttp AppRunner + TCPSite on an ephemeral port (port 0 — NEVER the 4360
desk default, so a running desk worker can't collide with the suite) and use aiohttp's own
ClientSession as the HTTP client. No new test deps and no pytest-asyncio: each test drives one
`asyncio.run()` coroutine (the test_toolreg.py precedent).

Verified against the INSTALLED aiohttp 3.14.1 in atlas/.venv (see stateserver.py header for the
exact symbol/line references).
"""
import asyncio
import json
from datetime import datetime, timezone

import aiohttp

from worker import stateserver
from worker.state import StatePublisher


def _dt(sec: int) -> datetime:
    return datetime(2026, 7, 20, 12, 0, sec, tzinfo=timezone.utc)


async def _get(server, path: str = "/state"):
    """GET against the ephemeral port; returns (status, lowercased-headers, raw-text)."""
    url = f"http://127.0.0.1:{server.port}{path}"
    async with aiohttp.ClientSession() as sess:
        async with sess.get(url) as resp:
            text = await resp.text()
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, headers, text


def test_state_endpoint_returns_200_and_full_schema():
    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(0), voice="mars")
        pub.start_session()
        srv = await stateserver.start(pub, 0)
        try:
            return await _get(srv)
        finally:
            await srv.stop()

    status, _headers, text = asyncio.run(scenario())
    assert status == 200
    body = json.loads(text)
    assert set(body.keys()) == {
        "version", "state", "since", "session_id", "voice", "transcript", "heartbeat",
        "filed_cards",
    }
    assert body["version"] == 1
    assert body["state"] == "ASLEEP"
    assert body["voice"] == "mars"
    assert body["session_id"] is not None


def test_transcript_ring_round_trips():
    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(3))
        pub.start_session()
        pub.add_line("user", "what's in the queue")
        pub.add_line("atlas", "Three cards in flight.")
        srv = await stateserver.start(pub, 0)
        try:
            return await _get(srv)
        finally:
            await srv.stop()

    _status, _headers, text = asyncio.run(scenario())
    body = json.loads(text)
    assert body["transcript"] == [
        {"t": _dt(3).isoformat(), "role": "user", "text": "what's in the queue"},
        {"t": _dt(3).isoformat(), "role": "atlas", "text": "Three cards in flight."},
    ]


def test_cache_control_is_no_store():
    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(0))
        srv = await stateserver.start(pub, 0)
        try:
            return await _get(srv)
        finally:
            await srv.stop()

    _status, headers, _text = asyncio.run(scenario())
    assert headers.get("cache-control") == "no-store"


def test_heartbeat_advances_between_two_requests():
    async def scenario():
        ticks = iter([_dt(10), _dt(11)])
        pub = StatePublisher(clock=lambda: _dt(0))  # snapshot() `since` is frozen...
        srv = await stateserver.start(pub, 0, clock=lambda: next(ticks))  # ...heartbeat advances
        try:
            _s1, _h1, t1 = await _get(srv)
            _s2, _h2, t2 = await _get(srv)
            return t1, t2
        finally:
            await srv.stop()

    t1, t2 = asyncio.run(scenario())
    h1 = json.loads(t1)["heartbeat"]
    h2 = json.loads(t2)["heartbeat"]
    assert h1 == _dt(10).isoformat()
    assert h2 == _dt(11).isoformat()
    assert h2 > h1


def test_bound_to_localhost_only():
    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(0))
        srv = await stateserver.start(pub, 0)
        try:
            return list(srv.addresses)
        finally:
            await srv.stop()

    addrs = asyncio.run(scenario())
    assert addrs, "server should report at least one bound address"
    for sockaddr in addrs:
        assert sockaddr[0] == "127.0.0.1"
    assert stateserver.HOST == "127.0.0.1"


def test_only_state_route_exists():
    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(0))
        srv = await stateserver.start(pub, 0)
        try:
            _status, _headers, _text = await _get(srv, "/secrets")
            return _status
        finally:
            await srv.stop()

    assert asyncio.run(scenario()) == 404


def test_response_is_key_free_under_poisoned_env(monkeypatch):
    """Set FAKE secrets in os.environ and prove the serialized response never contains them —
    the surface is built from publisher.snapshot() + heartbeat and NEVER reads process env."""
    sentinel = "SUPER-SECRET-SENTINEL-VALUE-9f3a2b1c7d"
    monkeypatch.setenv("ATLAS_FAKE_SECRET", sentinel)
    monkeypatch.setenv("FAKE_API_KEY", sentinel)

    async def scenario():
        pub = StatePublisher(clock=lambda: _dt(0), voice="mars")
        pub.start_session()
        pub.add_line("user", "hello")
        srv = await stateserver.start(pub, 0)
        try:
            return await _get(srv)
        finally:
            await srv.stop()

    _status, _headers, text = asyncio.run(scenario())
    assert sentinel not in text
