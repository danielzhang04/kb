# kb-ops — STATE

## Now

The production VM (`kb`, tailnet `100.89.73.118`) is LIVE on release `e8ac49ad`
(PR #203 rulings batch merged 2026-09-21 to `fc750a46`; PR #204 collector
`claude/tick-baseline`, 4cb7748c, merged 2026-09-23 to `e8ac49ad`; deployed to
prod 2026-09-23 05:55Z, backup `/root/pre-fix-20260923T055529Z`, previous
`8f71173e`). Release: daemon-internal schedule tick (every 5 min, outbox mode,
before/after status snapshot, dirty-checkout skip); `cadence` execution
profile + allowlist for agent-owner cadences; bridge admits `cadence:<agent>`
cards and stops retrying structural refusals; `nextAt` advances on
card-saved; `archiveRun` refuses open human requests unless forced; kb-reader
sshd `Match`/`ForceCommand` block with reader-shell `SSH_ORIGINAL_COMMAND`
fix (F4); prod-window guard hook rehearsal-only waiver (A-1), D10 metachar
block, O4 archive shape content-pinned, drain rehearsal `-WslDistro` shapes.

Live tick proof 2026-09-23: first tick `due=0 dispatched=0 paths=1
committed=5e9a5c0b` clean checkout; schedule `67340ae3` (self-lint-report,
cron `18 2 * * *` ET) claimed by the 06:20Z tick (`due=1 dispatched=1 paths=2
committed=4bb05d95`), run `run-e3860b76-...` succeeded/ok 06:24:46Z, checkout
clean at `0a2fa755`. Daily drain 2026-09-22: 19 bundles promoted
(`bd803ef7` → `8865a57f`); a governance path the boss had cherry-picked onto
ops was refused by VM apply and reverted (`052c8355`); resumed via
`promote_vm_outbox --reconcile-only`. Ops linear; next drain chain base
`052c8355`. Rehearsal passes p13 (tip `25778d50`) and p14 (tip `4cb7748c`)
evidence in `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p13\evidence.md`
and `p14\evidence.md`.

Three cards closed this pass (`queue/done/`): `2c3d4e5f-708192a3` (tick
source), `3d4e5f60-8192a3b4` (cadence execution profile — ruling+code done,
re-arm blocked by new finding), `4e5f6071-92a3b4c5` (sshd SFTP deny).

## Current gate

None for the deploy. Daniel owns the rulings in `## Next` items 1 and 3.

## Next

1. Four new findings cards filed 2026-09-23 in `queue/inbox/`:
   `202b9025-5ac106e7` (T2 — agent-owner cadence target-synthesis mismatch,
   blocks re-arming the nine disarmed cadences), `3ad32939-41ae8728` (T2 —
   `nextAt` boot backfill for pre-fix `card-saved` rows), `c14ef64c-a4bce73c`
   (T2 — drain rehearsal `-ChainBase`/4417-proxy gap + completion-gate
   rejection missing `gateKind`, stuck `run-cdae7121` on prod), and
   `0139c14e-5bb7dc47` (T3, human — archive 4 dead canaries, rule on schedule
   `67340ae3`).
2. Daniel gates owed: live test 3 (signed budget override, one signed line);
   browser dashboard + Terminal check on `e8ac49ad`; delete
   `governance/webauthn-credentials.yaml` on main; `claude/v1-desktop-u12`
   (PR #186) keep-or-drop. Done 2026-09-17/22: patch-settings re-run, PR #196
   closed, PR #193 merged, ops linear-history ruleset, dashboard-ops reset,
   D2.13 pasted on main.
3. `run-4113b3b2` and `run-bb9b3a00` were archived by Daniel in the UI on
   2026-09-17; only the four named in `0139c14e-5bb7dc47` remain.
4. Residual LOW/MEDIUM review items remain as cards in `queue/inbox/` (14
   filed 2026-09-17).

## Blocked

Re-arming the nine disarmed agent-owner cadences is blocked on
`202b9025-5ac106e7` (target-synthesis mismatch). `run-cdae7121` is stuck
`waiting-human` pending `c14ef64c-a4bce73c`. Nothing else platform-side;
remaining items await Daniel's rulings.

## Decisions

- 2026-09-16 — no passkeys on production; authority/guardrails Approach 1
  approved.
- 2026-09-17 — `workflowTags` excluded from the launch fingerprint (N1,
  `012a14ca`); subagent dispatches default sonnet/haiku unless
  security-critical (opus).
- 2026-09-21 — Boss amendment to ruling 2: tick source = daemon-internal, not
  a systemd timer, because only the daemon can commit into the ops checkout.
- 2026-09-22 — Daniel: "one branch, one merge" — no per-fix PRs; boss tests
  and rehearses locally, one merge Daniel reviews, never auto-merge.
- 2026-09-22 — Daniel accepted rulings 2/3/4 and pasted D2.13 on main
  (governance stays off ops: reconciler allowlist only, never a direct or
  cherry-picked write — see the drain incident in `## Now`).

## Findings

- Seven production demo canaries (pre-launch) were fixed across PRs #194–201;
  lesson: one real-model pass per workflow before "launch-ready".
- v1 acceptance canary `run-cc508ddb` closed the launch arc (signed approval,
  succeeded/ok, digest 200/tamper 404) — see PR #202.
- 2026-09-23 findings, each filed as its own card (see `## Next` item 1):
  agent-owner cadence target-synthesis mismatch (F8-adjacent);
  prospective-only `nextAt` advance leaves pre-fix rows noisy forever (F11);
  drain rehearsal `-ChainBase`/proxy gap and completion-gate-rejection
  `gateKind` gap sticking runs in `waiting-human` (F13/F14); four dead canary
  interventions need human archiving (T3).
- Reusable lessons from this pass are in `memory/claude-boss.md` under
  "2026-09-22/23 — rulings batch" (tick untracked-file check, one-branch-one-
  merge, governance-off-ops after the cherry-pick incident, F4 self-
  ForceCommand, F14 gateKind, F11 ship-backfill-with-the-fix, F8-adjacent
  joint-contract testing).
