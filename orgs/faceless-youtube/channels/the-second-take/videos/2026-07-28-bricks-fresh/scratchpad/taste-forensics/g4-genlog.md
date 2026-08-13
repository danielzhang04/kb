# G4 paid mint — incremental genlog (Task 9c)

**Spend law: $5.00 HARD CAP.** Rate convention (from `scratchpad/6c2-genlog.md`): 1K = $0.039,
2K = $0.134, 4K = $0.24. forge prints no cost; every cost below is an estimate at that rate.
Transport failures (no image returned) are NOT billable.

Every gen is appended here AS IT HAPPENS, before the next one is issued.

| # | round | frame | size | outcome | est. cost | cumulative | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | `line-worker` canonical | 1K | OK -> `_staging/line-worker.png` | $0.039 | $0.039 | new-cast mint (P2/P3 cast exemption); credential canary — forge loaded its own `.env`, first call succeeded |
| 2 | 1 | **L28** (miniscribe-floor plate) | 1K | OK | $0.039 | $0.078 | seeds `lettering-marker-italic` + `scene-style-tile` |
| 3 | 1 | `fig-miniscribe-rep--action-powerstance--expr-delighted--2ca9a597` | 1K | OK | $0.039 | $0.117 | L29 card |
| 4 | 1 | `fig-ibm-suit--expr-smug--13275cca` | 1K | OK | $0.039 | $0.156 | L33 card |
| 5 | 1 | `fig-miniscribe-rep--expr-delighted--13275cca` | 1K | OK | $0.039 | $0.195 | L33 card |
| 6 | 1 | `fig-ibm-suit--action-armscrossed--expr-deadpan--7d403f11` | 1K | OK | $0.039 | $0.234 | L38 card |
| 7 | 1 | `fig-miniscribe-rep--action-offering--expr-worried--24a6dfcf` | 1K | OK | $0.039 | $0.273 | L38 card (P12: `expr-pleading` -> `expr-worried`) |
| 8 | 1 | `fig-miniscribe-rep--hold-both-hands--expr-greedy--b1cd8a27` | 1K | OK | $0.039 | $0.312 | L39 card (P8-rekeyed `c7abdc09` -> `b1cd8a27`) |
| 9 | 1 | `fig-ibm-suit--action-thumbsdown--expr-annoyed--a8e7e3a3` | 1K | OK | $0.039 | $0.351 | L44 card |
| 10 | 1 | `fig-miniscribe-rep--action-slump--expr-worried--def769f5` | 1K | OK | $0.039 | $0.390 | L48 card (P8-rekeyed `4969239b` -> `def769f5`) |

| 11 | 1R | `fig-miniscribe-rep--hold-both-hands--expr-greedy--b1cd8a27` | 1K | OK (retry 1of1, `defect: pose`) | $0.039 | $0.429 | FAILED AGAIN -> PARKED |
| 12 | 1R | `fig-miniscribe-rep--action-slump--expr-worried--def769f5` | 1K | OK (retry 1of1, `defect: pose`) | $0.039 | $0.468 | FAILED AGAIN -> PARKED |

| 13 | 2 | **L29** | 1K | OK | $0.039 | $0.507 | scene released once its card + L28 carried verdicts |
| 14 | 2 | **L33** | 1K | OK | $0.039 | $0.546 | two-cast `handshake`; L34's parent |
| 15 | 2 | **L38** | 1K | OK | $0.039 | $0.585 | two-cast, no place; P2 `ibm-suit` re-cast + P12 expression swap |
| 16 | 2 | **L44** | 1K | OK | $0.039 | $0.624 | same cast member, different act — P8 act-keying |
| 17 | 2 | **L169** | 1K | OK | $0.039 | $0.663 | pure crowd beat, no cast — P4 in isolation |

| 18 | 2b | `fig-line-worker--hold-both-hands--expr-crestfallen--1d776b7a` | 1K | OK | $0.039 | $0.702 | L46 card, un-parked by the boss stamp — VERIFIED first try |
| 19 | 2b | **L46** | 1K | OK | $0.039 | $0.741 | scene released once its card was stamped — VERIFIED |
| 20 | 3 | **L34** | 1K | OK | $0.039 | $0.780 | delta off the VERIFIED L33 (lineage reset 2->1) — FAILED delta-discipline -> PARKED |

