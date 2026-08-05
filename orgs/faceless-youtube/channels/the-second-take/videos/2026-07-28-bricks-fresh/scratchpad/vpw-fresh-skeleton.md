# VPW fresh-authoring skeleton — 2026-07-28-bricks-fresh (doctrine reset)

Authored 2026-08-04 from `script.md` alone (no archived shots.json read; fresh-authoring law).
This file is the GLOBAL plan. Fifth 1 (act 1) is authored in `shots.json`; later fifths continue from here.

## 1. Acts (the story's own turns)

| Act | Script paragraphs | Words | Seconds @175wpm | Beat |
| --- | --- | --- | --- | --- |
| **1 — Setup** | P01–P06 | 293 | 100.5 | the 80s, the PC craze, what a drive is, the brick tease, MiniScribe's rise under Terry Johnson, the 1984 IBM cut and the fall |
| 2 — The doctor + the fear machine | P07–P09 | 264 | 90.5 | H&Q money, Wiles arrives ("Doctor Fix It"), quota terror, the fired-on-the-spot meeting, Jan 1987 audit, the $4M hole |
| 3 — The scheme | P10–P15 | 502 | 172.1 | lock-box swap, the rented warehouse, 26,000 bricks, the ship-and-return loop, the test count, escalation, "best managed company" |
| 4 — Collapse + reckoning | P16–P23 | 573 | 196.4 | the Christmas layoff, the Denver papers, Rifenburgh's restatement, bankruptcy, $550M, the reversal, the settlement, Wiles convicted, the HR close |

Script header: **1,632 words ÷ 175 wpm → 9:20 (559.5 s)**. Lint floor = 559.5 / 4 = **140 shots minimum**.

## 2. Density budget (whole file)

Band 1.5–3 s, up to 4 s earned; heaviest in the first 60 s.

| Act | Seconds | Planned shots | Avg hold |
| --- | --- | --- | --- |
| 1 | 100.5 | **41 (AUTHORED)** | 2.45 s |
| 2 | 90.5 | ~35 | 2.6 s |
| 3 | 172.1 | ~62 | 2.8 s |
| 4 | 196.4 | ~70 | 2.8 s |
| **Total** | **559.5** | **~208** | — |

## 3. Cast map (planned before authoring, derived from the script)

