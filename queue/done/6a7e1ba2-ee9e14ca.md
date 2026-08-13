---
id: 6a7e1ba2-ee9e14ca
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: cf43e8f19157e9a1
state: done
approval: null
workflow: 019ffc8e-0d6c-7cf3-9f41-d4023b184175
depends-on: []
variant-group: null
role: work
session-id: 6a7e180d-cacc13aa
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Build P8 quality-round drivers (register v3 + matched composer + delta re-gen)

You are a codex implementation worker on the codex-image-engine arc. Repo:
`C:/Users/danie/kb-worktrees/boss-codex-image-engine`, branch `claude/codex-image-engine`
@ fc8815f. You build EXACTLY what the boss spec orders — read it FIRST and treat it as
the contract:

1. `scratch-codex-image-engine/p8-boss-spec.md` — the P8 spec (mechanisms, levers R1-R9,
   acceptance). THE AUTHORITY for this task.
2. `scratch-codex-image-engine/p8-contracts.json` — boss-authored per-shot contract
   content your driver consumes VERBATIM.

\## Pattern to follow

P7's implementation is your template — read these before writing anything:
- `scratch-codex-image-engine/p7_register.py` + `test_p7_register.py`
- `scratch-codex-image-engine/p7_matched.py` + `test_p7_matched.py`
- `scratch-codex-image-engine/p7-boss-spec.md` (how spec→driver mapped last round)
- `scratch-codex-image-engine/_fake_codex.py` (the fake binary fixture — your only
  execution target; NEVER run real codex generation)

\## Deliverables (new files only, all under scratch-codex-image-engine/)

- `p8_register.py` — extends p7 register capture with `fill_modes` (quantized low-gradient
  color modes, top 8 by share) and palette dedup (merge ΔRGB≤12 sum-abs, freed slots →
  next accent clusters). Reuse p7_register functions by import where clean; do not copy
  code you can import. Emits `p8-registers.json` (schema versioned "p8-registers/1",
  superset of p7 fields so p8_matched can single-source it).
- `test_p8_register.py` — per spec acceptance: synthetic fill+hatch fixture proves modes
  capture the fill where cluster means would not; dedup fixture (3 near-creams → 1 +
  freed accent slot); determinism (two runs byte-identical JSON).
- `p8_matched.py` — P8 composer + driver over the EXISTING engine seam
  (`forge_codex.RunOptions(compose_fn=..., ...)` exactly as p7_matched uses it; engine
  internals untouched). Composes P7's format PLUS: `Surfaces:` labeled section, Camera
  sentence FIRST in Composition, closed-inventory tail clause, accent-scope /
  emitter / flat-material / orientation clauses from p8-contracts.json, counts lines.
  Every contract string passes through VERBATIM — no rewriting, trimming, or joining
  that alters characters inside a clause (C16 lesson: fact-deleting rewrites are the
  cardinal sin here).
  CLI: `--shots L36,L50` filter, `--mode fake|real`, `--deltas <path.json>` (shot →
  list of delta clause strings appended to that shot's Constraints; re-compose and
  re-generate ONLY listed shots, outputs named `<shot>-p8-match-r2.png`), same
  refusal-without-GO-flag exit-2 gate as p7_matched, resumable banking to
  `p8-results.jsonl` under a REPORT_HOME env like p7.
- `test_p8_matched.py` — per spec acceptance: all new sections present + verbatim
  (byte-level containment asserts for every clause of one golden shot), Camera-first
  ordering pin, deltas append + only-listed-shots re-gen + -r2 naming, fake full-slate
  8/8 (six primary + L33 + L27) and fake delta re-run 2/8 proven, resume skip proof,
  gate exit-2 pin.

\## Hard laws

- NO real generation — `--mode real` paths are boss-run only; your tests use the fake.
  BLOCKED if any acceptance step seems to need a real gen.
