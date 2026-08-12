---
id: 6a7cddec-1be3ee8e
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: 670c52ea8214181b
state: done
approval: null
workflow: 019ff7bc-374d-7ae2-9262-5d0929add861
depends-on: []
variant-group: null
role: work
session-id: 6a7cdc35-a47a9b3f
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Fresh-context review — Task C15 (study-only register seed), codex image-engine arc

Fresh-context adversarial reviewer; you did NOT build this. Cwd = arc worktree, branch
`claude/codex-image-engine`, HEAD = 7fa890f (`git show HEAD` = diff under review; exactly
forge_codex.py + test_forge_codex.py).

Read first: plan C15 —
`orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md` lines
3811–3966; spec §4.7 (two-cap doctrine + option (a)) + §10 Wave 2 promotion rule.
Sanctioned: stale plan count (real 117); the plan-authorized signature changes
(prepare_seeds cap kwarg, build_log_row added_by, LOG_KEYS+"added_by",
RunOptions.register_seed_tile, --register-seed-tile).

\## Attack surface — this task exists to be ABUSED; the doctrine must hold

1. **Cap doctrine** — CODEX_SEED_CAP=4 remains the default in EVERY path that doesn't go
   through with_register_seed. Poisons: 5 slate seeds + no tile → CodexContractError;
   5 slate seeds + tile (6 total) → rejected (STUDY_SEED_CAP is 5, never 6);
   4 slate + tile = 5 → passes ONLY with the tile appended by the policy;
   TRANSPORT_SEED_CEILING still enforced at the invocation boundary independent of caps.
2. **No mutation, no double-add** — with_register_seed copies the item (deep enough? poison:
   mutate item2["seed_roles"] and check item); dedup when the slate already carries the
   tile (path normalization: same tile via different case/relative path — realpath'd
   both sides?).
3. **added_by integrity** — OK rows carry "codex_register_policy" ONLY when the tile was
   actually appended; plain runs carry None; ERR rows (does the ERR-path build_log_row
   call pass added_by correctly?); C11 totality test still asserts set(row) ==
   set(LOG_KEYS) with the new key.
4. **Ordering** — tile is LAST in seeds and last in seed_roles; input_images_line labels
   it "Image N: style reference only."; envelope/referenced_image_paths order preserved.
5. **Study-only surface** — without --register-seed-tile, byte-identical CLI behavior to
   HEAD^ (no new default effects); the flag routes to RunOptions and through run_item.
6. **Test strength** — 2+ mutations (e.g. default cap silently 5; added_by stamped on
   plain runs) → a test must fail each; revert; list them.
7. **Hygiene** — exactly 2 files in HEAD; forge.py blob unchanged; entropy zero-hit; AST
   pin passing; suite green (117).

\## Rules
READ-ONLY (restore everything; only your report written). NO codex calls/network/commit/
push. Report to `.superpowers/sdd/2026-08-11-codex-image-engine/task-C15-review.md`.
Final message: line 1 `VERDICT: SHIP` or `VERDICT: NEEDS-FIXES`; findings ranked with
file:line + demonstrated failure; undemonstrated = QUESTION.

## Result

VERDICT: NEEDS-FIXES

- HIGH: transport ceiling is never enforced at `generate()`’s invocation boundary; six seeds trigger two fake subprocess attempts.
- MEDIUM: `with_register_seed` shallow-copies existing `seed_roles`, allowing returned-item mutation to alter the original spec.

Full evidence and passing checks: [task-C15-review.md](C:\Users\danie\kb-worktrees\boss-codex-image-engine\.superpowers\sdd\2026-08-11-codex-image-engine\task-C15-review.md). The focused suite passed: 117 tests.
