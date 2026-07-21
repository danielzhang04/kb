# Heartbeat — kb (the system itself)

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    agent: dispatcher-cloud
    risk-tier: T1
    prompt: |
      1. Run: python scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: python scripts/sync_skills.py --check  — on drift, write a wake-me card; do NOT fix silently.
      3. Use the dashboard-generator skill to rewrite dashboards/executive.md and
         dashboards/handover.md.
      4. Append a lessons line to your own memory shard memory/<agent-id>.md
      5. Commit ONLY dashboards/ memory/ queue/ ledgers/ changes to ops and push.
  - name: weekly-audit
    schedule: weekly:sat
    tier: cloud
    agent: dispatcher-cloud
    risk-tier: T1
    prompt: |
      Inspect the whole system: every declared cadence ran this week (dispatch ledgers) or
      log why not; reconcile grades ledger rows against activity ledger; list gaps and
      improvement proposals as cards in queue/inbox/ (risk-tier T1, unowned is fine —
      note in body they await dispatch); anything requiring human decision goes to
      queue/approvals/ as an approval card.
  - name: grades-reconcile
    schedule: weekly:sat
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: py -3 scripts/reconcile.py --tier desktop
      3. If reconcile exits non-zero, it FROZE the loop: it already wrote
         ledgers/grades/FROZEN with the quarantine reason and filed a T1 wake-me card
         into queue/inbox/. Do not re-run it and do not clear the sentinel by hand —
         confirm the wake-me card exists, then stop.
      4. If reconcile exits 0 ("reconcile: clean"), append a lessons line to
         memory/<agent-id>.md noting the clean run, then commit ONLY ledgers/ queue/
         memory/ changes to ops and push.
  - name: branch-hygiene
    schedule: weekly:sun
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: py -3 scripts/branch_hygiene.py
      3. Exit 1 is NOT a failure: the run finished and found something a human must
         decide, and it already filed the wake-me card. Confirm the card exists, then
         stop — do not retry and do not delete anything by hand.
      4. Exit 2 means it could not run at all and filed no card; put the stderr text
         into a wake-me card yourself.
      5. On exit 0, append a lessons line to memory/<agent-id>.md, then commit ONLY
         memory/ queue/ ledgers/ changes to ops and push.
      Tier is desktop, not cloud, because worktrees exist only on the desktop machine.
      This cadence deletes a branch ONLY when git proves every one of its commits is
      already reachable from origin/main; unmerged branches are reported, never touched.
```
