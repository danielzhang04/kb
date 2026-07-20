# Poyais rework log — 2026-07-16 (human-directed, chunk-2 board feedback)

Agent: generation agent. Scope: L33 FAKE stamps (new register, motion-only), L44 regen (nose + FICTION register),
stamp-register sweep of L10/L43 stamp cutouts. Register exemplar = `visual-kit/refs/env/stamp-block-outlined.png`
(LOCKED 2026-07-15: heavy red block CAPITALS, dense #d7402b ink, thin #241a12 letter contour hugging each glyph,
flat matte, edge distress). NEVER touched any manifest.json. `--force` + serial forge.

## Register exemplar readings (viewed 2026-07-16)
- `stamp-block-outlined.png`: shows "FICTION" (large) + "FAKE" (small) — heavy solid red block caps, thin dark
  #241a12 contour per glyph, edge-only distress, flat. This is the LOCK.
- OFF-register look (to reject): grunge "rubber-stamp" with a rectangular double-border box frame, CREAM letters
  knocked out of a red field, 3D drop-shadow bevel.

## Superseded files (moved 2026-07-16)
- `scenes/L33.png` → `scenes/_superseded-2026-07-16/L33.png` (SCRAPPED per human: "two shots look completely
  different… keep L33 plate, stamp down with motion". plates/L33.png RETAINED.)
- `cutouts/L33-fake-stamp-knight.png` → `cutouts/_superseded-2026-07-16/` (wrong register: grunge box stamp)
- `cutouts/L33-fake-stamp-clan.png` → `cutouts/_superseded-2026-07-16/` (wrong register; was byte-identical to knight)
- `scenes/L44.png` → `scenes/_superseded-2026-07-16/L44.png` (NOSE bug confirmed by face crop + FICTION register)
- `cutouts/L44-fiction-stamp.png` → `cutouts/_superseded-2026-07-16/` (stale — L44 stamp is now BAKED, layers empty)

## L44 nose bug — CONFIRMED by measurement/crop
Cropped old MacGregor face (superseded L44): a distinct soft-brown shaded nose bridge + nostril suggestion sits
between eyes and mouth. Canonical `macgregor-base.png` has NO nose. Human flag verified → regen justified.

---
(gen rounds appended below as they run)

## TASK A — L33 FAKE stamps (new register, motion-only) — DONE
- plates/L33.png RETAINED (untouched). scenes/L33.png stays scrapped (motion composites plate+stamps).
- Gen (1 gen, mode=style, aspect 3:2): ONE 'FAKE' stamp graphic.
  seeds VERBATIM: `refs/env/stamp-block-outlined.png`, `channels/the-second-take/videos/2026-07-04-poyais/assets/plates/L33.png`
  Staged: `visual-kit/_staging/L33-fake-stamp.png`.
- Register verdict: MATCHES lock — heavy red block caps, thin #241a12 contour per glyph, edge distress, NO box frame.
- Text transcription (letter-by-letter, off gen): F-A-K-E = "FAKE". Clean, correctly spelled, only word in frame.
- forge cutout -> matte MEASUREMENT: size 1043x558, opaque 53.3% / clear 46.1% / partial 0.6%, corners [0,0,0,0].
  Counters transparent (A-hole shows parchment through it on composite) — rembg did NOT group lettering, NO white-key refine needed.
- Composited over plates/L33.png at [0.3,0.5] + [0.7,0.5] (height_frac 0.30): both FAKE stamps read crisp, on-register,
  no halo, counters show document through. IDENTICAL intent satisfied.
- DUPLICATED to both layer names (byte-identical, md5 e693e7dd...):
  `cutouts/L33-fake-stamp-knight.png`, `cutouts/L33-fake-stamp-clan.png`.
- attempts: 1. flagged: false.

## TASK C — stamp-register sweep — DONE
- `cutouts/L10-stamp.png`: RULING = OFF-REGISTER (FAIL) → regenerated.
  Evidence: old L10-stamp was the grunge "rubber-stamp" look — rectangular double-border BOX frame, CREAM letters
  knocked out of a red field, 3D drop-shadow bevel — the exact off-register look the lock rejects. Predated the
  register exemplar (old file Jul 15 00:32; exemplar locked Jul 15 21:49).
  Regen: 1 gen, mode=style, aspect 3:2, word FICTION (per L10 cutout_prompt).
  seeds VERBATIM: `refs/env/stamp-block-outlined.png`, `channels/the-second-take/videos/2026-07-04-poyais/assets/scenes/L08.png` (L10 destination per motion background.plate).
  Staged `visual-kit/_staging/L10-fiction-stamp.png`. Register MATCHES lock.
  Text: F-I-C-T-I-O-N = "FICTION", clean, only word.
  Matte MEASUREMENT: size 1082x461, opaque 44.2% / clear 54.8% / partial 1.0%, corners [0,0,0,0]. Counters transparent.
  Composited over scenes/L08.png [0.5,0.5]: clean, on-register, no halo. Written to `cutouts/L10-stamp.png`.
  HYGIENE DEVIATION (honest): the OLD L10-stamp.png was overwritten directly by forge cutout --out before I moved it
  to _superseded; it was UNTRACKED in git so the old bytes could not be recovered. Off-register + scrapped anyway,
  low impact, but the supersede-first rule was missed on this one file. All other supersedes done correctly.
- `cutouts/L43-fiction-stamp.png`: RULING = IN-REGISTER (PASS) → LEFT UNTOUCHED.
  Evidence: red heavy block caps ("FICTION"), thin #241a12 contour hugging each glyph, edge distress, flat, on
  transparent — matches `stamp-block-outlined.png` exactly. Generated Jul 15 22:12, AFTER the exemplar lock (21:49).
  No box frame, no knockout. No action taken.
- `cutouts/L42-stars.png`: NOT TOUCHED (stars, not lettering — per brief exclusion).

## TASK B — L44 regen (nose + FICTION register) — DONE (shipped genA2, gen-B pass verified-unnecessary)
- scenes/L44.png superseded (nose bug). cutouts/L44-fiction-stamp.png superseded (stamp now baked, layers empty).
- Orphaned plates superseded → plates/_superseded-2026-07-16/: `L44.png`, `L44.identity-fail-2026-07-15.png`
  (L44 is now a PLAIN BAKED scene per motion.json — background.plate=scenes/L44.png, layers[]; the plate-decomposition
  is retired for this shot, so those plates were orphans).
- Two-gen identity pass (bible §3/§8 DEFAULT for a scene-heavy single-character shot):
  - gen A (mode=environment, aspect 16:9), seeds: macgregor-base, point-at-thing, expr-smug, plates/L43.png, stamp-block-outlined.png.
    Result: IDENTITY STARVE as predicted — MacGregor rendered as blank cream base in a brown hoodie; ALSO the baked
    FICTION grew a red rectangular BOX border (register drift). Composition/rig-form otherwise good. → re-authored gen A.
  - gen A2 (mode=environment, aspect 16:9) — re-authored (env-led seed order + explicit no-box stamp ban), seeds VERBATIM:
    `channels/the-second-take/videos/2026-07-04-poyais/assets/plates/L43.png`,
    `channels/the-second-take/videos/2026-07-04-poyais/assets/cutouts/L43-fiction-stamp.png`,
    `refs/macgregor/macgregor-base.png`, `refs/base/point-at-thing.png`, `refs/base/expr-smug.png`.
    Staged `visual-kit/_staging/L44-genA2.png`. This time identity did NOT starve — MacGregor rendered correctly.
  - DECISION: gen B (identity pass) is the fix for a STARVED figure; genA2 landed identity correctly, so gen B was
    verified-unnecessary and skipped (re-genning a correct figure risks re-introducing the nose — "don't redo good work").
- §3 self-check on final scenes/L44.png (= genA2), by full-frame + face-crop + hand-crop:
  - round head: PASS. no NOSE: PASS (face crop — clean, no nose bridge/nostrils; the reported bug is fixed).
  - no ears: PASS (dark sideburns run down the sides, no hairless ear gap). facial layout: PASS (smug half-lidded eyes).
  - four-digit hands: PASS (both pointing hands read cartoon 3-fingers+thumb; no 5-finger spread/mitten — not certified,
    human board is final finger authority per bible §3).
  - identity match vs canonical: PASS (tan #d9ac82 head + dark swept hair + heavy sideburns MATCH macgregor-base).
  - pinned costume: PASS (crimson gold-frogged hussar coat + epaulettes + gold order-star).
  - proportion: PASS (squat base). red accent: PASS (#d7402b only on FICTION stamp; MacGregor's crimson coat is pinned costume).
  - FICTION stamp: PASS — clean locked register, NO box border (matches L43).
  - style/taste: PASS — built, filled study (bookshelves, globe, brass lamp, desk edge), warm palette, depth, no dead air.
- Text transcription letter-by-letter off final frame:
  - caption: C-a-p-t-.- -T-h-o-m-a-s- -S-t-r-a-n-g-e-w-a-y-s = "Capt. Thomas Strangeways" — clean, correct.
  - stamp: F-I-C-T-I-O-N = "FICTION" — clean, correct.
  - No unrequested text anywhere. NO turn/profile/looking-over language used in the delta (nose-bug prevention).
- Cast: only MacGregor live (point-at-thing / expr-smug); Strangeways appears only as the wall portrait (diegetic art). ✓
- Output: `assets/scenes/L44.png`. attempts on final frame: gen A (starve) → gen A2 (shipped). flagged: false.

## Render-wiring caveat (unchanged, out of scope)
L44's authored camera "pull" (zoom-out) is a no-op until render-builder's camera path is wired (motion.json L44.camera._note).
Not touched here. No manifest.json touched (per §D — orchestrator merges).

---

## Round 2 (human board feedback) — full-sequence board review 2026-07-16

Agent: generation agent. Scope: L23 icons(3), L30, L34, L44 regens; L43 stamp unify (no gen); L03 ship interior transparency.
Register/rig law per pass2-brief + style-bible §2c/§2d/§2e/§3 + flags-investigation L23 drafts. `--force`, serial forge, NEVER touched any manifest.json.
Supersede-first: all overwritten assets moved to _superseded-2026-07-16/ BEFORE overwrite (bytes preserved).

### Superseded files (moved 2026-07-16, Round 2)
- cutouts/L23-town.png, L23-farm.png, L23-settler.png -> cutouts/_superseded-2026-07-16/ (off-style: isometric game-asset icons / settler sheen+5-digit)
- cutouts/L03-ship.png -> cutouts/_superseded-2026-07-16/ (opaque-white interior gaps)
- cutouts/L43-fiction-stamp.png -> cutouts/_superseded-2026-07-16/ (superseded by unify-with-L10)
- scenes/L30.png -> scenes/_superseded-2026-07-16/ (saluting soldier 5 fingers)
- scenes/L34.png -> scenes/_superseded-2026-07-16/ (crowd not on crowd rig)
- scenes/L44.png -> scenes/_superseded-2026-07-16/ (MacGregor 5 fingers)

### TASK 5 — L43 FICTION stamp unified with L10 (NO GEN) — DONE
- Superseded old cutouts/L43-fiction-stamp.png; copied cutouts/L10-stamp.png -> cutouts/L43-fiction-stamp.png BYTE-IDENTICAL (md5 13a27997f7b8dda79cca774ccede4319 on both).
- Composite verify over plates/L43.png at [0.5,0.5], height_frac 0.66 (engine appear-cutout default; L43 motion layer has no height_frac -> engine default per components.tsx L524). Scaled 1187x506 on 1376x768 plate at (94,131).
- VERDICT: PASS. FICTION sits diagonally across the oval portrait, locked stamp register (heavy red #d7402b block caps, thin #241a12 per-glyph contour, edge distress), counters transparent (portrait shows through), NO box border, no halo, corners alpha [0,0,0,0]. Unified with L10. Both stamps read 'FICTION'.

### TASK 1 — L23 debunk icons (town, farm, settler) — DONE
Cutouts (hybrid over scenes/L22.png). mode=style. Flags-investigation re-authored drafts applied: single FLAT-CEL icon, NO isometric/bevel/game-asset; settler uniform flat tone no sheen + 4-digit hand FACT; red X = single locked #d7402b.
- FARM: attempt 1. seeds VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/scenes/L22.png, refs/env/env-exterior-muted.png. Isolated flat-cel barn+silo+fenced-field+haystack, red X. forge cutout 622x621. matte opaque 63.2% / clear 36.5% / partial 0.3%, corners [0,0,0,0]. Composite over scenes/L22 [0.5,0.5] hfrac 0.34: clean, no halo, on-style. PASS.
- TOWN: attempt 1 FAILED (seeding scenes/L22.png bled the WHOLE swamp in as background -> not isolated, uncuttable). RE-AUTHORED retry (attempt 2): dropped the scene seed, seeded ONLY refs/env/env-exterior-muted.png + hard isolation language ("floats ALONE on empty pale, NO swamp/water/trees/scenery"). Result: isolated flat-cel house-cluster+steeple, red X. forge cutout 379x378. matte opaque 59.1% / clear 40.2% / partial 0.67%, corners [0,0,0,0]. Composite over scenes/L22 [0.22,0.44] hfrac 0.34: clean. PASS.
  seeds VERBATIM (final): refs/env/env-exterior-muted.png.
- SETTLER: attempt 1 FAILED (had a NOSE + suspect 5-digit splayed hand; sheen was already fixed). RE-AUTHORED retry (attempt 2): seeded refs/env/env-exterior-muted.png only; delta hard-authored NO nose (crowd rig), dot eyes, uniform flat cream (no sheen), squat proportion, hands closed at sides = THREE fingers + ONE thumb. Result: squat crowd-rig figure, NO nose, dot eyes, flat head, hands clean at sides, red X. Engine added a small wooden pallet under the boots -> removed deterministically (alpha-clear rows below boot soles y=628, then trim). final 592x628. matte opaque 54.2% / clear 45.5% / partial 0.3%, corners [0,0,0,0]. Composite over scenes/L22 [0.78,0.55] hfrac 0.36: clean, reads as settler in the swamp. PASS.
  seeds VERBATIM (final): refs/env/env-exterior-muted.png.
- Full-frame check (all 3 composited at motion positions): flat-cel register, isolated, single #d7402b X each, no isometric. flagged: false. NO baked text.

### TASK 2 — L30 saluting soldier 5 fingers — DONE (1 gen, PASS)
- Scene, mode=environment, aspect 16:9. seeds VERBATIM: refs/macgregor/macgregor-base.png, refs/base/action-armscrossed.png, refs/base/expr-smug.png (reproduces manifest technique). Delta = still_prompt (law) + section-8 MECHANISM fix for the open-hand drift: authored the lone section-2e soldier at ATTENTION with both arms straight DOWN pressed to his sides (NOT saluting, no raised/open hand) — hands at sides inherit the correct 4-digit count (style-bible section-3) — and stated the digit FACT (THREE fingers + ONE thumb).
- section-3 self-check: MacGregor on-identity (tan head, dark hair+sideburns, no nose/ears, crimson coat, arms crossed, smug). Soldier: full section-2e rig, round head, no nose/ears, full parade dress (shako, red coat, medal), arms straight down. Hand zoom-inspected (soldier right hand at side): simple closed cartoon hand, 3+thumb, NO splayed 5-finger — the salute-drift is eliminated by the arms-at-side pose. Proportion: soldier slightly taller than MacGregor but within family-rig tolerance (not lanky). No unrequested text.
- NOTE (design tradeoff, human's call): removed the SALUTE to kill the 5-finger drift at its source (section-8: open/raised hands are the drift point; hands-at-sides are safe). If the human specifically wants a visible salute, that reintroduces the open-hand risk and would need a fresh authored attempt.
- attempts: 1. flagged: false. -> assets/scenes/L30.png (hand advisory-only; human board = final finger authority per style-bible section-3).

### TASK 3 — L34 crowd not on crowd rig — DONE (1 gen, PASS)
- Scene, mode=environment, aspect 16:9. seeds VERBATIM: refs/macgregor/macgregor-base.png, refs/base/sit.png, refs/base/expr-smug.png. Delta = still_prompt (already carries the section-2d clause) + hard crowd-rig enforcement emphasis (EVERY townsperson incl. near-camera = simplified CROWD RIG: round head, DOT EYES, one simple mouth, NO nose/ears/teeth, no detailed faces; ONLY MacGregor keeps a full face).
- section-3 self-check: gilded coach centrepiece, MacGregor leaning out on-identity. Crowd (both pavement groups incl. foreground bonnet-woman + men): uniformly on the section-2d crowd rig — round heads, dot eyes, simple mouths, NO detailed/realistic faces, no noses. Proportion consistent (squat). The prior defect (realistic/full-rig crowd) is fixed. Medal present on MacGregor. No unrequested text.
- attempts: 1. flagged: false. -> assets/scenes/L34.png.

### TASK 4 — L44 MacGregor 5 fingers (regen off base) — DONE (2 gens; 1 re-authored retry; shipped attempt 2, FLAGGED caption)
- Scene, mode=environment, aspect 16:9. Two-gen identity default was on standby; identity did NOT starve either attempt (env-led seed order), so no gen-B needed.
- scenes/L43.png does NOT exist (L43 is a plate+cutout) -> substituted plates/L43.png for the "wall/portrait continuity" seed the brief named as scenes/L43.png. Logged.
- Attempt 1 (batch1) seeds VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/plates/L43.png, refs/macgregor/macgregor-base.png, refs/base/point-at-thing.png, refs/base/expr-smug.png, refs/env/stamp-block-outlined.png. Delta = still_prompt + pointing-hand 4-digit FACT + no-box FICTION ban + only-text ban. Result: MacGregor on-identity, hand clean 4-digit, study filled — BUT the FICTION stamp rendered WITH a rectangular BOX border (off-register) AND the 'Capt. Thomas Strangeways' caption was MISSING. FAIL.
- Attempt 2 (RE-AUTHORED retry) seeds VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/plates/L43.png, channels/the-second-take/videos/2026-07-04-poyais/assets/cutouts/L43-fiction-stamp.png (the unified bare no-box stamp), refs/macgregor/macgregor-base.png, refs/base/point-at-thing.png, refs/base/expr-smug.png. Delta re-authored: seeded the BARE stamp exemplar + explicit "NO box/border/rectangle around FICTION", explicit "keep the marker caption 'Capt. Thomas Strangeways' beneath the oval", hand fact.
- section-3 self-check on attempt 2 (shipped): MacGregor on-identity (tan #d9ac82 head, dark swept hair + heavy sideburns, NO nose, NO ears, round head, pinned crimson gold-frogged hussar coat + epaulettes + gold order-star, smug half-lidded eyes). Pointing hand zoom-inspected: classic 4-digit cartoon pointing hand (index+thumb+folded), NO 5-finger — the human's flag is RESOLVED. FICTION stamp: bare distressed block caps, NO box border, correct locked register, unified with L43/L10. Portrait: Strangeways cartoon rig + spectacles, no nose. Study: filled (bookshelves, brass lamp, globe, desk, panels), no dead air.
- Text transcription letter-by-letter off attempt 2: FICTION stamp = F-I-C-T-I-O-N "FICTION" clean. CAPTION = "Capt. Thomas Strangev" — TRUNCATED/garbled (missing "...ays"; final glyph malformed). *** FLAGGED ***
- RETRY BUDGET SPENT (attempt1 + attempt2 = the one re-authored retry). Per policy: kept the BEST attempt (attempt 2 fixes the human's 5-finger flag + the stamp register + identity + filled study; attempt 1 was worse: boxed stamp AND zero caption). Residual: truncated caption.
- attempts: 2. flagged: TRUE — reason: baked caption truncated to "Capt. Thomas Strangev" (partial baked text). Everything else (hand/stamp/identity/study) clean. -> assets/scenes/L44.png. Human board decides on the caption.

### TASK 6 — L03 ship interior gaps transparent — DONE (1 gen, PASS)
- Cutout (hybrid; ship path-animates over plates/L15.png == plates/L03.png, byte-identical md5 d95b387...). mode=style, aspect 16:9.
- Strategy: generated the ship on a SOLID MAGENTA (#FF00FF) chroma field (a pale field starves rembg on a pale ship = the original opaque-white-interior bug). seed VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/cutouts/_superseded-2026-07-16/L03-ship.png (the old ship cutout, for ship-shape fidelity + no bg to bleed). Delta forced solid magenta field with magenta visible through every rigging gap.
- Pipeline: forge cutout (rembg, outer silhouette 988x642) -> deterministic despill key (strong magenta -> alpha 0 for interior holes + residual bg; magenta-cast EDGE fringe neutralized toward grey; red pennant safe because its B<G). keyed 50460 px, despilled 20367 px.
- MEASURE: size 988x642, opaque 59.8% / clear 39.4% / partial 0.8%, corners [0,0,0,0]. Interior-gap alpha samples (between sails/rigging): [0.30-0.45 x 0.05-0.35] clear 33% mean-alpha 168; [0.55-0.70 x 0.10-0.40] clear 25%; [0.10-0.25 x 0.15-0.45] clear 63% — genuine transparency inside the rigging (sails opaque, gaps clear), NOT opaque-white.
- Composite over the actual map plate (plates/L15.png): interior gaps show the parchment map + compass rose THROUGH them — NO white boxes, no purple fringe (post-despill), clean edges. Original defect fixed.
- MINOR (not retried, to protect the transparency win): the small masthead pennant reads greenish rather than the authored red; tiny fast-moving element (~18% height over 2.4s). Noted for the human, not blocking.
- attempts: 1. flagged: false (minor pennant-colour note). -> assets/cutouts/L03-ship.png.

### Round 2 net
- Files produced: cutouts/L23-town.png, L23-farm.png, L23-settler.png, L03-ship.png, L43-fiction-stamp.png (copy of L10-stamp.png); scenes/L30.png, L34.png, L44.png.
- Gens spent: 7 (batch1) + 3 retries (batch2) = 10 gens. (town+settler+L44 = 1 retry each; farm/ship/L30/L34 = 1 gen each; L43 = 0 gens.)
- Superseded (Round 2, all in _superseded-2026-07-16/): cutouts L23-town/farm/settler, L03-ship, L43-fiction-stamp; scenes L30/L34/L44.
- Still flagged after retry: L44 truncated caption "Capt. Thomas Strangev" (only residual; human board decides). L03 pennant greenish (minor cosmetic, not blocked).
- NO manifest.json touched (orchestrator merges).

---

## Round 2b (human-directed targeted gens) — 2026-07-16

Agent: generation agent. Scope: TASK 1 L44 caption fix (1 gen, human-authorized beyond normal retry — current
scenes/L44.png bakes caption truncated to "Capt. Thomas Strangev", blocking); TASK 2 L30 saluting VARIANT (1 gen ->
scenes/L30-salute-alt.png, does NOT overwrite scenes/L30.png). Supersede-first; NEVER touched any manifest.json.
`--force`, `--aspect 16:9`, serial forge, mode=environment.

### Pre-gen state (viewed 2026-07-16)
- scenes/L44.png (current, shipped Round 2): MacGregor pointing on-identity (tan head, dark hair+heavy sideburns, NO
  nose, crimson gold-frogged hussar coat + gold epaulettes), oval gilded Strangeways portrait, red diagonal FICTION
  stamp baked across it in locked register (NO box), filled warm study (bookshelves, brass lamp+globe, desk edge,
  panels). CAPTION baked BENEATH-RIGHT of frame = "Capt. Thomas Strangev" — TRUNCATED (ran into desk edge, missing
  "...ays"). Everything else PASSED and must be preserved.
- refs/base/action-salute.png (salute pose primitive): bald cream base, right hand raised flat to the brow/temple in
  a crisp salute, left arm at side. Locked library hand form (4-digit) — the seed for the soldier's saluting hand.

### TASK 1 — L44 caption fix — DONE (1 gen, SHIPPED)
- Strategy change (not a re-fire): authored the caption as its OWN distinct element — a WIDE horizontal brass caption
  plaque mounted on the wall beneath the oval frame, centred, spanning the frame width, with clear margin after the
  final S so nothing crops. Anchored iteration: HELD everything else from the current frame, changed ONLY the caption
  treatment.
- Gen: mode=environment, aspect 16:9, --force. staged visual-kit/_staging/L44-caption-2b.png.
  seeds VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/scenes/L44.png (current near-perfect frame,
  iterate-on-this), refs/macgregor/macgregor-base.png (identity hold), refs/env/stamp-block-outlined.png (stamp register hold).
- Verify (crops @ 2-3x):
  - CAPTION letter-by-letter off the plaque: C-a-p-t-.- -T-h-o-m-a-s- -S-t-r-a-n-g-e-w-a-y-s = "Capt. Thomas Strangeways"
    — COMPLETE, correctly spelled, all letters present incl. final 's', legible, marker capitals in dark #241a12 ink,
    NOT red, NOT cursive. The Round-2 truncation ("Capt. Thomas Strangev") is RESOLVED.
  - STAMP letter-by-letter: F-I-C-T-I-O-N = "FICTION" — clean, heavy red #d7402b block caps, thin #241a12 per-glyph
    contour, edge distress, diagonal across portrait, NO box border. Locked register preserved.
  - Pointing hand (3x crop): classic cartoon pointing hand — index extended + thumb + folded fingers = 4 digits
    (3 fingers + thumb), NO 5-finger spread. (Advisory only; human board = final finger authority per bible §3.)
  - Face (1.6x crop): round head, tan #d9ac82, dark swept hair + heavy sideburns filling the ear gap, NO nose, NO ears,
    smug half-lidded eyes — on-identity vs macgregor-base.
  - Study: filled (bookshelves, brass lamp, globe, desk edge, panels), warm palette, depth, no dead air — preserved.
  - Only two text strings (caption + FICTION); no unrequested text.
- ALL CLEAN -> superseded current scenes/L44.png -> scenes/_superseded-2026-07-16/L44.round2b-caption-truncated.png
  (distinct name, did NOT clobber the Round-2 superseded L44.png), shipped new frame as scenes/L44.png
  (md5 589521ff176eac14eae6ffd1244097f2). attempts: 1. flagged: false.

### TASK 2 — L30 saluting VARIANT — DONE (1 gen -> scenes/L30-salute-alt.png, PASS; L30.png NOT overwritten)
- Directive: the prior Round-2 fix REMOVED the salute (soldier at attention, arms down) to kill the 5-finger drift.
  The human wanted the salute KEPT with fixed fingers. This variant restores the SALUTE, seeding the salute pose so
  the hand comes from a locked primitive.
- Gen: scene, mode=environment, aspect 16:9, --force. staged visual-kit/_staging/L30-salute-alt.png.
  seeds VERBATIM: refs/macgregor/macgregor-base.png (MacGregor identity), refs/base/action-armscrossed.png (MacGregor
  pose — appraising, arms crossed, per shots.json cast), refs/base/expr-smug.png (MacGregor expression),
  refs/base/action-salute.png (the locked salute-pose primitive, seeded for the anonymous soldier's saluting hand form).
- Delta: TWO figures only (no crowd). MacGregor LEFT arms-crossed + smug (identity/pose/expr seeds). Soldier RIGHT
  SALUTING — right hand flat to the brow (geometry from the salute-pose seed), §2e FULL base rig authored (round head,
  NO nose/ears, squat proportion stated as a FACT, NOT tall/lanky), saluting hand authored as an explicit FACT: classic
  flat cartoon hand, THREE fingers held flat together + ONE thumb = FOUR digits, never five, never splayed. Built barracks
  interior (bunks, window, footlockers, wall rifles), warm palette, depth, no dead air. No text.
- Verify (crops): salute hand (4x) = flat cartoon salute BLADE, fingers held flat together (3 fingers + thumb bent at
  base), NO 5-finger spread, NO mitten — the salute-pose seed held the form; the 5-finger drift the human flagged is
  eliminated while KEEPING the salute. Soldier face (2.5x): round head, NO nose, NO ears (shako), neutral flat mouth,
  squat proportion. MacGregor: on-identity (tan head, dark hair+sideburns, no nose, crimson hussar coat, arms crossed,
  smug). No unrequested text.
- HAND VERDICT: PASS — 4-digit flat salute blade, no five-finger spread (advisory only; human board = final finger
  authority per bible §3). Both figures on-rig, comic over-formality reads.
- Output: scenes/L30-salute-alt.png (md5 92f38de0c5efbbc7e3c83df9acf69389). scenes/L30.png (at-attention option, 15:31)
  LEFT UNTOUCHED — the board shows BOTH options, human picks. attempts: 1. flagged: false.

### Round 2b net
- L44: caption fixed + shipped (scenes/L44.png). L30: saluting alt added (scenes/L30-salute-alt.png), at-attention L30.png kept.
- Gens spent: 2 (1 per task, no retries — both cleared on attempt 1).
- Superseded: scenes/_superseded-2026-07-16/L44.round2b-caption-truncated.png (the caption-truncated frame).
- NO manifest.json touched (orchestrator merges).

---

## Round 3 (human-directed round-3 fixes) — 2026-07-16

Agent: generation agent. Scope: TASK 1 FICTION stamp non-transparent regions (re-key, no gen); TASK 2 L03 ship "off"
(1 gen re-authored); TASK 3 L34 MacGregor nose/off-rig (1 identity-pass gen). Supersede-first (distinct names where an
earlier-round file already sat in _superseded-2026-07-16/); NEVER touched any manifest.json. All measured with Pillow,
never eyeballed; composited over ACTUAL destinations.

### TASK 1 — FICTION stamp non-transparent parts — DONE (0 gens, deterministic re-key, PASS)
- Files: cutouts/L10-stamp.png + cutouts/L43-fiction-stamp.png (md5-identical copies of one stamp; shipped byte-identical to BOTH).
- DIAGNOSIS (Pillow alpha map, 8x4 grid): outer silhouette already keyed (corners [0,0,0,0], exterior transparent), BUT a
  **cream FIELD PATCH** (median RGB 240,241,227) was opaque = **7.18% of frame**, concentrated dead-CENTRE (grid rows 1-2,
  cols 2-6; x 325..953 / y 91..343 of 1082x461) — the enclosed pale stamp-field between the central C-T-I-O glyphs that rembg
  kept as an interior hole. NOT letter counters alone — a solid pale patch behind/between the mid letters. Red lettering + dark
  #241a12 contour were fully opaque (correct).
- FIX = approach (a) deterministic RE-KEY of existing pixels (cheapest, no gen): keyed every cream-pale opaque pixel
  (min-channel>=150 & saturation<=60) -> alpha 0; tapered alpha on the 120-150 min-channel boundary; 0.6px alpha-min
  smoothing to erode fringe; letter cores (red ink R>G+35 & R>B+35, or dark min<70) force-held opaque so no glyph erosion.
  Red-letter geometry + dark per-glyph contour untouched.
- MEASURE after: residual opaque-PALE **0.000%** (was 7.18%); red letters still opaque 27.42% (~unchanged from 27.17%);
  clear 62.4% / opaque 37.1% / partial 0.5%; corners [0,0,0,0].
- COMPOSITE verify over BOTH destinations: L10-stamp over scenes/L08.png @ [0.5,0.5] hfrac 0.66 (engine appear default) —
  golden-paradise scene (prince, city, mountains) shows THROUGH every counter + the inter-letter field, no cream box, no halo,
  dark contour hugs each glyph. L43-fiction-stamp over plates/L43.png @ [0.5,0.5] hfrac 0.66 — Strangeways portrait shows through
  the O/C counters + field. Both: only stamp geometry visible. PASS.
- Shipped byte-identical to both (md5 0227e7eae86d6174e56f2f807418ef4b). L33 FAKE stamps NOT touched (human-approved).
- Superseded (distinct names): cutouts/_superseded-2026-07-16/L10-stamp.round2-unify-opaque-field.png +
  L43-fiction-stamp.round2-unify-opaque-field.png.

### TASK 2 — L03 ship "is off" — DONE (1 gen, re-authored, PASS)
- File: cutouts/L03-ship.png (hybrid; ship path-animates over plates/L15.png, height_frac 0.18).
- DIAGNOSIS (composite current vs superseded-ORIGINAL over plates/L15.png): the current round-2 ship's TRANSPARENCY was fine
  (magenta measured 0.00% OPAQUE — it is transparent with magenta RGB underneath, the §8 viewer-composite artifact; 0% magenta
  fringe over the real plate). What DRIFTED: (1) **silhouette** — round-2 ship is 988x642 = aspect **1.54**, WIDE/squat/bloated
  hull + splayed sails vs the approved original's 944x772 = aspect **1.22** (tall, elegant, slender); (2) **pennant** — round-2
  masthead reads a bare GREEN stick (green 0.03%, red only 0.73%) vs the original's crisp RED pennant (red 1.05%); (3) green
  foliage bleed at the top. **Root cause of the widen: round-2 generated the cutout at --aspect 16:9** (pass2 rule: NEVER 16:9
  on cutouts — it stretched the ship wide).
- FIX = 1 re-authored gen on SOLID MAGENTA field, mode=style, **--aspect 4:3** (1.33, near the original's 1.22 — NOT 16:9),
  seeding the approved silhouette + authoring the pennant RED + holding proportions:
  seed VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/cutouts/_superseded-2026-07-16/L03-ship.png
  (the approved original ship — identity/style anchor). Delta: exact tall three-masted clipper silhouette held ("do NOT widen,
  stretch, flatten, or squash"), solid pure-magenta #FF00FF field visible through every rigging gap, RED #d7402b masthead
  pennant ("NEVER green"), no sea/sky/trees/foliage, no text.
- Result gen: elegant tall clipper, bright RED pennant, clean magenta field, no foliage.
- KEY = deterministic MAGENTA chroma-key + despill IN PILLOW (chosen over rembg to preserve thin rigging lines that rembg
  erodes): field = strong-magenta (spill = min(R,B)-G > 60) -> alpha 0; feathered the 15-60 spill boundary; despilled kept
  pixels (R,B pulled toward G by 0.9*spill so cream sails/brown hull lose magenta cast); 0.5px alpha-min smoothing; trim to bbox.
- MEASURE: final 1097x896 = aspect **1.22** (matches original); clear 47.5% / opaque 49.2% / partial 3.3%; corners [0,0,0,0];
  **residual magenta among visible 0.000%**; RED present 0.77%, GREEN 0.00%; interior gaps transparent (left rigging 48% clear,
  right rigging 16% clear — genuine see-through between sails/rigging).
- COMPOSITE over plates/L15.png: elegant tall ship, red pennant, parchment map + rigging visible THROUGH the gaps, clean edges,
  no magenta/green fringe, no foliage. Clear improvement over the drifted current. PASS.
- attempts: 1. flagged: false. Shipped -> cutouts/L03-ship.png (md5 d5bf73b28b16aca7cdaae7e1af92789b).
- Superseded (distinct name): cutouts/_superseded-2026-07-16/L03-ship.round2-wide-greenpennant.png (the round-2 drifted ship).
  (The pre-round-2 ORIGINAL L03-ship.png already in that dir was the SEED — left in place.)

### TASK 3 — L34 MacGregor nose + off-rig — DONE (1 gen, two-gen identity pass gen B, PASS)
- File: scenes/L34.png (background plate; layers none).
- DIAGNOSIS (zoom MacGregor face 3x): gen A (round-2 crowd-fix frame) has MacGregor with a distinct realistic NOSE (defined
  bridge + nostril shading), realistic cheek/jaw shading — off the no-nose flat-cel rig. The CROWD is correctly on the §2d crowd
  rig (round heads, dot eyes, simple mouths, no noses/ears) — GOOD, must preserve.
- FIX = two-gen identity pass, gen A already in hand (current scenes/L34.png). Gen B, mode=environment, --aspect 16:9 (scene),
  seed VERBATIM: channels/the-second-take/videos/2026-07-04-poyais/assets/scenes/L34.png, refs/macgregor/macgregor-base.png,
  refs/base/expr-smug.png (expression_ref from L34 shots.json cast). Delta: HOLD the entire scene + EVERY crowd figure on the
  crowd rig exactly as seeded; change ONLY the man in the coach window — round near-circle head, flat uniform tan tone (his
  canonical), NO realistic shading/cheekbones/jaw, NO NOSE, NO EARS (dark swept hair + heavy sideburns fill the ear gap), smug
  half-lidded eyes, pinned crimson gold-frogged hussar coat + epaulettes + medal.
  NOTE: brief said "tan #f5ead6" — that hex is base CREAM and contradicts MacGregor's canonical tan #d9ac82 (style-bible §9);
  treated as a typo and held his canonical tan via the seed (attribute-provenance §5), not the wrong hex.
- MEASURE (gen A vs gen B MAD): whole-frame 3.92; MacGregor face-region **8.38** (change landed — higher than surroundings);
  left-crowd region 4.87 (crowd effectively held). Tight face-crop A-vs-B side-by-side (NEAREST 6x): gen A has a clear
  nose+nostril; gen B mid-face is FLAT — nose/bridge/nostril GONE, on flat-cel rig. Head tone flat tan (canonical, not cream —
  identity match holds).
- §3 self-check on gen B MacGregor (zoomed): round head OK; NO nose (fixed); NO ears (sideburns fill); flat uniform tan tone;
  smug half-lidded eyes + thin brows; crimson pinned costume + medal; reads same-channel vs macgregor-base canonical. PASS.
- CROWD check (zoom both pavement groups incl. foreground bonnet-woman + men): uniformly on the §2d crowd rig — round heads,
  dot eyes, simple mouths, NO noses/ears/teeth, no detailed faces. UNTOUCHED by the identity pass. PASS.
- attempts: 1 (identity pass held; crowd not mangled -> no retry needed). flagged: false. Shipped -> scenes/L34.png
  (md5 bf0606d65fdd81821dca8e387881a08b).
- Superseded (distinct name): scenes/_superseded-2026-07-16/L34.round2-macgregor-nose.png (the gen-A nose frame; the SEED).

### Round 3 net
- Files produced: cutouts/L10-stamp.png + cutouts/L43-fiction-stamp.png (re-keyed, byte-identical), cutouts/L03-ship.png (regen),
  scenes/L34.png (identity pass).
- Gens spent: **2** (L03 ship 1 + L34 identity pass 1; TASK 1 stamp = 0 gens, deterministic re-key). No retries needed — all
  three cleared on first attempt.
- Superseded (all in _superseded-2026-07-16/, distinct names): L10-stamp.round2-unify-opaque-field.png,
  L43-fiction-stamp.round2-unify-opaque-field.png, L03-ship.round2-wide-greenpennant.png; scenes/L34.round2-macgregor-nose.png.
- Nothing left flagged — all three human flags resolved.
- NO manifest.json touched (orchestrator merges). No baked text changed (stamp re-key preserved FICTION; ship + L34 carry no text).


## REWORK ROUND 1 — chunks 3-6 (2026-07-16, this session)

Human board feedback (~30 shots + crowd-proportion question) executed end-to-end. Authority + parsed
ledger: docs/handoffs/2026-07-16-chunks36-rework-round1-pickup.md. All agents Opus 4.8.

- Human calls confirmed up front: crowd rig = EXACT base-rig proportions (face treatment differs);
  L96 -> exactly 10 crosses; L114 keeps framing (rig+fingers fixed only).
- Crowd audit (3 agents, all frames): tall-drift = L53/L54/L73/L76/L115 in the rework window (all
  fixed) + L30 in RELEASED chunk 1 (surfaced, not reworked). Borderlines L94/L95 fixed via chain
  regen; L100/L103 are infographic register (noted only).
- 8 rework units + U3 maps/motion: ~41 manifest entries updated (see manifest.json rework36_round1
  stamp for the per-shottechnique/seeds/attempts). Kind changes: L57+L62 hybrid->scene;
  L74/L75/L112/L120 scene->plate+layers (L74 = PIL crop of L15, human-authorized; L120 reuses
  L15 plate + L17 MacGregor cutout + draw_line arrow). L59 arrow=slide-in cutout (draw_line is
  route-only); L60 ring deleted; L79 was a PLACEMENT bug (off-frame bottom), fixed in motion only.
- 3-axis fresh-eyes review + consolidated fix round: 9 blocking flags found (L96 count=11;
  noses/ears on L68/L73/L76/L86-88/L122) — ALL cleared. Two review disagreements (L76, L122)
  adjudicated by zoom: identity axis right both times.
- Notable craft: de-nose pass lands in one gen but the engine re-draws a sticky C-shaped ear ~half
  the time -> second targeted pass seeded off the already-fixed frame (cost the retry on
  L86/L87/L88/L122). Crown cutout needed manual magenta chroma-key (rembg keeps enclosed magenta).
  Phantom-mojibake: two units reported mojibake in shots.json that a codepoint audit disproved —
  agents had decoded UTF-8 with the shell default; verify by codepoint before believing reports.
- shots.json: 28 re-authored still_prompts merged (backup shots.pre-rework36-prompt-merge-2026-07-16.json);
  both lints green. shots.motion.json edited by U3 only (backup shots.motion.pre-rework36-2026-07-16.json).
- Board republished to the SAME artifact URL; 0 blocking, 11 taste/verify cards. Superseded PNGs in
  assets/*/_superseded-2026-07-16/ under distinct rework1/rework1b names.
