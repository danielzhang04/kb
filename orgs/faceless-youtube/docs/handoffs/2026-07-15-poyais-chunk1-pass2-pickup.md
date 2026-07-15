# Pickup — Poyais Pass 2, chunk 1 rendered (2026-07-15)

**State: chunk 1 (L01–L26) is generated, human-gated, and RENDERED to a watchable MP4 with real VO.**
Chunks 2–6 (97 shots) are untouched. Paused at the user's request after the render.

Run-book: **`channels/the-second-take/videos/2026-07-04-poyais/_image-gen-plan-2026-07-14.md`** — chunk
table, unit method, per-chunk loop, invariants. Read it before resuming; this file is the delta since.

---

## 1. Where things are

| | |
| --- | --- |
| **Watch it** | `channels/the-second-take/videos/_poyais-chunk1/assets/final.mp4` — 1920×1080, 77.1s, VO only |
| **Review board** | https://claude.ai/code/artifact/62cff40c-281b-4275-907c-ae868537f149 |
| **Real video folder** | `videos/2026-07-04-poyais/` — 21 shots in `assets/scenes|plates|cutouts`, manifest stamped |
| **Render slice** | `videos/_poyais-chunk1/` — scratch, self-contained (L01–L26 + its script span + copied assets) |

Chunk 1 spent ~40 gens (29 first pass + 9 fix + 2 round-2) ≈ **$5.4**. Remaining 97 shots ≈ 109 gens ≈ $15.

### The render slice is disposable and reproducible
`scratchpad/make_chunk1_slice.py` rebuilds it: truncates `script.md` at L26's clause, subsets
`shots.json`/`shots.motion.json` to L01–L26, copies assets, stamps the gate. Fresh VO cost 1248 chars.
Do **not** reuse `_poyais-test-slice/`'s VO — its shots are the stale 125-shot authoring and its script is
not a clean prefix of the current one.

```
py -3 scratchpad/make_chunk1_slice.py
py -3 .claude/skills/voiceover/scripts/voiceover.py channels/the-second-take/videos/_poyais-chunk1
RENDER_CHUNK_FRAMES=1500 py -3 .claude/skills/render-builder/scripts/build_motion.py \
    channels/the-second-take/videos/_poyais-chunk1 --allow-missing \
    --motion-plan channels/the-second-take/videos/_poyais-chunk1/shots.motion.json
```

---

## 2. THE FINDING — four skill-level bugs, all still unfixed

**None of these are one-offs. All four will repeat across the remaining 97 shots.** The user said "that's
fine for now" — i.e. deferred, not rejected. Fix these BEFORE chunk 2 or rediscover them five more times.

1. **`mode=environment` cites a seed that does not exist.** `forge.py`'s A5 rule deliberately passes **no
   image seed** for `environment`/`style` (so the base face can't bleed into figure-free plates), but the
   §2b descriptor it pairs with opens *"Draw in the SAME art style as the reference image."* The sentence
   references nothing, and the engine falls back to a **stock-clipart prior**. This caused **every blocking
   flag in chunk 1** (L01, L03, L05, L12, L22 — all tagged `"environment gen, unseeded"`): glossy airbrushed
   skies, thin pale-grey outlines instead of `#241a12`. **Found independently by two agents.**
   Style-bible §5 already says environments should seed a ref for line weight — **forge contradicts the
   bible.** `refs/env/` is **already exempted in `_is_char_seed`** — the escape hatch was designed and never
   populated. Fix = populate `refs/env/` with on-style landscape/interior anchors and seed them.
   Workaround used: seed an on-style landscape (L05/L10) from a path outside `/refs/`, `/assets/library/`,
   `/assets/scenes/` so the figure prior stays off. **Affects ~82 character-free gens.**

2. **`--mode identity` mandates baldness.** Its §2 LOCKED STYLE descriptor hard-codes *"SAME perfectly bald
   ROUND head"*, which **stomps hair out of any haired cast member's seed** (L16 attempt 1 = a bald
   MacGregor). Same class as the already-fixed "expression merge stripped haired characters bald". It makes
   identity mode unusable for most of the cast. Workaround: use `--mode environment` (holds the rig via the
   auto-appended §2c, defers hair/costume/tone to the seed).

