# kb — project-frame hooks: PR #182 open, awaiting Daniel's merge + main-checkout pull (boss handoff 2026-09-11 ~16:30 ET)

Written by the boss session (Fable 5.1). Active work only — delete on pickup/completion.

## Load
1. PR https://github.com/danielzhang04/kb/pull/182 (body = Why/What/Evidence/After merge/Not in this PR)
2. `docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md` and
   `docs/superpowers/plans/2026-09-11-project-frame-hooks.md` (on the PR branch `claude/project-frame-hooks`)
3. `orgs/{prospecting,figment,kb-ops,faceless-youtube}/GOAL.md` + `STATE.md` (ops 183578b1)
4. `memory/claude-boss.md` section "2026-09-11 — project-frame hooks"

## State
- Branch `claude/project-frame-hooks` HEAD 076a4370, 23 commits over origin/main 39197cf5, pushed, remote == local.
  Worktree `C:/Users/danie/kb-worktrees/project-frame` (delete after merge; no node_modules junction).
- Gates: 215 passed (17 hook/script suites); live SessionStart probe 0.93 s / 0 stderr / 6628 chars; headless
  `claude -p` session received the frame ("LIVE-OK North star") and the store carried the governing sections.
- Reviews: per-task sonnet reviews (5 fix rounds), opus whole-branch (2 Critical + 3 Important → fixed in one opus wave),
  sonnet re-review CLEAN. Every subagent model verified by transcript grep.
- Ops content pushed: 183578b1 (4 GOAL/STATE pairs), 37ec7cf2 (20 stale handoffs removed; 5 remain). 6 stale
  main-branch handoffs removed in the PR.

## Owed
- **Daniel:** merge #182, then `git pull` the main checkout in the same action (committed hook paths point at
  `C:/Users/danie/kb/scripts/hooks/`; between merge and pull, sessions print `Cannot find module` on stderr, non-blocking).
- **Daniel (human-edited files):** proposed CLAUDE.md / BOSS.md diff — Navigation reads `GOAL.md`; project findings go to
  `STATE.md ## Findings` / `## Infra`; boss grades cite the model-audit row (PreToolUse Agent|Task + SubagentStop) with the
  transcript grep as fallback; handoffs flagged by `scripts/handoffs_sweep.py` are deleted at boss session close.
- `orgs/atlas/STATE.md` is pre-existing and fails `scripts/project_frame_lint.py` (72 lines, missing sections, no
  timestamp) — reshape before wiring the lint into CI.
- DONE 2026-09-11 17:10 ET — every armed path live-proven (headless session 74ea841c on prospecting-p8 with the branch
  settings): model-verify audit rows (requested haiku, observed claude-haiku-4-5, verdict match), SubagentStart inherited
  `[kb spawn context]` + North star into the child transcript, PostToolUse activity ring + throttle counter, Stop hook
  "STATE.md stale (4d)" warning, PreCompact summary written from the real transcript and replayed by the compact
  re-ground (all four sections in 1700 chars), frame hook silent on compact. Audit log: `%LOCALAPPDATA%\kb-context-lifecycle\model-audit.jsonl`.
- Deferred (can-ship, ledgered): compact-time concurrency between U7 and the frame hook (one stale compaction, self-heals);
  Stop hook up to 3 git calls; sweep `--json` always exits 0; sweep should skip a handoff referenced by a surviving
  handoff's `## Load` list (2026-09-02 dashboard handoff kept by hand for that reason).

## Rulings made on Daniel's behalf (in order; each is one revert if wrong)
1. Spec trimmed to two frame modes (`full`, `rollup`); U7/U9 serve compact/subagent from the store.
2. Sweep dead-Load check strict to ops/main (no working-tree leniency).
3. Headings prefix-matched everywhere (`## Current gate (P8)` resolves).
4. `.claude/settings.json` hooks + `CCO_QUIET=1` committed on the branch; the PR is the gate.
5. gitCapture stderr fix in the library; monkey-patch deleted.
6. Stop hook warns on an unparsable `_Updated:` while STATE.md exists.
7. Sweep git calls batched + hook-side 2 s sweep cap (latency 3.4 s → 0.3 s).
8. Keep `2026-09-02-dashboard-gate4-live-launch-plan.md` on ops (referenced by the 09-06 handoff's Load list).
9. Final fix wave on opus: PreCompact summary replayed by U7 and rollup; budget reserved for preamble+flags before
   `frame()`; store writes prefix-matched; sweep date guards; cross-process store lock; `KB_PROJECT` validated.
10. Unparseable `KB_HANDOFFS_NOW` falls back to today.
