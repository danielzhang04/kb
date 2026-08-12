# Track B measurement — separations (Task 4)

Source: `measure.py` -> `measurements.json`, run fresh, byte-identical on rerun. 50/50 boarded
beats (L01-L50) measured, 0 unmeasurable, 100 generation-records (gen-A pre-reset + gen-C
current, one each per beat). Liked/disliked membership = `beb.status_of()` against the
G0-locked `P6B_LIKED`/`C6C2_LIKED` ground truth in `_build_elicit_board.py` (Daniel-confirmed
at G0 with the two-sided-target amendment). All numbers below are from the **gen-C (current
doctrine) records only** — the generation the liked/disliked verdicts were actually cast
against — unless a gen-A comparison is explicitly called out.

## Methodology (so every number here is auditable)

- **Pixels**: resolved via `_build_elicit_board.frames_for()` (board-embed-anchored:
  `BoardIndex` + `pool_index`/`best_pool_match`), imported and reused verbatim from Task 1 —
  never re-derived — per the carried finding that beat-map render paths != judged pixels for
  92/228 board cards.
- **median_sat / ink_r_minus_b / ink_hue_deg**: mirrors `scratchpad/p6b_ink.py` `ink_stats()`
  exactly (darkest-3% circular-mean hue, mean R-B over that same darkest-3% mask, median HSV
  saturation over the whole frame), applied to the already-decoded frame instead of re-reading
  a path. **Spot-check**: 8 beats (L26, L28, L29, L30, L31, L35, L36, L37) have a pixel-identical
  sha256 match against `scratchpad/6c2-w2verify-a.json` frames and reproduce its `median_sat`
  exactly and `ink_r_minus_b` within the source's 1-decimal rounding (e.g. L26: ours
  sat=0.1843/rb=6.47 vs verify 0.1843/6.5; L28: 0.1216/3.05 vs 0.1216/3.0; L35: 0.1686/5.37 vs
  0.1686/5.4) — well beyond the 3-value acceptance bar. L27/L32/L33/L34 do NOT match the verify
  record because those frames were remediated (retried) afterward — confirmed by sha256
  mismatch against a live retry batch (`scratchpad/6c2-w2retry-pass1.json` etc.), not a
  measurement bug.
