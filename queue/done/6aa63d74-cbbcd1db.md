---
id: 6aa63d74-cbbcd1db
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: cd97dd7c34dcb000
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

Executed by dispatcher-cloud (cloud self-executing carve-out; routed model claude-sonnet-5,
ran on claude-opus-4-8) on 2026-09-13 06:08 UTC.

1. `python scripts/preamble.py` -> PREAMBLE OK (exit 0).
2. `python scripts/sync_skills.py --check` -> clean (exit 0), no drift.
3. Regenerated `dashboards/executive.md` and `dashboards/handover.md` in full via the
   dashboard-generator skill from live state (queue counts, today+yesterday ledgers, all
   orgs/*/STATE.md ## Now sections).
4. Appended tonight's lessons to `memory/dispatcher-cloud.md`.
5. Committed dashboards/ + memory/ + queue/ + ledgers/ to ops and pushed (see run summary).

Health: preamble OK; sync_skills in sync; daemon-dir gate reported drift in refs-fallback
mode (sync_daemon_dirs.py absent from ops; lone ops-only orgs/kb-ops/workflows/acceptance-run.md)
and CONTINUED per routine step 2b — recorded in wake-daniel-2026-09-13-sync-daemon-dirs-drift.
Cost this run: $0.00 (subscription).

