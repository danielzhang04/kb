# Fix plan v1 — residual taste regressions (synthesized from residual-forensics-claude.md + residual-forensics-codex.md)
2026-08-18, boss session. Revert-first per Daniel. Targets R1-R7 of residual-findings; preserves every 2026-08-18 reset win (warmth tail, vantage, chains, figure-bias, rig fidelity, lettering hygiene).

## Doctrine / code (7 items)

P1 [REVERT] `.claude/skills/visual-prompt-writer/SKILL.md` rule 4 (scene facts): restore the era requirement "framing + scale, the committed scene palette, light/atmosphere, and depth (fore/mid/background)" with scale as a STANDALONE scene fact; delete the "payload owning the plane that carries it" clause (it pulls all humans to one midground plane — R2a cause). Deliberately do NOT restore the era's trailing "filled edge-to-edge". Net −.

P2 [REVERT ×3] `visual-kit/visual-grammar.md` header `global_prompt_suffix` (+ verbatim re-copy into shots.json; lint enforces byte-equality): delete three clauses the era suffix never had — (a) the environment recipe "built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop)" (R2b: describes the flat renders almost literally); (b) "locked 2-3 colour warm-biased scene palette" (R3: made per-shot colour triples mandatory — "teal" went 1%→52% of shots; §5's era "committed warm scene palette" remains the governing rule); (c) the accent restriction "single red accent #d7402b used only semantically (…)" (R4: era L23's decorative hero brick would be illegal today; §4 still pins the hex). Blast: every gen; the two suffix pin tests (test_doctrine_reset_guards.py, test_forge_style_tile.py) update. Net −.

P3 [CHANGE] `visual-kit/style-bible.md` §2b descriptor: replace "FULL cel strength/every fill a real colour" pressure with opaque flat fills at MODERATE base chroma; keep TINTED WARM + "a genuinely cold scene cools its LIGHT, never its neutrals" (today's warmth fix stays); strongest chroma sits on the shot's authored accent where the beat authors one. Blast: every gen + §2b pin tests. Net 0.

P4 [REVERT + 1 sentence] `visual-kit/visual-grammar.md` §3: restore the positive scale/distance signatures removed by f73c7e44 ("tiny under dominant mass", "wide with air"); add the ONE emergent-loss sentence (scale-argument beats populate the background plane — one deep scene with people at more than one distance, never a single populated plane against scenery); state a standalone prop keeps its full silhouette + air unless the crop itself is payload (R7-L13). Compressed in place. Net ≈ 0.

P5 [LOGIC FIX] `lint_shots.py` `spatial_tier_check` (~line 1319): key the spatial test off `figures.crowd: true` instead of the `_BACKGROUND_CROWD` vocabulary match (which exempts exactly the midground crowds that fail); require rear geometry + an explicit relative-scale/plane cue; keep the genuine-mass allowance. Makes the EXISTING era rear-zone clause (visual-grammar :185-187) enforceable — would have hard-failed L02/L07 at authoring. Net ≈ 0.

P6 [CHANGE] VPW SKILL Step 2 + `references/critics.md` composition question: replace the weak rear-zone examples with one visually decidable rule — an anonymous crowd must read SMALLER through intervening depth and overlap; a pane/divider label alone is not distance. Folded into existing sentences. Net 0.

P7 [CHANGE] image-generation SKILL review rubric + `build_review_artifact.py`: (a) replace the global "filled edge-to-edge" style test with visual-grammar §3 framing/negative-space compliance (environments explicitly keep edge-to-edge) — the rubric rewarded L13's crop; (b) merge a lettering-register family-match check into the existing text-bearing review row (judged vs the locked crude-marker exemplar; catches L04-class polished-marker false-passes). Net ≈ 0.

## Asset (1 item)

P8 [ASSET FIX] Delete `videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png` — this video's local exemplar MEASURES 4.34–4.50 head-heights vs the channel standard ~2.7; forge resolves video-local first, so every crowd was faithfully executing a wrong standard (R1c). Deletion makes forge fall back to the channel exemplar (poyais ~2.7). No text change needed — the doctrine already says "match the exemplar"; the exemplar was wrong. Blast: all future crowd gens this video.

## Shots (VPW skill re-pass — after doctrine lands; never hand-edited)

P9 Re-author via the VPW skill, scoped: crowd planes of L02/L06/L07/L20/L21 (small/receding/depth-separated crowd, keep the good new vantage/action/chain holds) + palette rebalance of L03/L04/L11 (motivated dawn/night stays subordinate; L03 keeps the joke without near-black mass). L09/L12 stay (motivated). Then regen exactly those 8 shots.

## Explicitly NOT touched
Style-bible §5 "Rich, not sparse / edge-to-edge" (era text, not the regression); any numeric figure-height quota; warmth-tail/vantage/chain/figure-bias doctrine (reset wins, measure clean); the Feasibility gate; entrance-never-delta; ≤2 delta cap.
