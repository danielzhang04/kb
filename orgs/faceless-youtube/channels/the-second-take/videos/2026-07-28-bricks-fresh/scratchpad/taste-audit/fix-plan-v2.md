# Fix plan v2 — FINAL, Daniel-approved 2026-08-18 (v1 + adversarial verdicts folded in)
Adversarial source: fix-plan-v1-adversarial.md (all its SHIP-WITH-EDIT texts are binding). Preserves every 2026-08-18 reset win. Revert-first. No quotas/whitelists/per-shot rules.

V1 `.claude/skills/visual-prompt-writer/SKILL.md` rule 4: ADD standalone "framing + scale" as a scene fact; DELETE ONLY the fragment ", the payload owning the plane that carries it". KEEP "THREE-PLANE read", "at what scale", "from where the camera sees them".

V2 `channels/the-second-take/visual-kit/visual-grammar.md` header `global_prompt_suffix`:
  (a) DELETE the environment recipe "built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop)" (exact current wording — read the file).
  (b) DELETE ONLY the words "locked 2-3 colour"; KEEP "warm-biased scene palette".
  (c) The red-accent clause STAYS untouched (v1's deletion was killed — era law predates the liked frames).
  Then re-copy the ENTIRE updated suffix VERBATIM into the video's shots.json global_prompt_suffix (lint enforces byte-equality) and update the two suffix pin tests (visual-prompt-writer/scripts/test_doctrine_reset_guards.py; image-generation/scripts/test_forge_style_tile.py) plus any other test pinning the old suffix.

V3 `channels/the-second-take/visual-kit/style-bible.md` §2b: replace the "FULL cel strength / every fill a real colour" chroma-pressure wording with the ERA phrase restored VERBATIM from `git show 38e04261:...style-bible.md` §2b — "simple flat colours with gentle soft cel shading" (verify the exact era words from git, never retype from this plan). KEEP intact: "TINTED WARM", "never drains to greyscale", "a genuinely cold scene cools its LIGHT, never its neutrals". NO new accent sentence. §5 and forge.py tile prose untouched. Update §2b pin tests to the new span.

V4 `visual-kit/visual-grammar.md`:
  §3: restore the positive scale/distance signatures removed by f73c7e44 ("tiny under dominant mass", "wide with air" — pull exact era wording via `git show 6735796d:...visual-grammar.md`); add the standalone-prop rule: a standalone prop keeps its full silhouette + air unless the crop itself is the payload.
  §2 (the crowd/staging owner): add the ONE emergent-loss sentence — when a beat's argument is scale, the background plane carries its own activity: one deep scene with people at more than one distance, never a single populated plane against scenery.
  State the honest net line change in the report.

V5 `.claude/skills/visual-prompt-writer/scripts/lint_shots.py`: do NOT re-key spatial_tier_check to figures.crowd (killed: 67/72 HARD-fails incl. the MATCH template shots). Instead tighten `_REAR_ZONE`: remove/exclude false satisfiers that describe AT-camera staging (the "across the counter" class) and add a negative proximity term so pressed-to-camera crowd wording cannot satisfy the rear-zone test. Requirement: current 246-shot file still lints 0 HARD EXCEPT any shot the v2 re-pass (V9) is about to fix; run lint before/after and report exactly which ids change status.

V6 `visual-kit/visual-grammar.md` §2 + `.claude/skills/visual-prompt-writer/references/critics.md`: fold in the decidable crowd-distance rule — an anonymous crowd must read SMALLER through intervening depth and overlap; a pane/divider label alone is not distance. Replace weaker existing prose in place (grammar §2 is the owner; the critic references it). Same commit as V5.

V7 `.claude/skills/image-generation/SKILL.md` review/style-taste + `scripts/build_review_artifact.py`:
  (a) scope the "filled edge-to-edge" style test to ENVIRONMENTS in place (the anti-sparse test itself survives); non-environment frames are judged by visual-grammar §3 framing/negative-space instead.
  (b) add the lettering-register family-match row to the text-bearing review path (judged vs the locked crude-marker exemplar, orthogonal to spelling) — an honest NEW row, keep it one row.

V8 [separate worker — gen] re-mint `videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png` to the channel ~2.7 face-only standard via the forge flow (NOT deletion — file is gitignored/local and the same exemplar seeded the MATCH shots; this is proportion hygiene, not the R1 cause).

V9 [separate worker — after V1-V6 land] VPW-skill scoped re-pass: crowd planes of L02/L06/L07/L20/L21 (small/receding/depth-separated, keep the good vantage/action and the L20→L21 chain hold) + palette rebalance of L03/L04/L11 (motivated dawn/night stays subordinate; L03 keeps its joke without near-black mass). L09/L12 untouched (motivated). Everything else byte-identical.

ORDER: V1-V4, V6 → V9 re-pass → V5 lint tightening (validated against the post-re-pass file) → V7 any time → V8 parallel.
CONSISTENCY SWEEP (same wave as V1-V7): grep EVERY governing file in this flow (visual-grammar.md, style-bible.md, VPW SKILL.md + references/*, image-generation SKILL.md + forge.py + scripts/*, lint_shots.py, build_review_artifact.py) for surviving references to the deleted/changed spans: "built-but-flat", "locked 2-3 colour", "payload owning the plane", "FULL cel strength", "every fill a real colour" — every echo gets updated or reported; no dead or conflicting doctrine may survive anywhere in the flow.
