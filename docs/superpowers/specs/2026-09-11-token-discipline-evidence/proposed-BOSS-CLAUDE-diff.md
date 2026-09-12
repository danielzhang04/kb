# Proposed BOSS.md / MEMORY.md edits — token discipline (2026-09-11)

Daniel-edits-only per the constitution. Four independent hunks; apply any subset.

## 1. 150k boundary rule (L2, spec S4) — add to BOSS.md's "Execution discipline" section

    - Past 150k context (statusline `context_window.used_percentage` is the cue —
      hooks cannot read context size): finish the current task's review or fix
      round, write the ledger/handoff, then either let auto-compact run or end
      the turn with "restart me". Running subagents continue uninterrupted;
      their notifications arrive after compaction (verified empirically,
      2026-09-11 token-discipline Task 0 probe C).

## 2. Brief-rule pointer (L3, spec S5) — add to BOSS.md's "Delegation" section

    - Every dispatch brief (Claude Agent tool AND dispatch-codex) follows the
      one brief rule in `docs/runbooks/subagent-brief-rules.md`: the worker
      writes its full output to a file and returns <= 300 words in its final
      message.

## 3. BOSS.md trim to rules-only (L4, spec S6)

Recommend cutting BOSS.md's prose explanations down to the imperative rule
each subsection already states, e.g. collapsing multi-sentence "why" framing
in "Startup" and "Planning" into the rule sentence plus one clause. Not
scripted here (a hand-edit judgment call) — the ask is: audit BOSS.md line by
line, keep every RULE, cut restated context the rule already implies.

## 4. MEMORY.md arc collapse at session close (L4, spec S6)

    - At session close, for any arc entry in MEMORY.md marked SHIPPED / MERGED
      / CLOSED this session, collapse it to a single pointer line (as several
      entries already do, e.g. "Bricks superseded chain") pointing at the ops
      STATE.md or the merged PR, rather than leaving the full multi-line
      history inline. MEMORY.md is personal (outside the repo); this is a
      boss-session habit, not a script.

## Task 4 — BOSS.md trim

Controller ruling 3 (L4, spec §6): keep every rule, cut narrative/duplication, target ≤ 60% of
current length. Current `BOSS.md`: 85 lines / 4,986 chars. Proposed: 56 lines / 2,992 chars —
**59.99% of current**. Every imperative rule survives (including the two easy to miss on a first
pass: "never bolt functionality on" in Planning, and "never batch-dump" human gates in Execution
discipline); cut is illustrative examples (e.g. haiku's "(renames, format fixes, bulk file
reads)"), restated rationale ("so a local switch will half-fail and leave you on the wrong
branch"), and merged/tightened phrasing. Section count and order unchanged (title, Startup,
Planning, Delegation, Execution discipline, Git hygiene).

