# Wave B progress — shots L10-L17

Worker: scene-wave worker B. Worktree `C:/Users/danie/kb-worktrees/boss-taste-forensics`
(branch `claude/bricks-taste-forensics`, verified before starting). Partition: L10-L17 only.

## Plan (from Pass-1 resolution via `forge.py batch --shots`)

- L10: (d) one-shot single-character. Seeds: pc-boxy canonical, expr-talking, prop-drive canonical.
- L11: (b) seeded composition — bedside-table STAGE **base**. Seeds: pc-boxy canonical, expr-delighted, prop-drive canonical.
- L12: (e) seeded delta-chain — bedside-table STAGE **delta** of L11. Seeds: L11 in-chain parent, pc-boxy canonical, prop-drive canonical.
- L13: (c) character-free scene. Seeds: prop-drive canonical, scene-style-tile (cast-free register anchor).
- L14: (b) seeded composition. Seeds: pc-boxy canonical, expr-caught, prop-drive canonical.
- L15: (c) character-free / crowd-bearing. Seeds: crowd-exemplar, prop-beige-pc canonical, prop-drive canonical.
- L16/L17 (pc-ring STAGE base/delta): **PARKED before any generation, $0 spend.** See below.

## L16/L17 park reasoning (no spend attempted)

L16's `still_prompt` describes "a rival personified computer box... slate-grey desktop case... cartoon
eyes and mouth set into its front panel" — this figure is **not backticked registry vocabulary**
anywhere in the prompt, has **no canonical anywhere in `registry.json` or the video library**
(checked both), and is not a recognized `pc-boxy` variant. Per the seeding law ("Figures are SEEDED
(named cast · seeded performer) or CROWD; there is no unseedable foreground tier") this is a missing
Pass-1 asset — a new named-character canonical (a `pc-boxy` variant, slate-grey case) that was never
built or human-gated. Generating it now would be hand-authoring/improvising a figure the doctrine
explicitly forbids ("never improvised around").

Secondary, independent defect also found: L16's prose names `action-powerstance`, but the video's
`action-powerstance` asset (`refs/base/action-powerstance.png`) is a **human-base-rig** pose primitive
(reused across many human-cast shots, e.g. L26-L160). `pc-boxy`'s own registry note says "never seed a
human torso POSE frame onto it (bleeds a human body)" — so even the KNOWN half of L16's cast (pc-boxy
itself) cannot legally take the pose primitive this shot names. Two independent blockers on the same
shot.

L17 is `stage_role: delta` of L16 (pc-ring stage) — per dispatch instructions, a parked BASE parks its
delta too (blocked-by-base). Not attempted.

**Neither blocker was resolved on the spot — flagging for VPW/human restaging, not improvising.**

## Run log

- `forge.py batch --shots L10,L11,L12,L13,L14,L15 --out wB-spec.json` — 6 scenes, 0 STEP-1 figure gens
  (all figure primitives already exist in the channel registry/library — no new cast mint needed).
  NOTE: relative `--out` mis-resolved (doubled path bug, matches KNOWN ISSUES) — redone with an
  absolute `--out` path, confirmed correct.
- `forge.py gen --dry-run --batch wB-spec.json` — inspected all 6 assembled prompts before spend.
  Zero hand-authored clauses; every prompt was forge-assembled from shots.json + bible + registry.
- `forge.py gen --batch wB-spec.json` (LIVE) — **6/6 generated, 0 failed, 0 skipped, 0 held.**
  Staged to `<kit>/_staging/L10..L15.png`. One provider call per shot, well under the 4-min ceiling;
  no retries needed at generation time.
- `forge.py place --batch wB-place-names.json --to assets/scenes` — promoted all 6 staged PNGs to
  `assets/scenes/L10..L15.png` (PNG-validated on copy). Same doubled-relative-path bug hit here too;
  redone with absolute `--to`, confirmed files landed correctly.
