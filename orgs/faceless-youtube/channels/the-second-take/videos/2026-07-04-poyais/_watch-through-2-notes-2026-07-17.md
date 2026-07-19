# Poyais — Daniel's watch-through №2 notes (2026-07-17, on the R6 render)

Stable IDs M01–M35. Parsed verbatim from Daniel's notes; mapping to shots/cues is in the R7 fix
plan. Target: **this render should be shippable** — precision across the board.

## Visual / image-gen

- **M01 — Paradise chain: SEEDED, not layered.** The Poyais paradise chain must be integrated
  delta-chain frames (everything integrated into the scene), NOT cutout layers over a plate.
  KEEP the improved word-anchored pop timing (cuts land on the spoken words).
- **M06 — Floating book: bigger + CENTERED on screen.** Backdrop is fine as-is.
- **M10 — Five-star-experience shot:** book more centered but BIGGER — same size as the M06
  floating book (the two must match). Stars stamped ON the book (or at least centered), not
  floating loose.
- **M16 — Savings→Poyais-dollars arrow: center it.** SYSTEMIC: diagnose why animations place
  elements too far toward the top of frame across the board.
- **M17 — Colombia / Chile / Peru:** in the later shot, spawn the 3 guys who stand next to
  MacGregor in the earlier shot, in their places, labelled Colombia / Chile / Peru, each cued to
  his country being spoken.
- **M18 — Thought bubble: animate it floating/bobbing** like the Poyais book.
- **M22 — L103 ("250 went out, fewer than 50 came home") REGEN.** Overlapping people; it reads
  off. (Resolves R6 open ruling №1: regen, don't accept.)
- **M25 (visual half) — Paris route line: DOTTED, not filled/solid.**
- **M29 — MacGregor intro slide-in cutout: white gaps** remain in what should be transparent
  areas → regen the cutout, redo the matte.
- **M31 — Swamp shot ("took one look… and figured") REGEN:** MacGregor smaller / less dominant
  in the foreground (still seeded off the swamp scene) so the thought bubbles can start from the
  top-right of his head.
- **M32 — The two FAKE stamps still aren't aligned to their respective documents.** Align them.
- **M35 — Global bar: stamps and animations aligned; shippable precision everywhere.**

## SFX

- **M02 — Record scratch: MOVE to just before "so what happened",** with a LONGER pause,
  instead of its current spot.
- **M03 — Remove the SFX on MacGregor's entrance.**
- **M07 — Add halo vocal "ahhh" SFX over the floating book.**
- **M08 — Magical whimsical SFX (the LONGER variant): add between the floating book and the
  opening-of-pages — AND keep one during the gold ("both actually, why not").**
- **M11 — FICTION stamp over Strangeways: same slam effect as the other stamps + the slamming
  boom SFX like the others.**
- **M12 — After "Strangeways didn't exist": add a booing SFX + a pause** before the next scene
  and VO continue.
- **M14 — Add a round-of-applause SFX after "Did I mention he'd made a flag",** landing in that
  pause.
- **M19 — Add halo vocal "ahhh" SFX over "everyone wanted in"** (like the book one).
- **M20 — Crack SFX cues during "finally cracked"** — currently overlaps the next scene.
  SYSTEMIC LAW: most SFX should get an authored pause so they finish WITHOUT overlapping the
  next image/VO scene; the underlying music continues.
- **M21 — Buzzer ("no") SFX + pause after MacGregor's grant being cancelled.**
- **M23 — MacGregor-with-halo shot: REPLACE the current halo SFX with the vocal "ahhh" halo.**
- **M27 — Remove the whoosh over the ship moving in the super-early scene.**

## Pauses

- **M04 — No pause after "jewellery".**
- **M05 — "foreign medal pinned to his chest" → "So to sell…": pause WAY too short.** Lengthen.
- **M09 — Between floating-book and opening-book shots: authored pause holding until the
  whimsical SFX (M08) is over.**
- **M13 — SYSTEMIC: more pauses across the board.** The manual stitching pauses for
  within-sentence stitches (that render should stitch) aren't really being detected — fix the
  logic so they land.
- **M24 (pause half) — Longer pauses after "was already long gone".**
- **M25 (pause half) — "Went to Paris instead": longer pause.**
- **M26 — Investigate the rendering misstep / weird pause at "let him walk".**
- **M30 — Remove the audio pause after the "eight hundred thousand acres" beat.** (Map against
  M04 — may be the same cue or a distinct one.)

## Music

- **M15 — SYSTEMIC: during pauses, do NOT cut/dip the music** — bed continues through authored
  pauses. Full cuts stay ONLY for human-cost beats (where mostly everything cuts).
- **M24 (music half) — After "was already long gone": switch music to the more comedic track.**
- **M28 — Music at "It all started with a soldier": the more comedic track as well.**
- **M33 — The opening comedic track ENDS after "made himself the prince"** (before "Making
  things up was nothing new for him").
- **M34 — Span "Making things up was nothing new for him" → "MacGregor picked the perfect
  moment": current track too somber here (fine for later in the video).** Replace with a
  different track, something closer to the current SECOND track's register.

## R6 open rulings — status from these notes

- Ruling 1 (L103): **regen** (M22).
- Ruling 2 (L94 silent strike pops): **KEEP SILENT** (Daniel ruled 2026-07-17, question round).
- Ruling 3 (MacGregor 0.18 travel scale): assumed **accepted** (unflagged; Daniel invited to
  override in a later note).
- Ruling 4 (Fig Leaf): **kept** — the notes lean further INTO its register (M28/M33/M34).

## Daniel's rulings on the M-note ambiguities (2026-07-17 question round)

- **"The more comedic one" (M24/M28/M33) = Monkeys Spinning Monkeys** (upbeat-1) — deliberate
  meme use, sanctioned for the opening span ("It all started…" → "made himself the prince") and
  the post-"long gone" walked-free beat.
- **M34 middle-span track:** Claude picks the closest-to-Fig-Leaf-register track from the
  audition alternates (+ fresh music-forge candidates if none fit); Daniel gates it on the
  render.
- **M01 scope: paradise chain ONLY** reverts to integrated seeded delta-chain frames. The L88
  strike and L94 strikes STAY as cutout layers (strikes are annotations, not scene
  architecture).
