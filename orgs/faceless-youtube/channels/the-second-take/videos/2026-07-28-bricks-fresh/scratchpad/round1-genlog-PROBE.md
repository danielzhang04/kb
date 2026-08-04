# Figure-scale mechanism probe — 2026-08-03

Authorization: Daniel's 2026-08-03 board-selection go under FYT §D, with an explicit
$0.70 sub-cap for this probe. Native Forge staging only; no canonical scene, manifest,
registry, skill, or `shots.json` writes. Planned maximum: 4 × 2K at $0.134 plus 1 × 1K
at $0.039 = **$0.575**.

Scale criterion: for L28, both named figures must remain complete and clearly identifiable,
but visually secondary to the plant, each approximately **≤30% of total frame height** from
shoes to crown. A medium/foreground figure that is merely smaller than an earlier failure is
still a scale FAIL. Every output is also judged against style-bible §3 and §5.

| request | hypothesis | tier | cost (USD) | digest-pinned seeds | request / verdict |
|---|---|---:|---:|---|---|
| `L28-plate-probe-empty` | A — empty place plate before STEP-2 | 2K | 0.134 | `assets/scenes/L26.png` SHA-256 `bd358173a06461183d96f7f1631873c42c5641762bc887705032fccb833a7211` | PASS as an empty plate: no people reappeared; L26 architecture, built-place depth, four drives, blank surfaces, palette, and mountain windows landed. Output SHA-256 `8ab6cc4d6712bf6a9b033acfdd5a01f862fc7a7152a63055ac0b845a54b71e3b`. |
| `L28-composite-probe-empty` | A — place-subject STEP-2 from empty plate | 2K | 0.134 | Terry STEP-1 `740d537799714fc54f121bb629e5e33715bbd51ca0ab1fce6a8c920686eaf463`; MiniScribe STEP-1 `99fbcce3a67faeb7a61bef8cdb1c69d5b5780c4ecbc7a1119aeac35c42f3ee5f`; empty plate `8ab6cc4d6712bf6a9b033acfdd5a01f862fc7a7152a63055ac0b845a54b71e3b`; prop-drive `66084194d12ca18a20005a50c7ae27b9ff903e07c7e00f1e06d4dabaa8e243d6` | PARTIAL / scale FAIL: the plant becomes dominant and both identities/poses broadly hold, but Terry is roughly 40% of frame height, MiniScribe roughly one-third and occluded below the thighs. They are not equally complete or ≤30%. |
| `L28-group-probe-distance` | B — distant-pair intermediate | 1K | 0.039 | Terry STEP-1 `740d537799714fc54f121bb629e5e33715bbd51ca0ab1fce6a8c920686eaf463`; MiniScribe STEP-1 `99fbcce3a67faeb7a61bef8cdb1c69d5b5780c4ecbc7a1119aeac35c42f3ee5f` | PARTIAL / numeric scale FAIL: the pair is equal-height, complete, isolated, and far smaller than portrait sheets, but still roughly 45% of the 16:9 frame height rather than 16–20%. Rig and identities broadly hold. Output SHA-256 `55c28d8221ce39cd5ff69976ef094bfdc53586a2c33336f5c397d4df36598334`. |
| `L28-composite-probe-distance` | B — composite from distant-pair seed | 2K | 0.134 | distant pair `55c28d8221ce39cd5ff69976ef094bfdc53586a2c33336f5c397d4df36598334`; empty plate `8ab6cc4d6712bf6a9b033acfdd5a01f862fc7a7152a63055ac0b845a54b71e3b`; prop-drive `66084194d12ca18a20005a50c7ae27b9ff903e07c7e00f1e06d4dabaa8e243d6` | FAIL absolute scale: the pair stays complete, equal-height and identifiable, but the engine enlarges the locked unit to roughly 45% of frame height. The plant remains rich and dominant, Terry's one-hand drive hold broadly lands, and MiniScribe's badge remains visible. Output SHA-256 `49c3749d8de91557d2bfc8ff16ac6013d3c048dc7233d12d7af08868cc0cbe94`. |
| `L28-composite-probe-foreground-props` | C — forced perspective / large foreground props | 2K | 0.134 | Terry STEP-1 `740d537799714fc54f121bb629e5e33715bbd51ca0ab1fce6a8c920686eaf463`; MiniScribe STEP-1 `99fbcce3a67faeb7a61bef8cdb1c69d5b5780c4ecbc7a1119aeac35c42f3ee5f`; empty plate `8ab6cc4d6712bf6a9b033acfdd5a01f862fc7a7152a63055ac0b845a54b71e3b`; prop-drive `66084194d12ca18a20005a50c7ae27b9ff903e07c7e00f1e06d4dabaa8e243d6` | **PASS scale / FLAG fidelity:** both complete figures are equal and roughly 26–28% of frame height; foreground machinery and room dominate. §3 identity, round noseless/earless heads, squat proportion, costume, expression, badge, one-hand hold, empty other hand, outline and render appear to hold at ordinary scale. The output duplicates drive-like objects beyond L28's authored count and materially restages the set, so it is not shippable as L28 without a count/continuity correction. Output SHA-256 `3e01fde315552a11c434af61bc7714f1d25cdd8611f6bbf15cca6c1cbcceb0ea`. |