## Running total: $0.780 / $5.00  — FINAL. 20 gens, 0 transport failures, 0 provider 503s.

Round 2 final: `== 2 generated, 0 failed, 12 skipped, 2 held for review ==` on the re-issue
(5 scenes across both invocations: L29, L33, L38, L44, L169). **L39 and L48 stayed held**, now with a
sharper refusal than round 1 — `its review.json record FAILS rig` rather than "no review record".
The gate distinguishes *unruled* from *ruled-and-failed*, and a parked card cannot seed its scene.

### BOSS UPDATE mid-run (recorded verbatim in effect)
1. `expr-crestfallen` grandfather-stamped by the boss — store verified at 28 rows, same provenance
   string as the other 16, both P12 FAILs intact. **L46 un-parked**, ~$0.078 top-up authorised.
2. The two pose parks are **CONFIRMED — no further retries.**
3. Continue rounds 2-3 to completion, L33-before-L34 chain law, verifier stamps.

### A SECOND mechanism found while re-building L46 — plate lost to batch SLICING

Built scoped to `--shots L46` alone, L46's slate came back **`[card, crowd-exemplar]` with NO place
seed**, and the spec item read `place = None` — even though `shots.json` carries
`"place": "miniscribe-floor"` on that shot. Its siblings L44 and L169 both got the L28 plate.

Cause: the place plate is attached from the WALK that saw the shot which mints the place, so scoping
a batch to a shot without its plate-minting shot silently drops the plate. This is not cap
displacement (the plate is never droppable, and the slate was 2 seeds against a cap of 4). It is the
slicing hazard `plate_seed_overrides` names in its own docstring for the gate override — the same
hazard reaches the PLACE SEED itself, where nothing reports it.

Fix applied, no improvisation: rebuild scoped `--shots L28,L46` so the walk sees the plate. L46 then
correctly carries `role: place _staging/L28.png`. **Worth a doctrine item:** a sliced batch should
refuse, or at minimum warn, when a shot's declared `place` yields no place seed. Right now it is
silent, and a silently place-less frame is exactly the continuity break P5/P6 exist to prevent.

Note: the round-2 invocation was killed by MY OWN 10-minute tool ceiling after L38, not by the
provider — L44 and L169 had not been reached. No frame was lost and nothing was double-charged:
forge skips a frame whose PNG already exists, so the re-issue below picks up exactly where it
stopped. Re-issued in the background.

### Round 1 result — `== 9 generated, 0 failed, 0 skipped, 7 held for review ==`

Zero transport failures, zero retries. The 7 scenes (L29, L33, L38, L39, L44, L48, L169) were each
**held** with `skip (seed awaits review)` naming their unreviewed card and/or the unreviewed `L28`
plate. That is the round boundary working: it is correct behaviour, not a bug, and it is the second
live demonstration of P3 that 9a could only derive from code. Note L169 is held on the **plate
alone** — `place \`L28\` refused` — which is C-1's fix visible in the field: a plate is gated by path
even when it arrives wearing an exempt-looking label.

### Round 1 review — two disjoint sonnet verifiers, then merge (any fail = the frame fails)

| verifier | axes ruled | agent id | fails |
| --- | --- | --- | --- |
| sonnet-verifier-A g4-round1 | `rig` (incl. identity + pose), `expression-register` | `a4f64e94f26373b17` | 2 |
| sonnet-verifier-B g4-round1 | `flat-cel-hazard`, `line-register`, plate-law | `a3038907ba3c67d3a` | 0 |
| sonnet-verifier-A g4-round1-retry | same A axes, 2 retried frames | `a9bb0ecc0d273888b` | 2 |
| sonnet-verifier-B g4-round1-retry | same B axis, 2 retried frames | `a017c21ad78889ef2` | 0 |

(The round-1 pair could not be resumed for the re-verification — no transcript was retained — so the
re-verification went to a FRESH pair. That is strictly better for independence: the retried frames
were judged with no anchoring on the earlier ruling, and they reached the same verdict.)

**Verified 7/9:** `L28`, `fig-miniscribe-rep--action-powerstance--expr-delighted--2ca9a597`,
`fig-ibm-suit--expr-smug--13275cca`, `fig-miniscribe-rep--expr-delighted--13275cca`,
`fig-ibm-suit--action-armscrossed--expr-deadpan--7d403f11`,
`fig-miniscribe-rep--action-offering--expr-worried--24a6dfcf`,
`fig-ibm-suit--action-thumbsdown--expr-annoyed--a8e7e3a3`.

