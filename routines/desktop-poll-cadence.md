# Desktop interactive-poll cadence (task 2.6)

**What.** `scripts/desktop_poll.ps1` — a short-lived, offset-cursor, STOP-gated
poll of the Telegram bot's `getUpdates` endpoint, `--tier desktop`. It is the
**sole** poller for the bot (one-poller-per-bot invariant, architecture D2):
the desktop always polls; the cloud never polls concurrently, and never holds
the bot token.

**Cadence.** Run every **~2-5 minutes** via Windows Task Scheduler, on a
repeating trigger, while the desktop is on. This is the PC-on latency
contract: a possession tap lands within a few minutes, not until the next
nightly/heartbeat cadence. When the PC is off, the signed (GitHub PR-merge)
channel is the fallback — no poll runs, and nothing is lost, because the
Telegram `getUpdates` offset and the underlying cards are git-native state on
`ops`, not in-memory.

**Registration is a HUMAN gate.** This script is agent-built and rehearsed
(dry run under a `STOP` file must no-op cleanly), but registering the actual
Task Scheduler task is HUMAN GATE 2.7/2.8-adjacent — the same human step that
creates the bot (2.7) and places the bot token in Windows Credential Manager
(2.8). Suggested registration (human-run, not scripted here):

```
schtasks /Create /TN "kb-desktop-poll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb\scripts\desktop_poll.ps1" /SC MINUTE /MO 3 /RL LIMITED
```

`/MO 3` sits in the middle of the ~2-5 minute window; adjust between 2 and 5
to trade latency for load once the real bot is live. `/RL LIMITED` — the task
needs no elevated privileges.

**Shared offset.** `desktop_poll.ps1` and `scripts/desktop_dispatch.ps1` both
treat `ledgers/` and `queue/` as coordination writes on branch `ops`: pull
`--rebase origin ops` immediately before touching state, push immediately
after. The Telegram `getUpdates` offset lives at the git-native cursor
`ledgers/approvals/telegram-cursor` (`scripts/telegram_poll.py`,
`ledger.read_cursor`/`write_cursor`). Because every run of either script
starts from a freshly-pulled `ops` and pushes right after, there is only ever
one authoritative cursor value in the repo — never two divergent in-memory
offsets racing each other. This is what makes "sole poller" safe in practice,
not just a documented convention.

**Failure mode this guards against.** `scripts/desktop_dispatch.ps1`'s header
comment records a real incident: bare `python` on this box resolves to a
pip-less msys build with no PyYAML, so the preamble silently crashed while
Task Scheduler still reported success. `desktop_poll.ps1` mirrors that
script's fix exactly — resolve the real py-launcher interpreter once via
`py -c "import sys; print(sys.executable)"`, gate on the preamble's exit code
before any Telegram I/O, and log every exit path loudly to
`%LOCALAPPDATA%\kb-desktop-poll.log`.