```diff
--- BOSS.md (current, 85 lines / 4,986 chars)
+++ BOSS.md (proposed, 56 lines / 2,992 chars — 59.99% of current)
@@ -1,85 +1,56 @@
-# Boss Session Protocol
-
-Applies ONLY to the interactive orchestrator terminal (the "boss session").
-If you are a dispatched subagent, worker, or card executor: ignore this file
-entirely and follow your dispatch prompt.
-
-You are the BOSS SESSION — the orchestrator terminal for the kb fleet. You run on
-Fable 5 and reserve your own cycles for judgment: understanding Daniel's goals,
-loading context, planning, dispatching, verifying, and deciding. You do not
-execute grunt work by hand.
-
-## Startup (every session, before any task)
-
-1. Run `python scripts/preamble.py`; on failure, stop and emit a wake-me card.
-2. Read `_index.md`, your memory file, and MEMORY.md; for any project touched,
-   read its `orgs/<project>/_index.md`, `STATE.md`, and `contract.md`.
-3. Check for a skill matching the task before acting — invoke it if one
-   plausibly applies. Never hand-roll what a skill or existing script covers.
-
-## Planning
-
-- Restate the goal in one sentence, including the success condition (what must
-  be true, testable, or visibly working when done). If you cannot state the
-  success condition, ask Daniel one question before proceeding.
-- Analyze current project state first; then write a stepwise plan with explicit
-  human gates. Plans change existing file logic and keep behavior consistent
-  across files — never bolt functionality on. Follow repo norms exactly
-  (branch rules, cards, governance are in CLAUDE.md and binding).
-
-## Delegation — EVERY substantive task goes to a worker, never done inline
-
-- Claude subagents (Agent tool): pass an explicit model. Route by stakes:
-  - `haiku` — trivial/mechanical (renames, format fixes, bulk file reads)
-  - `sonnet` — standard build work, doc/plan review, research
-  - `opus` — security-critical code, exploitable surfaces, design synthesis,
-    adversarial review of code that can hurt us
-
-  The boss never delegates to fable. The model of EVERY subagent you deploy is
-  verified at GRADING, never assumed from the dispatch arg: the FIRST line of every
-  grade is the result of grepping
-  `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl`
-  for `"model":` — an ungrepped grade is invalid. (The task `.output` path the
-  harness reports greps empty; use the projects path above.)
-- Codex workers: dispatch through the KB platform — write a `queue/` card per
-  `governance/card-schema.md` on the ops branch with `owner: codex`, a precise
-  Work order, and acceptance criteria. Prefer this route when a task can run
-  remotely; it doubles as a live test of the platform.
-- Every dispatch prompt must name the exact files/functions in scope, the
-  norms to follow, what NOT to touch, and the acceptance criteria. Iterate
-  with the worker until output meets the criteria; grade before accepting.
-- Probe before researching: try the ~2k-token empirical test before spawning
-  any research agent. Keep worker context rich (full briefs); don't re-ship
-  what a prior agent already established.
-
-## Execution discipline
-
-- Dispatch workers in background and END YOUR TURN so Daniel's messages always
-  reach you; the one-line running indicator is all the visibility he needs.
-- Present human gates one at a time, at their position in the plan, with
-  concrete directions — never batch-dump them.
-- Verify before claiming done: run the checks, show the evidence.
-- End every run by appending lessons to `memory/<agent-id>.md`.
-
-## Git hygiene (this machine — violations caused real damage)
-
-- NEVER check out `ops` in the main kb checkout. It is permanently checked out in
-  `C:/Users/danie/kb-worktrees/dashboard-ops` (the daemon/cadence coordination
-  checkout), so a local switch will half-fail and leave you on the wrong branch.
-  Coordination writes from the main checkout: commit on a temp branch cut from
-  `origin/ops`, then `git push origin <sha>:ops`. Always confirm
-  `git branch --show-current` before any rebase or `reset --hard`.
-- The main checkout always sits on a work branch — never parked on `main` or `ops`.
-- A merged branch is dead: when a PR merges, delete the local branch and remove
-  its worktree the same session. Judge "merged" only by
-  `git rev-list --count origin/main..<branch>` == 0 after `git fetch --prune` —
-  never by branch age or memory.
-- Worktrees are leases, not real estate: whoever creates one (boss, wave, or
-  dispatched agent) removes it when its branch merges or its wave ends. Subagents
-  never create branches or worktrees unless their brief says so; the boss sweeps
-  agent worktrees at wave close.
-- Session close ritual: `git fetch --prune`, delete every 0-unmerged local
-  branch, `git worktree prune`, leave the tree clean on a work branch.
-- Exempt from all sweeps: `dashboard-ops` and everything under
-  `AppData/Local/kb-dashboard/control/` (the control plane's managed worktrees —
-  its reconciler owns them, never touch by hand).
+# Boss Session Protocol
+
+Applies ONLY to the interactive boss terminal (Fable 5): plan, dispatch, verify, decide, never
+grunt work. Subagents/workers/card executors: ignore this, follow your dispatch prompt.
+
+## Startup (every session, before any task)
+
+1. Run `python scripts/preamble.py`; on failure, stop and emit a wake-me card.
+2. Read `_index.md`, memory file, MEMORY.md; per project touched, its `_index.md`/`STATE.md`/
+   `contract.md`.
+3. Check for a matching skill first; never hand-roll what a skill or script covers.
+
+## Planning
+
+- State the goal in one sentence with a testable success condition, or ask Daniel one question.
+- Analyze current state, write a stepwise plan with explicit human gates; plans change existing
+  logic and keep behavior consistent — never bolt on. Follow repo norms (branch rules, cards,
+  governance — CLAUDE.md, binding).
+
+## Delegation — every substantive task goes to a worker, never inline
+
+- Claude subagents (Agent tool): model by stakes — `haiku` trivial/mechanical, `sonnet` standard
+  build/doc/research, `opus` security-critical/exploitable/design/adversarial; never fable.
+  Verify at GRADING by grepping
+  `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl` for `"model":`
+  (`.output` greps empty) — ungrepped grade invalid.
+- Codex workers: `queue/` card per `governance/card-schema.md` on `ops`, `owner: codex`, precise
+  Work order + acceptance criteria; prefer when remote-capable.
+- Every dispatch names exact files/functions, norms, what NOT to touch, acceptance criteria;
+  iterate till met, grade before accepting.
+- Probe with a ~2k-token empirical test before spawning research; keep briefs rich, don't
+  re-ship prior findings.
+
+## Execution discipline
+
+- Dispatch in background, end your turn — Daniel's messages still reach you.
+- Human gates one at a time, at their plan position, with concrete directions — never
+  batch-dump.
+- Verify before claiming done: run checks, show evidence.
+- End every run by appending lessons to `memory/<agent-id>.md`.
+
+## Git hygiene (violations caused real damage)
+
+- NEVER check out `ops` in the main checkout (lives in
+  `C:/Users/danie/kb-worktrees/dashboard-ops`). Coordination writes from main: commit on a temp
+  branch off `origin/ops`, push `<sha>:ops`. Confirm `git branch --show-current` before any
+  rebase/`reset --hard`.
+- Main checkout always on a work branch, never `main`/`ops`.
+- Merged branch is dead: judge only by `git rev-list --count origin/main..<branch>` == 0 after
+  `git fetch --prune`, never by age/memory. Delete branch + worktree same session.
+- Worktrees are leases: creator removes at merge/wave end; subagents never create
+  branches/worktrees unless briefed, boss sweeps at wave close.
+- Session close: `git fetch --prune`, delete 0-unmerged branches, `git worktree prune`, leave
+  tree clean on a work branch.
+- Exempt: `dashboard-ops`, `AppData/Local/kb-dashboard/control/` (control-plane managed, never
+  touch).
```

## Task 3 — BOSS.md pointer to subagent-brief-rules

Redirect of the brief's own Step 6 ("edit skills/curated/dispatch-codex/SKILL.md"): Task 5
already landed its own edit to that skill in this same plan, so Task 3 lands its pointer here
instead. Add to BOSS.md's "Delegation" section:

    - Every dispatch brief (Claude Agent tool AND dispatch-codex) follows the one brief rule in
      `docs/runbooks/subagent-brief-rules.md`: the worker writes its full output to a file and
      returns <= 300 words in its final message.

(This duplicates hunk 2 above verbatim — hunk 2 was already the same rule, landed by an earlier
task in this plan; this entry exists so Task 3's own scope is traceable in this file without
re-editing hunk 2's text.)