**Parked 2/9**, both on `rig` (the pose half), both after their one sanctioned retry:
`fig-miniscribe-rep--hold-both-hands--expr-greedy--b1cd8a27` (L39's card) and
`fig-miniscribe-rep--action-slump--expr-worried--def769f5` (L48's card).

Stamped via `stamp_review.py --figures` (the only writer) — 9 records merged, fails stamped as
fails. Store now 27 rows.

### THE MECHANISM behind both parks — worth the whole slice

Both parked cards came back **in the canonical's default upright standing pose**, with the pose
primitive simply not landing. The `action-slump` reference is an unmistakable bowed stoop; the card
is square-shouldered and upright. The `hold-both-hands` reference has both arms forward at
mid-torso; the card has the arms hanging (retry 1: one fist doing a sideways thumbs-up, the other
loose at the belt). Neither is subtle, and the retry — a full re-mint through the sanctioned P10
`pose` path carrying an explicit corrective posture instruction — **did not move the body either
time**.

The two parked cards are **exactly the two beats 9a re-authored to REMOVE stance prose** (L48: "with
his shoulders down" deleted; L39: sentence re-composed from the primitive). Every card whose beat
prose was left alone took its pose correctly (powerstance, armscrossed, offering, thumbsdown — 4 for
4). So the honest reading of this slice is:

> **P8's fix removed the thing that was actually carrying the pose.** The stance prose was doing the
> work; the pose SEED alone does not reliably transfer posture. P8 correctly identified that stance
> prose next to a named pose re-poses the card — but the remedy left the pose with no carrier at all,
> and P10's retry lever cannot recover it, because P10 re-mints from the same recipe that just failed.

This is a real doctrine finding, not a provider flake: 2 for 2 on the re-authored beats, 4 for 4 on
the untouched ones, and 2 further failures under an explicit corrective instruction. It should go to
the boss as the headline result of the mint.

---

## Pre-flight (2026-08-12, $0)

- Preamble: **OK** (no STOP file, no ANTHROPIC_API_KEY in env, budget within guard).
- Worktree HEAD `0471fc7`, branch `claude/bricks-taste-forensics`. Nothing committed or pushed.
- Credential: **never touched.** An existence check on `.env` was correctly BLOCKED by the
  hard-ceiling hook; I did not retry, and forge loads the file itself.
- Gate store `<kit>/_staging/review.json`: **18 rows exactly** — 16 grandfathered PASS
  (reviewer "grandfathered 2026-08-13 - boss ruling per Daniel G2 trust statement (2026-08-12)")
  + the 2 P12 FAILs (`expr-shock`, `expr-pleading`, reviewer "Daniel veto, G2 2026-08-12, P12").
  No `"fixture"` rows present — the 9a test-suite contamination finding is NOT active right now.
- Slice spec `g4-slice.spec.json`: 18 items = 10 scenes + 8 STEP-1 cards (the 9th card,
  `line-worker`'s, only resolves after round 0 mints that canonical).

### Pre-flight finding — L46 will park (recorded BEFORE any spend)

The 16 grandfathered rows substitute **`crowd-exemplar` for `expr-crestfallen`**. `expr-crestfallen.png`
exists in `refs/base/` but carries **no review record**. L46's authored prose names
`` `line-worker`, `expr-crestfallen`, `hold-both-hands` ``, and `seed_role_review_refusals`
(forge.py:1806-1831) runs over the **STEP-1 card's own roles**, so an unstamped expression primitive
refuses the card that would mint it. This was invisible when the grandfather board was built, because
`expr-crestfallen` only becomes reachable once `line-worker` exists.

I will **not** stamp it — writing that PASS row is fabricating a human review verdict, which is the
exact thing the gate exists to prevent (same call 9a made). L46 parks; the mechanism is recorded and
the remedy is one human-authorised stamp plus a 2-gen top-up (~$0.078).

**CONFIRMED LIVE at $0, after round 0** (once `line-worker` existed and L46 could resolve):

```
L46: expression `expr-crestfallen` refused as a seed - it has no review record in
     channels/the-second-take/visual-kit/_staging/review.json. Every asset whose pixels seed a
     scene carries a human ruling (P3); render it onto the review board and record the verdicts
```

Two things this proves, both worth keeping:
1. **P3's gate is real and it fires at BATCH time**, not gen time — an unreviewed primitive is
   refused before a spec exists, so it can never be paid for. This is the live demonstration 9a
   could only derive from code ("the gate's hold pattern is derived, not demonstrated live").
2. The refusal is **fatal to the whole batch build** (`refuse_unreviewed` exits; the spec is not
   written at all), so one unreviewed primitive blocks its 8 unrelated slice-mates. L46 is
   therefore dropped from the spec rather than merely skipped inside it — the run continues on the
   other 8 shots. **Slice is now 9 beats, not 10.**

### Round 0 — `line-worker` promoted (no spend)

- `_staging/line-worker.png` -> `refs/line-worker/line-worker.png`.
- Pass-1 identity row added to `<V>/assets/library/manifest.json` (name, kind `identity`, file,
  head_tone `#c8936b` sampled off the minted pixels, pinned costume, shots `[L46]`). This is the
  vocabulary route — `merge_vocabulary` (forge.py:463-493) unions the channel registry with this
  manifest, so **no channel `registry.json` edit was needed** and no governing file was touched.
- No human review record written for it: a named cast member's own canonical is the ONE P3
  exemption (G2 ruling), and the frame is on-style (family rig held, no nose, no ears, costume
  as authored).
- The per-video crowd exemplar 9a priced was **not minted**: the boss's grandfather stamp covers
  the channel `crowd-exemplar`, which already resolves as a seed for L169. Saves $0.039.

---

## Rounds 2b + 3 — verifier agent ids

| verifier | scope | agent id | fails |
| --- | --- | --- | --- |
| sonnet-verifier-A g4-round2 | 5 scenes + L46 card, rig/identity/pose | `ae93b25f844fa15d4` | 0 |
| sonnet-verifier-B g4-round2 | same, style/palette/place-continuity | `a28bd786ffe216539` | 0 |
| sonnet-verifier-A g4-round2b | L46 scene, rig/identity/pose | `aca336c28782bb390` | 0 |
| sonnet-verifier-B g4-round2b | L46 scene, style/place-continuity | `a6e075bc02f788a63` | 1 (overturned) |
| sonnet-verifier-B2 g4-round2b-adjudication | L46 place-continuity only | `a2413344a28147573` | 0 |
| sonnet-verifier-A g4-round3 | L34, rig + delta-discipline | `a0753835202288259` | 1 |
| sonnet-verifier-B g4-round3 | L34, style + place-hold | `aea6b6c85b0b04806` | 0 |

### One verifier ruling was OVERTURNED — recorded because it matters for how much these stamps are worth

`sonnet-verifier-B g4-round2b` failed L46 on `place_continuity`, describing the L28 plate as "a
wood-shelved retail/office interior with a terrazzo floor and a single pendant lamp". L28 is a
steel-benched factory hall with a tote rack, a roller door and a hanging MINISCRIBE board — the
description matches no file in this kit, and the same agent's own sibling had just matched four other
scenes to that plate. I read the plate myself, then sent the single disputed question to a FRESH
adjudicator (`a2413344a28147573`) which was asked to describe the plate independently BEFORE
comparing; it returned `pass` with a correct plate description. The fail was overturned on that
basis, and the overturn is written into L46's stamp `reviewer` string so it is not invisible later.
`place_continuity` is a reported field, not one of the two store axes, so no stamped axis changed.

**The general lesson: a single sonnet verifier can hallucinate a reference image it claims to have
read.** The disjoint-pair design caught this only because the two halves disagreed with each other's
implied world. A verifier that mis-reads the REFERENCE fails silently in the pass direction just as
easily as in the fail direction, and nothing in this loop would have caught that.

## Round 3 — L34, the P9 test, MEASURED

`_scene_provenance` reported `parent_depth 2, lineage 1` — the C-11 reset under a verified parent,
confirming the chain law worked: L33 was verified and promoted to `assets/scenes/L33.png` before L34
was built, and L34's `parent` role resolved to that file.

Region diff of L34 against its parent L33 (threshold: per-pixel RGB sum-delta > 30):

| region | changed | 6c2 baseline | reading |
| --- | --- | --- | --- |
| `miniscribe-rep` **face interior** | **43.70%** | 29.79% | **expression leak PERSISTS** |
| `miniscribe-rep` hair core | **6.51%** | 37.58% | **P9 FIXED the hair/identity half** |
| `ibm-suit` head | 10.21% | ~0.00% | held (edge/AA noise) |
| left shelving / place | 3.28% | 0.00-0.11% | held |
| right benches / place | 3.82% | 0.00-0.11% | held |
| roller door (the AUTHORED delta) | 50.67% | (landed clean) | the authored change landed |
| whole frame | 5.40% | — | |

**Verdict: P9 is HALF a fix.** The 6c2 park was diagnosed as "`seed_roles` never states which seed
owns expression". P9 added that statement, and the hair/identity half of the leak closed almost
completely (37.58% -> 6.51%). The EXPRESSION half did not close (29.79% -> 43.70%). On a beat whose
prose says "everything else exactly as established", `miniscribe-rep`'s eyes went from a closed happy
squint to wide open with pupils and his mouth from an open grin to a small closed smile, while
`ibm-suit` resolved the identical spec correctly — **the same character-asymmetry 6c2 recorded.**

**Not re-rolled, deliberately.** The 6c2 record's standing instruction is "fix preamble in a doctrine
window, do NOT re-roll — place, ibm-suit and the authored delta are all correct and a fresh roll
risks all three." All three are again correct here (place 3.3-3.8%, ibm-suit held, delta landed), and
P9's expression-authority prose is already IN the assembled prompt, so a re-roll could only re-roll
dice against a spec gap. Parked with the candidate left at `_staging/L34.png`, not promoted.

## FINAL STATE

**Spend $0.780 of the $5.00 cap** (20 gens x $0.039). 0 transport failures, 0 provider 503s, 0 stall
re-issues. The 9a estimate was $0.819-$1.053; the run came in under it because the crowd exemplar was
grandfathered rather than minted and only 2 retries were needed.

| | count | frames |
| --- | --- | --- |
| scenes VERIFIED | 7 | L28, L29, L33, L38, L44, L46, L169 |
| scenes PARKED | 1 | L34 (delta-discipline / expression leak) |
| scenes NEVER GENERATED | 2 | L39, L48 — gate held them on their parked cards |
| cards VERIFIED | 7 | 6 from round 1 + L46's `line-worker` card |
| cards PARKED | 2 | L39's and L48's, both on pose |
| canonical minted | 1 | `line-worker` (P3 cast exemption — no ruling required) |

**14 frames carry verified stamps** (7 scenes + 7 cards), plus the gate-exempt canonical.
Against the original 18-item spec: **13 of 18 verified**, 3 parked, 2 never generated; L46's card is
a 19th frame that only existed once `line-worker` was minted.

Nothing was committed or pushed. No credential was read, printed, copied or persisted. No
shots.json, governing-file or test edits. Store ends at 35 rows.

## Close-out sweep (post-run, $0)

The final sanity check caught a stale row that mattered: **L48 was sitting at `review_status:
verified`** in `assets/scenes/manifest.json`, pointing at a 6c2-era `assets/scenes/L48.png` that does
not exist in this checkout — even though this run never generated L48 (its card is parked). L39 held
a stale 6c2 `parked` reason for a different defect.

Both were re-stamped through `stamp_review.py` (the only sanctioned writer) with the true G4 reason.
All ten slice beats now read honestly: **7 verified, 3 parked** (L34, L39, L48).

Residues left deliberately, because `cmd_manifest` is the sanctioned emitter and a full re-emit would
destroy 18 unrelated rows — all recorded in the report:
- **L169's manifest entry carries `file: null`** (created fresh by `stamp_review`, which has no path
  to write), so a verified frame on disk is unreachable by render-builder.
- Slice rows' `seeds`/`notes` still describe 6c2-era frames.
- ~17 rows OUTSIDE the slice still read `verified` against PNGs absent from this checkout — the same
  hazard L48 had. Out of scope here; needs a sweep before any render.

Final store: **35 rows**, both P12 FAILs intact (`expr-shock`, `expr-pleading` = `human-veto: fail`),
plus the 2 pose-parked cards recorded as fails. Temp crop PNGs that two verifier subagents left in
`_staging` were removed so they cannot be boarded or gated as assets.

HEAD still `0471fc7`. Nothing committed, nothing pushed.
