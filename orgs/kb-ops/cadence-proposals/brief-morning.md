# Cadence proposal — `brief-morning` (AGENT-GENERATED)

> **AGENT-GENERATED, NOT INSTALLED.** Written by the fleet-arc Wave A build. This is a
> *proposal only*: no `HEARTBEAT.md` has been edited and no card has been created in `queue/`.
> Installing a cadence is a coordination write a human/dispatcher performs on the `ops` branch.
> Per `orgs/kb-ops/contract.md`, the first unattended run stays **supervised** (a human watches
> the run, verifies the artifact + ledger rows) before any recurring schedule is enabled.

## What it does

Renders `dashboards/brief-YYYY-MM-DD.md` each morning from live repo state (overnight ledger
activity, pending approvals + wake-me cards, deferral flags, one #1 win) via the deterministic,
LLM-free `scripts/brief.py`, then composes and (supervised) sends a <=400-char Telegram summary via
`scripts/brief_notify.py`. Both scripts run the shared preamble first (STOP-file supremacy) and
degrade gracefully — the calendar/inbox tiers render as "unavailable — Google gates pending" until
G1/G2 clear.

## Cadence block to add under `orgs/kb-ops/HEARTBEAT.md` `cadences:`

```yaml
  - name: brief-morning
    schedule: daily
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run `py -3 scripts/preamble.py` — if it fails (STOP file / budget / API key),
         stop immediately and do nothing else this beat.
      2. Run `py -3 scripts/brief.py --date <today>` to write dashboards/brief-<today>.md.
      3. Run `py -3 scripts/brief_notify.py --date <today> --send` to push the <=400-char
         summary over Telegram. --send only proceeds when the desktop launcher has injected
         KB_TELEGRAM_BOT_TOKEN (and KB_TELEGRAM_CHAT_ID); it never reads Credential Manager
         itself. Without the launcher env, it refuses to send (exit 1) — that is expected off
         the launcher.
      4. Commit ONLY dashboards/ changes to ops and push.
      Stay entirely inside dashboards/ (plus the ledgers/queue reads the renderers perform).
      No card mutation (brief.py and brief_notify.py never write queue/); no external side
      effect beyond the single supervised Telegram send.
```

## Supervised-first activation (human/dispatcher, on `ops`)

1. Human runs the three commands above by hand once, watches the output, and confirms
   `dashboards/brief-<today>.md` + the Telegram summary look right.
2. The FIRST Telegram send is human-supervised via the desktop launcher pattern
   (`scripts/desktop_poll.ps1` token custody); poller/task registration stays a human gate.
3. Only after a clean supervised run does a human add the block above to `HEARTBEAT.md` on `ops`
   to enable the recurring schedule. No agent enables its own schedule.
