# ab5 — real-pipeline char-seed engine test

Weaknesses first: Pro still parked four cards after their allowed reroll (two persistent studio-prop leaks and two persistent ear leaks); Flash parked every card, principally because STEP-1 cards retained scene props after the same-request reroll.

## Method and bounds

- Target selection was restricted to the ten `ab4-test-items.json` IDs as labels only. Both arms freshly used `g4_dry.py batch` over the ten matching `shots.json` IDs, then the Forge-emitted STEP-1 entries only; no frozen ab4 prompt text was used.
- Each selected request received a `g4_dry.py gen` zero-spend preflight, then live `forge.py gen --batch` at `2:3`, `1K`. Reviews used the skill's machine-owned scoped board/skeleton plus per-axis visual verdicts in `pro/verdicts.json` and `flash/verdicts.json`; no skeleton was stamped.
- A failed card was deleted only from this run's staging slot after its archived first PNG, then issued exactly once again through the same Forge-built request. No call stalled or was reissued for transport. Pro stopped at $2.144 (< $2.680); Flash reached its $0.780 ceiling exactly.
- Neither arm wrote `assets/`, a manifest, or a review store. PNGs, dry slates, boards, skeletons, verdicts, and the call log are all under this directory. Run staging PNGs were removed between arms and after Flash; pre-existing staging cards remain.

## Pro

| Card | Attempts | Verdict | Fail axes |
|---|---:|---|---|
| `fig-drive-maker--hold-both-hands--expr-greedy--12637e2e` | 1 | PASS | — |
| `fig-brick-foreman--action-shrug--expr-deadpan--1a78cea1` | 1 | PASS | — |
| `fig-miniscribe-rep--action-celebrate--expr-delighted--d0a1613b` | 2 | PASS | — |
| `fig-terry-johnson--carry-by-handle--expr-crestfallen--c5210e60` | 2 | PARK | clean_studio_backdrop |
| `fig-tv-chef--hold-both-hands--expr-worried--56a59b22` | 2 | PASS | — |
| `fig-qt-wiles--expr-smug--5d92f2c3` | 2 | PARK | no_nose_no_ears |
| `fig-auditor-rep--action-thumbsup--expr-deadpan--6c7b996d` | 1 | PASS | — |
| `fig-line-worker--hold-one-hand--expr-annoyed--39be0ae6` | 2 | PARK | clean_studio_backdrop |
| `fig-rifenburgh-ceo--hold-one-hand--expr-thinking--49deb800` | 1 | PASS | — |
| `fig-hq-banker--expr-deadpan--55bd2c0a` | 2 | PARK | no_nose_no_ears |

Verified pass rate: **6/10 (60%)**. Spent: **$2.144**. Cost-to-verified: **$0.357**.

## Flash

| Card | Attempts | Verdict | Fail axes |
|---|---:|---|---|
| `fig-drive-maker--hold-both-hands--expr-greedy--12637e2e` | 2 | PARK | clean_studio_backdrop |
| `fig-brick-foreman--action-shrug--expr-deadpan--1a78cea1` | 2 | PARK | clean_studio_backdrop |
| `fig-miniscribe-rep--action-celebrate--expr-delighted--d0a1613b` | 2 | PARK | clean_studio_backdrop |
| `fig-terry-johnson--carry-by-handle--expr-crestfallen--c5210e60` | 2 | PARK | no_nose_no_ears, clean_studio_backdrop |
| `fig-tv-chef--hold-both-hands--expr-worried--56a59b22` | 2 | PARK | four_digit_hands, clean_studio_backdrop |
| `fig-qt-wiles--expr-smug--5d92f2c3` | 2 | PARK | no_nose_no_ears |
| `fig-auditor-rep--action-thumbsup--expr-deadpan--6c7b996d` | 2 | PARK | clean_studio_backdrop |
| `fig-line-worker--hold-one-hand--expr-annoyed--39be0ae6` | 2 | PARK | clean_studio_backdrop |
| `fig-rifenburgh-ceo--hold-one-hand--expr-thinking--49deb800` | 2 | PARK | clean_studio_backdrop |
| `fig-hq-banker--expr-deadpan--55bd2c0a` | 2 | PARK | no_nose_no_ears |

Verified pass rate: **0/10 (0%)**. Spent: **$0.780**. Cost-to-verified: **N/A (no verified cards)**.

## Engine registry restore proof

Forge reads `visual-kit/registry/registry.json` via `reg.get("engine", "gemini-3-pro-image")`. The value was changed from `gemini-3-pro-image` to `gemini-2.5-flash-image` only for the Flash live arm and restored immediately afterward. `git diff -- orgs/faceless-youtube/channels/the-second-take/visual-kit/registry/registry.json` is clean after restoration.

## Deviations

- The scoped Forge batch also reported 17 seeding-law violations outside the ten requested shots; they were reported but untouched and did not enter either selected STEP-1 slate.
- Flash's nine non-drive calls were issued in Forge's sequential batch path after the first isolated call; every provider result landed normally and no call approached the 4-minute stall threshold.
- Same-request rerolls were used as the task specified, rather than a content-changing retry overlay. This intentionally tests the live engine/Forge path rather than a new prompt mechanism.
