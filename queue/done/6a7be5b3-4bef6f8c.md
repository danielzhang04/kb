---
id: 6a7be5b3-4bef6f8c
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: 09ac01a01ee96517
state: done
approval: null
workflow: 019ff3f5-b69e-7e01-85fc-7e856fe45de8
depends-on: []
variant-group: null
role: work
session-id: 6a7be4c8-094eb2f8
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task C2 fix round 1 — double-translation + residual-scan offset bug

Arc worktree is your cwd, branch `claude/codex-image-engine`. Scope:
`orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py` (the two
defects) + `.../test_forge_codex.py` (regression tests for BOTH demonstrated inputs) +
Fix report 1 appended to `.superpowers/sdd/2026-08-11-codex-image-engine/task-C2-report.md`.
NO codex calls, NO network, NO commit/push.

\## Findings (fresh-context review of e8585bc; both demonstrated, both real code bugs)

1. MEDIUM — forge_codex.py:60: translation is not context-aware; P2b's winning phrase
   "at stage-left of frame" (worked example at
   scratch-codex-image-engine/p2b-prompting-research.md:752) becomes the malformed
   "at on the left of the frame of frame" — a mapping applied inside an already-idiomatic
   phrase. Fix in core logic (context-aware/longest-match-first/word-boundary translation —
   whatever the table design genuinely needs, not a special case for this phrase), and add
   the P2b worked example as a regression test asserting its exact expected output.
2. MEDIUM — forge_codex.py:97-98: the residual scan computes match offsets against the
   TRANSLATED text and slices the ORIGINAL text with them, so a prior translation shifts
   offsets and hides nearby residuals. Demonstrated: composed prompt containing
   "stage-left, left x… wings" returns []. Fix the offset bookkeeping (scan the text the
   offsets refer to), add the demonstrated poisoned input as a regression test asserting the
   residual IS caught.

Both fixes are core-logic changes, not bolt-ons; keep the module slim. All 20 existing tests
must stay green; expect 22 after your two regression tests.

\## Verification to run and paste
- Red first: show both new regression tests FAILING against the unfixed code (git stash your
  forge_codex.py fix or write tests first — your choice, but paste a genuine red run).
- Green: full suite tail (22 passed).
- `git diff --stat` — exactly the two named files.

Final message: line 1 `C2-FIX1 DONE` or `C2-FIX1 BLOCKED: <why>`; red + green tails + diff stat.

## Result

C2-FIX1 DONE

Red run (unfixed):

```text
FAILED test_idiom_translation_p2b_worked_example_translates_full_position_phrase
- tote bins on the left of the frame, a shut roller door beyond
+ tote bins at on the left of the frame of frame, a shut roller door beyond
FAILED test_residual_scan_uses_original_offsets_after_prior_translation
E       assert ([])
2 failed in 0.16s
```

Green run:

```text
  ok  test_residual_scan_uses_original_offsets_after_prior_translation
  ok  test_residual_scan_warns_without_raising
  ok  test_resolve_codex_binary_is_never_called_at_import_and_fails_loud
== 22 passed ==
```

```text
 .../skills/image-generation/scripts/forge_codex.py | 14 ++++-
 .../image-generation/scripts/test_forge_codex.py   | 65 ++++++++++++++++++++++
 2 files changed, 76 insertions(+), 3 deletions(-)
```

Fix report appended to `.superpowers/sdd/2026-08-11-codex-image-engine/task-C2-report.md`.
