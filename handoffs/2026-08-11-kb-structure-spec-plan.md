# kb-structure spec + Phase I plan handoff — 2026-08-12 (plan review-clean, execution not started)

**Topic:** kb-structure arc. Design + 3 rulings LOCKED; spec + Phase I plan complete and reviewed.
Two 2026-08-12 rulings applied. Plan is review-clean on branch `claude/boss-2026-08-11c` (tip
2d327e4). **PR #118 is DRAFT (deliberately not merging)** — Daniel's sequence: merge PR #117
(workflow-platform) first, then an EXECUTION TERMINAL runs the plan end-to-end (does the deferred
post-merge spec pass + surfaces defects execution finds), and the execution-validated plan lands
on main via that work — NOT by merging this un-run plan doc. The plan on this branch is the pickup
point. Gate artifact: https://claude.ai/code/artifact/e61e4e55-e65c-43b6-8438-7735bf04afb8

### Rulings (all binding)
- Design (2026-08-11): (1) phased monorepo/state-first, platform/data split ABANDONED; (2) desktop
  promotion + VM outbox, NO GitHub credential on VM; (3) media post-cutover, two-gate cutover.
- Plan (2026-08-12): (1) NO persistent secret on the VM even a local one — restart canary re-auths
  via durable-file observation + human passkey; HMAC session mechanism DELETED with enforcement
  tests (resolves finding m3). (2) DEFER merge-dependent execution-plane tasks behind the
  workflow-platform checkpoint rather than specify against moving contracts.

### THE ONE OPEN THREAD (owed, not blocked-on-Daniel)
**Post-merge specification pass for the deferred sub-plan.** When PR #117 (workflow-platform)
merges to main, Tasks 9, 21, 23, 24, 25 become a MECHANICAL specification pass — their acceptance
criteria + files-to-reread are already written in the plan's `## DEFERRED` section. Per the
2026-08-12 memory index, #117's P0 is COMPLETE and it awaits Daniel's merge, so this may unblock
soon. Whoever resumes: after #117 lands on main, rebase this branch, do the deferred pass against
the real merged contracts (`executeApprovedLaunch` returns runRef AFTER runAutomatic starts;
bridge `sourceTurnId` = synthesized def id, not card id; real lock is synchronous
`ExecutionLatch.lock` at activation.ts:598), re-review, PR.

### What WORKED (with evidence)
- Ship-now plan (Tasks 1–8, 10–20, 22) review-clean: re-review #2 = FIX-THEN-COMMIT (both rulings
  PASS, no regressions, scope clean), last gap (Task 13 restore validators prose→code) fixed and
  boss-verified (6 helper `def`s + per-helper failure tests). Committed 2d327e4, PR #118.
- Full review trail banked in `docs/superpowers/specs/2026-08-11-kb-structure-evidence/`
  (plan-adversarial-findings-r1.md + plan-adversarial-review.md alongside the 6 design reports).
- Ruling-1 removal enforced IN-PLAN: tests assert `session.env` absent + `DASHBOARD_SESSION_SECRET`/
  `KB_CANARY_SESSION` unset + systemd `UnsetEnvironment=`; `auth/session.ts` keeps process-local
  `randomBytes(32)` so restarts invalidate sessions (verified in real code).

### What Did NOT Work (and why) — lessons for the resumer
- A KILLED worker leaves a plausible-but-hollow artifact (the first fix's 946 insertions looked
  complete; re-review found B3/B5 prose-only + compile breakage). Always re-review a killed
  worker's output; never commit-then-trust.
- claude Agent path was infra-flaky this session (2 opus reviewers died: API error, 600s stall).
  codex ran every worker with zero infra deaths. When claude Agents die repeatedly, move the role
  to a codex worker (cold session = still independent of the fixer).
- A checkpointing reviewer must NOT use `--sandbox read-only` (blocks its own checkpoint writes);
  confine via `--cwd` on default workspace-write instead.
- Fully TDD-specifying execution-plane code against an UNMERGED dependency is fighting a moving
  target — that's what the RE-RUN charged us for; defer + gate instead.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/superpowers/specs/2026-08-11-kb-structure-design.md` | DONE | c521d20; rulings locked |
| `.../2026-08-11-kb-structure-evidence/*` (8 files) | DONE | design + plan review trail |
| `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` | SHIP-NOW clean / DEFER gated | 2d327e4; ship-now Tasks 1–8,10–20,22 review-clean; DEFER 9,21,23,24,25 |
| PR #118 → main | OPEN | awaits Daniel merge |
| branch `claude/boss-2026-08-11c` | PUSHED | worktree `kb-worktrees/boss-2026-08-11c` KEEP until #118 merges |

### Exact Next Step
1. Daniel merges PR #117 (workflow-platform). 2. An EXECUTION TERMINAL picks up this branch/plan:
rebase on the merged main, do the deferred post-merge spec pass (Tasks 9,21,23,24,25 against real
contracts — criteria already written), then run the plan end-to-end via
superpowers:subagent-driven-development (Tasks 1–8 dispatchable first; one reviewer per task).
3. The execution-validated plan + built code land on main via THAT work. PR #118 stays draft as
the plan-of-record thread until then (ready it, or supersede it, when execution validates).
Do NOT merge #118 as an un-run plan doc — nothing is built and the deferred half is provisional.

### Load list
- this handoff
- gate artifact https://claude.ai/code/artifact/e61e4e55-e65c-43b6-8438-7735bf04afb8
- `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (authority)
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` @ 2d327e4 (the plan; `## DEFERRED` section = post-merge work)
- `docs/superpowers/specs/2026-08-11-kb-structure-evidence/plan-adversarial-review.md` (the review that shaped the rulings)
- `handoffs/2026-08-12-dashboard-workflow-platform-p0.md` (the merge dependency — PR #117)
- `memory/claude-boss.md` 2026-08-11/12 lessons
- Skill on execution pickup: superpowers:subagent-driven-development
