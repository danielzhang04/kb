# memory: dispatcher-desktop-fallback

## 2026-07-15
- Acted as desktop-tier fallback executor for the kb nightly routine (cloud could not
  reach the repo). Completed nightly.md steps 4/4b/5/6 for one human-approved card,
  `6a581e05-36cf29da` (kb / cadence:nightly-review / T1).
- Gate first, always: `approvals.approved_by_human(...)` returned (True, 'ok') — proceeded.
  On anything but (True, 'ok') the standing order is STOP + wake-me card, never execute.
- Ran preamble (OK) and `sync_skills.py --check` (exit 0, clean); regenerated both
  dashboards from live repo state per the dashboard-generator skill; appended `## Result`
  to the card and transitioned approved -> done via cards.transition (moved to queue/done/).
- Lessons: (1) `scripts/cards.py` LEGAL allows approved -> done directly and save() handles
  the dir move — no manual file juggling. (2) `ledger.append` keys off the machine's LOCAL
  date; here local civil date is 2026-07-15 though UTC had just ticked to 2026-07-16, so my
  cost shards landed under 2026-07-15 — expected, not a bug. (3) Stage the four coordination
  path prefixes explicitly (queue/ ledgers/ memory/ dashboards/); never `git add -A` (hook-banned).
