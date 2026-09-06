---
id: 6a9d02da-7de01dbe
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: f327af86cb939c30
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
state-history:
  - working: dispatcher-cloud 2026-09-06 (nightly cloud run)
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

Executed by dispatcher-cloud, nightly cloud run 2026-09-06 06:08 UTC. All 5 steps done:
1. `python scripts/preamble.py` → PREAMBLE OK (exit 0).
2. `python scripts/sync_skills.py --check` → clean, no drift (exit 0, no output).
3. dashboard-generator skill: rewrote dashboards/executive.md and dashboards/handover.md
   in full from live queue/ledger/STATE state.
4. Appended lessons line to memory/dispatcher-cloud.md.
5. Cost rows logged; committing coordination paths to ops (see run summary for push path).

Daemon-dir gate (routine step 2b): sync_daemon_dirs.py absent from ops; ran main's copy in
refs-fallback mode → drift unchanged (single ops-only orgs/kb-ops/workflows/acceptance-run.md).
Per standing hard rule, NOT re-carded (umbrellas 6a605ebb + 6a7c0ebf already open); reported
in dashboards. No cards emitted by the dispatcher beyond this one. No queues-for-me actions
triggered; no approvals to verify (figment GATE A 65d8f246 remains parked, unowned, for human).
