---
id: 6ad06fbb-5c83ba4e
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: ced83eedf03b107c
state: done
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: claude
model: claude-sonnet-5
autonomy: acts-alone
assurance_class: acts-alone
---

## Work order

1. Run: python scripts/preamble.py  — if it fails, stop and write a wake-me card
   into queue/inbox/ explaining why.
2. Run: python scripts/sync_skills.py --check  — on drift, write a wake-me card; do NOT fix silently.
3. Use the dashboard-generator skill to rewrite dashboards/executive.md and
   dashboards/handover.md.
4. Append a lessons line to your own memory shard memory/<agent-id>.md
5. Commit ONLY dashboards/ memory/ queue/ ledgers/ changes to ops and push.

## Result

Executed 2026-10-15 by dispatcher-cloud (Opus 4.8), self-executing this acts-alone cadence.

1. **preamble.py** — OK (both main checkout and the ops worktree).
2. **sync_skills.py --check** — clean, EXIT 0 (in sync). No drift → no wake card needed.
3. **Dashboards** — rewrote `dashboards/executive.md` and `dashboards/handover.md` in full from
   live ops state (120 inbox / 3 working / 2 approvals / 1678 done; budget $0.00/$30.00, all
   subscription-billed; 5 org STATE "Now" summaries; 2 latest handoffs). Restored the
   "## Latest handoffs" section that handover.md had been missing.
4. **Memory** — appended the 2026-10-15 lesson block to `memory/dispatcher-cloud.md` (durable
   worktree-vs-blocked-checkout lesson + dedup/drift status).
5. **Commit** — coordination paths committed to `ops`; push path reported in the run summary.

Daemon-dir drift (routine step 2b, reports-only): UNCHANGED from 2026-10-14 — single ops-only
`orgs/kb-ops/workflows/acceptance-run.md`; `scripts/sync_daemon_dirs.py` still absent on ops (ran
main copy in refs-fallback). Per the standing dedup decision, refreshed canonical card `6a605ebb`
in place (9th consecutive recorded unchanged night); did NOT file a dated duplicate. Human fix
remains bundled in open approval `6ab76543`.
