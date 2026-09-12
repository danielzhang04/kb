# kb — token discipline: spec approved, build NOT started (boss handoff 2026-09-11 ~18:40 ET)

Written by the boss session (Fable 5.1) at its own 150k boundary — the first handoff made under the rule it
proposes. Active work only — delete on pickup.

## Load
1. `docs/superpowers/specs/2026-09-11-token-discipline-design.md` (branch `claude/token-discipline` @ 1b401f5e,
   pushed; worktree `C:/Users/danie/kb-worktrees/token-discipline`). §0 rulings, §2 lever table, §9 verified facts.
2. Evidence beside it: `…-evidence/usage-analysis-2026-09-06-to-11.md` (tables A–G), `tooling-research.md`.
3. `memory/claude-boss.md` sections "2026-09-11 — project-frame hooks" and "2026-09-11 — token discipline".
4. The SDD process that worked this week: `docs/superpowers/plans/2026-09-11-project-frame-hooks.md` header +
   the skill `superpowers:subagent-driven-development` (one implementer per task, review per task, opus final).

## Next boss — exact brief
1. Preamble; read the spec; invoke `superpowers:writing-plans` on it → `docs/superpowers/plans/2026-09-11-token-discipline.md`
   (sonnet may draft; boss self-reviews against the spec). Task 0 = measurements/probes (load-context breakdown,
   `codex --help` compaction/effort flags, empirical "subagent notification survives /compact").
2. Execute with `superpowers:subagent-driven-development` in the existing worktree; sonnet implementers,
   sonnet task reviews, haiku scoped re-reviews, opus whole-branch final. Every subagent model grep-verified.
3. Boss discipline while building: subagents return ≤300 words + a report file; batch independent tool calls;
   Monitor for waits; write Daniel's rulings to the SDD ledger the moment they happen; at the next task boundary
   past 150k, write the handoff and ask for a restart (or let `autoCompactWindow` fire once it is set in Task 2).
4. Ship: PR with Why/What/Evidence/After-merge/Not-in-PR; the cleanup hunks (§8) reviewable one by one; the
   proposed BOSS.md/CLAUDE.md edits delivered as a diff for Daniel (human-edited files).

## Daniel's rulings (2026-09-11, verbatim intent)
1. Measure only — no warn, no freeze.
2. MCPs stay, same names/instructions/planning; lazy-load only if invisible to use (docs say no lazy connect →
   only per-agent `mcpServers` restriction for builders/reviewers).
3. Codex boss terminal stays `gpt-6-astra`; child dispatches lower tier/effort.
4. Boss resets at the next task boundary past 150k context.
5. Cleanup may delete anything nothing functional or future-facing depends on, as reviewable PR hunks.

## Owed / open
- Root-level stray untracked files in the main checkout (`*.png`, `*_tmp.txt`, `p5_plan_b380.md`, `nyc-midtown-workspaces.html`,
  `queue/inbox/*` drafts) — Daniel's call, not a PR.
- BOSS.md boundary rule + CLAUDE.md `## Decisions` line — human-edited; diff comes with the PR.
- The analysis script `analyze_tokens.py` in the evidence dir is throwaway; `usage_ledger.py` (L1) is the kept one.
