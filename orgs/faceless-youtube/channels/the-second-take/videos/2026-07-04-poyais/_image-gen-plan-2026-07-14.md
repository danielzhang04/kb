# Poyais — Pass 2 image-gen execution plan (2026-07-14)

The run-book for generating all 118 Poyais scene images. This is **not** a new method — it is the
`image-generation` skill's Pass 2, parallelized. The skill is the law; this file only says how the work is
**cut into units, dispatched, reviewed, and presented**. Where this file and the skill/style-bible disagree,
**they win**.

Scope: `long_form` only (118 shots). No shorts. Thumbnail deferred to its own step.

---

## 1. State — what is already done

| Pass | Status |
| --- | --- |
| **Pass 0** — pose/expression/interaction library | DONE (52 registered primitives, human-gated) |
| **Pass 1** — character + prop canonicals | DONE — 6 characters, 6 props |
| **Pass 1b** — posed-character merges | DONE — 24 merges, human-gated 2026-07-14 |
| **Pass 2** — scene generation | **THIS PLAN** — 0 of 118 shipped |

Library = 49 assets. Canonicals: `macgregor-base`, `bolivar`, `mosquito-king`, `strangeways`, `hastie`,
`hastie-wife` + `prop-{guidebook, poyais-banknote, poyais-bond, land-grant-deed, poyais-flag,
macgregor-portrait}`.

**Naming trap:** MacGregor's canonical is `macgregor-base.png`; every other character's is `<name>.png`.
A bare `cast` entry (no `pose_ref`/`expression_ref`) must resolve `<char>.png` → `<char>-base.png` fallback.
Only L105 and L109 cast bare.

`assets/scenes/manifest.json` is empty — `L01.png` and `L03` plate/cutout exist on disk from the aborted
run but are **unstamped, therefore not shippable, therefore regenerate them**. L01 was additionally
generated from a mojibake-corrupted prompt (repaired 2026-07-14).

---

## 2. The work — derived, not remembered

**118 shots → 138 generations → 39 agent units → 6 chunks.** Every number below is emitted by
`scratchpad/build_units.py` from `shots.json` + `shots.motion.json`. Re-run it rather than trusting this
table if the inputs change.

### Gen kind is decided by `shots.motion.json`, never by prose

| Motion shape | Output | Gens |
| --- | --- | --- |
| no `layers` | `scenes/<id>.png` | 1 |
| `layers` all `source:"engine"` (device cards) | `scenes/<id>.png`, **number-subtracted** but still a complete frame | 1 |
| cutout layer + `background.mode:"plate"` | `plates/<id>.png` + `cutouts/<id>-<layer>.png` each | 1 + N |
| cutout layer + `background.mode:"delta-chain"` (**hybrid**) | `cutouts/<id>-<layer>.png` **only** — plate already points at the prior `scenes/<id>.png`; **do not gen a plate, do not bake a scene** | N |

Totals: `scene` 82 shots/82 gens · `plate+cutout` 13/27 · `hybrid-cutout` 12/18 · `card-scene` 11/11.

### Unit = one dependency family, or a bundle of independents

A **unit is one agent**. Two edge types make shots dependent, and both must stay inside one agent:
1. **shared `stage`** — a delta seeds the previous frame's output.
2. **plate reuse** — `background.plate` → `scenes/<other-id>.png`.

15 multi-shot families exist; 3 are **non-contiguous** (`L53,L57,L62` · `L76,L79,L80` · `L105,L107`) — a
hybrid reusing a *distant* plate. These are a **star, not a chain**: the dependents each seed the one base
plate, so within the agent the base goes first, then the rest in any order.

