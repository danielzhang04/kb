---
id: 6aa39cda-caa9a023
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: 1bc802f87e86f886
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

Executed by dispatcher-cloud (self-executing cloud carve-out), 2026-09-11 ~06:19 UTC.
1. preamble.py — PASS.
2. sync_skills.py --check — clean (exit 0), no skills drift.
3. dashboard-generator skill — dashboards/executive.md and dashboards/handover.md
   rewritten in full from live queue/ledger/STATE state.
4. Appended a lessons line to memory/dispatcher-cloud.md (queue_root gotcha, daemon-dir
   drift, malformed figment card).
5. Coordination paths (dashboards/ memory/ queue/ ledgers/) committed to ops and pushed.
Separately, per routines/nightly.md step 2b, filed
queue/inbox/wake-daniel-2026-09-11-sync-daemon-dirs-drift.md (daemon-dir checker still
absent on ops; single ops-only file drift via refs-fallback).
