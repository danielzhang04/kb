# Variant-B genlog — first-12-shot batch (2026-08-20)

Branch: `claude/bricks-variant-vb` (main clone). Video: `2026-07-28-bricks-fresh`.

## Materialization

- Archived the existing (stale, pre-materialization) `shots.json` to `shots.pre-variant.json`
  (204 shots, a leftover full-video file not authored on this branch).
- Built the new `shots.json` from `scratchpad/vpw-var/fragment-A1.json` (VPW's 45-shot Act-1
  fragment) per this branch's `shots-schema.md`: schema `faceless-youtube/shots@2`,
  `global_prompt_suffix: ""` (this branch's empty byte-lock), `long_form.shots` = the 45 fragment
  shots verbatim, empty `thumbnail`/`shorts` scaffolding (fragment covers Act 1 only).
- Lint (`lint_shots.py`): **2 HARD** — both act-only-vs-full-script sizing (duration-sum 97s vs the
  full ~558s script runtime; 45 shots vs the ~112-shot full-runtime cadence floor) — exactly the
  two fragment-scope HARDs the dispatch called out as expected/accepted. **14 heads-up**, all the
  advisory "registry character named in prompt but not in `cast`" notice (harmless; this branch's
  doctrine casts inline by name, not via the `cast` array). Confirmed unchanged after the R1 prompt
  edits below (re-ran lint at the end — still 2/14, no new violations).

## Registry restoration (git-history data restore, no unsanctioned pixels)

- `pc-boxy` (needed by L04) was ABSENT from `visual-kit/registry/registry.json` on this branch —
  the variant-B recut restored an older Poyais-only registry state (8 characters) that predates the
  Bricks video's cast. The on-disk canonical `refs/pc-boxy/pc-boxy.png` was untouched (sha256
  `dff1d8c6...` matches byte-for-byte the blob at parent commit `f1c3b1aa`, before the recut).
  Restored the `characters.pc-boxy` + `assets[].pc-boxy` entries verbatim from that commit — a pure
  data restoration of a dropped record for an asset already verified and on disk, not a new mint.
  No other characters needed for this 12-shot scope (rival-pc/drive-maker aren't cast until L19-21,
  outside scope).

## Pixel hygiene

- `assets/scenes/` held VARIANT-C pixels for L01-L45 (confirmed via `scenes/manifest.json`
  technique strings literally reading "style suffix", a variant-C-only mechanism this branch does
  not use). Did not trust any existing filename; forced fresh generation for all 12 target shots.

## Generation — batch 1 (11 shots, L08 deferred)