3. **The Pass-1b merge leaks iris COLOUR from the expression ref.** §5 says the expression reference gives
   *only eye/brow/mouth SHAPE* — it doesn't say "not colour", so colour leaked. `expr-thinking.png` has
   brown irises; the canonical is near-black; the merge took brown. **Verified by pixel sample:** old
   (76,48,29) ≈ expr-thinking's (69,45,30); fixed (55,27,11) ≈ canonical's (56,26,10).
   `macgregor--action-armscrossed--expr-thinking` is FIXED. **`macgregor--sit--expr-thinking` is NOT — check
   it before L63 (chunk 3).** Suspected mechanism for the original leak: stacking a pose AND an expression
   base frame against one canonical (2-against-1) — the "stage 1-to-1" rule exists to stop exactly this.

4. **Head-turn language grows a NOSE.** Any prompt implying a turn — *"surveying"*, *"turned away"*,
   *"looking off at X"* — pulls the rig into profile and grows a nose (killed L24 attempt 1). §7 already
   names this limit for true profile, but nothing warns the author. Fix = front-on framing + let the seeded
   pupils do the looking. **Audit chunks 2–6 `still_prompt`s for this language.**

### Also true, and mine, not the pipeline's
- **The scenes manifest key is `shots`, not `scenes`** (`forge.py:389`, `render.py::_load_scene_manifest`).
  I wrote `scenes`; `render.py` read an empty manifest and **all 21 scenes failed the verify gate → 21
  placeholder cards.** Fixed. If a future manifest is hand-built, use `shots`.
- **`--force` destroys a better earlier attempt.** L23-settler attempt 1 had the correct cream head; the
  retry regressed it and overwrote it. Retries should stage to a distinct name.
- **`--aspect 16:9` is for scenes/plates ONLY.** A cutout on 16:9 leaves dead width the engine fills with
  **variant sheets** (L17 came back as a 3-variant turnaround). Use an aspect that frames the element.
