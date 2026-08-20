---
id: 6a86c3ff-a2ad4cb5
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\bricks-arc-va\orgs\faceless-youtube
risk-tier: T1
owner: codex-worker
claim-token: b064dd3bfbf94e30
state: done
approval: null
workflow: 01a01e41-1cef-7260-a271-2c42485a938e
depends-on: []
variant-group: null
role: work
session-id: 6a86b893-8bff0720
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: VARIANT A — apply the recut plan (poyais-end restoration), suffix dispatch unchanged

You are a codex edit worker on the kb fleet. You edit files in the VARIANT-A WORKTREE ONLY. No git commits (the boss commits). No network. UTF-8 (verify no mojibake after writes).

WORKING ROOT (write ONLY here): C:/Users/danie/kb-clones/bricks-arc-va/orgs/faceless-youtube

\## Task
Apply doctrine-recon/recut-plan.md (the REVISED version in this worktree... NOTE: the worktree was cut before the revision — the authoritative revised plan is at C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube/doctrine-recon/recut-plan.md (commit c7166556); READ IT FROM THERE, apply INTO this worktree) in full across the 14-file stack: every RESTORE-VERBATIM (pull the exact text via git show of the cited sha — the clone's git history is shared with this worktree), every KEEP (leave alone), every DELETE, every MOVE, and the deterministic behavior-restorations in lint_shots.py / forge.py / stamp_review.py with their named regression tests. The plan's non-verbatim trims (anonymous-clause deletions) apply exactly as the plan marks them.
SUFFIX: variant A keeps the CURRENT dispatch shape — suffix appended at tail. If the plan's restored style-bible text changes the suffix CONTENT, apply it and keep grammar-header ↔ forge string byte-identical (update fixtures).

\## Verify (report all honestly)
1. Full VPW + forge/image-gen test suites (including the plan's new named regressions — write them if the plan specifies them).
2. Per-file line counts before/after vs the plan's estimates (flag >15% deviations).
3. Suffix sha (grammar header == forge string).
4. Cross-file echo sweep: grep for the deleted passages' load-bearing phrases — zero echoes.
OUTPUT → doctrine-recon/variant-a-notes.md in THIS worktree: per-file table, test results, deviations, echo-sweep result.
Final message: per-file net deltas, total, test results, suffix sha, deviations/flags. Nothing else.

## Result

| File | Net lines |
|---|---:|
| VPW `SKILL.md` | -33 |
| `critics.md` | -82 |
| `shots-schema.md` | +124 |
| `lint_shots.py` | -1,366 |
| Image-generation `SKILL.md` | -168 |
| `forge.py` | -1,123 |
| `stamp_review.py` | -47 |
| `build_review_artifact.py` | -257 |
| `crop_battery.py` | -7 |
| `finalize_thumbnail.py` | 0 |
| `visual-grammar.md` | -66 |
| `style-bible.md` | +89 |
| `registry.json` | -147 |
| `example-shots.md` | -88 |
| **Total** | **-3,171** |

Total stack: **9,728 → 6,557 lines**.

Tests:

- VPW: **101 passed**
- Image-generation: **166 passed**
- Combined: **267 passed**
- Six available video lints: **no new HARD findings**
- Echo sweep: **zero**
- Mojibake sweep: **zero**

Suffix SHA-256: `39dc14b4781b4a68b4711ff6a518598c2f22251e7e3488062e3f7c3a47b197b7`

Deviations above 15%:

- VPW `SKILL.md`: **+24.8%**
- `shots-schema.md`: **+18.6%**
- `forge.py`: **+19.1%**

Flags:

- Bricks heads-ups increased **7 → 42** from the restored advisory casting check; HARD remained **0**.
- Seven baseline fixture paths were absent and could not be linted.