`forge.py batch` then `forge.py gen --image-size 1K --force`, kit `the-second-take`, aspect 16:9.
L08 (a stage delta off L07) was excluded from batch 1 because its parent L07 had no seeding review
record yet (forge's P3 gate) — generated it separately after L07 was reviewed+promoted.

11/11 succeeded on the first call. **Fresh-eyes review found real defects on 4 of the 11**
(L01, L02, L04, L07) plus one on L09 in a later pass — see Review below.

## Fresh-eyes review + ONE re-authored retry per failing shot

- **L01** — DEFECT (fidelity): "deep blue suburban den" rendered as a retail/arcade room (cash
  register, arcade cabinet) instead of a private home. Re-authored: dropped "arcade glow" (which
  was pulling in retail furniture), locked "1980s home den... TV glow... no shop counter, no cash
  register, no arcade cabinet". Retry: clean.
- **L02** — DEFECT (style/rig): near-ground crowd rendered fully detailed (individuated hair/faces)
  against the channel's plain round-head crowd rig used everywhere else, including this same
  image's background figures. "big-haired shoppers" phrasing likely invited the off-rig detail.
  Re-authored: explicit "channel's simple round-head crowd rig... no individually detailed faces or
  hair". Retry: clean, rig-consistent throughout.
- **L04** — DEFECT (rig, HARD): `pc-boxy` rendered with fingered hands, violating its registry
  `no_hands: true` canonical; framing also too close for the authored "far down... alarmed pause".
  Re-authored: restated the no-hands fact inline (carried-fact law, L-1 analog) + reasserted
  middle-distance framing. Retry: clean, no hands, correctly scaled.
- **L05** — DEFECT (fidelity, minor): engine invented illegible gibberish signage text on the
  background shop windows (unauthored). Re-authored: explicit "windows with plain unmarked glass —
  no signs, no lettering". Retry: clean; the one authored literal ('1983' on the calendar) still
  reads correctly letter-by-letter.
- **L07** — DEFECT (fidelity, HARD): shot is the crowd-free BASE of the retail-shelf stage (crowd is
  reserved for L09 per the plan's disclosure ordering), but the engine added an unauthored shopper
  crowd plus fabricated box labels ("HOME PC", "NEW!", a price tag). Re-authored: explicit "EMPTY...
  no shoppers present... no labels, no price tags, no on-box text". Retry: clean, matches the
  intended quiet establishing plate — and now a valid held-stage base for L08's delta.
  Note: `notes` in `merged.json`/`shots.json` misstates this as "ONE sanctioned retry (plain reroll)"
  in one place — corrected to reflect the actual re-authored-prompt retry used here.
- **L09** — DEFECT (fidelity, HARD): shopper crowd rendered in anachronistic Victorian-era dress
  (top hats, bonnets, long gowns) instead of 1980s clothing. Re-authored: explicit "plain 1980s
  clothing... NO historical or Victorian costume, no top hats, no bonnets". Retry: clean, era-correct
  on the plain crowd rig.
- **L03, L06, L10, L11, L12** — clean on the first gen, no retry needed.

All 6 retries passed on the ONE allotted attempt; **zero shots parked**.

## Delta-chain handling (L08)

- L07 (base) required a P3 seeding review record before L08 (delta) could seed off it. Built the
  asset-verdict skeleton (`build_review_artifact.py --staging ... --assets _staging/L07.png
  --figures-out ...`), filled `{"fidelity":"pass","style":"pass","rig":"pass"}` from the fresh-eyes
  look above, merged via `stamp_review.py --figures ...` into `visual-kit/_staging/review.json`.
- Placed the 11 reviewed frames into `assets/scenes/` (overwriting the stale variant-C pixels)
  BEFORE building L08's spec, so forge's place-frame resolution picked up the corrected L07 (by
  digest match in the review store) rather than the old on-disk variant-C `scenes/L07.png`.
- L08 generated clean on the first call: shelf wall now mostly bare, held set/rail/skylight/palette
  persist from the base — the single authored depletion delta.

## Scene-level machine-tier review + stamp

- `assets/_review/merged.json` carried STALE variant-C rulings for L01-L25 (different narrative
  details than what's on disk now, e.g. L03's old ruling described "an adding machine" and "a
  hair-thin red thread" that don't exist in the current image). Replaced only the L01-L12 entries
  with fresh rulings from this batch's actual review (all `clean`/`clean`/`clean`); left L13-L25
  untouched (their pixels/rulings are outside this run's scope and unchanged).
- `stamp_review.py <video_dir>` → `stamped: 25 verified, 0 parked` (our 12 + the 13 pre-existing,
  idempotently re-stamped).
- Updated the `technique`/`seeds`/`parent_depth`/`lineage`/`notes`/`retry_cause` fields on the
  L01-L12 `scenes/manifest.json` entries from the actual batch specs (they previously described
  stale variant-C techniques, including literal "style suffix" wording this branch does not use).

## Call accounting

| Step | Calls |
| --- | ---: |
| Batch 1 (L01-L07, L09-L12) | 11 |
| Retry 1 (L01, L02, L04, L05, L07, L09) | 6 |
| L08 | 1 |
| **Total** | **18** |

Ceiling was 22 — closed with 4 calls to spare, no stall (each dispatch completed inside the poll
window; no re-issue needed). Cost: 18 × $0.134 = **$2.412**.

## Park mechanisms

None. All 12 target shots reached `verified`, 0 `parked`.

## Verified / parked counts

- Verified: 12/12 (L01-L12).
- Parked: 0.
