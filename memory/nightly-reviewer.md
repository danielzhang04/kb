# memory: nightly-reviewer

## 2026-07-15
- Nightly-review card `6a581e05-36cf29da` executed after human approval (cloud dispatcher
  had escalated it to approvals/ under v1's blanket-supervised policy). preamble OK;
  `sync_skills.py --check` exit 0, no drift. Regenerated dashboards/executive.md and
  dashboards/handover.md in full from live state.
- Executed by the desktop fallback (`dispatcher-desktop-fallback`) because the cloud
  routine could not reach the repo — the review work order is executor-agnostic; any
  approved owner can run it once `approvals.approved_by_human` returns (True, 'ok').
- Lesson: dashboard content must be sourced live, never carried over — queue counts from
  the queue/ dirs, spend from the cost ledger vs governance/budget.yaml, project lines
  from each orgs/*/STATE.md "Now". This run: everything empty/idle, $0.00 of $5.00 used.
