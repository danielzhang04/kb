# Heartbeat — kb-ops

kb-ops's job is the fastest safe path to first real T1 grades: small, low-risk, self-contained
self-ops work the desktop tier can run unattended and an Inspector can cleanly score.

```yaml
cadences:
  - name: self-lint-report
    schedule: daily
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Read orgs/kb-ops/STATE.md and raw/ for anything new to file.
      2. Run `py -3 -m pytest tests -q` from the repo root as a repo-health lint check;
         note the pass/fail counts.
      3. File any new raw/ items into wiki/.
      4. Write a dated report into orgs/kb-ops/output/ marked DRAFT summarizing the test
         run and anything filed.
      5. Update orgs/kb-ops/STATE.md with what ran, the result, and what's next.
      Stay entirely inside orgs/kb-ops/**. No content-producing or publishing action, no
      external side effect, nothing outside this project's tree.
```