## Per-hypothesis verdict

- **A — empty plate then place-subject composite: PARTIAL, not sufficient.** The empty plate is clean and
  removes the strongest existing large-person pixel prior. It makes the room dominant in STEP-2, but the first
  seeded figure still expands to roughly 40% height and the second is partly occluded. Empty-first is useful
  support, not the scale breaker by itself.
- **B — figures-at-distance intermediate: FAIL for absolute scale.** It holds two identities, equal height and
  completeness as one group, but ignores the requested 16–20% size at STEP-1 and expands back to roughly 45%
  in the scene. Replacing portrait sheets with a group sheet changes relative geometry, not the engine's
  people-fill-frame prior.
- **C — foreground occupancy / forced perspective: PASS for the scale class.** Large near-field machinery and
  drives consume the visual hero slots and establish a deep aisle with an explicit far floor line. Both named
  figures then land complete at about 26–28% height. This is the only tested mechanism that meets the scale
  criterion. Its first sample has a separate object-count/set-continuity fidelity flag.

## Winning recipe for VPW + image-generation

1. **Mint a positive empty place frame first.** Seed the approved video-local place and describe an
   *unoccupied* built room with uninterrupted floor/apron; do not use a list of human negations. Human-pick this
   empty frame before composing cast into it.
2. **VPW authors physical depth, not scale adjectives.** Lead with large foreground architecture/props that
   crop at the frame edges, a conveyor/rail occupying the lower foreground, and a long unobstructed aisle ending
   on one explicit far floor line. Put the two figures in the final clause on that line, complete and secondary.
   For L28's retry, the payload must also say positively: one conveyor carries exactly four additional drives;
   every other belt/table surface is bare, so the successful scale layout does not multiply props.
3. **STEP-2 seed order:** `[figure A STEP-1, figure B STEP-1, empty video-local place, recurring prop]`, all
   SHA-256 pinned and within Forge's cap of four. Do **not** insert the distant-pair intermediate; it did not
   improve absolute scale.
4. **Build with native Forge and inspect before spend:** once the empty plate is an approved video-local
   `place_anchor`, run

   ```powershell
   py -3 .claude/skills/image-generation/scripts/forge.py batch --kit channels/the-second-take/visual-kit --batch channels/the-second-take/videos/<slug>/shots.json --video channels/the-second-take/videos/<slug> --shots <shot-id> --out channels/the-second-take/videos/<slug>/scratchpad/<shot-id>-scale.json
   py -3 .claude/skills/image-generation/scripts/forge.py gen --kit channels/the-second-take/visual-kit --batch channels/the-second-take/videos/<slug>/scratchpad/<shot-id>-scale.json --video channels/the-second-take/videos/<slug> --dry-run
   py -3 .claude/skills/image-generation/scripts/forge.py gen --kit channels/the-second-take/visual-kit --batch channels/the-second-take/videos/<slug>/scratchpad/<shot-id>-scale.json --video channels/the-second-take/videos/<slug>
   ```

   The dry run must show exactly the four seeds above and a 16:9/2K request.

Current builder caveat: Forge can consume an approved empty `place_anchor`, but cannot derive that empty variant
as an intermediate for the same figure-bearing shot. Production adoption therefore needs VPW to author/mint the
empty place upstream (or a future builder-owned `empty_place` step); hand-writing production batch specs is not
the supported fix. The retry path's known place-anchor replacement limitation also makes a fresh builder-owned
shot slate preferable to an overlay for this recipe.

**Spend:** five successful provider calls, no retries: **$0.575 / $0.70**.
