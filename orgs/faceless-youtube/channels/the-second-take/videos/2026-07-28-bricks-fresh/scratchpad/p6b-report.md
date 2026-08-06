# Phase 6B report — bricks-fresh first tenth (L01–L25)

Worker: phase-6b generation worker · 2026-08-06 · branch `claude/bricks-doctrine-reset` (R1 fix ea71f99)
Nothing committed, staged, or pushed. Writes confined to `V/scratchpad/`, `V/assets/scenes/`,
`V/assets/_review/`, and `KIT/_staging/`.

---

## Weaknesses first

**1. Six of the 25 slice shots are undelivered — a sustained provider outage, not a content defect.**
`HTTP 503: "This model is currently experiencing high demand"` returned on **three successive waves**
for L08, L10 and L22. L23/L24/L25 were never attempted because their chain root L22 does not exist,
and seeding them off nothing would have reintroduced exactly the silent-continuity violation the
STEP-1 promotion was performed to eliminate.

I made **one bounded retry** of the outage (the error text states spikes are usually temporary), it
failed identically, and I **stopped rather than loop**. No frame's one sanctioned CONTENT retry was
spent — that budget is fully intact for all 17 delivered frames. **These 6 are resumable with zero
rework:** `p6b-slate2.json` already holds their correct plate-resolved specs; re-running
`forge.py gen --batch p6b-lane4b.json`, then a lane of L23/L24/L25, is the entire remaining action.

**2. The boss's ruling brief miscounted the board-v2 rulings, and I did not silently reconcile it.**
The brief said "rulings R2/R3/R5 + the five plain passes". The binding record
(`orgs/faceless-youtube/knowledge/decisions.md`, 2026-08-06, commit ea71f99) shows **R1–R6 with FOUR
numbered plate rulings and FOUR plain passes** — **L172 carries an explicit ruling (R4)**, it is not
a plain pass. All 8 are Daniel-accepted either way, so the promotion itself stands.

