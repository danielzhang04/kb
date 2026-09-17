# kb v1 launch — authority handoff — 2026-09-17

## Context

Production VM `kb` (`100.89.73.118`) is live on `7e09fd4f` after the launch
recovery chain. The launch is now at the authority-and-guardrails completion
gate: PR #202 (`claude/authority-guardrails`, `d36209be` or newer) is merge
pending, followed by a boss production deploy. Daniel ruled on 2026-09-16 that
production uses no passkeys and approved Approach 1 of the authority and
guardrails design.

## What worked (with evidence)

- The VM is live on the chain `29dc9887`, `d0634b75`, `f5b32044`, `5bfef3ad`,
  `1da163a5`, `6b17b248`, `7e09fd4f`; the outbox drained to `origin/ops`
  `4b189177`, whose pre-linearization backup is
  `refs/backup/ops-pre-linearize-2026-09-15`.
- Stale run `run-971d5ba4` is stopped; a real subscription-billed,
  zero-spend `self-lint-report` run succeeded; UI and Terminal were proven.
  The nine agent-owner cadences are disarmed, with the snapshot in rehearsal
  tooling p8.
- Seven production demo canaries isolated and fixed the seven layers in PRs
  #194, #195, #197, #198, #199, #200, and #201. Canary
  `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` reached the real completion gate.
- PR #202 implements all-scope open/signed/none routing, SSH-signed approval
  (`kb-ops-approver`, namespace `kb-human-approval`), `X-KB-Actor`, required
  reason, pinned launch tags, signed budget override, loopback peer-owner proof,
  and hardened session hooks. It has two Opus security reviews, rehearsal p11/p12
  proofs, and 228 tests.

## What did not

- The old passkey channel is not usable: Daniel has no production passkey, by
  his 2026-09-16 ruling. The signed approval path replaces it.
- Legacy runs have no stored tags. Their completion-gate reads must fail closed;
  the response requires a signed approval.

## What remains

1. Daniel merges PR #202; the boss deploys it.
2. On prod, run `approver-signers` (public allowed-signers installation plus
   unit environment line) and `remove-passkey-dropin`, then deploy.
3. Use respond tooling to resolve run
   `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` with a signed approval.
4. Daniel rules on D2.13, tick source, cadence execution profile, `kb-reader`
   SFTP deny, ops linear-history ruleset, and dashboard-ops reset.

## Load list

- `orgs/kb-ops/STATE.md`
- `orgs/kb-ops/GOAL.md`
- `docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md`
- `docs/superpowers/plans/2026-09-16-authority-and-guardrails-plan.md`
- PR #202 (`claude/authority-guardrails`, `d36209be` or newer)
- `C:\Users\danie\kb-rehearsal\tooling\rehearsal` p11/p12 and p8