- **A pale isolation field starves rembg** when the subject is pale — it silently drops parts (L25 lost both
  trailing circles; L08's prince stranded opaque cream in an armpit, invisible on cream, obvious on green).
  Use a vivid/mid-grey void. The brief's "isolated on a plain flat pale background" convention is WRONG for
  pale subjects. **Found independently by two agents.**
- **Measure, never eyeball, a matte or a colour.** Every measured call this run was right; every eyeballed
  one was wrong in both directions (a phantom halo that was just the viewer compositing under transparent
  pixels; a real defect that "looked harmless").

---

## 3. The architectural law chunk 1 proved

**Layer only what has a canonical; delta-chain what has to be invented.**

| Cutout | Seeded from a canonical? | Outcome |
| --- | --- | --- |
| L13/L15 macgregor · L17 bolivar · L08 prince | yes | **all passed** |
| ship · capital · bank · banknotes · cathedral · stamp · town/farm/settler | no — invented | **all flagged** |

A cutout generated blind to its plate has nothing pinning its style, so it invents its own register (fire-red
roofs, a fine-lined cathedral, isometric game-asset houses). This is the same logic the skill already applies
to plates ("a plate commits lighting blind to figures") — never extended to cutouts. **Caveat:** bug #1 above
is part of the mechanism, so re-test this law once `refs/env/` exists — a seeded environment cutout might hold.

**Corollary the run also proved: a re-base inside the same location must seed the prior stage's base frame.**
The `≤3 deltas then re-base` cap assumes a re-base starts a NEW place; when the same place persists it throws
the set away. That is why L22 and L24 (same swamp, split into `empty-swamp`/`swamp-con` by the cap) came back
as **two different swamps**. Fixed for L22→L24→L26 (1 and 2 hops). **`motion-planner` still has the bug.**

**Parallelism did not cause the drift — it exposed it.** The dependency graph binds shots by `stage` and plate
reuse; it has no edge for *"this is the same place as that."* A serial run would have hidden it by accident.

---

## 4. Chunk 1 state — what shipped, and what is knowingly wrong

`assets/scenes/manifest.json` is stamped `verified:{scene:true,rig:true}` on all 21 shots with an **honest
`gate_note`: this is the HUMAN gate, not an agent review** (the review was skipped by request on the reruns).
Accepted-with-flags, all still true in the MP4:

- **L18/L19** — mosquito-king's crown/epaulettes/mantle missing. **Baked into the Pass-1b asset**
  (`mosquito-king--action-armscrossed--expr-deadpan`), so a Pass-2 retry cannot fix it; needs a library regen
  + cascade. Also renders as a South-Asian paisley kaftan, not the authored British-influenced regalia.
- **L23** — settler head peach not cream (§2d tone), reads 4 fingers + thumb, and is arguably a §2e figure
  authored on the §2d crowd rig. Its town/farm icons read as isometric game assets.
- **L12** — reads as a literal schoolroom blackboard; the bible scopes explainer devices to "flavor only…
  never a lecture".
- **L01** — scale-as-argument weaker than authored (the generating agent and the reviewer flatly disagreed).
- **L03** — the map is **L15's aged-parchment chart, with three decorative ships already on it**, not the
  authored cel-blue ocean / green Poyais coast. The hero ship sails past decorative ships. User: "I don't
  care, this is great." Left deliberately.
- **L10** — stamp tilt landed 18.4°, authored ~30°. Clearly diagonal; a harder slam is a deliberate re-roll.
- **L16** — **no route line.** Correct (the engine owns it via `draw_line`), but the engine-drawn L15 route
  therefore **VANISHES at the L15→L16 cut**. Needs a completed-route engine layer. **Still open.**

### Round-2 re-authoring already applied (user-directed)
- **L08** — the advertised prince is now **ANONYMOUS** on the §2e full rig, not MacGregor (the reveal is
  L27's beat). Deviation from the literal request ("crowd rig"): a prominent foreground figure on the §2d
  crowd rig is an explicit FAIL, so §2e was used. User did not object.
- **L10** — no longer its own paradise; it is **L08 + the FICTION stamp**, its plate deleted.
- **L16** — MacGregor is a **parked cutout** on `plates/L15.png`, not baked. Stale scene deleted.
- **L17** — was orphaned by that change (it delta-chained off the deleted `scenes/L16.png`). Re-pointed at
  `plates/L15.png` + a macgregor layer reusing L16's cutout. **Zero gens.**
- **L03** — reuses `plates/L15.png` (technique (a), zero gens); ship re-authored to a true side elevation.
- **L05–L08** — layers → **seeded delta chain** (held 2.04 / 8.47 / 3.03, all HOLD).
- **L22→L24→L26** — one swamp, chained. L24's plateau lowered so L25's bubble zone (`[0.68,0.28]`) is clear.

---

## 5. Resume here

1. **Watch the MP4 and take the user's verdict.** The open visual question is whether L05–L08's buildings
   arriving on **hard cuts** reads as an enumeration or falls flat versus the pop-on we gave up.
2. **Decide the four bugs above.** Strong recommendation: fix #1 (`refs/env/`) before chunk 2 — it is one
   small fix standing between us and ~82 more character-free gens with the same defect.
3. **Then chunk 2 (L27–L47, 20 shots / 24 gens / 7 units)** via the run-book's loop.
4. Deferred, in the run-book: L110's office reuse; `expr-worried` runs hot; the `_staging` race;
   `forge.py cmd_gen` is serial (a thread pool needs approval); cross-video reusable backdrops (the L03/L15
   plate share is the first evidence this works).
5. Owed: `audio-director` on chunk 1 (no SFX/music yet) — separate skill, own ear-gate.

## 6. Tooling added this run

- **`.claude/skills/image-generation/scripts/build_review_artifact.py`** — the skill has always mandated a
  human review artifact but shipped no tool, so every board was hand-built. Reads the manifest +
  shots/motion, inlines images as `data:` URIs (CSP blocks every external host), renders a **checkerboard
  under real transparency** (a flat fill makes a matted cutout look like an opaque box — the user reported
  the ship as non-transparent when it was already 38.5% clear), and gives each image its VO line, intended
  animation, and flag reason. Lightbox: **←/→ steps, Esc closes.**
- **`scratchpad/build_units.py`** — emits per-agent unit specs from the dependency graph. **Not durable —
  scratchpad only.** Note the resolver quirk: MacGregor's canonical is `macgregor-base.png`; every other
  character's is `<name>.png`, so a bare cast entry needs the `-base` fallback.
- **`scratchpad/fix_mojibake.py` / `scan_mojibake.py`** — `shots.json` was corrupted (100/118 shots, em-dashes
  → `â€"`) by an ad-hoc script on 07-14 and repaired 07-15, verified by codepoint. Committed skill scripts are
  all clean. A `lint_shots.py` mojibake guard was **proposed and declined**.
