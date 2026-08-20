# Doctrine revert edit notes — R1/R2'/R3/R4/R5

## Per-file edits

| File | Before | After | Δ | In-place change |
| --- | ---: | ---: | ---: | --- |
| `.claude/skills/visual-prompt-writer/SKILL.md` | 304 | 300 | -4 | Step 2/3a: genuine-reveal-only chains; seeded-one routing; per-beat depiction and palette; closed primitive/costume catalog with blocked elevation. |
| `.claude/skills/visual-prompt-writer/references/critics.md` | 157 | 159 | +2 | Critic now judges depiction choice, chain necessity/materiality, seeded-one routing, and catalog resolution without quotas. |
| `.claude/skills/visual-prompt-writer/references/shots-schema.md` | 296 | 291 | -5 | Schema prose now requires material progressive deltas, per-beat palettes, catalog-resolved primitives/pinned costumes, and crowd only for mass-story beats. |
| `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` | 2723 | 2744 | +21 | Removed zero-chain pressure; promoted empty/non-material `changed_elements` to HARD; added registry ∪ approved-library primitive resolution and blocked-elevation HARD checks by adapting the existing registry readers. |
| `.claude/skills/visual-prompt-writer/scripts/test_new_guards.py` | 530 | 538 | +8 | Replaced crowd-routing assertions and added compact R5 catalog/elevation coverage. |
| `.claude/skills/visual-prompt-writer/scripts/test_stage_check.py` | 76 | 76 | 0 | Replaced zero-chain requirement coverage with zero-chain-valid and material-delta HARD coverage. |
| `.claude/skills/image-generation/SKILL.md` | 508 | 503 | -5 | Generation contract mirrors genuine reveals, seeded-one routing, per-beat locked palettes, and pre-shot primitive elevation. |
| `.claude/skills/image-generation/scripts/forge.py` | 3220 | 3208 | -12 | Doctrine messages no longer route one person to crowd; style-tile role transfers saturation, never temperature/hues; unknown primitive text is a bypass diagnostic, not authoring permission. No suffix bytes or promotion mechanics changed. |
| `.claude/skills/image-generation/scripts/test_forge_figures.py` | 318 | 312 | -6 | Pins authored 2–3-colour palette language and catalog costume identity law. |
| `.claude/skills/image-generation/scripts/test_forge_style_tile.py` | 348 | 347 | -1 | Pins the new palette-neutral HEAD descriptor while retaining the gated suffix literal unchanged; style tile no longer transfers temperature. |
| `.claude/skills/image-generation/scripts/test_pass1_gate_doc_consistency.py` | 108 | 95 | -13 | Cross-file tests now pin closed-world primitives/elevation while preserving universal cast promotion. |
| `.claude/skills/image-generation/scripts/test_forge_seed_roles_and_delta.py` | 660 | 661 | +1 | Pins saturation-only style-tile role prose. |
| `.claude/skills/image-generation/scripts/test_forge_interaction_and_lettering.py` | 343 | 342 | -1 | Removes the stale claim that an unknown primitive may be authored ahead of minting. |
| `.claude/skills/image-generation/scripts/test_forge_place_and_gates.py` | 997 | 997 | 0 | Removes “default delta authoring” language from the held-expression case. |
| `.claude/skills/image-generation/scripts/test_forge_seed_requirement.py` | 1183 | 1181 | -2 | Refusal tests now promote a lone story-bearer to cast and reserve crowd for a mass-story point. |
| `channels/the-second-take/visual-kit/visual-grammar.md` | 295 | 291 | -4 | Restores first-class non-literal moves and per-beat palettes; chains require a visible story-needed progression; one seeded figure is cheap/default; primitives/costumes are closed-world. |
| `channels/the-second-take/visual-kit/style-bible.md` | 201 | 200 | -1 | Removes global temperature law; locks authored 2–3-colour beat palettes, makes cool/desaturated lows normal, limits the style tile to saturation, and pins catalog costumes. |
| `channels/the-second-take/visual-kit/registry/registry.json` | 670 | 670 | 0 | Removes the style-tile note that claimed warm-neutral doctrine and temperature transfer. |
| `channels/the-second-take/example-shots.md` | 89 | 88 | -1 | Replaces the unregistered base-rig figure, turns the chain example into a real progressive reveal, and restores empty-world/cool-aftermath staging. |
| **Doctrine + tests total** | **13026** | **13003** | **-23** | Net negative. |

## Lint on untouched current `shots.json`

- Command: `py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`
- Result: **26 HARD**, **39 heads-up**.
- R1: **26 HARD** visually non-distinct deltas: `L02, L15, L37, L51, L70, L72, L76, L103, L110, L111, L119, L123, L136, L144, L146, L162, L169, L175, L184, L186, L206, L209, L218, L229, L242, L243`.
- R5: **0 HARD** on the current plan; every pose/expression-shaped token resolves and no elevation flag is present.
- `shots.json` was not edited; SHA-256 remains `FF74B3ADD80083376A0A9E557B5D3D6CC886CFD612B57B0EFF80F0ECFCB6B0C0`.

## Verification

- VPW suite: **271 passed**.
- Targeted generation doctrine/forge suite: **178 passed**.
- Both edited skills pass `quick_validate.py`; all touched files strict-decode as UTF-8, contain no mojibake markers, and edited Python compiles.
- The broader generation suite reached **292 passed / 2 path-sensitive failures** when forced to use a temp directory inside this repo; those two root-walk tests correctly require their temp tree to sit outside a repository, while the sandbox denied the normal external temp root. The touched generation tests all pass.

## Flagged residuals

- The exact `global_prompt_suffix` still says `warm-biased scene palette` in `visual-grammar.md`, current `shots.json`, and its byte-lock tests. It remains byte-identical by the brief's separate gated A/B ruling; grammar header and shot suffix still match exactly.
- Novel semantic materiality cannot be made fully machine-decidable without narrow shot-specific rules. Lint HARD-catches empty declarations and the audit's general no-op shapes (cosmetic-only, explicit low salience, local reposition, secondary fixture/detail, label-only metadata, decorative trim); the critic remains responsible for materially equivalent novel phrasing.