- forge.py, forge_codex.py, study_metrics.py, p5/p6/p7 files: READ-ONLY. Do not edit.
- bricks kit (orgs/faceless-youtube/**): READ-ONLY.
- No commits, no pushes — boss commits.
- No credential reads; never touch .env; no network beyond what codex gives you.
- Run the sibling suites after your build: test_p7_register, test_p7_matched,
  test_forge_codex (126), your two new suites. Report exact counts. If TEMP-dir ACLs
  block pytest, redirect TEMP/TMP to a fresh dir OUTSIDE the repo (known box issue).
- Entropy hygiene: no high-entropy blobs in any file you write; keep excerpts short.

\## Report (your final message)

Files created (paths + line counts), test results (exact pass counts incl. sibling
suites), the golden-shot composed prompt for L36 fake mode (verbatim, so boss can eyeball
section ordering), any spec ambiguity you hit and how you resolved it (deviations
DISCLOSED, never silent), anything BLOCKED.

## Result

Implemented P8 drivers and tests. No real generation ran.

Created:

- [p8_register.py](C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine\p8_register.py) — 119 lines
- [test_p8_register.py](C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine\test_p8_register.py) — 52 lines
- [p8_matched.py](C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine\p8_matched.py) — 198 lines
- [test_p8_matched.py](C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine\test_p8_matched.py) — 73 lines

Also appended the required worker note to [memory/codex-worker.md](C:\Users\danie\kb-worktrees\boss-codex-image-engine\memory\codex-worker.md).

Verification passed:

- `test_p8_register.py`: 3 passed
- `test_p8_matched.py`: 3 passed — proves fake 8/8 r1, fake 2/8 r2, resume skip, CLI gate/filter
- `test_p7_register.py`: 2 passed
- `test_p7_matched.py`: 4 passed
- `test_forge_codex.py`: 126 passed
- `py_compile`: passed
- Entropy scan on all four P8 files: zero hits

L36 fake-mode composed prompt:

```text
Use case: illustration-story
Asset type: documentary-style animated video still frame
Style/medium: flat 2.5D vector cartoon in the exact style of Image 3 — even medium-weight dark neutral outline, flat cel fills enriched with soft light pools and gentle tonal gradients on large surfaces, subtle contact shadows under figures and props, faint paper-grain surface texture, rounded friendly shapes, and the same high detail density as Image 3
Scene: base, greedy expression, power-stance pose, planted on top of a banded bale of banknotes the size of a car that fills the centre of the frame. Two smaller bales sit on the left of the frame and on the right of the frame at half its height on a flat cream ground, charcoal-cream-green palette, even frontal light, foreground depth from a cropped bale corner across the bottom of the frame. The wide paper band strapping the big bale carries the stencilled figure '125 MILLION'.
Dressing: Money treatment: saturated green bills with heavy dark outlines and large pale oval portrait medallions; cream paper bands.
The scene contains EXACTLY the elements listed — add nothing else: no extra shelving, furniture, trays, straps, mechanisms, or props.
Composition: Mid-wide shot in slight isometric from the left — the main stack's left face visible in two-point perspective, horizon low, surrounding smaller stacks cropped by the frame edges.
cream void with a tan floor plane and a visible soft horizon line — NOT a boundless vignette; rep stands atop one large banded stack of bills center frame, fists on hips (powerstance), ≈35% frame height; four smaller banded stacks sit around the big one at the frame corners (partially cropped); soft contact shadows under every stack; every plane crisp — no blur.
Surfaces: money-bill paper fill exactly #d3d3a9 (light sage — NOT dark olive); bill hatching as thin #7b835e linework only
Surfaces: oval seals on bill faces #b8c493
Surfaces: wrap band cream #f4e5c8 with black marker-caps text
Surfaces: floor warm tan #f0d8b0; background cream #f5e6c9
Counts: one large central pallet-sized stack; four smaller stacks at frame corners, cropped
Inventory negatives: the side stacks are bare bricks of bills WITHOUT cream strap bands — only the central stack carries the labeled band
Inventory negatives: no straps, ribbons, or bands anywhere except the central labeled band
Expression geometry: greedy-smug — half-lidded eyes, small closed smirk.
Pose: the man stands hands-on-hips atop the stack at ~35-40% of frame height, smug half-lidded eyes, small closed smile, soft contact shadow under his feet
Emitters: none.
Orientation: the '125 MILLION' band is a paper strap wrapping the stack's front-center: it sits ON the bills, its edges parallel the stack's vertical edges, its face tilts with the stack's perspective, text tilted with the face — it is not a separate full-height column
Lettering: the big stack's front band reads exactly "125 MILLION" in thick near-black hand-marker italic capitals, slightly tilted with the band.
Input images: Image 1: character reference for miniscribe-rep — match exactly — do not copy its background or style; Image 2: lettering style reference ONLY — render the specified string(s) in exactly this hand-lettering style; do not copy this image's own words, objects, background or layout; Image 3: style reference ONLY — match its line weight, outline ink colour, cel-fill treatment, palette temperature, shading, texture and detail density exactly; do NOT copy any of its objects, characters, or layout
Composition/framing: Compose for a 1376×768 pixel frame — a 16:9 landscape aspect ratio.
Color palette: outline ink #1f1102; scene palette — use no colours outside: #f4e5c9, #d3d3a9, #7b835e, #b6ae88, #eeddb2, #858763, #574d35
Constraints: preserve miniscribe-rep's exact costume, proportions and line weight from the reference image; environment stays a built-but-flat environment — minimal geometry plus one foreground depth prop, not a fully rendered set; match the tonal richness of Image 3 — soft light gradients and subtle contact shadows are required; poster-flat minimalism is wrong; cel fills fully saturated exactly as in Image 3 — washed-out pastel or gray-toned fills are wrong; every surface is a flat painted fill in the cel style — no brick/block coursing, no wood grain, no concrete speckle, no screws or hardware detail, no photorealistic plastic film; texture lives only in the linework and the faint paper grain
Avoid: photorealism, painterly or 3D-render look, heavy solid-black ink, warm sepia ink cast, words, letters, numerals or signage other than the exact string(s) specified in the Lettering line, on-screen narrator or host face, logos, watermark, depth-of-field blur, bokeh, soft focus — every plane in crisp focus, desaturated pastel fills
```

Ambiguities disclosed: I interpreted “6/6 + L33 + L27” as the explicitly stated 8-shot slate. Dedup may leave fewer than six unique palette entries only when no remaining eligible accent exists to claim the freed slot. Nothing blocked.
