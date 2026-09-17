# kb-ops — GOAL

_Refreshed: 2026-09-17_

## North star

Operate a working, iterable, consistent agent platform that is easier and
cleaner for Daniel: agents can run visibly in the dashboard and Terminal while
the platform keeps consequential authority with Daniel and fails closed at
guardrail boundaries.

## Success conditions

- Production remains healthy on the deployed launch chain: outbox drained,
  stale run stopped, a real `self-lint-report` succeeds, and UI and Terminal
  work end to end.
- The approved authority-and-guardrails design lands and is deployed: route
  classes are enforced on every scope; signed human approval and audit are
  available; launch-time publish/spend tags are pinned; and desktop/session
  controls fail closed.
- The real completion gate can be resolved with the new signed approval
  channel, without a production passkey.
- Remaining operational and governance decisions are recorded by Daniel:
  D2.13, schedule tick source, agent-cadence execution profile, `kb-reader`
  SFTP deny, ops linear-history ruleset, and dashboard-ops reset.

## Invariants

- Daniel is the only merge authority; no branch-tip deploys.
- No passkeys are registered or required on production (Daniel’s 2026-09-16
  ruling).
- Human approvals use the approved SSH-signed channel and must include the
  required actor and reason evidence; missing legacy tags fail closed.
- A release changing a frozen unit contract installs its resident validator
  before activation.
- Every deploy follows the converged ship process: probe, review, build and
  tests, adversarial review, Daniel merge, rebuild from the protected branch,
  then deploy.
- `queue/`-touching cadences and any diff over 400 lines require Daniel’s
  queue-for-me approval.

## Governing docs

- `orgs/kb-ops/_index.md`, `contract.md`, and `STATE.md`
- `docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md`
- `docs/superpowers/plans/2026-09-16-authority-and-guardrails-plan.md`
- PR #202, `claude/authority-guardrails`
