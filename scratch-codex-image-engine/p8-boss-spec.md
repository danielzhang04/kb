# P8 boss spec — equivalent-quality round (Daniel: "not production grade yet; optimize toward equivalent quality")

Authored by boss from frame-by-frame forensics of all 10 P7 outputs vs baselines
(`.superpowers/sdd/2026-08-11-codex-image-engine/p7-real-results/p7-staging/` vs
`scratch-codex-image-engine/gemini-baseline/`). P7's four mechanisms (accent clamp,
composition contract, expression geometry, lettering exceptions) all LANDED — everything
in P7 stays. P8 targets the residual mechanism classes below.

## Diagnosed P8 mechanism classes (forensics evidence per class)

1. **Fill-vs-cluster register error** — cluster MEANS mix pale fills with dark hatching/
   outlines. L36 register carries both `#d3d3a9` (true sage bill fill; measured flat-mode
   `#d0d8a8` at 57% of the seal region) and `#7b835e`/`#858763` (hatch-contaminated
   olives); codex painted bill bodies with the dark ones (`#505040` measured). Also 3
   near-duplicate creams (`#f4e5c8/#f5e5cb/#f5e6c9`) waste palette slots.
2. **No per-surface color binding** — palette is global, so codex assigns values by its
   own priors: L28 ceiling + roller door came out dark teal (baseline: pale gray-blue
   ceiling, mid-gray door), L32 lamp gray-industrial (baseline warm cream dome), L35
   trusses steel blue-gray (baseline dark brown wood).
3. **Accent bleed** — L33 storage bins tinted steel-blue (baseline neutral gray); the
   accent hex escaped its object.
4. **Prop identity drift** — L28 open-front angled picking bins became lidded totes; L36
   side stacks grew strap bands the baseline lacks; L27 roller door grew a mechanical
   drum.
5. **Invention / symmetry additions** — L28 added a right-side shelf unit (baseline: bare
   wall) and a giant foreground parts tray; L42 invented the scale's full base (baseline
   crops it).
6. **No camera/crop contract on object shots** — L42 baseline is a cropped close-up (beam
   crosses frame, base out of frame); P7 zoomed out to show the whole scale. L36 baseline
   is slight-iso from left; P7 near-frontal symmetric.
7. **Emitters render unlit** — L50 banker lamp shows no glow cone/pool (baseline glows
   with visible cone), L27 bulb bare with no warm cone on the door.
8. **Light-pool literalism** — L28/L33 pools render as crisp ellipse discs; baseline pools
   are soft-edged, feathered, blending into the floor.
9. **Realism creep on materials** — L27 walls grew cinderblock coursing + concrete
   speckle; L32 wood grain/screws/metal shading; L27 shrink-wrap photoreal film. House
   style is flat painted fills.
10. **Mass/count adherence** — L35 pyramid rendered 3 tiers/6 crates vs baseline 4
    tiers/~16; L28 fixtures 4 vs ≈6-9.
11. **Pose/prop orientation granularity** — L44 thumbs-down arm tucked vs extended; L50
    "20 MILLION" band printed flat on the front face vs baseline's band running
    diagonally along the top edge in perspective; L50 banker leans/sits vs stands.

## P8 levers

- **R1 — register v3, material fills** (`p8_register.py`, extends p7_register):
  in addition to cluster palette, emit `fill_modes`: quantized (8-step) color MODES over
  low-gradient pixels (Sobel magnitude < FLAT threshold reused from study_metrics
  FLAT_RANGE philosophy — but implement locally; do NOT touch study_metrics.py), top 8 by
  pixel share, each with share. Modes never average fill with hatch. Dedup palette: merge
  clusters within ΔRGB ≤ 12 (sum-abs) keeping coverage-weighted representative; freed
  slots go to next accent clusters.
- **R2 — surface binding block**: new labeled contract section `Surfaces:` mapping each
  major named surface/prop to its hex (from fill_modes) or value phrase. Boss authors
  per-shot content (below); composer passes verbatim. Example (L36): "money-bill paper
  fill exactly #d3d3a9; hatching lines #7b835e; oval seals #b8c493; band cream #f4e5c8;
  floor tan #e8d0a8; background cream #f5e6c9."
- **R3 — accent scoping**: accent hex lines name their object AND exclude neighbors:
  "vivid steel-blue #5b7fae ONLY on the rectangular work mats; storage bins stay neutral
  gray #9a9a9a — no blue tint."