- Computed sha256 of each placed file for the manifest note.
- Built combined manifest entries (existing rows + my 6, `review_status: unreviewed`, `parent_depth`/
  `lineage` inherited from the `batch` spec via `--from-batch`). **Hit a live race**: another wave
  (worker A, presumably) wrote to the SHARED `assets/scenes/manifest.json` between my read and my
  write, and my first `forge.py manifest` emit was clobbered (my 6 rows vanished, replaced by the
  other worker's L18-L25 rows written from a stale base). Recovered by re-reading fresh, excluding my
  own ids defensively, rebuilding, and re-emitting — verified immediately after that all 6 of mine
  AND the other worker's rows both survived (54 total entries, 0 duplicate ids). No card/entry outside
  L10-L17 was authored or altered by me.
- Built the review board: `build_review_artifact.py --video <video> --out wB-board.html --shots L10
  L11 L12 L13 L14 L15`.
- Dispatched a SEPARATE fresh-eyes review subagent (sonnet, general-purpose, no generator context) —
  given style-bible §1/2-2d/3/5, the 6 PNGs directly, and each shot's still_prompt/vo_text/shot_class/
  seed list. Awaiting its verdict.

## Round-1 fresh-eyes verdict (received)

- L10: clean (PASS all 3 axes).
- L11: clean (PASS all 3 axes).
- L13: clean (PASS all 3 axes).
- L14: FAIL fidelity — only one stub arm on the drawer (other pressed against the cabinet's upper
  side wall near head height) + oversized `prop-drive` rendered as a generic dark-grey metal filing
  cabinet instead of the established cream-buff/teal drive design.
- L12: FAIL fidelity — bedside lamp fixture entirely absent from frame (should read as a dark/unlit
  shape, not vanish) + tighter crop than L11.
- L15: FAIL rig only (fidelity/style clean) — crowd figures on adult body proportions instead of the
  locked squat crowd-rig proportion, plus one figure wears a distinct individuated dark
  head/shoulder covering (breaks the 2-3-repeating-silhouette crowd rule).

## Stamp round 1 (L10/L11/L13/L15 only)

Wrote `assets/_review/merged.json` entries for my 4 non-retry shots, then ran
`stamp_review.py <video_dir>` (orchestrator-only step).

**Important schema pitfall found and partially repaired:** `stamp_review.py`'s classifier requires
explicit per-axis `"f"`/`"s"`/`"r"` fields on each `merged.json` ruling (not just `"worst"`/`"why"`);
an entry carrying only `{id, worst, why}` reads as "missing verdict" on all 3 axes and force-parks
even a fully clean shot. My first stamp attempt used the simpler shape (matching several *pre-existing*
entries already in the shared `merged.json`, apparently written the same way by another wave) and it
**collaterally downgraded shots OUTSIDE my partition from `verified` to `parked`** (observed:
L28, L29, L33, L38, L44, L46, L169, L84, L114, L198, L65, L112, L86, and the just-added L18-L25 —
all pre-existing entries lacking `f`/`s`/`r`). I attempted a video-wide backfill repair but the
harness's own auto-mode classifier BLOCKED that write as out-of-partition (correctly — my brief says
touch nothing outside L10-L17). **I did not force it.** I only fixed my own 4 entries (L10/L11/L13/L15)
with proper `f`/`s`/`r` fields and re-ran the stamp, which correctly landed L10/L11/L13 as `verified`
and L15 as `parked` (rig only). **The collateral parking of the other-wave shots (L18-L25, L28, L29,
L33, L38, L44, L46, L65, L84, L86, L112, L114, L169, L198) remains — this needs the orchestrator/boss
to backfill `f`/`s`/`r` on those `merged.json` entries (propagate each entry's existing `worst` value
onto all three axes) and re-run `stamp_review.py` once. I flag this loudly in my final report; it is
NOT something I fixed myself, since it is outside my assigned shot range.**

## Retry round (L12, L14 only — L15 has no clean single-clause lever, not retried)

- Built `forge-retry-overlay@2` (`wB-retry-overlay.json`) with ONE exact-replace `content` defect
  entry per shot — L12 restores the lamp fixture as a visible-but-unlit shape + pins the same crop;
  L14 restores both-arms-on-the-same-drawer AND restates the prop-drive's established cream-buff/teal
  design in the same replaced span (two related facts, one contiguous span, one retry).
- `forge.py batch --retry wB-retry-overlay.json --out wB-retry-spec.json` — 2 requests, canonical
  shots only.
- `forge.py gen --dry-run` on the retry spec — inspected both assembled prompts; L12-fix correctly
  reseeds from the PROMOTED L11 canonical (`assets/scenes/L11.png`), never from the failed L12 frame,
  per the "never seed a defective frame" rule.
- `forge.py gen --batch wB-retry-spec.json` (LIVE) — **2/2 generated, 0 failed.** Staged to
  `_staging/L12-fix.png`, `_staging/L14-fix.png`.
- Dispatched a SEPARATE fresh-eyes reviewer (sonnet) for the two retry candidates, comparing L12-fix
  against approved L11 and L14-fix against L13's established prop-drive design. Awaiting verdict —
  this is the mandatory "next pass rules the retry" step; I never self-clear my own retry.

## Retry review verdict (received)

