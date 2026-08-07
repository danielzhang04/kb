# 6c2 wave-2 fresh-eyes verify — worker B — L39–L50

Verification only. No mints, no re-prompts, no stamps. Machine record: `6c2-w2verify-b.json`
(one entry per frame, sha256 pinned). L38 skipped — unminted.

Rulebook: `6c2-verify.md` scene axes + `style-bible.md` §3/§5 + `visual-grammar.md`.
Ink measured with `scratchpad/p6b_ink.py` (warm target #241a12 ≈ hue 19°, R−B +18; cool
inversion R−B ≤ 0 = FAIL). Specs read from `6c2-wave2-scenes.json` + `shots.json`.

## Tally

**5 pass / 7 fail.** Pass: L40, L41, L42, L43, L50. Fail: L39, L44, L45, L46, L47, L48, L49.

| shot | verdict | the one-line reason |
| --- | --- | --- |
| L39 | fail | '600 MILLION' stencilled on the truck's SIDE panel, not the authored rear panel; money heaped on the roof instead of bulging out of the load bed he is shoving shut |
| L40 | pass | balance plate, dead level, right column taller — clean |
| L41 | pass | true delta: beam settles right, left pan lifts, everything else held |
| L42 | pass | true delta: left column's front face falls away to a hollow shell; beam state inherited |
| L43 | pass | rewind staged as the period deck, slack tape between the spools; card match clean |
| L44 | fail | authored "tote rack stage-left half empty" not executed — rack pixel-identical to the L28 seed |
| L45 | fail | forward boot out over the void (prose: gap **in front of** his boots, tableau not a fall) + a 5-digit hand |
| L46 | fail | staged dead centre walking laterally stage-right; prose puts him stage-left walking **toward the roller door** |
| L47 | fail | authored on a car park apron **outside**; frame keeps him inside on factory concrete, no exterior, no kerb |
| L48 | fail | "action-slump / shoulders down" rendered as an upright stand — inherited straight from the card |
| L49 | fail | hq-banker dressed in NAVY chalk-stripe; card + canonical are BROWN — and navy is ibm-suit's signature |
| L50 | pass | best frame in the slice: lettering on the correct surface, card-perfect brown suit |

## Ink table

Every frame is nominally WARM (R−B > 0) — **no cool inversion, no hard ink FAIL in the slice.**
Nothing lands within 30° of the 223° cool pole; the nearest is L48 at 81.3° away. But three
frames sit on the **zero line for R−B**, which is the more useful signal here.

| shot | ink hue | R−B | ink lum | median sat | read |
| --- | --- | --- | --- | --- | --- |
| L39 | 22.5° | +19.9 | 16.0 | 0.090 | on target |
| L40 | 37.7° | +23.1 | 20.8 | 0.216 | on target |
| L41 | 38.4° | +22.8 | 26.2 | 0.228 | on target |
| L42 | 37.4° | +22.3 | 22.4 | 0.235 | on target |
| L43 | 27.2° | +18.3 | 18.0 | 0.345 | on target; sat high (teal field) |
| **L44** | **122.0°** | **+0.13** | 11.6 | 0.126 | **neutral/green black — on the zero line** |
| L45 | 23.4° | +51.4 | 39.4 | 0.259 | over-warm: darkest 0.5% = (56,21,1) rust, no true near-black |
| **L46** | **114.3°** | **+0.97** | 15.2 | 0.106 | **neutral/green black — on the zero line** |
| L47 | 47.7° | +11.0 | 26.9 | 0.090 | weak-warm, under the +18 target |
| **L48** | **141.7°** | **+0.03** | 18.5 | 0.141 | **flattest in the slice — clears the hard FAIL by 0.03** |
| L49 | 13.4° | +40.2 | 17.2 | 0.624 | warm; sat 3.3× the era prior |
| L50 | 15.2° | +46.7 | 23.0 | 0.663 | warm; sat 3.5× the era prior |

Reference measurements taken for the diagnosis: place seed **L28 = hue 78.6°, R−B +3.0**;
figure cards used by those same frames = **+19.5 / +41.8 / +39.3 / +28.5**; canonicals
ibm-suit **+22.6**, hq-banker warm. The cards are fine. The **place seed is the carrier.**

## Systemic signals (≥3 frames each — these are mechanisms, not one-offs)

**1. The L28 place seed propagates neutral ink. (4 frames: L44, L46, L47, L48 — all four
L28 children in the slice.)** L28 itself measures R−B +3.0 with hue 78.6°, and every child
lands at +0.03 … +11.0 while their own figure cards measure +19.5 … +41.8. Nothing in the
slice inverts, but the whole L28 family is one bad seed away from tripping the R−B ≤ 0 rule
— L48 clears it by three hundredths. Re-warming a scene is cheaper than re-warming a seed;
fix belongs at L28.

**2. Authored depletion is not being applied to seeded set dressing. (3 frames: L44, L46,
L48.)** L44 asks for "the tote rack stage-left half empty" — the rack is pixel-identical to
L28. L48 asks for "the tote racks empty" — same rack, still full, and both tray racks still
carry their cartons. L46 asks for "every fourth ceiling fitting dark" and gets ~8 of 11 dark
(over-corrected in the other direction). The pattern: **deltas that ADD or REMOVE contents of
an inherited prop get dropped; deltas applied to bench tops and lighting get through.** The
generator is treating the seeded rack geometry as immutable.

