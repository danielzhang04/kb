---
id: 6a65a3cd-dabf5d57
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: 2a5b70c57ebd3c29
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

Executed by dispatcher-cloud (cloud self-exec) 2026-07-26 06:07 UTC. All steps clean.
1. `preamble.py` → PREAMBLE OK.
2. `sync_skills.py --check` → clean (exit 0), no drift. Also ran `sync_daemon_dirs.py --check`
   from the origin/main copy (script absent on ops) → clean, ops matches main for all
   daemon-read dirs.
3. Rewrote `dashboards/executive.md` and `dashboards/handover.md` in full from live queue,
   ledger, and orgs/*/STATE.md state.
4. Appended a lessons line to `memory/dispatcher-cloud.md`.
5. Logged the cost step to today's ledger; committed coordination paths to ops.

No new wake-me card filed: the recurring `sync_daemon_dirs.py`-missing-on-ops gap is already
tracked by `6a605ebb-d86dff79`, and today's daemon-dir check came back clean.
