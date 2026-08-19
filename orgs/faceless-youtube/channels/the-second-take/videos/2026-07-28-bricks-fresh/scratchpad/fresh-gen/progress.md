# Fresh-gen L01-L25 progress log — CLOSED

Video: 2026-07-28-bricks-fresh
shots.json commit: c094d26c (2026-08-19T16:14:29-04:00) — FULL clean VPW re-run, 245 shots
Engine: gemini-3-pro-image, 1K, aspect 16:9 (long_form)

## Pre-step
- Archived v2-era assets/scenes/L01-L25.png -> scratchpad/fresh-gen/v2-frames/ (25 files) DONE
- Chain-boundary check: brick-hook chain (L23 base -> L24 delta -> L25 delta) closes fully inside L25;
  L26/L27 are independent hard_cut base shots, not part of any chain crossing the boundary; L28 starts a
  new place (miniscribe-plate). No extension needed — range stayed exactly L01-L25.
- Flagged Pass-1 canonicals (family-packer, packing-executive) confirmed NOT referenced anywhere in
  L01-L25 (first appear ~line 2477+, well past L25). No new canonical minting required for this wave.
- STALENESS GUARD: visual-kit/_staging/L01.png..L25.png all predated the c094d26c commit. Backed up to
  scratchpad/fresh-gen/stale-staging-backup/, then batch generated with --force for guaranteed fresh
  content off the new shots.json.

## Batch spec
- forge.py batch --shots L01..L25 -> 25 scene entries + 2 STEP-1 figure gens (drive-maker, an existing
  closed-enumeration named cast member — ordinary per-beat STEP-1 pose/expression cards, not new Pass-1
  canonicals).
- dry-run: 27/27 clean, 0 seeding-law violations in scope.

## Incident: L21/L22 seed-gate + a self-inflicted seed-race (both closed)
- Wave 1 generated 25/27 items; L21 and L22 were correctly held by forge's P3 gate (STEP-1 figure cards
  need a recorded review before seeding a scene). Reviewed + stamped both cards via
  `stamp_review.py --figures` into the channel-wide `_staging/review.json` store, then re-ran scoped to
  `--shots L21,L22` (NOT a blind full-batch --force rerun the first time I tried this, which accidentally
  re-generated L01-L04 unnecessarily before being caught and killed — those 4 shots were already safely
  promoted to assets/scenes/ beforehand, so no review work was lost, only 4 wasted API calls).
- Separately: the first L03 retry (L03-fresh-retry1.png) was CONTAMINATED — I fired the retry batch
  before copying my fresh L02.png into assets/scenes/, so the retry's chain-parent seed resolved to the
  STALE pre-wave assets/scenes/L02.png (a totally different v2-era "roller rink" scene), producing an
  unrelated frame. Caught on inspection, discarded, and re-fired cleanly as L03-fresh-retry2 once no
  concurrent promotion could race the seed read. Lesson: never run a promotion copy into assets/scenes/
  concurrently with a retry that seeds from assets/scenes/.

## Per-shot outcomes

| Shot | Verdict | Attempts (paid) | Notes |
|---|---|---|---|
| L01 | verified | 1 | base mall; strong scale-staging, crowd rig holds |
| L02 | verified | 1 | delta (crowd attitude + big-hair) landed |
| L03 | verified | 2 (1 wasted, contaminated+discarded) | delta; original missed the oversized rust-red shadow (fidelity FAIL) -> ONE sanctioned retry, rewrote shadow clause explicitly -> clean |
| L04 | verified | 1 | pc-boxy expr-deadpan base |
| L05 | verified | 1 | delta; pixel-diff confirmed real change (not silently ignored) |
| L06 | verified | 1 | delta; pixel-diff confirmed real change |
| L07 | verified | 1 | "floor balance" base, good depth/crowd layering |
| L08 | verified | 1 | delta |
| L09 | **PARKED** | 2 (original + 1 retry, both failed) | rig FAIL: crowd individuated (>3 hair colors, visible noses/features) instead of crowd-rig; retry explicitly restated rig discipline in-prompt, still failed. See mechanism note below. |
| L10 | verified | 1 | pc-boxy + prop-drive, workshop |
| L11 | verified | 1 | delta, screen powered down |
| L12 | verified | 1 | delta, cutaway reveal |
| L13 | verified | 1 | drive alcove base |
| L14 | verified | 1 | delta, file cards inside |
| L15 | verified | 1 | delta, locked portfolio added |
| L16 | verified | 1 | showroom base, crowd rig holds |
| L17 | verified | 1 | delta, crowd mass increased |
| L18 | verified | 1 | pc-boxy vs rival-pc, market ring |
| L19 | verified | 1 | delta, contest rope added |
| L20 | verified | 1 | delta, drive pallet added |
| L21 | verified | 1 (+1 STEP-1 figure gen) | drive-maker STEP-1 card reviewed/stamped, then scene generated clean |
| L22 | verified | 1 (+1 STEP-1 figure gen) | drive-maker STEP-1 card reused, crowd rig holds correctly here |
| L23 | verified | 1 | warehouse base, "26,000" count card legible |
| L24 | verified | 1 | delta, brick reveal |
| L25 | verified | 1 | delta, brick payload multiplied across cartons |

