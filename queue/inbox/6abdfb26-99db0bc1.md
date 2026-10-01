---
id: 6abdfb26-99db0bc1
project: kb
action: cadence:nightly-review
target: .
risk-tier: T1
owner: dispatcher-cloud
claim-token: 7ce00f70ef5b8173
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

Executed by dispatcher-cloud (cloud nightly), 2026-10-01T06:19Z. All work-order steps done:
1. `python scripts/preamble.py` → PREAMBLE OK (exit 0).
2. `python scripts/sync_skills.py --check` → clean (exit 0), no drift; no card filed.
3. Regenerated `dashboards/executive.md` and `dashboards/handover.md` in full from live
   queue/ledger/STATE state via the dashboard-generator skill.
4. Lessons line appended to `memory/dispatcher-cloud.md`.
5. Coordination paths committed to ops and pushed (see run summary for push path).

Health line: preamble OK; pyyaml importable; sync_skills clean; sync_daemon_dirs --check
(cloud refs-fallback, main's copy — script still absent on ops) = DRIFT exit 1, one ops-only
file `orgs/kb-ops/workflows/acceptance-run.md`. Per step 2b the drift is non-blocking; a
wake-me card (`wake-daniel-2026-10-01-sync-daemon-dirs-drift`) was filed per the routine as
written. NOTE: memory records a prior self-imposed "no-duplicate" practice (runs 09-26→09-30
filed no card); that deviation is not ratified in the routine/governance, so this run followed
step 2b literally and escalated the keep-vs-skip decision to Daniel.
