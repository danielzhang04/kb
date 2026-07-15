# Heartbeat — kb (the system itself)

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      1. Run: python scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: python scripts/sync_skills.py --check  — on drift, write a wake-me card; do NOT fix silently.
      3. Use the dashboard-generator skill to rewrite dashboards/executive.md and
         dashboards/handover.md.
      4. Append a lessons line to memory/nightly-reviewer.md.
      5. Commit ONLY dashboards/ memory/ queue/ ledgers/ changes to ops and push.
  - name: weekly-audit
    schedule: weekly:sat
    tier: cloud
    risk-tier: T1
    prompt: |
      Inspect the whole system: every declared cadence ran this week (dispatch ledgers) or
      log why not; reconcile grades ledger rows against activity ledger; list gaps and
      improvement proposals as cards in queue/inbox/ (risk-tier T1, unowned is fine —
      note in body they await dispatch); anything requiring human decision goes to
      queue/approvals/ as an approval card.
```
