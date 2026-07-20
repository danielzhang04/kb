# Cadence proposal — `rollup-eod` (AGENT-GENERATED)

> **AGENT-GENERATED, NOT INSTALLED.** Written by the fleet-arc Wave A build. This is a
> *proposal only*: no `HEARTBEAT.md` has been edited and no card has been created in `queue/`.
> Installing a cadence is a coordination write a human/dispatcher performs on the `ops` branch.
> Per `orgs/kb-ops/contract.md`, the first unattended run stays **supervised** before any
> recurring schedule is enabled.

## What it does

Renders `dashboards/rollup-YYYY-MM-DD.md` at end of day from live repo state: today's completions
(`queue/done` mtimes cross-referenced with the day's grade rows), unfinished `working`/`inbox` cards
with their `deferred_count`, cards at 3+ deferrals flagged prominently, and a PROPOSALS section
("re-queue X", "archive Y"). The renderer (`scripts/rollup.py`) is **propose-only**: it NEVER mutates
a card and never re-queues on its own authority — a human or the dispatcher acts on the proposals.
It runs the shared preamble first (STOP-file supremacy).

## Cadence block to add under `orgs/kb-ops/HEARTBEAT.md` `cadences:`

```yaml
  - name: rollup-eod
    schedule: daily
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run `py -3 scripts/preamble.py` — if it fails (STOP file / budget / API key),
         stop immediately and do nothing else this beat.
      2. Run `py -3 scripts/rollup.py --date <today>` to write dashboards/rollup-<today>.md.
      3. Read the PROPOSALS section. This rollup only PROPOSES (re-queue / archive); it does
         not act. Any re-queue is a separate, human-or-dispatcher decision — the deferral
         counter is bumped by the dispatcher via rollup.increment_deferral only when it
         actually re-queues, never by this cadence.
      4. Commit ONLY dashboards/ changes to ops and push.
      Stay entirely inside dashboards/ (plus the ledgers/queue reads the renderer performs).
      No card mutation; no external side effect.
```

## Supervised-first activation (human/dispatcher, on `ops`)

1. Human runs `py -3 scripts/rollup.py --date <today>` by hand once, watches the output, and
   confirms `dashboards/rollup-<today>.md` (completions / unfinished / 3+-deferral flags /
   proposals) looks right.
2. Only after a clean supervised run does a human add the block above to `HEARTBEAT.md` on `ops`
   to enable the recurring schedule. No agent enables its own schedule, and no proposal in the
   rollup is auto-executed.
