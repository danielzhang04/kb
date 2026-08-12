# kb-structure spec + Phase I plan handoff — 2026-08-11 (updated: plan RE-RUN, 2 rulings pending)

**Topic:** kb-structure arc. Design cycle COMPLETE and Daniel's 3 rulings LOCKED; spec + 25-task
Phase I plan shipped. Plan then went through consistency-review (+5 fixes) → adversarial review
(16 findings) → fix attempt (worker KILLED mid-run) → independent re-review = **RE-RUN**. Plan is
NOT mergeable. Two decisions now belong to Daniel. All on `claude/boss-2026-08-11c` (pushed).
Gate artifact: https://claude.ai/code/artifact/e61e4e55-e65c-43b6-8438-7735bf04afb8

### The locked rulings (Daniel, 2026-08-11 — binding, unchanged)
1. Phased architecture ADOPTED; platform/data two-repo split ABANDONED. Phase I = monorepo +
   immutable versioned release artifacts to VM. Phase II = state-first split. Phase III =
   trigger-based project extraction.
2. Desktop promotion + durable VM outbox; NO GitHub credential on the VM ever; PAT rejected;
   staging-repo = pre-designed escalation.
3. Media exile entirely post-cutover; cutover = two gates (read-only web, then execution
   authority behind a hardening checklist).

### TWO DECISIONS PENDING FROM DANIEL (present context-first; both are real gates)
1. **Scope ruling — local session secret.** The B5 fix persists the dashboard's own HMAC
   session-signing key to a root-owned `0600` file on the VM so the restart canary can re-auth
   after a daemon restart. It grants NO external authority (only signs local dashboard sessions;
   no GitHub/backup/signing key reaches the VM). But it is a new persistent secret on the box, and
   ruling 2 was "no credential on the VM ever." Question: is a local-authority session secret
   in-bounds, or must the canary re-auth another way? (Also unblocks finding m3.)
2. **Sequencing ruling — execution-plane tasks.** B5 (recovery supervisor + restart canary)
   depends on the daemon's card→run linkage, and the REAL launch path
   (`dashboard/server/control/launch.ts` `executeApprovedLaunch`) starts `runAutomatic()` BEFORE
   returning `runRef` — so "durable receipt before execution" can't be finalized until
   `claude/workflow-platform` merges and its contracts settle. Question: fully specify those tasks
   now against a moving target, or mark them "specify post-merge" and ship Tasks 1–8 + the
   non-execution hardening first?

### What WORKED (with evidence)
- Spec `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (c521d20) + 8 evidence files in
  sibling `2026-08-11-kb-structure-evidence/` (now includes plan-adversarial-findings-r1.md +
  plan-adversarial-review.md).
- Plan (59825c6) + fix-attempt WIP (4c3599e). Re-review (codex sol/xhigh, card 6a7cb97c) graded
  16 findings: 11 ADDRESSED, B4/B6 PARTIAL, B3/B5/m3 NOT-ADDRESSED. Scope PASS on external
  authority (VM gets only public verification material); Phase integrity PASS; checkpoint PASS;
  4/5 earlier fixes survived.
- Parallel evidence harvest (4 codex workers under the critique's shadow) + boundary map
  spot-verified 3/3 by boss. B5 sourceTurnId (`bridge-${id}`) and B6 (`ExecutionLatch.lock` is the
  real synchronous owner at activation.ts:598, NOT `ActivatedExecution.lock`) both boss-verified.

### What Did NOT Work (and why)
- **Fix worker KILLED mid-run** (background task stopped ~48min in; both pids dead, no final
  message). Recovered: 946 insertions were coherent on disk, banked as WIP 4c3599e. Lesson: a
  killed worker leaves a plausible-but-unverified artifact — the re-review is what caught that B3/B5
  were prose-only and that fixes added compile breakage (Task21→22 order, deleted checksum iface,
  canary v1/v2 mismatch, Gate2 consumes unproduced files).
- **TWO claude opus review agents died** (API error, then 600s stall) before producing output.
  The claude Agent path was flaky this session; codex was reliable throughout. Switched the
  re-review to codex-deep and it completed clean.
- **codex re-review misconfigured with `--sandbox read-only`** — blocks the checkpoint writes the
  brief asked for. Killed (taskkill /PID <python> /T /F, verified other terminals' workers
  untouched) and re-dispatched with default workspace-write + scratch `--cwd` (reads repo, writes
  only checkpoints). Lesson: for a checkpointing reviewer, NEVER `--sandbox read-only`; confine via
  `--cwd` instead.

### What Has NOT Been Tried Yet
- The targeted fix pass that clears RE-RUN: fix all compile/ordering breakage; implement B3
  signing + verify_inventory extras-rejection; wire B6 to real `ExecutionLatch.lock`; complete B4
  restore drill; resolve B5 + m3 + HMAC-secret per Daniel's two rulings. Sequence B5/canary behind
  the workflow-platform merge if Daniel picks "defer".
- Opening the PR to main (only after RE-RUN cleared).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/superpowers/specs/2026-08-11-kb-structure-design.md` | DONE | c521d20; rulings locked |
| `.../2026-08-11-kb-structure-evidence/*` (8 files) | DONE | synthesis + 5 design reports + 2 plan-review files |
| `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` | WIP/BROKEN | 59825c6 clean baseline; 4c3599e fix attempt has RE-RUN issues — do NOT merge |
| branch `claude/boss-2026-08-11c` | PUSHED | remote == local; worktree `kb-worktrees/boss-2026-08-11c` KEEP |

### Exact Next Step
Present Daniel the two rulings above (artifact link + context, one at a time). On his answers:
dispatch ONE targeted codex fix pass scoped by the re-review verdict
(`.../scratchpad/rereview-verdict.md`, also banked as evidence/plan-adversarial-review.md) + his
rulings; re-review; then PR to main. If "defer" on ruling 2, split the execution-plane tasks out
behind the workflow-platform-merge checkpoint and ship Tasks 1–8 + non-execution hardening first.

### Load list
- this handoff
- gate artifact https://claude.ai/code/artifact/e61e4e55-e65c-43b6-8438-7735bf04afb8
- `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (authority)
- `docs/superpowers/specs/2026-08-11-kb-structure-evidence/plan-adversarial-review.md` (the RE-RUN verdict — fix scope) + `plan-adversarial-findings-r1.md`
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` @ 4c3599e (the WIP to fix)
- `handoffs/2026-08-11-dashboard-workflow-platform-p0.md` (the merge dependency)
- `memory/claude-boss.md` 2026-08-11 lessons
- Skill on execution pickup: superpowers:subagent-driven-development
