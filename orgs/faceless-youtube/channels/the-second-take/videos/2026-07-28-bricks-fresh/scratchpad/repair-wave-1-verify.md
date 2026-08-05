# Repair-wave-1 adversarial verification

**Target:** `videos/2026-07-28-bricks-fresh/shots.json` after `scratchpad/repair-wave-1.md`'s 43 shots +
2 thumbnail entries.
**Authority:** `scratchpad/adversarial-full-file.md` (findings + repair routes + REFUTED list).
**Method:** re-read every touched shot in the current `shots.json`; for the 8 touched shots inside
`L01`-`L47` (still tracked at `HEAD` — the rest of the file is wholly uncommitted, so no pre-repair
baseline exists past `L47`), exact-diffed `still_prompt`/`notes`/`shot_class`/`duration_s` field-by-field
against the committed fifth-1 baseline to catch undisclosed collateral edits. Doctrine cross-checked
against `visual-grammar.md`, `shots-schema.md`, `style-bible.md §2b`, and `registry/registry.json`
(confirms `miniscribe-rep` de-badged: "chest and lapels plain — no badge, pin, or logo", line 49).
Editing nothing, committing nothing.

---

## Baseline-diffable batch (L01-L47 range, exact field diff against committed HEAD)

| shot | fields changed | verdict | evidence |
| --- | --- | --- | --- |
| `L06` | `shot_class`, `notes` (prompt byte-identical) | **CLOSED** | class `literal`→`diegetic-device`, label only, confirmed zero prompt bytes changed |
| `L26` | `still_prompt`, `notes` | **CLOSED** | "in plain block colours" → "with its land masses flat olive and its oceans flat pale blue"; "flat" is ordinary file vocabulary (80 other hits across the file, e.g. `L11` "flat top face", `L33` "flat cartons") not a style-recipe re-leak; REFUTED-8's "three red arrows...different coast" clause left untouched — verified byte-identical |
| `L29` | `still_prompt`, `notes` | **CLOSED** | badge clause → "his chest and lapels plain,"; `'MINISCRIBE'` L-1 carry untouched (diff shows only the badge clause replaced) |
| `L32` | `still_prompt`, `notes` | **CLOSED** | badge clause removed, replaced by plain chest/lapels; boom now carried by crowd+`expr-greedy`, payload (Palette) moved to final clause — no badge/drive-shaped text remains |
| `L33` | `still_prompt`, `notes` | **CLOSED, minimal** | diff is a single deletion of `"etween and b"` from "Between and behind" → "behind" — the smallest possible edit, no collateral change anywhere else in the prompt |
| `L34` | `still_prompt`, `notes` | **CLOSED** | "medium at bench height" → "high, looking down into the open case..."; `L11` independently confirmed unchanged/still bench-height (see spot check below) |
| `L44` | `still_prompt`, `notes` | **CLOSED** | order book moved from "tucked under one arm" to "squared on the top carton of that pallet"; `duration_s` field confirmed UNCHANGED (2.8 both versions) — the note's "re-anchored... 2.78s" sentence is a **carried-over sentence from the pre-repair-wave note**, not a new undisclosed edit (verified: that exact sentence already existed in the `HEAD` baseline note) |
| `L46` | `still_prompt`, `notes` | **CLOSED** | palette line re-derived ("washed grey-beige..." + bench timber/shadow specifics) vs `L47`'s untouched "drained to grey-beige and cold steel" — no longer byte-identical |

All 8 shots in this range: **zero unexpected field changes** (only `still_prompt`/`shot_class`/`notes`,
plus lint-derived `vo_text` on all — expected, not authored). No bulk substitution pattern detected; each
edit is scoped to its own clause.

---

## Machine sweeps (whole file, all 248 shots + thumbnail)

