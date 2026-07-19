# Chunk-2 human shot-review feedback — edit log (2026-07-15)

Applying human-directed shot-review feedback to the Poyais authoring files (VPW + motion-planner lane).
Files touched: `shots.json`, `shots.motion.json`, `.claude/skills/motion-planner/references/animation-rules.md`.
Backups: `shots.pre-c2-feedback-2026-07-15.json`, `shots.motion.pre-c2-feedback-2026-07-15.json`.

Encoding law: all reads/writes explicit UTF-8; JSON edited via Python `json` load/dump
(`ensure_ascii=False`). Verified the whole-file round-trip is byte-identical to the original
(the file was authored with `json.dumps(ensure_ascii=False, indent=2)`, no trailing newline), so
programmatic edits produce a clean diff and round-trip the pre-existing mojibake untouched (not
"fixed" — out of scope, and F-encoding forbids silencing a pre-existing artifact by eye).

## Mid-run corrections folded in
- **L44 camera:** use the EXISTING camera vocabulary; the human authorizes a zoom-out exception for
  L44 only. (See schema surprise below — the camera move is not wired in the render engine yet.)
- **L46 (supersedes original point 5):** NOT new baked text. L46 is a faithful static blow-up of the
  prop canonical `assets/library/prop-poyais-banknote.png`. Refinement: the prop carries
  'POYAIS BANK', a '100' cartouche, a centre vignette CONTAINING A BANK BUILDING, and the red wax
  seal — so the old 'central vignette blank' gag is RETIRED; text is prop-inherited, not authored.

## Edits (completed)

**shots.json** (changed shot ids: L33, L40, L41, L43, L44, L46 — confirmed nothing else moved):

1. **L33 — plate + two FAKE-stamp overlays.** `still_prompt` re-authored to the PLATE: two forged
   credentials (knighthood scroll LEFT, clan-chief crest RIGHT) in one matched document template, NO
   stamps (stamps are overlays). Current L33 authored no document titles, so none kept; plate carries
   no text. Note records: PENDING stamp-register audition lock, FAKE cutout gen DEFERRED until the
   exemplar exists.
