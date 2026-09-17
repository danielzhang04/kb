# kb-ops — STATE

## Now

The production VM (`kb`, tailnet `100.89.73.118`) is LIVE on release `8f71173e`
(main after PR #202 merged 2026-09-17, deployed 23:01Z under the prod-window
guard; `previous` = `7e09fd4f`, backup `/root/pre-fix-20260917T230126Z`).
Authority and guardrails are in force: no passkeys, open|signed|none route
classes on every scope, SSH-signed human approvals (`kb-ops-approver`, namespace
`kb-human-approval`, allowed-signers installed at
`/usr/local/lib/kb/kb-ops-approver.allowed-signers`, passkey drop-in removed),
`X-KB-Actor` audit with a required reason, publish/spend tags pinned at launch.

The v1 acceptance canary `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` completed on
the new release: its legacy completion gate was resolved with a signed approval
by Daniel (HTTP 200, `resolvedBy.actor=daniel`), the run reached
`succeeded / ok`, and `brief.json` served 200 by digest with a matching sha256
while a tampered digest returned 404. The v1 launch arc is closed.

The outbox is drained to `origin/ops` (linear). Nine agent-owner cadences remain
disarmed (rehearsal tooling p8 snapshot); the workflow schedule `96db76e4` is
armed but nothing ticks it on the VM.

## Current gate

None for the launch. Daniel owns the rulings in `## Next`.

## Next

1. Daniel rules (cards filed in `queue/inbox/` 2026-09-17): `governance/risk-tiers.md`
   D2.13 amendment; schedule tick source; agent-cadence execution profile;
   `sshd` SFTP deny for `kb-reader`; linear-history ruleset on ops; the
   dashboard-ops worktree reset.
2. Daniel re-runs `python C:\Users\danie\kb-rehearsal\tooling\patch-settings-prod-window.py`
   so the session hook also gates Write/Edit on the window file (review 2, N4),
   and closes PR #196 (its hook copy shipped inside #202) and rules on PR #193.
3. Archive the dead canary runs `run-1328b419`, `run-4113b3b2`, `run-efad83df`,
   `run-8bd8eeb9`, `run-4b3867de`, `run-bb9b3a00` (delete-class, human only).
4. Sweep `queue/` for any pre-deploy `queue-bridge:` card whose run exists; N1 is
   fixed (`012a14ca`) so replays now reconcile, but a card that failed before the
   deploy may need one re-dispatch.
5. Residual LOW/MEDIUM review items are cards in `queue/inbox/` (14 filed
   2026-09-17).

## Blocked

Nothing platform-side. Governance and operations items await Daniel’s rulings.

## Decisions

- 2026-09-16 — Daniel ruled: no passkeys on production.
- 2026-09-16 — Daniel approved authority and guardrails Approach 1, specified
  in `docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md` and
  planned in `docs/superpowers/plans/2026-09-16-authority-and-guardrails-plan.md`.
- 2026-09-17 — Boss ruling: `workflowTags` are not part of the launch
  fingerprint (derived from `owner`, which is fingerprinted), so legacy
  idempotency keys replay 200 instead of 409 (N1, `012a14ca`).
- 2026-09-17 — Daniel: subagent dispatches run on sonnet/haiku unless a
  security-critical review demands opus.

## Findings

- Seven production demo canaries each failed at one distinct layer and were
  fixed and deployed in PRs #194, #195, #197, #198, #199, #200, and #201:
  research profile Write permission; fenced-judge JSON; empty
  `resolvedFindingRefs`; $5 cap counting subscription usage; accounting-window
  policy hash; prose-wrapped JSON; and budget-window handling. Lesson: one
  real-model pass per workflow before "launch-ready"; the stub masks all three.
- Final rehearsal pass p12 (opus, `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p12\evidence.md`)
  proved the exact 403 → sign → 200 sequence on a legacy-shaped run, a clean
  Linux gate (3044 vitest, 2285 pytest), and found N1's first fix was dead code
  behind a store-only test. Lesson: a reviewer's "fixed" needs a production-path
  test.
- Non-descriptive `-Topic` values make the demo researchers answer BLOCKED;
  always pass a subject-like topic.
- The auto-mode classifier refuses some hook-allowlisted prod shapes
  nondeterministically (window open, park, signed respond); Daniel ran the
  signed respond by hand with the `!` prefix in Git Bash form.
- PR #202 gates open/signed/none route classes on every scope, uses the
  `kb-ops-approver` SSH signing key and `kb-human-approval` namespace, audits
  `X-KB-Actor`, requires a reason, pins publish/spend tags at launch, supports a
  signed budget override, adds loopback peer-owner proof for win32-desktop, and
  hardens the session hook (228 tests).
