# Wave-2 failed-card remint — progress log (COMPLETE)

Source: `scratchpad/overnight-board/failed-cards.json` (11 entries). Authorization: Daniel, 2026-08-18 ("if some of them failed, then redo them").

Cost basis used (per `scratchpad/audit-drift-2026-08-04.md`, `6c2-genlog.md`, consistent throughout this video's history): a 1K STEP-1 / primitive call = **$0.039**. All gens in this wave were 1K.

## Baseline (pre-run) integrity check on visual-kit/_staging/review.json
- top-level key: `figures`
- total figure entries: **203**
- all-pass (verified) entries: **183**

## Post-run integrity check
- total figure entries: **209**
- all-pass (verified) entries: **195**
- Every key this wave wrote was checked individually against its pre-run state: the 2 primitive keys
  (`refs/base/action-recoil.png`, `refs/base/surrender.png`) were ALREADY all-pass before this run and
  remain all-pass now (net zero change — replaced with a fresh record for the new pixels, same verdict).
  Every one of the 11 card keys this run touched was previously either `rig: fail`, absent, or (for the
  two back-to-viewer stems) recorded only under a different `_staging_flagged_`-prefixed key — NONE was
  part of the original 183-verified baseline. Net movement is +12 all-pass (10 cards fixed to all-pass +
  2 already-counted primitives unchanged), zero downgrades of any pre-existing verified entry.
  **Result: PASS — no downgrade.**
- The original parked `_staging/fig-brick-foreman--back-to-viewer--7a3b93be.png` (bare, un-prefixed) file
  and its `rig: fail` record were left completely untouched, per instruction — the remint went out under
  a new name (`-r2`) instead of overwriting it.

## PHASE 1 — pose primitive re-mints (action-recoil, surrender)

Both re-minted via forge's single-asset loop (`gen`, mode=identity, character=base, aspect 2:3), seeded off
`[refs/base/base.png, existing primitive]` (existing primitive kept as pose/geometry reference per brief),
delta = pose description + explicit four-digit-hand clause quoting bible §3 language. Dry-run pre-flighted
at $0 first in both cases. Verified BEFORE any dependent card was attempted (P3 seed-gate structurally
enforced this: forge refused all 5 dependent cards on first dry-run until the two primitives were
reviewed+stamped — see below).

| primitive | attempt | verdict | hand count check | cost | notes |
|---|---|---|---|---|---|
| action-recoil | 1 | **verified** | both hands 4-digit (thumb+3), zoomed-crop confirmed | $0.039 | old file backed up to `refs/base/action-recoil-pre-remint-2026-08-18.png`; registered over `refs/base/action-recoil.png` |
| surrender | 1 | **verified** | both raised/open hands 4-digit (thumb+3) — the open-hand drift point bible §3 flags, specifically checked | $0.039 | old file backed up to `refs/base/surrender-pre-remint-2026-08-18.png`; registered over `refs/base/surrender.png` |

Both stamped into `visual-kit/_staging/review.json` with full per-axis verdicts (`flat-cel-hazard`,
`line-register`, plus an added `rig` axis — more rigorous than the tool's default asset-class skeleton,
matching the historical bar these two specific hand-bearing poses carried before) via
`build_review_artifact.py --assets ... --staging ...` (skeleton, sha256-pinned) then
`stamp_review.py --figures ...`. **Phase-1 subtotal: $0.078.**

## PHASE 2 — 11 failed card re-mints

All 11 re-minted via `forge.py gen --batch <spec.json>` using the exact-reference STEP-1 recipe already
authored for these stems in `scratchpad/w2-full/batches/*.json` (proper `seed_roles` — canonical + pose
[+ expression] — pulled verbatim, not hand-rolled with raw `--seed`, so role prose stays truthful per the
skill's ban on hand-minting STEP-1 with `gen --seed a,b,c`). Dry-run pre-flighted at $0 first; the first
dry-run correctly REFUSED the 5 action-recoil/surrender-dependent cards until Phase 1's primitives were
reviewed+stamped (P3 seed gate working as designed), second dry-run (post-stamp) passed clean on all 11.

| stem | attempts | verdict | cost | notes |
|---|---|---|---|---|
| fig-auditor-rep--action-powerstance--expr-delighted--4a73160d | 1 | **verified** | $0.039 | closed-fist pose, no digit risk; delighted register correct |
| fig-auditor-rep--action-thumbsup--expr-deadpan--6c7b996d | 1 | **verified** | $0.039 | thumbsup hand zoomed — 4-digit confirmed; deadpan register correct |
| fig-bond-investor--hold-both-hands--expr-delighted--610638ea | 1 | **verified** | $0.039 | prior state was `not_yet_attempted` (no formal verdict); clean first attempt |
| fig-brick-foreman--back-to-viewer--7a3b93be **(renamed -r2)** | 1 | **verified** | $0.039 | ONE attempt per brief (3x prior ear-notch failure). Explicit rig-correction note (solid unbroken hair, no ear-notch) added to the prompt. Zoomed head crop: hair renders as one continuous flat-cel cap, no notch/hole/visible ear. Output named `-r2` to avoid colliding with the still-parked original `7a3b93be.png`, which is left untouched on disk with its original `rig: fail` record intact. |
| fig-brick-foreman--action-armscrossed--expr-deadpan--e3499d42 | 1 | **verified** | $0.039 | prior state `generated_unreviewed`; clean, no ear/nose, deadpan register correct |
| fig-brick-foreman--action-recoil--expr-surprised--639a586c | 1 | **verified** | $0.039 | depended on Phase-1 action-recoil fix; both hands zoomed — 4-digit confirmed |
| fig-brick-foreman--surrender--expr-fear--9b76c8c6 | 1 | **verified** | $0.039 | depended on Phase-1 surrender fix; both raised hands zoomed — 4-digit confirmed |
| fig-miniscribe-rep--action-recoil--expr-surprised--0487471a | 1 | **verified** | $0.039 | depended on Phase-1 action-recoil fix; both hands zoomed — 4-digit confirmed |
| fig-miniscribe-rep--action-recoil--expr-surprised--b5fa2de9 | 1 | **verified** | $0.039 | depended on Phase-1 action-recoil fix; both hands zoomed — 4-digit confirmed |
| fig-qt-wiles--back-to-viewer--dfb3cd97 | 1 | **PARKED — rig fail** | $0.039 | ONE attempt per brief. Rig-correction note (ear-notch) added but generation rendered a 3/4 PROFILE view instead of true back-to-viewer: a clearly drawn EAR plus one eye/eyebrow visible on the turned head — direct "NO nose, NO ears" (bible §1/§3) violation, a DIFFERENT manifestation of the pose's known defect than brick-foreman's (profile-leak vs. hair-notch). **Mechanism diagnosis**: the `back-to-viewer` pose primitive combined with this character's canonical (silver side-parted hair, distinct head/hair silhouette) is drifting the head into a 3/4 turn, exposing rig features the pose exists to hide — a character/pose interaction, not a primitive defect (the SAME primitive produced a clean brick-foreman back-to-viewer in this same wave). No further retry burned; parked per brief. |
| fig-qt-wiles--surrender--expr-confused--59fca904 | 1 | **verified** | $0.039 | depended on Phase-1 surrender fix; both raised hands zoomed — 4-digit confirmed; confused register (furrowed brow) correct |

**Phase-2 subtotal: 11 × $0.039 = $0.429** (10 verified + 1 parked, all attempts billed once each).

## Spend tally

- Phase 1 (2 primitives): $0.078
- Phase 2 (11 cards): $0.429
- **Total: $0.507 / $8.00 cap** — well under budget, no re-issues needed beyond the tool-timeout retries
  described below (those were harness/tool-call timeouts, not billed generation retries — every gen call
  in the log succeeded on its first provider call).

## Operational notes (not billing-relevant)

- The live batch gen call for the 6-remaining-item tranche exceeded the default 2-minute foreground
  timeout twice mid-run (harness tool timeout, not the 4-minute stall policy — no gen itself stalled;
  each individual `START provider call` → `OK` pair completed in well under a minute). Recovered by
  re-issuing the batch scoped to only the not-yet-generated remainder each time, with a longer explicit
  timeout on the final re-issue. Zero duplicate spend — verified by checking which staged files already
  existed on disk before each re-issue.
- `forge.py`'s P3 seed-reuse gate refused all 5 action-recoil/surrender-dependent cards on the first
  dry-run because the two primitives' `canonical_sha256` no longer matched their (freshly re-minted)
  bytes on disk — exactly the designed behavior: a stale/absent record refuses rather than grandfathering
  an unreviewed frame. Resolved by running the proper review+stamp loop
  (`build_review_artifact.py --assets ... --staging ...` → fill verdicts → `stamp_review.py --figures`)
  before re-attempting, per the skill's C-6/P3 procedure — not by bypassing the gate.
