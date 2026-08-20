# L01-L25 generation genlog — VPW3 (poyais-revert doctrine, shots.json @ bf7447cf)

Video: `channels/the-second-take/videos/2026-07-28-bricks-fresh`. Scope: act-1 opening slice, L01-L25 of the
freshly re-authored 204-shot `shots.json`. Kit: `channels/the-second-take/visual-kit`.

## PREP

- `assets/scenes/L01-L25.png` (SUPERSEDED prior shots.json content) + their stale manifest rows moved to
  `assets/_archive-vpw2-fresh/` (25 pngs + `archived-manifest-rows.json`); live `assets/scenes/manifest.json`
  cut from 57→32 rows, scoped to only the live shots.json.
- `assets/_review/merged.json` was entirely stale L01-L25 content (25 rows, no other shot ids) — archived to
  `assets/_archive-vpw2-fresh/archived-merged-review.json`, live file reset to `[]`.
- **Found + fixed a second stale-collision layer not covered by the brief's PREP note**: the CHANNEL-WIDE
  `visual-kit/_staging/L01.png`...`L25.png` (bare shot-id names) held leftover frames from an EVEN EARLIER
  pre-doctrine run (mall-interior/Radio-Shack imagery, nothing like the current prompts). Forge's `gen`
  reuses-by-filename with no content check, so the first live batch silently "skip (exists in staging)"'d
  21/23 scenes against garbage. Archived all 25 bare-named staging pngs to
  `visual-kit/_staging/_archive-vpw2-fresh-L01-L25/`, re-ran clean. Lesson banked for future waves: a fresh
  shots.json re-author needs its OWN staging-name clear, not just the video's own `assets/scenes/`.
- Pass 1: all named cast/primitives needed by L01-L25 (`pc-boxy`, `rival-pc`, `drive-maker`,
  `expr-confused/-smug/-surprised`, `action-powerstance/-offering`) already existed with passing review
  records (`pc-boxy` and `action-offering` verified via the store's digest-fallback match; `rival-pc`
  exempt under the G2 cast-canonical ruling). No new Pass-1 asset gate needed. Wrote the resolved `assets`
  tags into `shots.json` for L04/L16/L18/L20/L23 (Pass-1 step 7).

## Generation waves

| Wave | Shots | Calls | Notes |
| --- | --- | --- | --- |
| STEP-1 cards | fig-drive-maker--action-powerstance--expr-smug, fig-drive-maker--action-offering--expr-smug | 2 | minted for L18/L20 |
| Wave 1 (scenes) | L01-L07, L09-L17, L19, L21-L24 (23 scoped; L18/L20 held on unreviewed cards) | 21 | all fresh, 0 fail |
| Retry wave (1 sanctioned retry each) | L02, L04, L06, L16, L19, L23 | 6 | surgical `{from,to}` replace via `forge-retry-overlay@2`; all 6 came back clean |
| L09 reroll (1 sanctioned retry, no editable clause — crowd-rig is forge-injected) | L09 | 1 | fixed the rig fail, revealed a new text fail — PARKED |
| L18 / L20 (unlocked after STEP-1 cards stamped) | L18, L20 | 2 | clean |
| Wave 2 (delta) | L08, L25 (after L07/L24 place-plates stamped in the channel store) | 2 | clean |
| **Total** | | **34** | ceiling 45, expected 30-35 — on budget |

Cost estimate: 34 × $0.134 = **$4.56**.

## Per-shot outcome (L01-L25)

