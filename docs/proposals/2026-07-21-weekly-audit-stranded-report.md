# Proposal: weekly-audit reports the stranded auto-archive count

**Status:** proposal (HEARTBEAT.md is human-curated — not edited by this change)
**Date:** 2026-07-21
**Related:** stranded-card auto-archiver (`dashboard/server/write/strandedArchiver.ts`,
`scripts/stranded_report.py`), approved design 2026-07-21.

## Context

The daemon stranded-archiver (v2) identifies abandoned cards — owner a REAL agent, and BOTH the
card AND its owner idle in inbox/working past the stranded window (default **7 days**) — and, in
its eventual live mode, MOVES them into `queue/archived/`. **This PR ships the archiver DRY-RUN-ONLY
and DEFAULT-OFF: it reports what it WOULD archive and moves nothing.** The Human Inbox and the
morning brief **remain surfacing `stranded` cards** — those surfaces are intentionally KEPT until
dry-run proves the archiver picks the right cards (redesign §3d Q6). Once live archiving is enabled
and proven, this weekly-audit report keeps auto-archiving visible to a human on a slower cadence.
Until then it will simply report 0 (nothing is archived while dry-run).

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
