# kb-ops — STATE

## Now

The production VM (`kb`, tailnet `100.89.73.118`) is LIVE on release `7e09fd4f`.
Today’s deployed chain is `29dc9887`, `d0634b75`, `f5b32044`, `5bfef3ad`,
`1da163a5`, `6b17b248`, `7e09fd4f`. The outbox drained to `origin/ops`
`4b189177`; ops is linear, with backup ref
`refs/backup/ops-pre-linearize-2026-09-15`. Stale run `run-971d5ba4` is stopped,
the real `self-lint-report` run succeeded, and both UI and Terminal are proven.
Nine agent-owner cadences are disarmed (rehearsal tooling p8 snapshot).

PR #202 (`claude/authority-guardrails`, tip `d36209be` or newer) is merge pending.
It implements the approved authority and guardrails design and has two Opus
security reviews plus rehearsal proofs p11/p12.

## Current gate

Daniel merges PR #202; then the boss deploys it to production.

## Next

1. On prod, run preflight step `approver-signers` to install the public
   allowed-signers file and unit environment line, then run
   `remove-passkey-dropin`.
2. Deploy the merged release.
3. Resolve canary run `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5`’s completion
   gate through the respond tooling using a signed approval. Legacy runs store
   no tags, so the read must fail closed and the signature is required.
4. Daniel rules on the D2.13 amendment in `governance/risk-tiers.md`, schedule
   tick source, agent-cadence execution profile, `sshd` SFTP deny for
   `kb-reader`, linear-history ruleset on ops, and the dashboard-ops worktree
   reset.

## Blocked

The authority-and-guardrails production completion is blocked only on Daniel’s
merge authority for PR #202, then the boss’s deploy. The remaining governance
and operations items await Daniel’s rulings.

## Decisions

- 2026-09-16 — Daniel ruled: no passkeys on production.
- 2026-09-16 — Daniel approved authority and guardrails Approach 1, specified
  in `docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md` and
  planned in `docs/superpowers/plans/2026-09-16-authority-and-guardrails-plan.md`.

## Findings

- Seven production demo canaries each failed at one distinct layer and were
  fixed and deployed in PRs #194, #195, #197, #198, #199, #200, and #201:
  research profile Write permission; fenced-judge JSON; empty
  `resolvedFindingRefs`; $5 cap counting subscription usage; accounting-window
  policy hash; prose-wrapped JSON; and budget-window handling.
- Canary `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` reached the real completion
  gate. Daniel has no passkey registered on production.
- PR #202 gates open/signed/none route classes on every scope, uses the
  `kb-ops-approver` SSH signing key and `kb-human-approval` namespace, audits
  `X-KB-Actor`, requires a reason, pins publish/spend tags at launch, supports a
  signed budget override, adds loopback peer-owner proof for win32-desktop, and
  hardens the session hook (228 tests).
