"""Local read-only HTTP `/state` surface (design §3, Task 5).

An aiohttp server started inside `app.py::entrypoint()` on the existing job-context event loop
— same placement discipline as `_build_tts()`, which keeps it inside the job context and off the
wake thread (the V0 landmine). Bound to **127.0.0.1 ONLY**. One route, `GET /state`, returning
`publisher.snapshot()` plus a `heartbeat` stamped at request time; header `cache-control:
no-store`. No other routes.

Provably key-free: the response body is `publisher.snapshot()` (pure in-process state) plus the
`heartbeat` timestamp and NOTHING from `os.environ` — the scoped-key carve-out requires this
surface to never reflect process env.

API verified against the INSTALLED aiohttp 3.14.1 at
`atlas/.venv/Lib/site-packages/aiohttp/`:
  - `aiohttp.web.Application()` and `app.router.add_get(path, handler)`
    (web_urldispatcher.py:1204 `add_get`).
  - `web.AppRunner(app)` then `await runner.setup()` (web_runner.py:387 `AppRunner`;
    BaseRunner.setup web_runner.py:299).
  - `web.TCPSite(runner, host, port)` then `await site.start()`; `site.port` returns the actual
    bound port after start when `port=0` was requested (web_runner.py:87/113/133).
  - `runner.addresses` -> list of socket `getsockname()` tuples (web_runner.py:284), used to
    prove the localhost bind.
  - `web.json_response(data, headers=...)` serializes `data` as JSON and sets
    `content-type: application/json` (web_response.py:857).
  - `await runner.cleanup()` tears down sites + server for teardown (BaseRunner.cleanup
    web_runner.py:316).
"""
import logging
from datetime import datetime, timezone
from typing import Callable

from aiohttp import web

logger = logging.getLogger("atlas.stateserver")

# localhost ONLY — the surface never binds a routable interface (design §3).
HOST = "127.0.0.1"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StateServer:
    """A running `/state` server: owns the aiohttp `AppRunner`/`TCPSite` and exposes `.stop()`.

    Constructed with the publisher it mirrors and an injectable `clock` (real UTC by default) so
    the request-time `heartbeat` is deterministic under test. It is an observer of the publisher,
    never a controller — it only reads `snapshot()`.
    """

    def __init__(self, publisher, clock: Callable[[], datetime] = _utcnow) -> None:
        self._publisher = publisher
        self._clock = clock
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

    async def _handle_state(self, request: web.Request) -> web.Response:
        # snapshot() + a fresh heartbeat are the ONLY body sources. os.environ is never read.
        payload = self._publisher.snapshot()
        payload["heartbeat"] = self._clock().isoformat()
        return web.json_response(payload, headers={"cache-control": "no-store"})

    async def start(self, port: int) -> "StateServer":
        app = web.Application()
        app.router.add_get("/state", self._handle_state)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, HOST, port)
        await self._site.start()
        logger.info("atlas /state serving on http://%s:%s", HOST, self.port)
        return self

    @property
    def port(self) -> int:
        """The actually-bound port (resolves an ephemeral `port=0` after start)."""
        return self._site.port if self._site is not None else 0

    @property
    def addresses(self) -> list:
        """Bound socket addresses (`getsockname()` tuples) — proves the localhost bind."""
        return self._runner.addresses if self._runner is not None else []

    async def stop(self) -> None:
        """Tear down the site + server. Idempotent."""
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            self._site = None


async def start(publisher, port: int, clock: Callable[[], datetime] = _utcnow) -> StateServer:
    """Start the `/state` server bound to `127.0.0.1:<port>`. Awaitable; returns the handle
    (call `.stop()` to tear it down). Pass `port=0` for an ephemeral port (tests)."""
    return await StateServer(publisher, clock=clock).start(port)