| Shot | Technique | Result | Notes |
| --- | --- | --- | --- |
| L01 | (c) cast-free | verified | clean first pass |
| L02 | (c) cast-free | verified | 1 retry — fine wood-grain on arcade cabinet (line-register hazard) → flat-panel replace fixed it |
| L03 | (c) cast-free | verified | clean first pass |
| L04 | (b) pc-boxy | verified | 1 retry — unauthored "DO NOT TOUCH" sign baked in → bare-plinth replace fixed it |
| L05 | (c) cast-free, lettering | verified | clean; DSG '1983' passes letter-by-letter |
| L06 | (c) cast-free | verified | 1 retry — unauthored "SALES" text on receipt → blank-receipt replace fixed it |
| L07 | (c) cast-free, delta BASE | verified | clean; place-plate stamped for L08 |
| L08 | (e) delta | verified | held-set holds off L07; single depletion change lands correctly |
| L09 | (c) cast-free, crowd | **PARKED** | 1 retry (plain reroll, no editable clause). Fixed a hard rig fail (individuated crowd faces w/ noses+teeth) but the reroll baked unauthored "PC" text ~8x onto background boxes; residual LOW note on head-tone count (~4, over the 2-3 bound). Retry budget exhausted — parked, not re-rolled a third time. |
| L10 | (c) cast-free | verified | clean; "run on" correctly stayed a visual pun, no baked text |
| L11 | (c) cast-free | verified | clean first pass |
| L12 | (c) cast-free | verified | clean first pass |
| L13 | (c) cast-free | verified | clean first pass |
| L14 | (c) cast-free | verified | clean; drawers correctly unlettered |
| L15 | (c) cast-free | verified | clean first pass |
| L16 | (b) pc-boxy + rival-pc | verified | 1 retry — both figures rendered head/screen-only, missing canonical stubby arms/legs → full-body replace fixed it |
| L17 | (c) cast-free | verified | clean first pass |
| L18 | (b) drive-maker via STEP-1 card | verified | clean; card passed rig/expression-register/flat-cel-hazard first |
| L19 | (c) cast-free | verified | 1 retry — unauthored "INVOICE" text on paper prop → blank-invoice replace fixed it |
| L20 | (b) drive-maker via STEP-1 card | verified | clean first pass |
| L21 | (c) cast-free | verified | clean; minor note — gold glint sits in the pebble pile rather than literally beside the door, not blocking |
| L22 | (c) cast-free | verified | clean first pass |
| L23 | (b) pc-boxy | verified | 1 retry — pc-boxy rendered WITH hands gripping the carton (violates registry `no_hands: true`) → armless-edge replace fixed it |
| L24 | (c) cast-free, delta BASE | verified | clean; place-plate stamped for L25 |
| L25 | (e) delta — the video's central reveal | verified | held-set holds off L24; the brick reveal lands clean |

**24/25 verified, 1/25 parked.**

## Systematic finding — surfaced, not self-applied

Four separate shots (L04, L06, L19, and L09 post-retry) independently baked **unrequested printed text**
onto a prop the `still_prompt` named only by its OBJECT TYPE ("sales receipt", "invoice", "PC boxes",
an implied warning sign) — never a quoted literal. The head clause ("No text, no words, no labels") and
tail clause ("no unrequested text") did not reliably suppress this. Three fixes held on a targeted single
retry (explicit "BLANK/unlettered" qualifier inserted next to the prop); L09's crowd-injected clause could
not be surgically patched the same way and the defect recurred after its one retry.

Recommended next-wave fix (surfaced for a human/VPW ruling, not self-applied): a standing negative clause
for paper/box/sign props specifically, or a bible-level amendment to the "no unrequested text" wording —
this reads as a real recurring mechanism gap, not shot-specific bad luck.

## Files touched

- `shots.json` — Pass-1 `assets` tags added for L04/L16/L18/L20/L23 only.
- `assets/scenes/L01.png`...`L25.png` — final verified/parked frames.
- `assets/scenes/manifest.json` — merged, single-writer via `forge.py manifest` + `stamp_review.py`.
- `assets/_review/merged.json` — this wave's 25 rulings (fresh eyes, all three axes).
- `assets/_archive-vpw2-fresh/` — superseded pre-wave scene pngs + manifest rows + merged.json.
- `visual-kit/_staging/_archive-vpw2-fresh-L01-L25/` — superseded channel-staging pngs under colliding names.
- `visual-kit/_staging/review.json` — 2 STEP-1 cards + 2 place-plates (L07, L24) stamped passing.
