# P10 boss spec — production-shape codex composer (post-P9 rebuild)

Authorized by Daniel 2026-08-13 after the P9 probe round closed all four cause buckets.
P10 replaces the P7/P8 hand-contract composer with the production prompt shape and an
unmutated forge slate. Probe evidence: B2 (plate-as-base + lean prompt, room-MAE 19.0),
C (degloss strip, M2 0.867), D (production shape, best register), A1/A2 (no gloss
ceiling). Reports: `.superpowers/sdd/2026-08-11-codex-image-engine/p9-investigation/`
+ `p9-probes/`.

## Design laws (each traces to a P9 finding)

1. **Slate integrity (finding B).** The slate comes from `forge.cmd_batch` derivation and
   is NEVER mutated: every seed role forge assigns survives — place plates, chain
   parents, STEP-1 figure plates, lettering exemplar, `scene-style-tile`. No trims
   beyond forge's own displacement walk. NO Gemini-baseline frames as anchors — that
   role does not exist. The only permitted transform is the P6-era resolution of
   missing staged files (baseline substitution for forge-named earlier scenes;
   fake placeholders in fake mode) — reuse `p6_matched.derive_corpus` mechanics.
2. **Prompt shape (finding D).** Compose EXACTLY this section order, nothing else:
   1. STYLE HEAD: the style-bible §2b STYLE-ONLY descriptor essentially verbatim
      (read at compose time from `visual-kit/style-bible.md`; keep its "gentle soft
      cel shading" — probe D proved the house register needs it; do NOT add P8's
      global gradient/tonal-richness language, and do NOT add a full-matte clause).
   2. SEED ROLES: one line per seed, labeled by index, one role per concern.
      Place/chain-parent plates use BASE-EDIT preservation language (finding B2):
      "Image N: the established <place> — reproduce this frame's room EXACTLY:
      geometry, layout, furniture, palette, line weight and lighting; change ONLY
      <the shot's delta>." Figures: "character reference — match exactly — do not
      copy its background or style." Lettering exemplar and style tile keep their
      production role wording.
   3. STILL PROMPT: the shot's `still_prompt` from shots.json VERBATIM (slug
      backticks and all — production sends them; C2 translation NOT applied unless
      forge's own path applies it — mirror what forge sends Gemini, which the R2
      audit documented as the literal still_prompt).
   4. OPTIONAL SURFACE LINE (finding P8-fill-modes, kept minimal): for shots listed
      in `P10_SURFACE_SHOTS` only (ship with exactly L36, L50, L42 — the money
      shots), ONE line: "Surface colors: <clauses from p8-contracts.json surfaces,
      money-material entries only>." Nothing else from the P8 contract machinery.
   5. TAIL: the video's `global_prompt_suffix` verbatim, then ONE hardened Avoid
      line = production's implied avoids + the render-vice list: "Avoid:
      photorealism, painterly or 3D-render look, specular highlights, glossy or
      plastic or metallic sheen, reflections, ambient occlusion, global gradients,
      bevels, rim light, bloom, volumetric light, 3D material rendering, heavy
      solid-black ink, on-screen narrator or host face, logos, watermark,
      depth-of-field blur, bokeh, soft focus, words, letters, numerals or signage
      [EXCEPT-clause per lettering law below]."
   Target length 1,300–1,900 chars. HARD assert < 2,600 (production's own band) —
   a shot that composes longer is a BLOCKED-report case, not a trim case.
3. **Lettering (doctrine still HELD by Daniel — machinery only).** Shots whose forge
   slate carries the lettering exemplar get "EXCEPT the exact string(s): <strings>"
   in the Avoid line, strings taken from the P7 lettering fields (explicit
   lettering_strings — the fix round inlined them). Others keep the full ban.
4. **Deltas REPLACE (finding C-contradictions).** `--deltas <json>` maps shot →
   {section_key: replacement_text}. Recompose swaps the named section's content;
   appending anything to a composed prompt is forbidden by construction. Section
   keys: style_head, seed_roles, still_prompt, surface_line, tail_avoid — plus
   "extra" which is REFUSED with an error naming this law.
5. **Encoding hygiene (mojibake finding).** All prompt writes: UTF-8, newline="\n".
   Before writing, assert the composed text contains no mojibake sequences
   (reject on regex `â€|Ã.` class patterns) — the P8 archives shipped double-encoded
   em-dashes to the model. Find and fix the actual double-encoding source in the
   shared write/read path your driver uses (inspect how p7/p8 built + archived
   prompts; the archive at `_codex/prompts/*.txt` shows the corruption). State the
   root cause in your report.
6. **Targets + naming.** Same 8 shots for comparability: L27 L28 L32 L33 L35 L36 L42
   L50. Staged names `<shot>-p10-match-r1` (r2 for delta re-gens). Results dir via
   REPORT_HOME like p8. Resume banking, GO-flag gate (exit 2 without
   `--i-am-the-boss-with-p10-go`), fake mode against `_fake_codex.py`.
7. **Engine untouched.** forge_codex.py is NOT edited (post-fix state @ 9f39df99 is
   the contract: use compose_fn seam + with_style_anchor API where a tile is the
   5th slot). forge.py zero-diff stands.

## Deliverables

`p10_matched.py` + `test_p10_matched.py` (scratch-codex-image-engine/). Tests
fake-first: section order pin (byte-level for one golden shot — L28), §2b head
sourced from the bible file (mutation: edited bible changes composed head), seed-role
base-edit language present for chain-parent shots and ABSENT for place-root shots,
still_prompt verbatim containment, surface line exactly for L36/L50/L42 and no
others, char-band assert, delta REPLACE semantics (replacement changes exactly one
section; "extra" refused; recompose deterministic), mojibake reject pin (poisoned
spec string → hard error), lettering EXCEPT wiring, fake 8/8 + resume + gate.
Sibling suites stay green (engine 132, p6 8, p7 15, p8 9, p9 n/a script). Entropy
zero-hit. No real generation (BLOCKED if a step seems to need one). No commits.

## Report

Files + line counts, exact test counts (yours + siblings), the composed L28 and L36
prompts verbatim (fake mode), the mojibake root cause you found, deviations disclosed.
