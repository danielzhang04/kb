# kb — token discipline: PR #183 open, awaiting Daniel's merge + main pull (boss handoff 2026-09-12 ~02:30 ET)

Written by the boss session (Fable 5.1). Active work only — delete on pickup/completion.

## Load
1. PR https://github.com/danielzhang04/kb/pull/183 (Why/What/Evidence/After merge/Not in this PR)
2. `docs/superpowers/specs/2026-09-11-token-discipline-design.md` + `…-evidence/` (usage analysis, task0 probes, proposed
   BOSS/CLAUDE diff, MEMORY.md trim) on branch `claude/token-discipline` @ 5735dd73 (worktree `kb-worktrees/token-discipline`)
3. `memory/claude-boss.md` sections "2026-09-11 — token discipline" and "2026-09-12 — token discipline build"

## State
- 23 commits over main f5a9aec2, +7,900/−17,822; 377 tests green across 17 suites; opus whole-branch review → one opus
  fix wave (F1 VM ledger clobber, F2 guard regex FPs, I1–I4, M1–M4) → sonnet re-review CLEAN. Every subagent model grep-verified.
- Live-proven in real sessions: opus PDF Read denied with the delegate message; haiku child extractor ALLOWED (after the
  agent_id transcript fix); startup frame shows `## Usage (yesterday)`; `preamble.py` 0.15 s with the detached ledger on ops.
- Ops content already done: `## Decisions` in kb-ops/prospecting/figment/faceless-youtube STATE.md (dc27cade); usage ledgers
  + sidecars for 09-10/09-11 on ops.

## Owed
- **Daniel:** merge #183, `git pull` the main checkout in the same action (absolute hook paths; `KB_USAGE_LEDGER=1` and the
  guard only take effect from the main checkout's settings after the pull).
- **Daniel (human-edited):** apply `…-evidence/proposed-BOSS-CLAUDE-diff.md` (150k boundary rule, Decisions-when-ruled,
  subagent-brief-rules pointer, BOSS.md trim ≈60%) and the MEMORY.md replacement in `…-evidence/memory-index-trim.md`.
- `orgs/atlas/STATE.md` + `orgs/atlas-prep/STATE.md` still fail the lint (pre-existing shape).
- Follow-up (parked, one-liner): `usage_ledger.py --force` to override the ops turn-count refusal.
- After a week of `ledgers/usage/`: read the trend; decide whether L2's 150k compaction feels right in practice.

## Rulings made on Daniel's behalf (each a one-commit revert)
1. Guard rules file at `scripts/hooks/context_guard.rules.yaml`, not `governance/`.
2. Build ran in this session (Daniel's override of the 150k handoff for this arc).
3. Ledger runs DETACHED from preamble (never synchronous); parse time is irrelevant to sessions.
4. Codex cumulative total kept separate from Claude per-turn peak context.
5. Guard reads the session model from the transcript tail (structural JSON walk), never a store cache; subagents resolved by `agent_id`.
6. `## Decisions` after `## Current gate`; bullets `YYYY-MM-DD — ruling — why`, ≤10; STATE cap stays 60 (kb-ops trimmed).
7. fyt-runner `mcpServers: []` stands (implementer's evidence: it never uploads; publish is a dispatched card) — my objection was wrong.
8. Ledger launch opt-in via `KB_USAGE_LEDGER=1` in project settings env (VM gates never set it); zero-row days never publish; an ops day's turn count can only grow.
9. Guard denies plain `git log --oneline` (unbounded); `-n`/`-<N>`/`--max-count`/`-p`/`..` escape.
10. No `--force` on the turn-count refusal (parked).
