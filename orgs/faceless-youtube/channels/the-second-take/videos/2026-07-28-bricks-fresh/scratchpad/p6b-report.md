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