**3. L28 is stamped `verified` on human acceptance, NOT on a clean measurement.** Daniel's R2
accepted L28-retry1 with its ink-register deviation left OPEN (ink luminance 44.5 vs the archived
prior's 23.0; coverage 11.43% → 8.90%), folding the question into the systemic R1 fix. **R1 is a
generator-side style change and does not retroactively alter those pixels.** I recorded the residual
verbatim in the manifest entry's `notes` and in its `merged.json` ruling so it can never be quietly
erased. Flagging because a future reader seeing `verified` would otherwise assume it measured clean.

**4. L06 carries a duplicated diegetic literal.** Two "1983" cards render — the authored window card
plus an unauthored tent card on the counter; the prompt states only "the window card carrying
'1983'". Logged and badged on the board for the fresh-eyes verifier. I deliberately did **not** spend
the frame's one retry: pre-empting the verifier's judgment is not the generator's call.

**5. Two frames sit low on saturation** — L16 (0.1686) and L19 (0.1922). Both clear the 0.10 tripwire
and both are authored low-chroma, but they are the two to eye hardest for the grey-drain failure.

**6. Zero STEP-1 figures minted**, so `p6b-figures.json` is a legitimately empty skeleton — this
slice does not advance the C-6 reuse loop for the next one.

---

## STEP 1 — plate promotion (complete)

**8 plates copied** `KIT/_staging` → `V/assets/scenes/`: L03, L05, L63, L71, L113, L172, L196, and
`L28-retry1.png` → `L28.png` (retry provenance in its manifest note).

**Manifest:** `forge.py manifest --kind scenes` **accepted all 8 — no counter refusal.** C-11
counters were copied *programmatically* from the remint batch specs (`remint-plates-slate.json`;
`remint-L28-retry.json` item `L28-retry1`), never re-derived by eye. All 7 spec'd plates carry
`parent_depth=0 / lineage=0` — they are ROOT plates with no place parent, exactly what
`forge._scene_provenance` returns for `if not place_frame`. **L05 has no batch spec** (Daniel's R5
restored-archive frame, a $0 manual copy-in that never went through `batch`), so its counters are
stated as those same root values, with its note naming the archive source and the ruling. Nothing
was fudged and forge refused nothing.

**Stamp:** `stamp_review.py <video_dir>` → **`stamped: 8 verified, 0 parked`**, from a ruling file
built at `assets/_review/merged.json` (the path stamp_review hardcodes) out of Daniel's board-v2
rulings. `stamp_review.py` remained the only writer of every verdict.

| plate | ruling | source file |
| --- | --- | --- |
| L03 | **R3** — night-scene exception granted | `_staging/L03.png` |
| L05 | **R5** — style-tile copy rejected; restored from `_pre-remint-archive-2026-08-05` | `_staging/L05.png` |
| L28 | **R2** — accepted; line-weight absorbed into R1 (residual open) | `_staging/L28-retry1.png` |
| L172 | **R4** — remint accepted (after > before) | `_staging/L172.png` |
| L63, L71, L113, L196 | plain pass ×4 | `_staging/<id>.png` |

## STEP 2 — the formerly-blocked shots

The dry-run (`p6b-dryrun2.txt`) **confirms the blocker is gone**: every one of the 9 resolves a real
place plate, `plate=False` on all nine (no silent root fallback), and **`lineage=1` on every direct
child of L03/L05 — proving the `verified` stamp registered**, since the counter resets only under a
verified parent.

| shot | resolved place seed | depth/lineage | outcome |
| --- | --- | --- | --- |
| L06 | `assets/scenes/L05.png` | 1 / 1 | **generated** (canary 2) — 0.2353 |
| L07 | `assets/scenes/L05.png` | 1 / 1 | **generated** — 0.2431 |
| L08 | `_staging/L07.png` | 2 / 2 | **FAILED** — 503 ×3 |
| L09 | `assets/scenes/L05.png` | 1 / 1 | **generated** — 0.2353 |
| L10 | `assets/scenes/L05.png` | 1 / 1 | **FAILED** — tool-ceiling kill, then 503 ×2 |
| L22 | `assets/scenes/L03.png` | 1 / 1 | **FAILED** — 503 ×2 |
| L23 | `_staging/L22.png` | 2 / 2 | **not attempted** — chain root L22 missing |
| L24 | `_staging/L23.png` | 3 / 3 | **not attempted** — chain root L22 missing |
| L25 | `_staging/L24.png` | 4 / 4 | **not attempted** — chain root L22 missing |

**Continuity verified by eye on the canary:** L06 reproduces the L05 plate's shelf bays, box
arrangement, oak counter, brass till, teal trim, street door and floor light pool, with the authored
crate delta composited on top. That is the unblock working as intended.

## Final tally

- **Generated: 17** — L01, L02, L04, L06, L07, L09, L11–L21.
- **Reused board-approved: 2 in-slice** (L03, L05); **6 more promoted** out of slice (L28, L63, L71,
  L113, L172, L196).
- **Undelivered: 6** — L08, L10, L22 (provider 503); L23, L24, L25 (chain dependents).
- **Provider-touching calls: 26** (17 successes, 9 failures — 8 of them 503s).
- **Spend: $1.014 counted conservatively** (every provider-touching call billed, 503s included);
  realistically **$0.663** for the 17 successful gens. Ceiling $3.00 — **at most 34% consumed**,
  leaving ≥$1.99 for the 6 resumable shots.
- **Saturation range: 0.1686 – 0.7176.**
- **R1 regression tripwire: NEVER TRIPPED.** No frame < 0.10, so never two consecutive.
- **Canaries: 2/2 PASSED** — L01 (slice 1) and L06 (slice 2, which additionally proved place
  continuity against the newly promoted L05 plate). No batch ever fired on an unverified config.

## Files

| path | what |
| --- | --- |
| `assets/scenes/manifest.json` | 8 promoted entries, all `review_status: verified`, `parked_reasons: []` |
| `assets/scenes/L03,L05,L28,L63,L71,L113,L172,L196.png` | the promoted approved plates |
| `assets/_review/merged.json` | the board-v2 ruling input stamp_review consumed |
| `scratchpad/p6b-board.html` | **19 cards** — 17 candidates + 2 promoted plates as continuity context; verdicts EMPTY |
| `scratchpad/p6b-figures.json` | C-6 figure skeleton (empty — no STEP-1 minted) |
| `scratchpad/p6b-genlog.md` | live status surface: slice decision, promotion, per-call rows |
| `scratchpad/p6b-report.md` | this report |
| `scratchpad/p6b-slate.json`, `p6b-slate2.json` | the two batch specs (slate2 holds the 6 resumable) |
| `scratchpad/p6b-dryrun.txt`, `p6b-dryrun2.txt` | $0 pre-flights |
| `scratchpad/_promote_plates.py`, `_build_p6b_board.py`, `p6b_sat.py` | drivers/helpers |
| `_staging/_pre-p6b-archive-2026-08-06/` | 23 stale pre-reset frames, moved not overwritten |

## Owed next

1. **Resume the 6** when the provider recovers — specs already built, no rework.
2. **Fresh-eyes verifier** over `p6b-board.html` (17 candidates), then stamp.
3. **`knowledge/decisions.md` entry** for the promotion + the R4/L172 miscount correction —
   operating-law §F-log requires it, but `knowledge/` is outside this worker's write scope, so it is
   the boss's to log.
4. **Consider surfacing the silent-plate-miss as a forge defect**: a missing PLACE plate should
   hard-error at $0 like other unresolvable seeds, instead of silently downgrading to a root plate.
   Not patched (prohibited) — flagged only.


---

# CONTINUATION 2026-08-06 — record / stamp / promote / resume / retry

## Weaknesses first (continuation)

**1. The provider is DOWN, and it stopped the run twice.** Resume canary L10 returned `HTTP 503`;
its one re-issue HUNG past the 4-minute stall ceiling. The retry probe L06-retry1 also returned
`HTTP 503`. Per the standing instruction I stopped both times rather than burn the ceiling on a dead
API. **No shot was resumed and no retry frame exists.**

**2. L08 is blocked again — and by the SAME forge defect, on a new path.** After stamping, L08's
rebuilt slate seeds `[crowd-exemplar]` only: it silently LOST its in-chain parent L07. L07 is
parked, so it was never promoted; `assets/scenes/L07.png` does not exist; `place_frame` resolves to
`None`; and forge's explicit parked-parent refusal in `_scene_provenance` ("a parked defect is
non-shippable and may not be inherited") is NEVER REACHED, because that guard only fires when the
parent file resolves. Generating L08 would have produced a frame with no continuity to its stage
parent. **I did not generate it.** L08 now waits on L07's retry being reviewed and verified.

**3. The 4 parked frames' manifest entries point at `assets/scenes/<id>.png`, which does not
exist** — they were correctly NOT promoted. Harmless today (a parked entry hard-errors the render
gate before any file is read) but it is an inconsistency a future reader should not trip over.

**4. Nothing was softened.** Every `parked_reason` in the manifest is the verifier's own string
verbatim, including the two HIGH-severity fidelity parks.

## What landed

**RECORD.** All 17 candidates emitted through `forge.py manifest --kind scenes --from-batch
p6b-slate.json`; the 8 already-promoted plate entries carried through verbatim so the emit could not
drop them. L06/L07/L09 counters copied programmatically from `p6b-slate2.json` (`--from-batch` reads
only one spec). **Manifest: 25 entries.**

**STAMP.** `stamp_review.py` + the verifier's `p6b-rulings.json` -> **`stamped: 13 verified, 4
parked`**. Manifest now **21 verified / 4 parked / 0 unreviewed**.

**PROMOTE.** 13 verified candidates COPIED (not moved) into `assets/scenes/`; `_staging` keeps every
copy. **`assets/scenes/` holds 21 PNGs.** The 4 parked are correctly absent.

**RETRIES BUILT + $0-VALIDATED.** One `faceless-youtube/forge-retry-overlay@2` manifest
(`p6b-retry-overlay.json`), four entries, correction text derived ONLY from the verifier's failed
attributes. `batch --retry` + `gen --dry-run` confirm **`changed_spans: 1` on all four** — one
exact-replace authority each, every passing clause byte-identical, names free of collision.

| retry | replaced span | what it corrects (verifier's failed attributes only) |
| --- | --- | --- |
| L06-retry1 | the `'1983'` window-card clause | t2 — that card is the ONLY '1983'; no tent card |
| L07-retry1 | Framing + palette + queue sentence | r2 vantage, r3 crate-at-counter, g1 hand on every note, t1 complete lettering |
| L16-retry1 | `Palette beige on grey.` | a4 cases warm beige ~#d8c9a3, s1 WARM #241a12 ink (measured cyan, hue 172.2deg, R-B -1.4 — sole inversion in a batch running 6-34deg / +3.4 to +31.3) |
| L18-retry1 | the `Only this changes:` sentence | a1 slabs STAND ON END, r1 parent set held, r2 same 1980s crowd, s1 red semantic only |

Seeds are right: L06/L07-retry1 seed promoted `scenes/L05.png`; **L18-retry1 seeds promoted verified
`scenes/L17.png`** — precisely the parent-continuity invariant it broke.

## Ledger

- **Provider-touching calls: 29** (17 successes, 12 failures — 10 of them 503s).
- **Spend: $1.131 conservative** / **$0.663 realistic**. Ceiling $3.00 — **at most 38% consumed**,
  **≥$1.87 left** for the 10 frames still owed.
- **R1 tripwire: NEVER TRIPPED** across all 17.

## Still owed (all specs built — no rework, just a live provider)

| owed | count | blocked by |
| --- | --- | --- |
| 4 retry frames (L06/L07/L16/L18-retry1) | 4 | provider 503 — fire `gen --batch p6b-retry-slate.json` |
| L10, L22, then chain L23→L24→L25 | 5 | provider 503 — `p6b-slate3.json` |
| L08 | 1 | DOCTRINE: parked parent L07 — needs L07-retry1 reviewed + verified + promoted FIRST |

Retry frames get NO stamp — they return to fresh-eyes. The 4 parked manifest entries stay parked.