Registry-resolvable today (channel `registry.json` + this video's `assets/library/manifest.json`):

| Slug | Who | Enters on (naming line) | Acts |
| --- | --- | --- | --- |
| `pc-boxy` | personified 1980s home computer | P03 "computers run on these things" | 1 |
| `terry-johnson` | MiniScribe's founder | P05 "founded in 1980 by a guy named Terry Johnson" | 1 (exit P06) |
| `miniscribe-rep` | MiniScribe personified | P05 "And they were HOT." (see friction #1) | 1, 3, 4 |
| `ibm-suit` | IBM personified | P05 "IBM picked MiniScribe" | 1 |
| `hq-banker` | Hambrecht & Quist personified | P07 "their bankers at Hambrecht & Quist" | 2, 4 |
| `qt-wiles` | Q.T. Wiles | P07 "They brought in the man, the myth, the legend: Q.T. Wiles." | 2, 3, 4 |
| `brick-foreman` | the middle-manager lead who packs the bricks | P09 "a room full of middle managers" / P12 | 3, 4 (returns holding a pink slip in P16 — identity continuity is the point) |
| `auditor-rep` | Coopers & Lybrand / the outside accountants | P09 "MiniScribe's outside accountants came in" | 2, 3 |

To mint at the Pass-1 gate later: `rifenburgh-ceo` (P17, "under a guy named Richard Rifenburgh"). No other new cast is planned —
Compaq, Maxtor, the Colorado Brick Company and the Denver papers are staged as **objects/places**, not personified cast
(illustrate the VO, never extend it).

Cast cap: ≤2 named per shot; a fresh two-cast shot is a stage BASE.

## 4. Place inventory (whole file) — owner forced choice recorded once, on the plate

| `place` | Set | Plate (first-in-file generated shot) | Owner decision | Used in |
| --- | --- | --- | --- | --- |
| `brick-warehouse` | the rented off-site warehouse of shrink-wrapped pallets | **L03** (act 1, cast-free wide) | `owner_ambiguity: true` — a rented shell nobody's name is on; the unmarked-ness IS the read | act 1 (tease), act 3 (P12–P13) |
| `miniscribe-plant` | the Longmont assembly floor + its shipping door | **L26** (act 1, cast-free wide) | `place_owner: "MINISCRIBE"` — board over the floor entrance | acts 1, 3, 4 |
| `wiles-office` (act 2) | Wiles' remote Los Angeles office | first act-2 shot in it, cast-free | `place_owner: "Q.T. WILES"` or ambiguity — decide at authoring; the script gives no door literal, so ambiguity is legitimate | act 2 |
| `miniscribe-boardroom` (act 2/3) | the quarterly target meeting room | first cast-free wide | `place_owner: "MINISCRIBE"` (same L-1 carry hazard as the plant) | acts 2, 3 |
| `brick-company-yard` (act 3) | the Colorado Brick Company yard | cast-free wide of the brick stacks | `place_owner: "COLORADO BRICK"` (script vocab: "the Colorado Brick Company") | act 3 |
| `denver-newsroom` (act 4) | the Denver newspaper desk | cast-free wide | decide at authoring | act 4 |

Rules that bind every later fifth:
- A place is declared only for a set the file **revisits**. A one-visit set runs as a `stage` chain (base + ≤3 deltas) with no
  `place` — the chain parent already seeds it, and a dedicated plate for a single visit is pure waste (conditional plate law).
- Place-exempt classes never declare `place`: `symbolic-stand-in-object`, `number-glued-to-object`, `map-plan-view`,
  `physicalized-imbalance`, `register-shift-infographic`.
- **`miniscribe-plant` carry hazard (friction #2):** the owner literal `MINISCRIBE` is a substring of the cast slug
  `miniscribe-rep`, and L-1's carry check is case-sensitive-by-discriminator and word-boundary-based. Any in-place shot naming
  `miniscribe-rep` must re-quote `'MINISCRIBE'` **within ~60 characters after the slug, with no coordinator between**
  (`` `miniscribe-rep` under the board carrying 'MINISCRIBE' ``), or must not name that cast in that place.

## 5. Stage plan (act 1 authored; later acts sketched)

Act 1 chains: `den-1983` (L01+1δ) · `store-1983` (L04+3δ) · `drive-vault` (L11+3δ) · `shopfront-brawl` (L16+1δ) ·
`backroom-take` (L18+1δ) · `brick-tease` (L21+2δ) · `ibm-deal` (L29, two-cast base) · `plant-thinning` (L40+1δ).

Later acts, planned chains: `wiles-meeting` (the stand-up firing, act 2) · `lockbox-swap` (act 3, three-beat action chain —
**must be one declared chain or carry `hard_cut`**, this is the L88–L91 drift the action-chain law exists for) ·
`pallet-build` (act 3) · `test-count` (act 3) · `restatement-desk` (act 4) · `verdict-bench` (act 4).

## 6. Three peaks

- **Opening peak:** L03 — the plate of `brick-warehouse` carries the hook: a dark rented warehouse, one work lamp, three
  shrink-wrapped pallets, every surface blank. The doctrine's plate mechanism does the hook's work instead of a spare frame.
- **Mid-video re-arm (55–65%, P13–P14):** the ship-and-return loop and the test count ("It's the TSA") — reserve the video's
  strongest staging here; plan a circular shipping-loop plan view plus a sampling tableau.
- **Withheld peak (final 20%, P21–P23):** Wiles' conviction and the HR punchline. Do not spend its staging earlier.

## 7. Cadence plan / disclosure

- Nothing appears on screen before the VO says it. The bricks are withheld until P04 ("well, the title gives it away"),
  where they arrive as a delta on an already-established pallet stack — the reveal lands ON the line.
- The 1988 peak numbers ('125 MILLION', '600 MILLION') are number-glued-to-object frames, never floating text.
- Red is semantic only (alarm / ownership / the punch element): act 1 spends it on the vault wheel, the clay brick itself,
  the shipping arrows, the cut banding, the cliff-scree strap. Keep the whole-file count low; never decoration.
