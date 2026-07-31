# Board pass-through verdict — Daniel, 2026-07-30

Gate 1 output for bricks-fresh. Raw feedback below (verbatim summary), then parsed. This file is
the run-specific record; portable lessons route to owning docs per operating-law §G — see the
fix-design deliverable when it lands.

## Headline

Daniel found far more defects than the 31 parked — dozens of VERIFIED shots condemned. The review
layer badly under-flagged (ears/ear-holes, eyelids, facial-feature placement, body proportion are
not being caught). Repair wave is PAUSED until the fix design is approved: regenerating through the
same broken prompting would waste spend.

## Per-shot condemns (parsed)

Timing/segmentation:
- L02 — Pac-Man image must land on the words "Pac Man", not "and one" (shot-boundary vs VO sync)
- L03 — corporate-scam image must land on "corporate scam"; also the box art doesn't read "scam"
- L197 — why does a shot exist on just the word "and"? (segmentation granularity)

Rig (character) defects:
- L17/L18 very off rig (parked) · L34 nose+ears + background figure digit-count · L45–47 off rig +
  inconsistent character · L49–50 inconsistent character · L51 nose+ears · L52–54 should/could be
  deltas, L53 off rig · L60–68 many off rig · L73 off crowd rig · L81–83, L85 off rig ·
  L89–91 ears/"ear prints", nose, off rig · L89+L93 NO EYELIDS (not our design) · L99–L101 off rig ·
  L107–108 off rig · L115 subtly off — eyes/facial-feature placement, recheck · L122 off rig ·
  L123 three arms (parked) · L126–131 many off rig · L133 off rig, too tall (parked) · L137–138 no
  ears, ear HOLES in hair · L146–147 off rig · L155–156 off rig, L156 digit-count · L157–158 way off
  rig · L160 off rig · L161–162 way fucked up · L173 off rig, head · L174–175 off rig · L191 off
  rig · L192–194 off rig + ear holes · L196 terrible facial expression · L197 off rig · L200–201 way
  off rig
- L31–33, L40 base-template identity (parked, known class)
- L143–144 should be CROWD rig, not full rig

Background/scene contamination ("why that background?"):
- L78, L87–88, L102, L148, L171 Victorian room (parked) · L99 SWAMP (VERIFIED — review located the
  swamp on L97, which Daniel says is FINE; mislocated flag) · L105, L109, L114 (Victorian bleed,
  verified), L136 (ocean waves?), L153–154, L157–158, L169–170, L198, L206 background wrong
- Daniel's direct question: is poyais-specific content leaking in? Is some function feeding
  previously generated images back in as references? "Scratch that shit if that's the case."

Continuity (same scene must be same):
- L81/L82 warehouse differs from earlier warehouse · L103–104 should be same scene · L116–119
  should be the same map · L207–208 should be the same shot

Logic/staging:
- L70–73 confusing composition · L89–91 breaking into a PAPER box with a WRENCH makes no sense ·
  L126–131 weird logical shots · L206 two piles of cash makes no sense
- L172 authored text missing entirely ("what the fuck is that, there's no text?")

Palette:
- L181–184 way too red · L184 don't love

Explicit passes: L97 fine.

## Daniel's systemic directives (verbatim intent)

1. Rig prompting must be consistently better — NO drift in that logic, ever.
2. When a rig scene is complex, simplify everything else in the prompt (complexity budget).
3. Fewer character shots overall; more scene AND background diversity — same-y palette/background
   is boring. Avoid many different character types in one shot (hard to control).
4. Off-rig failures are dominated by ears / ear-holes / facial-feature drift / body-proportion
   drift MORE than fingers — but also ensure the function obeys pose seeding and doesn't invent.
5. Keep files slim: fixes go to their owning layer (VPW / image-gen / grammar / exemplars), no
   appended functionality lists, no bloat.

## Boss probe addendum (2026-07-30, after the analysis wave)

The L97/L99 "swamp mislocation" is REAL and is an id↔pixel misbinding: pixels on disk
(scenes/L97.png = clean box; scenes/L99.png = swamp, visually confirmed by boss and matching the
board) contradict every review record (gen-log, merged.json, scenes/manifest.json all bind the
swamp/parked verdict to L97). Daniel's reading was correct. Defect class for the fix list: review
verdicts are bound to shot id only, never to image content (e.g. a content hash), so a swap or
misbinding anywhere in the chain silently inverts two shots' verdicts.

