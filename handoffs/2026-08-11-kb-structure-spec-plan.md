# kb-structure spec + Phase I plan handoff — 2026-08-11

**Topic:** kb-structure arc completed its design cycle: evidence harvest (4 codex workers + 1
salvage attempt), synthesis, Daniel's three rulings LOCKED, spec + 25-task Phase I plan shipped
on `claude/boss-2026-08-11c` (pushed, c521d20 spec + 59825c6 plan). This CONSUMES
`2026-08-11-kb-structure-brainstorm.md` (deleted this push). Execution is NOT started —
sequenced behind cloud-migration Wave-3 per ruling 3.

### The locked rulings (Daniel, this session — binding)
1. **Architecture:** phased design ADOPTED; platform/data two-repo split ABANDONED (adversarial
   critique verdict RETHINK, evidence-backed). Phase I = monorepo + immutable versioned release
   artifacts to the VM. Phase II = state-first split (queue/ledgers churn out; knowledge+platform
   stay coupled). Phase III = trigger-based project extraction.
2. **Sync topology:** desktop promotion + durable VM outbox; NO GitHub credential on the VM ever.
   Staging-repo promotion = pre-designed escalation; brokered GitHub App only if direct
   publication proves necessary; PAT permanently rejected.
3. **Sequencing:** ALL media exile after cutover (pre-cutover archive tranche explicitly
   rejected). Cutover = TWO gates: read-only web first, execution authority behind the hardening
   checklist.

### What WORKED (with evidence)
- **Spec** `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (c521d20) with all six
  evidence reports banked in sibling dir `2026-08-11-kb-structure-evidence/` — boss fixed the
  worker's ephemeral-path evidence register before commit.
- **Plan** `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` (59825c6): 25 tasks,
  workflow-platform merge checkpoint between Tasks 8/9, TDD steps with real code throughout.
  Writer sol/xhigh hit the 5400s timeout DURING its self-review — file was complete (verified:
  25 headings, coverage map, zero forbidden phrases). Fresh-context sonnet verifier
  (87/87 turns model-grepped): FIX-THEN-SHIP, 1 Critical + 2 Important + 2 Minor; all five fixed
  by a terra worker and boss-verified in the final file.
- **Evidence quality loop:** 4 parallel evidence workers (critique sol/xhigh RETHINK; boundary
  map spot-verified 3/3; media inventory; creds options) under the critique's wall-clock shadow.
  Boss corrected one critique claim (createQueueBridge HAS a production caller — env-gated
  default-off at surface.ts:128).

### What Did NOT Work (and why)
- **Original critique worker (thread 6a7b9e84-b9f50765)** — died at 2h26m on codex backend
  stream disconnect (5 reconnects failed, turn.failed). Read-only sandbox meant ZERO banked
  output; 165 audit commands lost.
- **Salvage follow-up into the dead thread** — worker honestly reported its audit context was
  gone post-disconnect and refused to fabricate. Thread resume after a crashed turn does NOT
  recover working memory; the JSONL log (`turn.failed` tail) is the reliable postmortem.
- **codex dispatch with non-git scratch cwd** — refuses in 9s ("Not inside a trusted directory");
  `git init` the scratch dir first.
- **Plan-writer self-review at 5400s timeout** — the audit checklist at the plan's tail was
  written but never executed by the writer; the external verifier substituted for it and caught
  a real Critical (Task 21 register() throw contradicting the pinned overwrite-semantics test at
  managedExecution.test.ts).

### What Has NOT Been Tried Yet
- Opening the PR for `claude/boss-2026-08-11c` → main (spec + plan; Daniel merges).
- Everything in the plan itself: Tasks 1–8 may land pre-checkpoint any time; Tasks 9–25 blocked
  on the workflow-platform merge (804acec ancestor requirement).
- Media-exile track design details beyond the spec's fixed sequence (post-cutover).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/superpowers/specs/2026-08-11-kb-structure-design.md` | DONE | c521d20; decision record, rulings locked |
| `docs/superpowers/specs/2026-08-11-kb-structure-evidence/*` (6 files) | DONE | synthesis + 5 worker reports, banked |
| `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` | DONE | 59825c6; 25 tasks, review-fixed |
| branch `claude/boss-2026-08-11c` | PUSHED | remote == local; worktree `kb-worktrees/boss-2026-08-11c` KEEP until merge |
| `handoffs/2026-08-11-kb-structure-brainstorm.md` | CONSUMED | deleted this push |

### Exact Next Step
Daniel merges the branch (PR or direct). Then: Tasks 1–8 of the Phase I plan are dispatchable
immediately in a fresh arc (subagent-driven-development, one reviewer per task); Tasks 9+ wait
for the workflow-platform merge; execution authority + media exile wait for their gates. The
plan header names the required sub-skill.

### Load list
- `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (the authority)
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` (header + Global Constraints + Source anchors first; tasks by need)
- `docs/superpowers/specs/2026-08-11-kb-structure-evidence/synthesis.md` (why the design changed)
- `handoffs/2026-08-11-dashboard-workflow-platform-p0.md` (the checkpoint dependency's arc)
- `memory/claude-boss.md` 2026-08-11 lessons
- Skill on execution pickup: superpowers:subagent-driven-development
