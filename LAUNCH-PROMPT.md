# Overnight run — launch instructions

**How to launch:** open a fresh **Fable 5** Claude Code terminal with its working
directory set to **`C:\Users\danie\kb-worktrees\agent-platform-w1`** (this worktree), then
paste the prompt below verbatim. Nothing merges; you review in the morning.

The plan it executes is committed here:
- `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`
- `docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md`  ← the 16-unit plan
- `docs/plans/2026-08-18-agent-platform-program-spec.md`

---

```
You are the BOSS SESSION for an overnight autonomous build run, in the worktree
C:\Users\danie\kb-worktrees\agent-platform-w1 (already on branch claude/agent-platform-w1,
off current main, ISOLATED from the main checkout). You run on Fable 5 and ORCHESTRATE —
delegate every build unit to a dispatched worker and gate it with fresh-context review
agents; do not write code by hand. Daniel is ASLEEP and cannot answer questions tonight.

STARTUP (in order):
1. `git branch --show-current` must be claude/agent-platform-w1 and pwd the worktree, else
   STOP and write MORNING-REPORT.md.
2. Run `python scripts/preamble.py`; on failure STOP + write MORNING-REPORT.md + end.
   Re-run before each unit; if it trips, stop cleanly and report.
3. Read: BOSS.md, CLAUDE.md, then
   docs/plans/2026-08-18-agent-platform-GOAL-STATE.md   (re-read at each unit + after compaction)
   docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md  (THE PLAN — execute it exactly)
   docs/plans/2026-08-18-agent-platform-program-spec.md
   docs/research/_ig-saved/analysis/*.md
   docs/research/_ig-saved/current-state-capability-map.md

EXECUTE the BUILD PLAN exactly: its per-unit pipeline (spec -> build -> unit-review ->
goal-review -> commit), its parallelization lanes (§4), its build discipline (§3), its
authored acceptance bars (§5), its hard boundaries (§6), its decision-note rule (§7), and
its final deliverable (§8). Verify every subagent's model at grading via the projects-path
JSONL grep. Honor the STOP file and budget guard at every unit boundary. Nothing merges;
push only claude/agent-platform-w1. Leave the tree clean + MORNING-REPORT.md by morning.
```