**3. The seeded place loses its own identity prop, inconsistently. (3 frames: L44, L46, L48
lose it; L47 keeps it.)** The red MINISCRIBE fascia sign — the single most identifying object
in L28 — is absent from three of the four children and present in the fourth. No still_prompt
authors its removal. Whatever pass strips it is not deterministic.

**4. Stage-direction geometry is the dominant defect class. (5 frames: L39, L45, L46, L47,
plus L48's light shaft.)** Every one is the same shape: the prose fixes two elements *relative
to each other* and the frame decouples or inverts them —
lettering on the rear panel → drawn on the side panel (L39);
gap in front of his boots → gap under his forward boot (L45);
walking toward the roller door → walking across the frame away from it (L46);
out through the door onto an apron → still inside on factory concrete (L47);
shaft of light beside him → shaft of light on him (L48).
This is the p6b staging-miss class recurring unchanged. It is not a prompt-detail problem —
every one of these facts IS in the prompt.

**5. Card drift is reaching the scenes, but not reliably. (2 frames, opposite outcomes — worth
naming even below the ≥3 bar because it is the exact thing the brief asked about.)**
- **L46 RECOVERED.** Its card (`fig-base--hold-both-hands--expr-crestfallen--miniscribe-floor-4bd17718`)
  carries the flagged arms-at-sides drift; the scene nonetheless stages the authored chest-height
  carry with both hands on the box. **No inherited-from-card fail in L46.**
- **L48 DID NOT.** Its card (`fig-miniscribe-rep--action-slump--expr-worried`) has the *same
  class* of drift — an upright arms-at-sides stand where a slump was ordered — and the scene
  inherited it whole. Same defect in the card layer, opposite result downstream, so the
  recovery in L46 was luck, not a mechanism.

## Continuity

- **In-slice chain L40 → L41 → L42: holds.** Both children are true deltas. L41 executes only
  the beam settling; L42 executes only the shell reveal AND correctly inherits L41's beam state
  rather than resetting to level. Environment, palette, stand, ground and framing carry through
  all three. Neither child reads as a fresh root.
- **Deferred (parent outside slice B): L44, L46, L47, L48** — all four place-seeded on L28.
  Geometry inheritance is actually excellent in every one (rack, benches, ceiling rig, wall band,
  floor sheen all register). Handed to the stamping pass with the two observations above: the
  missing MINISCRIBE sign and the un-applied depletion deltas.
- **Not deferred, but flagged: L49 ↔ L50.** Same authored bank office, one VO line apart, and
  **neither declares a chain parent or place seed** (both `parent_depth: 0`). They disagree on
  four things: suit colour (navy vs brown), floor (green carpet vs oak boards), back wall (drawer
  cabinet wall vs raised-panel wainscot) and desk top (green leather inset vs plain oak). L50 is
  the correct one. This is a **spec gap**, not a generation defect — two consecutive same-room
  shots were left unchained.

## The one that needs an authoring ruling, not a re-mint — L49

L49's `still_prompt` pins hq-banker as *"a navy chalk-stripe three-piece suit with a gold watch
chain across the waistcoat, swept grey hair, heavy build"*, and the shot note says **"pinned
outfit stated once here"** — i.e. that line is meant to be the authoritative costume pin. But
`refs/hq-banker/hq-banker.png` and every hq-banker STEP-1 card are **warm brown** chalk-stripe.
Measured: L49 scene torso (64,57,60) / trouser (54,56,67) against card (91,55,40) and canonical
(93,57,42) — and the rendered navy is inside noise of the **ibm-suit** canonical (55,55,72).
ibm-suit appears five shots earlier in L44. So obeying the prose puts two named cast members in
the same costume signature within one act, and identity-by-costume collapses.

The generator did the defensible thing: it followed the prose. **The fix is in `shots.json`
(and any costume pin derived from it), not only in the frame** — otherwise a re-mint reproduces it.
L50, which does not restate the outfit, came out correctly brown.

## Positive counter-examples worth keeping

- **L50** is the clean reference for text-bearing frames: '20 MILLION' sits on the **paper band
  strapping the block**, the exact surface the prose names, in the marker-italic face, and it is
  the only text in the frame. Contrast L39, same authoring pattern, wrong surface.
- **L46's crowd** is the cleanest poyais-mechanism execution in the slice: ~13 base figures,
  one simple beat-fit register (sad brows + flat downturned mouth), arms down, no nose/no ears,
  garment colour varied, correct depth scale (crowd ~227px on a higher floor line vs the hero at
  ~315px — no scale inversion), and no crowd figure competing with the hero.
- **L40/L41/L42** read the `scene-style-tile` anchor correctly as line-register + palette only.
  None of the tile's shop content — and crucially none of its **'1983' tent card** — bled in.
  No unauthored lettering anywhere in the slice.

## Rig-law hits

Hands were counted at pixel level on every figured frame. **One violation: L45.** The raised
stage-left hand renders **five** digits (thumb + four fingers) while the same figure's other hand
correctly renders four — so the two hands also disagree with each other. Every other figured
frame (L39, L43, L44, L46, L47, L48, L49, L50) holds 4-digit hands at matched size. No
sub-outline stroke fields, no gradient fills, no proportion breaks anywhere in the slice.

One stray-stroke note: in **L39** the truck's rear-door seam is drawn across the performer's
left wrist/cuff instead of terminating behind it — a single-line layering error, not a register
failure.
