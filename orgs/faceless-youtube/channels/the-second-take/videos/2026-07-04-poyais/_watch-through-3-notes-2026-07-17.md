# Poyais — Daniel's watch-through №3 notes (2026-07-17, on the R7 render)

Stable IDs P01–P30 + three rulings from the question round. This is the R8 source-of-truth.

## Rulings (Daniel, question round)

- **R8-A:** The singing is in the MIDDLE span (1:17–4:08, Ascending the Vale) → replace with
  the next-best NON-VOCAL non-meme candidate, verified by measurement (P07).
- **R8-B:** Universal pause law = **+0.5s after every sentence** (0.3s for chained 1–2-word
  sentences), ON TOP of VO prosody, and authored pauses **STACK** on top of it (not max).
  Engine-wide, this video and all future ones (P17).
- **R8-C:** **Monkeys to the very end** — somber tail + final dry span DELETED; Monkeys carries
  the finale and the end card; the two earlier human-cost dry spans stay fully dry (P29).

## Timing / engine

- **P01 — Paradise chain retiming.** Elements appear one beat LATE: bank pops at "its own
  money", money between "money" and "cathedral", cathedral+prince both during "prince".
  Diagnose the systematic shift; each element must appear exactly on its own word.
- **P02 — Stamps hit and FREEZE.** Currently slam then drag downward. Applies to ALL stamps.
- **P04 — MacGregor intro slide-in: center him; slightly bigger.**
- **P11 — Re-lock the camera** on the MacGregor+Strangeways crossed-out shot (the single
  authorized pull) → clean cut, no move.
- **P12 — FICTION-over-Strangeways boom is DELAYED** → fix cue timing.
- **P23 — L94 strikes (no shelter / supplies / help): spawn EQUIDISTANT across the board.**

## Chapter cards (P03 — returns, Daniel-directed, overrides the 2026-07-15 retirement)

Floating TEXT on screen (no card chrome), black-on-white or white-on-black, **Ink Free**
(locked channel font). Text = Claude's, channel tone, non-literal, no "Chapter N". Placements:
1. After "So what happened" (and REMOVE the record-scratch SFX there).
2. One between #1 and #3, placement Claude's call.
3. After the cracking scene (P22).
4. After "was already long gone".
5. END CARD, held a few seconds, with a new VO line ("Thanks for watching"-ish) (P30).

## Script cuts + VO (all require re-synthesis + timeline rebase)

- **P05 —** Remove "on the coast of what's now Honduras and Nicaragua". "A local king really
  did give MacGregor land" = king-only shot; "Eight million acres…" = the exchange shot.
- **P17 —** Remove the 3 baked `[PAUSE]` tags from script.md; the universal 0.5/0.3 law
  (R8-B) replaces them, implemented in the render pipeline for ALL videos.
- **P18 —** Remove "and nobody reading the fine print"; keep "with everybody throwing cash at
  the shiny new story".
- **P26 —** Remove the "One of them was Hastie, [without] two children" line completely.
- **P30 —** New closing VO line ("Thanks for watching" or similar, Claude's wording) under the
  end card.

## SFX

- **P06 —** Cash lands right AFTER "jewellery", not on "rum". No extra pause.
- **P08 —** halo_vocal: HIGHER pitched — try the alternate or pitch-shift; applies to every
  halo_vocal cue.
- **P09 —** Remove the thud/"pop" during the book float.
- **P10 —** Five-star element restyled as a STAMP: same diagonal + size as FICTION/FAKE;
  boom (stamp SFX) replaces the ding.
- **P13 —** Remove the boo on the Strangeways beat.
- **P15 —** Remove the whoosh at "the first ship, the Honduras Packet".
- **P16 —** Applause fades out; no abrupt cut.
- **P20 —** Remove the riser/whoosh at "Money poured in faster…"; the halo_vocal at
  "Everybody wanted in" uses the new higher variant.
- **P22 —** Crack SFX: HEAVIER (current reads like a small twig) → re-source; and the next
  music track must not start until AFTER the cracking scene.
- **P27 —** "Insisting MacGregor himself…": halo_vocal (new variant) cues over the ENTIRE
  shot.

## Music

- **P07 —** Replace Ascending the Vale (middle span) — vocals read weird (R8-A).
- **P22 (music half) —** Underscore switch moves to after the crack beat.
- **P29 —** Monkeys from the Paris caper through the end + end card (R8-C).

## Visual regens

- **P14 —** "Opened offices across Europe" map: Europe only (no Americas), more centered.
- **P19 —** Country trio redesign: regen the later shot with a TOWN background (no background
  people), each character in his country's dress; the earlier "Colombia, Peru, Chile" shot
  uses the SAME background + positions with MacGregor's spot left blank; trio spawns
  per-country; the later shot reads as seeded off it.
- **P21 —** The dot-com-style bubble floats (bob) like the Poyais book.
- **P24 —** "People started to die": background characters have NOSES → regen off crowd rig.
- **P25 —** Survivors / travel / most-died / half-dead scenes: regen off crowd rig.
- **P28 —** "They buried him" scene: set it in VENEZUELA → regen to reflect.
