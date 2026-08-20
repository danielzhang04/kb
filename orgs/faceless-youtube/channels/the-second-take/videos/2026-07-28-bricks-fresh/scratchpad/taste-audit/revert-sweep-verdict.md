# R1/R2'/R3/R4/R5 doctrine revert sweep verdict

Technical verdict: REQUEST CHANGES.

Scope: the 20 modified tracked files in the VPW, image-generation, and The Second Take doctrine surface, plus the current `bricks-fresh` `shots.json`. Unrelated pre-existing/untracked work was not reviewed or changed.

## Findings

### HIGH -- R1 current production artifact is now hard-invalid (26 violations)

`channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json:39`

> `~ crowd attitude and repeating big-hair silhouettes`

The new R1 material-delta guard correctly HARD-fails this and 25 further current deltas (`L02, L15, L37, L51, L70, L72, L76, L103, L110, L111, L119, L123, L136, L144, L146, L162, L169, L175, L184, L186, L206, L209, L218, L229, L242, L243`) as cosmetic/non-distinct. The current video therefore cannot pass its required lint gate. This conflicts with R1's requirement that chains contain only genuine progressive reveals and that non-distinct deltas fail HARD; the doctrine was tightened but the active artifact was not made conformant.

### HIGH -- R5 catalog lint is bypassable by an unknown pose token

`.claude/skills/visual-prompt-writer/scripts/lint_shots.py:2143`

> `if _POSE_TOKEN_SHAPE.search(token) and token not in primitives})`

Only unknown backticked tokens matching the finite prefix regex are checked. The fixture's `` `action-not-in-catalog` `` correctly HARD-fails, but equally unknown `` `invented-pose` `` passes because it does not match that shape; unbackticked freestyle pose prose is likewise outside this check. This conflicts with R5's closed-world requirement that VPW may author only catalog-resolving pose/expression/costume vocabulary, with snap/elevation as the only alternative.

### MEDIUM -- R2' old cast-to-crowd routing remains in the input VPW reads

`channels/the-second-take/videos/2026-07-28-bricks-fresh/vpw-log.md:5`

> `All other people are crowd-tier figures, dressed for each scene’s own late-1980s setting.`

VPW Step 0 explicitly reuses this declaration during scoped repair. It instructs the former blanket crowd fallback instead of promoting an individual human beat to seeded cast and reserving crowd for a mass-story beat. This conflicts with R2' universal cast promotion/default single-figure staging.

### LOW -- R3's old global-warm policy remains asserted by the generator source

`.claude/skills/image-generation/scripts/forge.py:285`

> `provider weights the LAST instruction hardest — so the tail is where line weight, the warm-biased`

This source comment still calls global warm bias a law that the tail must enforce, while `style-bible.md:150` says warm, cool, mixed, and desaturated passages are equally normal and palettes follow each scene. It is not the deliberately frozen suffix bytes themselves, but it is still live generator-adjacent doctrine language that invites restoration of the retired global bias.

## R verdicts

| Rule | Verdict | Evidence |
| --- | --- | --- |
| R1 | FAIL | The guard is HARD, but the current file has 26 HARD non-distinct delta violations. |
| R2' | FAIL | `vpw-log.md` still routes all undeclared people to crowd, contradicting seeded individual default/promotion. |
| R3 | FAIL | The frozen suffix byte-lock holds, but `forge.py` still states global warm bias as governing law. |
| R4 | PASS | VPW, grammar, critics, and examples restore symbolic/map/number-object/reaction/empty-world/hero-object as first-class and make literal one option. No contrary live doctrine found. |
| R5 | FAIL | The intended prefix-shaped unknown token HARD-fails, but arbitrary unknown pose tokens bypass the catalog check. |

## Verification

- `py -3 -m pytest -q` on all 9 touched Python test files: PASS, 239 passed in 9.20s.
- `py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`: FAIL, 26 HARD violations and 39 heads-ups (exit 1).
- R5 fixture: `r5-pose-bite.json` confirms `action-not-in-catalog` HARD-fails and catalog `action-powerstance` passes; `invented-pose` bypasses (no HARD).
- Byte-lock: PASS. `visual-grammar.md` suffix header and `shots.json.global_prompt_suffix` are byte-identical: 535 UTF-8 bytes, SHA-256 `ce1bc8e02c8678a131018761053d67a1746350fc5d77727c2eb7227ef4c548bb`.
- Diff hygiene: `git diff --check` and `git diff --cached --check` produced no whitespace errors.

Finding counts: HIGH 2, MEDIUM 1, LOW 1.

## Fix round 1

- R5 closed-world resolution: `.claude/skills/visual-prompt-writer/scripts/lint_shots.py:2101-2144,2350-2362,2565` now resolves every backticked token against the declared channel registry, approved video library, and the video-local closed cast declaration; no prefix-shape bypass remains. `.claude/skills/visual-prompt-writer/scripts/test_new_guards.py:457-467` covers `invented-pose`, and `r5-pose-bite.json:2-19` now records the three expected HARD outcomes. Freestyle prose poses are explicitly critic-judged at `references/critics.md:54-55`.
- R2' cast routing: `vpw-log.md:5,7` now promotes individual human beats to seeded cast and reserves crowd-tier staging for a mass-story beat, while retaining the late-1980s dress setting. No blanket crowd fallback remains in the declaration.
- R3 tail mechanics: `.claude/skills/image-generation/scripts/forge.py:285-286` now describes the provider's last-instruction weighting and tail-carried line weight, scene palette, and red-accent constraint without asserting warm bias. The frozen suffix bytes were not changed; grep of all touched skill files found no other warm-bias-as-law comments.

### Re-verification

- All 9 touched pytest files: PASS, 239 passed in 15.78s.
- Current `shots.json` lint: expected exit 1 with exactly 26 HARD R1 violations and 39 heads-ups; no R5 false positives.
- R5 fixture: `action-not-in-catalog` HARD-fails; `invented-pose` HARD-fails; catalog `action-powerstance` passes.
- Byte-lock: PASS — grammar header equals `shots.json.global_prompt_suffix`, 535 UTF-8 bytes, SHA-256 `ce1bc8e02c8678a131018761053d67a1746350fc5d77727c2eb7227ef4c548bb`.
- Diff hygiene: `git diff --check` PASS; `shots.json` remains unmodified.
