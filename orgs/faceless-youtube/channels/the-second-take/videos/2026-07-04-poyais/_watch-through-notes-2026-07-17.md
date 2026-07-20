# Daniel's watch-through notes — full render v1 (2026-07-17)

Master input for fix round R6. Each item has a stable ID; all downstream mapping, planning, and
fixes reference these IDs. Verbatim intent preserved; light structuring only.

## Motion / animation

- **N01** — Sailing animation: the ship should stop on water BEFORE reaching land.
- **N02** — Poyais chain shot: each element (capital city, bank, money, cathedral, prince,
  FICTION) should pop exactly when its word is spoken.
- **N17** — ALL stamps: currently bounce onto screen. They should feel slapped/stamped DOWN —
  no bounce/bob once landed. (Engine-wide stamp behavior.)
- **N20** — "Savings to Poyais dollars": the motion arrow should be center of screen; REMOVE the
  following image that has an arrow embedded in it.
- **N24** — Colombia, Peru, Chile don't line up with the actual map. Animate the labels on where
  they're actually supposed to be.
- **N27** — "No city, no port, no cathedral": each should spawn when its word is said.
- **N28** — "Local king stranded Europeans": slide the king-holding-Poyais-acres-torn-in-half
  over the screen, ending where he is in the actual image — NOT the walking king — then cut to
  the new image.
- **N29** — "No shelter, no supplies, no help": each should appear when its word is said.
- **N33** — The carriage drawn to Italy is messed up: reuse the one to France, and make that one
  a dotted line too.
- **N34** — "Moved to Venezuela": MacGregor figure should be smaller, drawn from Europe; change
  the map to the same one as way earlier; get rid of the red arrow; MacGregor should be the
  moving element.

## Image regen / composition

- **N04** — MacGregor spawning (in the Poyais-chain scene) has white spots (matte fringe).
- **N05** — Make MacGregor a little bigger in that same scene.
- **N10** — "Nobody in London going to buy": thought bubbles should be close to / coming from
  MacGregor's head, not the middle of the screen.
- **N11a** — Knight and clan chief FAKE stamps have white in the background (matte fix).
- **N12** — "Guide to Poyais" floating book isn't centered on screen; regen the background to a
  warm-lit library in the same art style.
- **N13a** — "Ultimate 5-star experience": first frame should be the SAME image as the new
  floating-book + library background (N12).
- **N13b** — Second 5-star frame: stars should be smaller — see ALL the stars.
- **N23a** — SOLD stamp: remove the border so it matches the other stamp-downs.
- **N30** — "Fewer than 50" image is off — overlap between characters. Regen.

## Audio — SFX

- **N03** — FICTION pop (in the Poyais chain): use the louder slam/crash sound, not the current
  stamp SFX.
- **N08** — Remove the ding SFX at the land exchange.
- **N09** — After "rum and jewellery": pause + cha-ching SFX.
- **N11b** — Knight + clan chief FAKE stamps: add the same crash SFX as FICTION (N03).
- **N13c** — 5-star experience: add an approval-type SFX.
- **N14** — Add the magical/whimsical SFX at the (way earlier) fictional-Poyais introduction.
- **N15** — Add the screeching-halt SFX right after the FIRST Poyais FICTION, with a longer
  pause in the audio.
- **N16** — Add a sad trombone at FAKE Strangeways, with a longer pause.
- **N21** — Add whooshes during major scene changes.
- **N22** — REMOVE the sad trombone after "one-man government"; use a different SFX instead.
- **N23b** — SOLD stamp: add the same SFX as the other stamp-downs.
- **N25** — Add a cracking SFX at "until finally cracked".
- **N26** — Add a crashing-down SFX at "Poyais bond crashing down".
- **N31** — Add a halo SFX during "MacGregor treated worse than any man alive".
- **N32** — Add a missing-person SFX during "MacGregor was long gone".
- **N18** — In general: MORE SFX (not crazy, but definitely more).

## Audio — pauses / music

- **N06** — There are NO pauses in the voiceover — why? We built those in. (Diagnose.)
- **N07** — Music should start exactly at "It all started with a soldier named", not before.
- **N19** — Longer pause after "made a flag".