| check | result |
| --- | --- |
| `lint_shots.py` (no `--write`, fresh run) | **HARD: none. 13 heads-up** (was 14 per the review — `L74`'s under-floor cadence flag independently confirmed gone; the remaining 13 are the same delta-length + seat/support forced-review rows the review already accepted) |
| `grep -i "badge\|drive-shaped"` over every `still_prompt` | **0 hits** anywhere in the file |
| `"badge"` in `notes` | **exactly 7** (`L29 L32 L65 L163 L168 L183 L244`), all compliance/de-badge language — matches the repair report's own count exactly |
| `"block colours"` / `"block colors"` anywhere in `still_prompt` | **0 hits** (both `L26` and `L130` clear) |
| `"Between and behind"` residual | **0 hits** |
| Banned render-technique terms (gradient/gloss/specular/bloom/DoF/blurred/soft focus/photoreal/subsurface/rim light) | **0 hits** across all 248 prompts |
| `terry-johnson` anywhere in the thumbnail block | **absent** — confirmed by direct JSON inspection, not just grep |
| Σ `duration_s` vs `long_form_est_runtime_s` | **541.28 s vs 540.08 s** — matches the report's claimed number exactly |
| Shot count | **248**, unchanged |
| Stage-chain integrity (own script: base-first, ≤3 deltas, contiguous, per stage) | **0 violations across 91 stages** |
| Entrance-law (own script: a named cast's first file-order appearance is never a `stage_role: delta`) | **0 violations** |
| Forge `batch --dry-run` seed-lineage over the whole file (`.claude/skills/image-generation/scripts/forge.py`) | **all 248 shots resolve; 0 lines contain `REFUSED`/`VIOLATION`/`error`/`fail`.** Spot-checked the report's own §7 table (`L87 L090 L153-156 L158-159 L33 L98 L185`) against a **fresh, independently-run** dry-run — every line matches verbatim. (The run does exit 1 on a final `seed frame not found: .../crowd-exemplar.png` lookup **after** printing all 248 lineages cleanly; the file demonstrably exists on disk at that exact path — a tool/path-resolution quirk in this worktree, not a `shots.json` content defect, and not something the repair wave could have caused since it never touches kit files) |

---

## Per-finding verdicts

### BLOCKING

| finding | verdict | evidence |
| --- | --- | --- |
| **B-1** badge prose on de-badged canonical (`L29`,`L32`,`L65`) | **CLOSED** | exact-diffed on `L29`/`L32` (fifth-1 baseline); `L65` read directly — all three now state "chest and lapels plain"; 0 badge/drive-shaped hits file-wide; registry confirms de-badge is current canon |
| **B-2** ratchet drawn going down (`L66`) | **CLOSED** | `L66` rule now struck low near the bottom with clear board above; `L69` (untouched) shows charcoal at mid + red a hand's-width above — now a legible upward step; `L102` (untouched, further downstream) raises it again off the same premise — **3-point ratchet checked end to end, direction consistent throughout** |
| **B-3** escalation chain reruns pallet-build (`L153`-`L156`) | **CLOSED** | `L153` re-worlded to a mezzanine-landing look-down over the rear stacking face — vocabulary (hopper, castings, landing, rear wall) shares nothing with `L117`'s trestle/barrow/shelving; chain feasibility verified by hand: `L153` reserves exactly what `L154`/`L155`/`L156` each consume, in order; forge confirms `L153→L154→L155→L156` lineage; `L152`/`L157` (untouched neighbors) checked, no ripple |

### HIGH

| finding | verdict | evidence |
| --- | --- | --- |
| **H-1** incompatible staging in `handshake` (`L33`) | **CLOSED** | diff is a single-clause deletion, "Between and" removed, nothing else touched; seed cap confirmed still 4 in forge dry-run |
| **H-2** prop fights the seeded pose (`L44`) | **CLOSED** | book now on the pallet, `action-armscrossed` untouched; `duration_s` field confirmed unchanged from baseline (2.8 both sides) — the note's "re-anchored…2.78s" sentence pre-dates this wave, not a new stealth edit |
| **H-3** place-exempt class breaks place seed (`L87`,`L090`) | **CLOSED** | both re-classed + `place` declared per the schema's own sanctioned swap; forge confirms both now seed plate `L28` (`L87: [L28, lettering-marker-italic]`, `L090: [L28, crowd-exemplar]`) instead of running `ROOT`; discovery sequence `L86→L87→L88→L089→L090→L091` re-read end to end, all six now consistent on the same bay |
| **H-4** named lead for a script-separated tier (`L158`,`L159`) | **CLOSED** | no backticked cast name anywhere in either prompt; `figures.crowd: true` on both; VO span "one of the executives" no longer maps to `brick-foreman`; forge confirms `L158`/`L159` seed the place plate, not a STEP-1 figure card |
| **T-1** real named person as fraud perpetrator (thumbnail challenger 1) | **CLOSED** | `terry-johnson` confirmed absent from the entire thumbnail block; hero is now `miniscribe-rep`, `expr-caught` register kept, composition re-worded |

### MEDIUM

| finding | verdict | evidence |
| --- | --- | --- |
| **M-1** vantage reflex (`L098`,`L120`,`L128`,`L168`) | **CLOSED** | all 4 re-derived off their own beats to distinct vantages; `L03`/`L248` (plate + bookend) and `L127`/`L133` (deliberate rhyme) confirmed untouched, exactly per the route |
| **M-2(a)** payload buried mid-prompt (`L108`,`L128`,`L166`,`L193`,`L243`,`L247`) | **CLOSED** | scripted check on all 6: none end on `Palette:` any more, all end on their named payload object |
| **M-2(b)** doctrine fix (`visual-grammar.md §2`) | **correctly NOT applied** — carried to caller in §6, per brief (doctrine files out of scope for this wave). Verified: `visual-grammar.md` on disk is unmodified |
| **M-3** scale-device saturation (`L232`,`L240`) | **CLOSED** | both re-derived off the device (door-held-open / envelope row); `L147`/`L148`/`L157`/`L186`/`L198` (left alone per route) confirmed unchanged — `L186` still `physicalized-imbalance`, still "two masses," correctly not touched for M-3 (only its M-4 self-sufficiency fix applied) |
| **M-4** "the same X" with no seed (`L126`,`L186`) | **CLOSED (mitigated)** | both frames now fully self-sufficient (no "the same" language); payload-last also applied to `L126`; doctrine half correctly deferred to caller (`shots-schema.md` unmodified) |
| **M-5** render-technique vocabulary (`L26`,`L130`) | **CLOSED** | "block colours" replaced by content description on both; confirmed "flat" itself is ordinary file vocabulary (80 other hits, e.g. `L11`, `L33`) and not a style-recipe re-leak; `L26`'s REFUTED-8 "three arrows / different coast" clause verified byte-identical, untouched |
| **M-6** empty boardroom against crowd-bearing plate (`L185`) | **CLOSED** | `place` key confirmed absent from `L185`'s JSON; re-staged in the corridor; `L71` (the plate, untouched) and `L177` (rifenburgh-ceo's actual entrance, untouched) checked — no entrance-law issue from reusing the un-minted cast slug on a later stage base |
| **M-7** five consecutive shortfall frames (`L090`) | **CLOSED** | re-worlded to the pay-hatch/corridor register; checked against `L67`/`L68` (the vocabulary it's supposed to echo, not duplicate) — confirmed genuinely distinct (office-side full grille vs. corridor-side shuttered/padlocked/empty) |
| **T-2** two red pointers on thumbnail primary | **CLOSED** | ring dropped, single arrow kept, "chest and lapels plain" added; only one drawn red pointer device remains |

### LOW

All applied LOW items verified CLOSED by direct read/diff: `L74`/`L75` real-hold rebalance (independently confirmed via `lint_shots.py`'s own real-cadence heads-up, which is now silent), `L06` class relabel (prompt byte-identical), `L34` framing, `L46` palette, `L164` single referent, and the 9 lettering/printing-technique-word shots (`L192 L193 L218 L219 L226 L228 L231 L232 L174`) — technique-word sweep confirms 0 residual hits (the one false-positive, `L209`'s "an imprint printed in the dust," is an untouched, unrelated, legitimate use of "printed" as a physical-mark verb, not a lettering-technique word).

Correctly **skipped**, verified as legitimate exclusions: shot-id zero-padding (Pass-1/mechanical, out of VPW scope), fifth-4's two-decimal `duration_s` (review's own verdict was "no repair needed").

---

## Untouched-neighbor ripple check (5, as briefed)

| neighbor | of | result |
| --- | --- | --- |
| `L69`, `L102` | `L66` ratchet | **clean** — ratchet direction now consistent low→mid→higher across all three checkpoints |
| `L86`, `L88`, `L89`, `L091` | `L87`/`L090` plant run | **clean** — bay description (pegboard bare upper half, cartons lower half) consistent across all six shots in the discovery sequence |
| `L152`, `L157` | `L153`-chain | **clean** — `L152` (different stage, `brick-foreman` legitimately WITH crowd per REFUTED-10) and `L157` (imbalance device, left alone per M-3 route) both unaffected |
| `L71`, `L177` | `L185` (M-6) | **clean** — plate (`L71`) still crowd-bearing/`owner_ambiguity`; `rifenburgh-ceo`'s real entrance (`L177`, a stage base) unaffected; `L185`'s later reuse as its own fresh stage base is legal (not an entrance) |
| `L160` | `L158`/`L159` (H-4) | **clean, no ripple caused by this wave** — unrelated "kid-corner" idiom-pun stage, unchanged, out of this repair's scope |

---

## NEW DEFECT FOUND

**`L226` — stale cross-reference in `notes` (LOW severity, documentation-only, no prompt/generation impact).**
`L226`'s `notes` field reads: *"Reuses the STEP-1 card fifth 4 mints at `L158`."* This was true before H-4: `L158`
used to cast `brick-foreman`. H-4 (correctly) removed `brick-foreman` from `L158` entirely, replacing him with
an anonymous crowd family — but nothing swept forward references to `L158` as a mint origin. Mechanically this
is harmless: `brick-foreman`'s actual canonical entrance is `L79` (long before `L158`), and `L226`, carrying no
`stage`/`stage_role`, is its own single-shot base and would mint its own STEP-1 `fig-brick-foreman--expr-deadpan`
card regardless of what its note claims (confirmed: forge's dry-run tags `L226` `GENERATE`, not `shared`) — so
image-generation is unaffected. The defect is confined to the audit trail: a now-false provenance claim, the
same class of drift the original review itself was hunting (stale prose surviving an upstream canonical change),
just relocated to a `notes` field instead of a `still_prompt`. **Not introduced by carelessness inside the touched
shot's own edit** (`L226`'s own change — "typed"→"plain buff sheet" — is correct and scoped) but a genuine,
uncaught ripple from H-4's edit at `L158` onto an unrelated, untouched shot. Cheap fix for whoever next opens the
file: delete or repoint that one sentence in `L226`'s `notes`.

No other new defects found across 43 shots + 2 thumbnail entries, the full-file machine sweeps, or the 5
untouched-neighbor spot checks.

---

## FINAL COUNTS

- **CLOSED:** 16 findings (B-1, B-2, B-3, H-1, H-2, H-3, H-4, T-1, M-1, M-2(a), M-3, M-4, M-5, M-6, M-7, T-2) +
  all applied LOW items (6 shot-level fixes covering 15 shots) — **every named finding in
  `adversarial-full-file.md`'s repair-required list closes via its named route.**
- **PARTIAL:** 0
- **REGRESSION:** 0
- **Correctly deferred/skipped (verified as legitimate, not silently dropped):** M-2(b) doctrine, M-4 doctrine
  half, shot-id zero-padding, fifth-4 cosmetic duration precision — 4 items, doctrine files confirmed unmodified
  on disk.
- **NEW DEFECTS FOUND:** 1 (LOW severity, notes-only stale cross-reference at `L226`, zero generation impact)

## FILE VERDICT: **DIRTY**

One real but trivial defect survives adversarial re-review — a stale provenance sentence in one shot's `notes`
field, a ripple from H-4 that never touches `still_prompt`, generation, or any lint/forge-checked law. Every
BLOCKING, HIGH, and MEDIUM finding from the source review is genuinely closed, with zero regressions and zero
collisions against the REFUTED list found across an exhaustive re-check (exact baseline diffs where a baseline
existed, full-file machine sweeps, an independent forge dry-run, and 5 untouched-neighbor ripple checks). Calling
it CLEAN would round off a confirmed, if cosmetic, defect; DIRTY reflects that one thing was found, not that the
wave's substance is in doubt.