Independent singletons are bundled ~4 gens per agent so agents finish together (`forge gen` is **serial**
inside an agent at ~50s/gen — an unbalanced unit sets the chunk's wall-clock).

### Chunk boundaries — cut only where no family spans the seam

80 of 117 cut points are legal. These six respect that:

| Chunk | Range | Shots | Gens | Units |
| --- | --- | --- | --- | --- |
| 1 | L01–L26 | 21 | 29 | 8 |
| 2 | L27–L47 | 20 | 24 | 7 |
| 3 | L48–L67 | 20 | 23 | 6 |
| 4 | L68–L89 | 22 | 24 | 7 |
| 5 | L90–L109 | 20 | 21 | 6 |
| 6 | L110–L125 | 15 | 17 | 5 |

Cost ≈ 138 × $0.134 ≈ **$18.5** before retries; ~$22 with a realistic retry rate.
Wall-clock ≈ slowest unit per chunk (~6 gens ≈ 5 min) + review + artifact ≈ **~10 min/chunk**.

---

## 3. Per-chunk loop

Each chunk is: **generate (parallel) → review (3 parallel) → retry once → stamp → artifact → your gate.**
Chunk N+1 does not start until you release chunk N.

### 3.1 Generate

`py -3 scratchpad/build_units.py <N> --emit` writes `scratchpad/units/cN-uNN.json`, one per agent, each
carrying its shots' `still_prompt`, `vo_text`, `shot_class`, resolved `cast` seed paths, `props`,
`background`, `cutout_layers` (with `cutout_prompt` + `animation`), and `engine_cards`.

Dispatch all units of the chunk **in one message** so they run concurrently. Each agent gets: the shared
brief (`scratchpad/pass2-brief.md`) + its unit spec + this contract:

> Read `pass2-brief.md`, then your unit spec. You own these shots and nothing else. Run from the repo root.
> `--force` and `--aspect 16:9` on **every** gen. If your unit is `sequential`, run the shots in listed order —
> a delta seeds its predecessor's output. Seed the posed-character asset named in each cast entry; the pose,
> expression, hands and tone are baked in — your delta describes **only** environment + placement. Verify each
> output against style-bible §3. **ONE re-authored retry** on a defect, then flag and move on. Do **not** touch
> any `manifest.json`. Return the JSON contract.

**Agent-safety rules that matter:**
- Agents write **disjoint files** (their own shot ids) — no shared-file races.
- **No agent writes a manifest.** The orchestrator merges. (3 agents once concurrently built the same
  `_staging` name; no clobber, but by luck.)
- `_staging/` collides silently on name reuse unless `--force`. Always `--force`.
- Never pipe `forge gen` through `tail`/`head` — it withholds output and looks hung.

### 3.2 Review — 3 concurrent agents over the whole chunk

Per the skill: **one batched review, no mid-run gating, no per-delta diff-gate.** Each gets every generated
file plus per shot its `still_prompt`, `vo_text`, `shot_class`, and the bible §3 / §6 / `universal.md §13a`.

1. **Identity/rig** — a **forced** per-invariant PASS/FAIL on every seeded figure AND every anonymous
   §2e foreground figure: round head · no nose · no ears · four digits (3+thumb) · pinned costume. Judge
   against the **approved canonical** (`refs/<char>/<char>-base.png`), not an idealized rig. Full frame —
   **no hand crops.** Silence is not a pass. Delta frames also get a held-set line.
2. **Fidelity** — exactly the load-bearing facts, nothing extra that changes the read.
3. **Style/taste** — reads as its `shot_class` at a glance, on-recipe flat-cel 2.5D, **and rich** (committed
   palette, depth, filled edge-to-edge). Thin/sparse = FAIL.

Merge the three lists. Unflagged frames ship as-is.

### 3.3 Retry — ONE, re-authored

Exactly one auto-retry per flagged frame. It is a **fresh gen off a re-authored prompt** — change the
prompt logic, never append the flag to the delta that just failed. Seed from canonical, not the failed
frame. Self-check only the flagged point; do not re-run the review agents. Still failing → **stop**, keep the
best attempt, `flagged: true` with the reason, **surface it in the artifact** — you decide. No third attempt,
no escalation ladder. A defect that repeats across shots and looks like a bible value being wrong → surface a
proposed edit, never self-apply.

### 3.4 Stamp — the render gate

Orchestrator merges all agent returns into `assets/scenes/manifest.json`:
`{shot_id, file, technique, seeds, flagged, verified:{scene,rig}, notes}`.

- clean on both axes → `verified: {scene: true, rig: true}`, `flagged: false`
- identity/rig flag → `rig: false` · fidelity/style flag → `scene: false`

**Only a fully-passed shot is `{scene:true, rig:true}`.** `render-builder` hard-errors on any scene that is
present but unstamped, exactly like a missing one. (The `_poyais-test-act1` run stamped all 62 scenes true
**including 8 flagged** — that contradicted this rule. Do not repeat it.)

### 3.5 Artifact

Built by **`.claude/skills/image-generation/scripts/build_review_artifact.py`** (new — the skill mandates
the artifact but shipped no tool, and hand-building it six times is the anti-pattern). Reads the chunk's
manifest + `shots.json`/`shots.motion.json`, emits one self-contained HTML.

Per image: the **still**, its **shot id + class**, the **VO line** it sits under, and its **intended
animation** (camera move + each layer's `animation` from the motion plan + any device card). Flagged frames
carry a visible reason badge.

Requirements (CSP blocks every external host — inline everything as `data:` URIs):
- **grid** of large images; click any to open the lightbox
- **lightbox: `←` / `→` step between images, `Esc` closes** — this is the point of the artifact, per your ask
- images downscaled to ~1600px JPEG q82 before inlining (~300KB each) — full PNGs would blow the page up
- flagged-only filter; theme-aware; wide content scrolls inside its own container

---

## 4. Invariants (the law this run must not drift from)

- **Seed, don't paste.** A scene is a whole generation seeded on the posed-character; the engine re-renders
  the figure into the scene's light. That is why characters are pre-baked and **plates are not**.
- **Never fresh-draw a figure that has a canonical.** `cast` is authoritative — no prose-clustering.
- **Three-tier rig:** named/seeded → full rig (§2c, auto-appended) · anonymous **foreground** → full rig via
  the §2e clause, no seed · anonymous **crowd** → simplified §2d rig (dot eyes, one mouth). A prominent figure
  on the crowd rig is a FAIL.
- **Ignore `on_screen_text`** and every motion/beat field — the engine draws real type. Bake text **only**
  where `still_prompt` names it as an on-artifact element (a stamp, an engraving, a signboard).
- **`cutout_prompt` must never contain the word "plate"** — it draws a dinner plate. Say "isolated on a plain
  flat pale background, no surface under it".
- **A plate must read as a complete image**, never a blank hole where the subtracted element was. Same for a
  number-subtracted card scene.
- **Delta chains: ≤3 deltas from the base**, then re-base.
- **Don't self-certify finger counts** — the review rules per-invariant, the artifact shows full frames, the
  final count is yours.

---

## 5. Known open items (surfaced, not silently carried)

| Item | Status |
| --- | --- |
| **L110 office reuse** — the edit manifest wants it to reuse L67's office, but it is authored as an independent plate 43 shots later (a true delta would break the ≤3-hop rule) | unresolved; chunk 6 decides |
| **`expr-worried` runs hot** — may need the reserve-for-peaks treatment `expr-greedy` got | watch in review |
| **mosquito-king drift** — grows facial hair / loses side hair on merges | watch in chunk 1 (L18/L19) and 5 |
| **`_staging` race** — concurrent agents can target the same staging name | mitigated by `--force` + disjoint shot ids; not structurally fixed |
| **`forge.py cmd_gen` is serial** — a thread pool would cut chunk wall-clock materially | **not approved**; do not change unilaterally |
| **`lint_shots.py` mojibake guard** — would hard-fail the corruption class that hit this file | **declined 2026-07-14** |
| **Linter false positives** — it flags a registry name in a `still_prompt` possessive ("MacGregor's desk") and on delta/hybrid frames where the figure carries in the plate. L17/L92/L107/L110 are all false positives, **not** authoring gaps | known; do not "fix" the data |
| Cross-video reusable backdrops (offices/banks/crowds/swamps) | deferred by you — a feature to consider **after** this run |

---

## 6. After Pass 2

Thumbnail (primary + challengers, 16:9) → voiceover for the whole video → `audio-director` →
`build_motion --motion-plan` → chunked Remotion render (`RENDER_CHUNK_FRAMES`=1500; a flat full-length
render OOMs the Chromium tab).