## Daniel RULINGS (2026-07-30 — binding on the fix design)

North star: video gen almost fully automatic. Ruled, no longer open:
1. KEEP 4 fingers. KEEP the existing cast. No 5-finger migration.
2. SEEDING LAW: every figure gen is always seeded off the existing pose/asset base — consistent
   for ALL image gen, no exceptions. Image prompts must never affect or contradict the seeding
   law (prompts cannot opt out of, override, or restate seed-carried facts).
3. Less character-forward shots in general.
4. Per-video SMALL named cast; every other human is crowd-rigged by rule; fewer characters per
   shot across the board.

## Daniel checkpoint rulings on fix-design r1 (2026-07-30 — binding on r2)

Doctrine shift stated plainly: PROMPTING + STRUCTURAL enforcement is the bulk of the work;
CHECKING is unreliable at catching rig defects and must be SLIMMED, not grown. "I want to fix the
actual system so generating images isn't fucked up to begin with."

Per fix: (1) calm the checking down — no new verification machinery for now; rig-hold checking is
hard and not very helpful. (2) APPROVED. (3) REJECTED as a lint — no new flagging functions; the
rule survives as authoring doctrine only. (4) tentative "sure...?" — keep only if clearly
structural and slim (consider folding the builder into forge itself rather than a new script).
(5) MODIFIED: no promotion path — ALL non-cast humans are crowd rig, always; foreground figures
are named cast ONLY; UP TO 2 named cast per shot; RESTRICT minting new interaction/pose templates
(rare, it breaks things easily); route the law wherever it belongs (VPW and/or grammar).
(6) MODIFIED: cast list is decided by VPW reading the script BEFORE authoring (a small early plan
step is fine); NO per-act palettes — instead delete the single global palette rule and hold one
per-video color STYLE (e.g. muted video → no sudden neon-green shot). (7) ear-hole wording fine;
skip checklist framing — only keep edits that change PROMPT text (crowd-hand clause, proportion);
seeding law is the real eyelid fix. (8) REJECTED — no crop battery; checking on a broken system
is waste. (9) MODIFIED and stronger: NO cross-video env plates EVER — delete the channel register
plates, their README routing rule, and downstream references; env plates are allowed WITHIN a
video only (a video may mint its own). (10) scene_id REJECTED as unnecessary (within-video plates
+ delta chains carry continuity). (11) APPROVED, framed as the VPW/shots-schema fix it is.
(12) MODIFIED into a slimming mandate: cut down the critic/judge apparatus, especially rig-
consistency judges — slim, don't abolish. (13) SCRAPPED — judges compare against base rig
canonicals directly as part of ordinary judging, no calibration-set file.

Additional rulings (same session): (d) pc-boxy stays AS-IS — and a positive authoring insight to
route: Daniel LIKES personified-object characters ("non-person animated characters") precisely
because they barely drift — there isn't much rig to hold. Favor them where a beat allows.
(f) framing corrected TWICE — final form: (f) was never about spend or regen cost. It is the
design's center of gravity: make the GENERATING logic itself better and more consistent so that
checking becomes unnecessary. Checking mechanisms are bad at detecting rig drift and are largely
wasted space; they shrink because the generation fixes make them redundant, not as a cost
trade-off. A spend cap gets asked once, at the actual regen gate, and not before.

r2 rulings (2026-07-30, late): (e) F-12 APPROVED as recommended (faced object → CAST, slug + Pass-1
mint, exempt from pose inventory; unfaced → PROP, prose until canonical). Personified objects
CORRECTED to neutral: allowed, a FEW fine, too many = weird video; never explicitly pushed, never
banned (fix-design.md edited in place to match). Spend approval deferred to the regen gate.

Still open: Daniel's go on starting the implementation wave · the music-scope question from the
phase plan.

## Open items still owed by Daniel (unchanged)

Repair budget cap · music scope · pc-boxy trade-dress ruling · F-12 slug asymmetry ruling ·
ear-check verdict on the fixed 413s splice clip (played, awaiting word).
