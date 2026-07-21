# Proposal: weekly-audit reports the stranded auto-archive count

**Status:** proposal (HEARTBEAT.md is human-curated — not edited by this change)
**Date:** 2026-07-21
**Related:** stranded-card auto-archiver (`dashboard/server/write/strandedArchiver.ts`,
`scripts/stranded_report.py`), approved design 2026-07-21.

## Context

The daemon stranded-archiver now MOVES abandoned cards (owner a real agent, idle >24h in
inbox/working, owner runner offline) into `queue/archived/` instead of surfacing them in the
Human Inbox or the morning brief. Both the daily brief and the dashboard projection are now
QUIET on stranded cards. So that auto-archiving stays visible to a human on a slower cadence,
the **weekly-audit** cadence should report how many cards were archived in the period.

There is no code seam into weekly-audit — it is a PROMPT executed by `dispatcher-cloud`. The
count is produced by a small helper instead:

```
py -3 scripts/stranded_report.py            # trailing 7 days, ending now
py -3 scripts/stranded_report.py --days 7   # explicit window
```

It prints `N card(s) auto-archived as stranded in the last 7 day(s).` followed by one line per
archived card (id, action -> target, owner, archive timestamp), parsed from each archived
card's `## Result` marker.

## Proposed one-line prompt addition (for a human to apply to HEARTBEAT.md `weekly-audit`)

Add to the `weekly-audit` cadence prompt:

> Run `py -3 scripts/stranded_report.py` and include its output — the count and list of cards
> auto-archived as stranded this week — in the audit. Reversible: a card wrongly archived is
> reopened by moving it from `queue/archived/` back to `queue/inbox/`.

## Why not edit HEARTBEAT.md directly

Per repo convention HEARTBEAT.md cadence prompts are human-curated; this note leaves the exact
wording and timing to Daniel. The helper and its tests ship now; the prompt line is the only
remaining human step.