2. **L40 + L41 — hold the L37–39 table set.** Both `still_prompt`s re-authored to the SAME open
   guidebook on the SAME wooden reading table as L37–39 (was "warm negative-space framing" → now the
   wooden table reads; camera may push closer on the pages but table context holds). L40 note: re-base
   SEEDED off the L37 frame (scenes/L37.png) for set continuity, new farm page content. L41 note:
   chained off L40 (delta #1 on guidebook-riches base, ≤3-delta cap legal). Motion for L40/L41 left as
   fresh baked plates (see schema note — a cross-stage delta-chain plate would HARD-fail the lineage
   lint, so the L37 seed is a gen directive in the note, not a motion plate reference).
3. **L43 — rig reinforcement only.** Appended a STRICT RIG clause to `still_prompt` pinning the
   portrait figure to the seeded cartoon rig (round head, no nose/ears, flat-cel, NOT a realistic
   engraving/portrait). Rest verbatim. Note appended. (Regen is the render fix.)
4. **L44 — full redesign.** `still_prompt`: the L43 study wall seen WIDER — framed oval Strangeways
   portrait with caption 'Capt. Thomas Strangeways' and a BAKED red 'FICTION' stamp diagonally across
   it (post-stamp state), MacGregor beside it POINTING, smug; built/filled study (shelves, desk edge,
   brass lamp). Both text strings quoted verbatim. `cast` → macgregor only (pose `point-at-thing`,
   `expr-smug`); Strangeways is now solely the wall portrait. Removes the SECOND FICTION overlay from
   the video (one fiction is enough).
5. **L46 — faithful prop blow-up (per mid-run corrections).** `still_prompt`: the seeded banknote
   prop held up filling the frame, ALL detail prop-inherited from `assets/library/prop-poyais-banknote.png`
   — 'POYAIS BANK', the '100' cartouche, the bank-building centre vignette, scrollwork, red wax seal;
   no new text, no invented lettering, no blank cut-out; static. The old 'central vignette blank' gag
   RETIRED (contradicted the prop). Quoted 'POYAIS BANK'/'100' marked prop-inherited in the note.

**shots.motion.json** (changed: top-level `_note` inventory + L33 + L44):

- **L33** → `background.mode: plate` with a `plate_prompt` (two matched docs, no stamps) + TWO cutout
  layers `fake-stamp-knight` (at [0.3,0.5], anchor "a knight and a") and `fake-stamp-clan`
  (at [0.7,0.5], anchor "clan chief, none of"), IDENTICAL `cutout_prompt`/`height_frac` 0.3, both
  `animation.style: slam`, staggered by anchor (knight word precedes clan → first-stamp-beat-second).
  cutout_prompt notes the stamp-register is PENDING / cutout gen DEFERRED.
- **L44** → plain baked scene: `background {mode: plate, plate: scenes/L44.png}`, `layers: []`
  (fiction-stamp cutout removed), plus an authored `camera` object (see schema surprise).
- **_note inventory** updated: removed "L44 FICTION stamp", added "L33 FAKE stamps (x2)"; the
  "Camera stays LOCKED" line now records the one authored L44 exception + the wiring gap.

**.claude/skills/motion-planner/references/animation-rules.md** — integrated (not appended) into the
existing "discrete overlay" bullet: stamp/seal/mark overlay cutouts DEFAULT to `style:"slam"`
(stamp-down); `pop`/`fade` reserved for non-stamp pops. Human-confirmed 2026-07-15.

## Stamp-slam sweep result
Enumerated every cutout layer. Genuine stamp/star/seal OVERLAYS were ALREADY `slam`: L10 (FICTION),
L42 (five stars), L43 (FICTION), L68 (SOLD). The new L33 FAKE stamps authored as `slam`. L44 FICTION
removed. NOT flipped (correctly): L23 debunk-icons (town/farm/settler) and L107 anger-mark are
`pop` non-stamp pops; L13/L15/L62/L80 "star" keyword hits are MacGregor's order-STAR medal (character
detail, not an overlay). No `slam` reversals were needed beyond adding the two new L33 layers.
NOTE on "L42 stars: staggered slams": the motion schema has NO stagger/delay primitive, and the five
stars are one graphic row (single cutout). Splitting into five one-star layers would 5× the gens and
still fire on the same anchor (no per-layer time offset exists), so L42 stays a single slam row.

## Schema surprises (report to human)
1. **Camera zoom-out is NOT wired in the render engine.** `build_motion.py::locked_camera` hardcodes
   `{move:"none"}` for EVERY shot and `apply_motion_plan` never reads a plan-level camera key; a
   regression guard even asserts `camera_moving == 0`. The camera VOCABULARY exists only as engine
   tokens (`motion-tokens.json → camera.pull_from: 1.18` = the pull-back/zoom-out dial) kept "for a
   future explicit/authored move." I authored L44's zoom-out in that existing vocabulary
   (`camera: {move:"pull", pan:null, intensity:1.0}` + a `_note`), which lints clean (validate_plan
   ignores extra shot keys), BUT it will NOT render a zoom until the render camera path is wired — a
   render-builder change, out of this brief's scope. Flagged in the L44 `_note` and the top-level
   inventory `_note`.
2. **L44 soft heads-up (intended):** lint_shots now warns L44 "names strangeways but not in cast".
   This is the direct, human-directed consequence of casting macgregor only (Strangeways is the wall
   portrait, seeded off L43). Same named-but-not-cast pattern as pre-existing L08/L17/L92/L107/L110.
   Soft heads-up, exit 0 — not a failure.

## Lint results
- `lint_shots.py shots.json` → **0 HARD violations, exit 0** (32 soft heads-ups, all pre-existing
  categories: >8s anchors, delta durations, named-but-not-cast; incl. the intended L44 one above).
- `lint_motion_plan.py shots.motion.json shots.json` → **0 errors, exit 0**.

## Encoding verification
Added lines scanned by ordinal: 0× U+FFFD, 0× U+00C3, 0× U+00C2 in both files. Only high codepoint
introduced is U+2264 (`≤`) in an L41 note — intentional, valid UTF-8. Pre-existing mojibake in
untouched spans left as-is (out of scope; F-encoding forbids by-eye "fixes").

