# Heartbeat — atlas-prep

atlas-prep is a large-context research worker holding to the T2 bar: cloud-tier research
deliverables that always stop at a human gate before anything leaves this project as final.

```yaml
cadences:
  - name: research-draft-gate
    schedule: weekly
    tier: cloud
    agent: dispatcher-cloud
    risk-tier: T2
    prompt: |
      1. Read orgs/atlas-prep/STATE.md and raw/ for the next queued research target.
      2. Research it (read-only: repo reads, web fetch/search of the named target) and
         draft findings into orgs/atlas-prep/output/ marked DRAFT. This is an internal
         working draft only — not a finished or publishable deliverable.
      3. Update orgs/atlas-prep/STATE.md with what was drafted and its current status.
      4. Do NOT publish, send, or notify anything externally, and do not merge to main.
         Write an approval card into queue/approvals/ (risk-tier T2) pointing at the draft
         and STOP — a human reviews and decides what happens to it next.
      Stay entirely inside orgs/atlas-prep/**. No content-producing-for-publication and no
      external side effect beyond read-only research fetches.
```