**24/25 verified, 1/25 parked (L09).**

### L09 mechanism note (parked, not self-applied)
`suspected_mechanism_layer: shots_json / provider_limitation`. This shot's crowd is rendered at
near-foreground scale (front rows are large, almost character-scale) and described with individuating,
emotional language ("eager buyers with expectant expressions"). Contrast with L01/L07-08/L16-17 in this
same wave, whose crowds stayed distant/smaller-scale and held the crowd rig cleanly on the first try.
The one sanctioned retry surgically restated the rig discipline (dot eyes, no nose, <=3 hair silhouettes)
directly in the authored prompt text and the engine still individuated faces. This reads as a
composition/scale problem the forge prompt layer cannot out-argue at this density — a VPW authoring
question (push the crowd smaller/further back, or drop the individuating language), not a further prompt
patch. Flagged for human/VPW review per doctrine; not self-applied.

## Figures minted
2 STEP-1 pose/expression cards for `drive-maker` (existing closed-enumeration named cast member,
canonical already established — these are ordinary per-beat STEP-1 cards, not new Pass-1 canonicals):
- `fig-drive-maker--hold-both-hands--expr-smug--a53aa722.png` (seeds L21)
- `fig-drive-maker--action-offering--expr-smug--67d56515.png` (seeds L22)
Both reviewed clean (rig/fidelity/style all pass) and stamped into the channel-wide
`visual-kit/_staging/review.json` store via `stamp_review.py --figures`.

No new Pass-1 canonicals were minted. The flagged family-packer/packing-executive canonicals are
confirmed NOT demanded anywhere in L01-L25.

## Cost accounting (estimate)
Reference rate from forge.py comments: ~$0.134/frame at 1K.
- Wave 1: 25 paid calls (23 scenes L01-L20+L23-25, 2 STEP-1 figures; L21/L22 correctly held pre-call, $0)
- L03/L09 retry1 batch: 2 paid calls
- Accidental wave2 full-batch rerun (killed after L01-L04): 4 paid calls, WASTED (discarded, not reviewed,
  not promoted — the pre-existing promoted L01/L02/L04 were unaffected)
- L21/L22 clean scoped rerun: 2 paid calls
- L03 retry2 (clean): 1 paid call

**Total paid API calls: 34. Estimated spend: ~$4.56 (well under the $10.00 cap).**

## Scope-integrity counts
- Shots in scope: 25 (L01-L25), no chain-boundary extension needed (verified at pre-step)
- Shots generated: 25/25 (100%)
- Shots verified: 24/25 (96%)
- Shots parked: 1/25 (L09)
- shots.json / doctrine / other stamps: untouched (git diff confirms 0 changes)
- v2-era frames archived intact: 25/25 in scratchpad/fresh-gen/v2-frames/
- No git commits made (per instructions)

## Promotion + stamping
All 25 winning frames copied into `assets/scenes/L0*.png` (overwriting the archived v2-era bytes, which
remain safely preserved in `scratchpad/fresh-gen/v2-frames/`). `assets/scenes/manifest.json` rewritten
for all 25 shot entries (technique/seeds/parent_depth/lineage/retry_cause/notes) from the actual batch
specs used. `assets/_review/merged.json` written with full f/s/r rulings scoped to L01-L25 (24 clean, 1
rig-HIGH). `stamp_review.py <video_dir>` run as the sole writer: **stamped 24 verified, 1 parked** —
confirmed by reading back every L01-L25 manifest entry.