- **R4 — closed inventory law**: Scene section ends with "The scene contains EXACTLY the
  elements listed — add nothing else: no extra shelving, furniture, trays, straps,
  mechanisms, or props." Plus per-shot negatives where P7 invented (right wall bare, no
  strap bands on side stacks, no roller drum, base out of frame).
- **R5 — camera line**: every shot's Composition block STARTS with a Camera sentence:
  framing (close-up/mid/wide), view angle (frontal / three-quarter from left / slight
  isometric), and crop edges (what is cut by the frame). Oriented props get an
  orientation clause (L50 band: "label band runs diagonally along the top edge of the
  stack, foreshortened with the stack's perspective, text following the band's tilt").
- **R6 — emitter spec**: lamps/bulbs that glow in the baseline get "emits a visible warm
  light cone; soft elliptical pool on <surface>; the shade itself glows <color>". Pools
  gain "soft-edged, feathered, blending gradually into the floor — not a hard-edged
  disc."
- **R7 — flat-material law**: Constraints gain "every surface is a flat painted fill in
  the cel style — no brick/block coursing, no wood grain, no concrete speckle, no screws
  or hardware detail, no photorealistic plastic film; texture lives only in the linework
  and the faint paper grain."
- **R8 — pose granularity**: limb-level clauses where P7 drifted (L44 right arm fully
  extended forward at shoulder height, thumb pointing down; L50 banker STANDS behind the
  desk leaning slightly forward, one straight arm resting along the stack top).
- **R9 — delta re-gen turn (NEW lever class)**: after the first real gen, boss reviews
  each output vs contract; misses get per-shot `Delta:` clauses appended to the
  Constraints section and ONE fresh-session re-gen (NOT `exec resume` — A3 measured
  resume at ~3x uncached input; fresh re-compose is cheaper and deterministic). Driver
  must support `--deltas <json>` mapping shot → list of delta strings, re-composing and
  re-generating only listed shots into `-r2` filenames.

## Targets + budget

Primary slate (residual-heavy): **L36 L50 L28 L42 L32 L35**. Lever-check pair: **L33**
(accent scoping) + **L27** (flat-material law) IF first-turn results warrant. Hard budget
**≤14 real gens** this round (6 first-turn + up to 6 delta re-gens + 2 contingency /
lever-checks). $0 API — codex subscription only. Stall law: 4-min ceiling + one re-issue
(existing engine law). All P7 mechanics otherwise unchanged (registers, class-matched
anchors, seeds, refs, lettering exceptions for the test).

## Per-shot Surfaces/Camera/Delta source

Boss authors the per-shot Surfaces + Camera + inventory-negative content into
`p8-contracts.json` (schema mirroring p7's per-shot spec consumption) — the driver READS
it; content is boss-supplied data, not worker-authored. Worker builds the machinery.

## Acceptance (fake-first)

- `p8_register.py` + `test_p8_register.py`: fill-mode extraction (synthetic fixture:
  image of pale fill + dark 1px hatch lines → modes contain the fill, clusters would
  not), palette dedup (3 near-cream fixture merges to 1, freed slot fills with next
  accent), determinism.
- `p8_matched.py` + `test_p8_matched.py`: composes all P8 sections (Surfaces, Camera
  line first in Composition, closed-inventory tail, emitter/flat-material/accent-scope
  clauses, delta append + re-compose for --deltas shots only, -r2 naming), verbatim
  pass-through of boss contract prose (NO rewriting — C16's fact-deletion lesson),
  fake full-slate run 6/6 + delta re-run 2/6 proven against `_fake_codex.py`, resume
  banking, refusal-without-flag exit 2 (same gate law as p5/p6/p7 drivers).
- All existing suites stay green: engine 126, p7 43, sibling scratch suites. forge.py
  zero-diff. Entropy scan zero-hit on any file you add.
- NO real generation by the worker — boss runs reals from host shell. BLOCKED if any
  step seems to need one.

## Out of scope

forge.py (untouched, standing guarantee), forge_codex.py engine internals (compose_fn
seam is under separate fresh-eyes review — build P8 as scratch drivers on the EXISTING
seam like p7_matched did), study_metrics.py, lettering DOCTRINE (Daniel holds the
production ruling; P7's per-string test mechanism continues unchanged for this round),
bricks kit files (read-only), any commit (boss commits).