- **seed_topology**: `assets/scenes/manifest.json` (role-tagged seed schema) for gen-C c6c2
  frames (L26-L50); `assets/_archive-pre-regen-2026-08-06/manifest.json` (flat seed-path
  schema, no role tags) for gen-C p6b frames (L01-L25), best-effort — `chain_depth`/`seed_type`
  survive, `figure_count`/`tier_mix` do not (disclosed per-record via
  `figure_unavailable_reason`). gen-A (pre-reset) frames have no comparable seed manifest at
  all. `place_plate_id`/`plate_reuse_count` come from `shots.json`'s `place` field, counted over
  **all 246 current shots**, not just the 50 boarded ones (H1's test wants "every plate
  cameo").
- **prose**: `words` = whitespace-token count of the current `still_prompt`; `staging_clauses` =
  non-empty segments after splitting on `,`/`;`/sentence breaks with backtick rig-tokens
  stripped first; `distinct_props` = unique noun-phrases captured by
  `(article|number)\s+(noun phrase, <=3 words)`, deduped. **This is a coarse, deterministic
  proxy, not NLP-grade extraction** — spot-checking `prop_list` output shows real false
  positives (e.g. "point in the", "far end", "equal relative head" alongside genuine props like
  "long steel benches", "queue rope stage-left"). Treat the counts as directional, not exact.
- **h6_scope**: `environment-scene` for every `shot_class` except
  `{symbolic-stand-in-object, number-glued-to-object, diegetic-device}` -> `prop-focus-exempt`,
  operationalizing Daniel's verbatim scoping note (elicit-answers.md P08-L10) as one general
  rule over the schema enum, not a per-shot special case.

## Coverage

| | boarded | measured | liked (new-doctrine board) | disliked |
|---|---|---|---|---|
| p6b (L01-L25) | 25 | 25 | 21 | 4 |
| 6c2 (L26-L50) | 25 | 25 | 9 | 16 |
| **total** | **50** | **50 (100%)** | **30** | **20** |

Every boarded beat produced both a gen-A and a gen-C measurement (100 records, 0 gaps). No
frame was unmeasurable.

---

## H1 — the L28 place plate itself is the defect, not only its reuse

**Test run**: plate-linked dislike rate among the 8 boarded beats carrying
`place == "miniscribe-floor"` (L28 + its 7 named/derived children: L29, L33, L34, L44, L46,
L47, L48) vs the 6c2 baseline.

- Plate-linked dislike rate: **7/8 = 87.5%** (only L28 itself is liked).
- 6c2 baseline dislike rate (all 25 6c2 beats): 16/25 = 64.0%.
- Elevation: +23.5 points over baseline — real but modest, given the baseline itself is
  already majority-disliked.
- **Every plate cameo** (H1's test, whole-file scan): `place == "miniscribe-floor"` appears on
  **17 shots total** across the full 246-shot file, not just the 8 in the judged window: L28,
  L29, L33, L34, L44, L46, L47, L48, **L169, L170, L171, L172, L232, L233, L234, L244, L245**.
  **9 cameos were never boarded or judged by Daniel at all.** If H1 is confirmed and the plate
  is revised, those 9 need remediation too or they silently carry the defect forward — flagged
  for G4 scope, since G4's test only names "≥2 place-children."

**Refinement, not a contradiction (flagged so it isn't lost)**: L28 — the plate's own
establishing shot — is **liked**, despite carrying the same `plate_reuse_count = 17` as its
disliked children. Daniel never saw L28 in the P01 panel that produced his "I just don't like
the plate itself" verdict (P01's image set is L40-43 + L29/L33/L44/L46/L47/L48 — L28 is
absent); he was reacting to the plate **as reused background behind different figures**, which
happens to be the same pixels as L28. So H1's title claim ("the plate itself is the defect")
is not literally true by the boarded verdict — the plate reads fine once, standing alone, and
reads wrong specifically when repeated as anonymous backdrop. This sharpens H1 toward H2
(repetition) rather than refuting it: **a revised plate is still Daniel's stated fix, but the
boarded evidence says the failure mode is repetition-of-a-generic-backdrop, not the single
image in isolation** — worth Track A confirming from the archaeology side before G4 spends a
re-mint on a plate whose isolated-shot form Daniel already approved.

## H2 — same-plate repetition compounds the damage; chains and standalones survive

**Test run**: `plate_reuse_count` and `chain_depth` (manifest `parent_depth`), liked vs
disliked, 6c2 only (p6b's `place` field is null for all 25 beats — plate reuse categorically
doesn't apply there, so H2 is 6c2-scoped by the data itself).

| | n | plate_reuse_count mean | chain_depth mean |
|---|---|---|---|
| 6c2 liked | 9 | 1.89 | 0.33 |
| 6c2 disliked | 16 | 7.44 | 0.56 |

- **Plate-reuse half: confirmed, sharply.** Liked mean reuse 1.89 vs disliked 7.44 — but this
  is almost entirely the same signal as H1 (7 of 8 plate-carrying beats are disliked; every
  non-plate beat scores 0 either way), so H1 and H2 are not independent measurements here, they
  are two readings of one underlying fact. Not falsified: liked shots do NOT reuse plates at
  similar rates to disliked ones.
- **Chain-depth half: NOT clearly confirmed.** Liked mean 0.33 vs disliked 0.56 is a small gap
  in the *wrong* direction of clean separation, and it rests on only 2 of 9 liked beats
  actually being chained (L41 depth 1, L42 depth 2 — the money-chain evidence); the rest of the
  liked set (L26, L28, L35, L37, L40, L43, L49) sits at depth 0, same as most of the disliked
  set. **The "evolving delta chains... survive" half of H2 is evidence from a single 3-beat
  sequence, not a general pattern** — flagged so G4 doesn't over-generalize "chain it" as a fix
  independent of what's actually being chained.

## H3 — post-reset palette is too cool/monotone; target is a slight warm lean

**Amendment 1 applies**: two-sided moderate band, not a maximize-warmth direction.

| | n | ink_r_minus_b (median, IQR) | median_sat (median, IQR) | cool-inverted (rb<=0) |
|---|---|---|---|---|
| liked | 30 | 18.36  [5.04, 28.88] | 0.24  [0.16, 0.49] | 0/30 |
| disliked | 20 | 15.14  [1.92, 29.91] | 0.13  [0.11, 0.20] | 1/20 (L10) |

- **ink_r_minus_b (shadow-hue warmth) does NOT cleanly separate the sets** — the IQRs
  overlap almost entirely (liked [5.0, 28.9] vs disliked [1.9, 29.9]); medians differ by only
  ~3 points. By this specific measure, **H3's falsification condition is close to triggering**:
  warmth-in-the-shadows is not a strong discriminator.
- **median_sat (overall saturation) DOES separate cleanly** — liked median 0.24 vs disliked
  0.13, liked shots run ~1.8x more saturated at the median, and the IQRs barely overlap (liked
  Q1=0.16 sits above disliked median=0.13). This is the stronger, more actionable H3 signal:
  **the "too cool/monotone" complaint reads more as an under-saturation problem than a
  hue-in-the-shadows problem.**
- **Two-sided target (per Amendment 1), stated as bounds**: liked-band ink_r_minus_b
  **[5, 29]** (IQR), median_sat **[0.16, 0.49]** (IQR) — a moderate middle, not the liked set's
  outright max (rb up to 54, sat up to 0.72) and clearly warmer/more-saturated than the
  disliked floor (rb can go to -1, sat down to 0.04). Zero liked frames are cool-inverted; one
  disliked frame is.
- **Direct contradiction, flagged**: Daniel named L39 verbally as "too cool" (P05-L39: "shot is
  way too cool, colors are off"). Its measured ink is **rb=+16.8, hue=31.6°deg — warm, and
  inside the liked band**, not the cool-inverted example. The one frame that IS cool-inverted by
  this metric (L10: rb=-1.06, hue=223°) is disliked for staging/crowd-rig reasons in his
  verbatim answer, not named as a color complaint. **The darkest-3%-ink hue metric is not
  measuring what Daniel calls "too cool" for at least this one named case** — it likely reads
  midtone/background hue and overall vividness (where median_sat does separate), not shadow
  tone. Track A/C should not treat ink_r_minus_b as a proxy for Daniel's "too cool" complaints
  without this caveat.

## H6 — environment/scene shots want slightly more detail; prop-focus exempt

Scope: 26 liked / 17 disliked environment-scene beats (7 beats are prop-focus-exempt: L04,
L13, L36, L37, L39, L43, L50 — 4 liked, 3 disliked among the exempt group).

| environment-scene only | n | words mean | staging_clauses mean | distinct_props mean |
|---|---|---|---|---|
| liked | 26 | 77.77 | 8.54 | 10.58 |
| disliked | 17 | 75.82 | 8.47 | 9.76 |
| delta | | +1.95 | +0.07 | +0.81 |

**H6 is NOT confirmed by this prose-density proxy** — the falsification condition ("falsified
if detail does not separate within environment-class shots") is essentially met: a ~2.5% word
gap, a ~1% clause gap, and an 8% prop gap are inside the proxy's own noise floor (see
Methodology — `prop_list` spot-checks show real false-positive noise of that order). For
comparison, the **exempt (prop-focus) control group shows a larger gap** (words +4.25, clauses
+1.17, props +1.17) than the in-scope group — the opposite of what H6 predicts (exempt shots
were supposed to show LESS or no detail-preference effect, not more).

- **Per-range breakdown, flagged as a direct contradiction**: p6b liked words mean = 79.11 vs
  p6b **disliked words mean = 91.25 — disliked shots are authored with MORE prose, not less**,
  the reverse of H6's direction (n=4 disliked, small sample, but the sign is unambiguous and
  worth Track A checking against the rendered pixels rather than the prompt text).
- **Most likely explanation, not a refutation of Daniel's stated preference**: this proxy
  measures the AUTHORED PROMPT's word/clause/noun count, which the doctrine keeps fairly
  uniform by house style regardless of how much visual detail the render engine actually puts
  on screen. Daniel's "little more detail in the backgrounds" complaint is about what's
  **depicted**, not what's **written** — a rendered-pixel detail/clutter measurement (edge
  density, distinct-region count) would be a more direct test than prompt word-count, and sits
  outside this track's remit (Track A/C territory). **Recommendation: do not treat this
  prose-proxy result as evidence against Daniel's stated preference — treat it as evidence that
  prompt-length is the wrong instrument to test it with.**

---

## Summary table

| Hypothesis | Measure | Result |
|---|---|---|
| H1 | plate-linked dislike rate | Confirmed directionally (87.5% vs 64% baseline), refined: the plate reads fine standing alone (L28 liked), fails on reuse |
| H2 (reuse) | plate_reuse_count liked vs disliked | Confirmed sharply (1.89 vs 7.44) — same signal as H1 |
| H2 (chain) | chain_depth liked vs disliked | Not confirmed generally — rests on one 3-beat sequence |
| H3 | ink_r_minus_b | Weak/inconclusive — IQRs overlap |
| H3 | median_sat | Confirmed cleanly (0.24 vs 0.13 median) — the stronger warmth-adjacent signal |
| H6 | prose words/clauses/props, env-scope only | Not confirmed by this proxy; p6b subset runs the wrong direction |

## Frames that could not be measured

None. 50/50 boarded beats, 100/100 generation-records (gen-A + gen-C per beat) resolved and
measured.