- **L12-fix: PASS, clean on all 3 axes.** Lamp fixture confirmed present as a dark unlit silhouette
  at the same pixel position/crop as L11; everything else pixel-held. Promoted:
  `_staging/L12-fix.png` (sha256 `0f2e81e8…`) copied over `assets/scenes/L12.png`. Stamped `verified`.
- **L14-fix: FAIL (rig).** Prop-drive identity and both-arms-on-drawer positioning are both fixed,
  BUT the retry introduced a NEW defect not present in the original: pc-boxy is drawn with
  articulated fingered hands gripping the drawer, breaking its established no-hands/stub-arm canon
  (arms also cross/stack at two heights rather than pressing side-by-side at hip height). **This was
  the one sanctioned retry — now exhausted, no third attempt.** Per skill doctrine ("keep the best
  attempt, mark it flagged, surface it"), promoted the retry anyway as the best available candidate
  (fixes 2 of 3 original defects vs. the original's 2 defects including a worse prop-identity miss):
  `_staging/L14-fix.png` (sha256 `021766a3…`) copied over `assets/scenes/L14.png`. Stamped `parked`
  with the fingered-hands rig defect as the reason. `suspected_mechanism_layer: vpw_authoring` — the
  shot's own "shoving" action verb pulls the render toward hand-based manipulation, which conflicts
  with pc-boxy's no-hands canon; a real fix needs the ACTION re-authored (e.g. body-check / lean
  against the drawer) rather than a further prompt-only retry on the same mechanism.

## Stamp round 2 (L12, L14)

Wrote proper `f`/`s`/`r` merged.json entries for L12 (clean) and L14 (rig defect, retry exhausted),
re-ran `stamp_review.py <video_dir>`. Result confirmed: L12 `verified`, L14 `parked`. **Good news on
the round-1 collateral damage**: by this second run the aggregate flipped to "28 verified, 10 parked"
(vs. round 1's "7 verified, 25 parked" before my fix, then "4 verified, 25 parked" briefly worse) —
spot-checked L28/L29 (outside my partition, previously wrongly downgraded) and both read `verified`
again. Someone else (boss/orchestrator or another wave) evidently applied the same `f`/`s`/`r`
backfill I was blocked from doing myself. Not verified end-to-end for every other shot in the video —
worth a final independent check outside my partition, but the acute damage I caused and flagged
appears resolved.

## Manifest field refresh (L12, L14 seeds/technique/retry_cause/notes)

Directly patched only the `seeds`/`technique`/`retry_cause`/`notes` fields on the L12 and L14 rows
(re-read manifest.json fresh immediately before write; left `review_status`/`parked_reasons` exactly
as `stamp_review.py` had just written them, touched no other row). Used a direct field patch rather
than re-running `forge.py manifest --kind scenes` over the whole 54-entry file a second time, to avoid
repeating the earlier lost-update race against Wave A's concurrent writes to this shared file.

## FINAL STATE — L10-L17

| Shot | Status | File | Notes |
|---|---|---|---|
| L10 | verified | assets/scenes/L10.png | clean, no retry needed |
| L11 | verified | assets/scenes/L11.png | clean, no retry needed (bedside-table BASE) |
| L12 | verified | assets/scenes/L12.png | 1 retry (lamp-fixture fix), now clean (bedside-table DELTA) |
| L13 | verified | assets/scenes/L13.png | clean, no retry needed |
| L14 | **parked** | assets/scenes/L14.png | 1 retry exhausted; fingered-hands rig defect remains; needs a shots.json action re-author, not another gen retry |
| L15 | **parked** | assets/scenes/L15.png | crowd-rig defect (proportions + headwear variety); no authored-payload retry lever found; needs root-cause on the §2d crowd-rig clause's effectiveness |
| L16 | **parked, $0 spend** | — | missing Pass-1 canonical for the "rival" personified computer + incompatible human-rig pose primitive on pc-boxy; needs VPW restaging / new asset gate |
| L17 | **parked, $0 spend** | — | blocked-by-base (delta of parked L16) |

**Calls:** 8 live provider gens total (6 initial batch + 2 retries), 0 failed. At the corrected
$0.134/gen minimum rate that's ~$1.07; at the empirical ~$0.17/gen all-in average, ~$1.36.

**Deviations to flag to the boss:**
1. Collateral stamp-schema damage (see above) — appears resolved by another party, but not
   independently re-verified by me outside L10-L17.
2. L14 and L15 need root-cause/re-authoring attention beyond scene-generation-worker scope (an
   action-verb rewrite for L14, a crowd-rig-clause investigation for L15) — not silently retried a
   third/second time.
3. L16/L17 need a Pass-1 gate decision (new "rival" pc-boxy variant canonical + pose-primitive fix)
   before any spend is attempted on the pc-ring stage.
