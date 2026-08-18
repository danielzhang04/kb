# Plate regen — warm-neutrals doctrine (2026-08-18)

Doctrine commit 33676421: §2b neutrals TINTED WARM, §5 fore/mid/background depth read
restored, tile grants line register + palette saturation AND temperature.

## Phase 0 — archive (DONE)
Old files copied to `scratchpad/plate-regen/old/` before any overwrite:
- scene-style-tile.png (5,017,074 bytes)
- L28.png, L65.png, L84.png, L86.png, L112.png, L114.png, L198.png

## Place plates found (enumerated before generating, per skill Pass-2 seed law —
"place plate" = the place's first approved frame, one per `place` in shots.json,
technique `(c) Character-free scene`, zero-seed root):

| place | first shot | file | review_status (pre) |
|---|---|---|---|
| miniscribe-floor | L28 | assets/scenes/L28.png | verified |
| wiles-office | L65 | assets/scenes/L65.png | verified |
| audit-room | L84 | assets/scenes/L84.png | verified |
| miniscribe-warehouse | L86 | assets/scenes/L86.png | verified |
| rented-warehouse | L112 | assets/scenes/L112.png | verified |
| colorado-brick-yard | L114 | assets/scenes/L114.png | verified |
| jury-courtroom | L198 | assets/scenes/L198.png | verified |

(L26, L40 are no-place roots — map/symbolic shots, not place plates — out of scope.)

## Phase 1 — scene-style-tile remint (DONE)
- 1 provider call, $0.039, landed first try, no retry needed.
- Content: 1980s home-electronics retail shop interior (fore/mid/background depth read per new §5).
- Warm verified by eye (golden oak / cream / warm amber, zero grey-teal) AND by measurement:
  mean R-B = 88.15 (new) vs 65.19 (old archived tile) — stronger warm bias, no drift.
- Registered via `forge.py register` (overwrote refs/env/scene-style-tile.png); registry note updated
  documenting the doctrine remint + archive path of the old tile.
- Old tile preserved at `scratchpad/plate-regen/old/scene-style-tile.png` (5,017,074 bytes).

Spend so far: $0.039 / $6.00 cap.

## Phase 2 — 7 place plates remint (DONE, 6/7 verified + promoted, 1/7 parked)

Generated all 7 via `forge.py batch --shots <ids>` (unmodified shots.json, current bible) + `forge.py
gen`. 4/7 (L65, L112, L114, L198) passed clean on the FIRST generation. 3/7 (L28, L84, L86) still read
grey-teal despite the bible's warm-neutrals clause -- the authored payload's literal "Cool grey-X
palette" wording won over the system instruction. Systematic (3/7, same defect class) -> ONE sanctioned
retry per shot via a `forge-retry-overlay@2` (`defect: content`, exact `{from,to}` replace of the
palette/light span only, `changed_spans: 1` confirmed by dry-run) -- kept the authored cold-LIGHT mood,
fixed the neutral-warmth mechanism per S2b ("a genuinely cold scene cools its LIGHT, never its
neutrals"). shots.json was never touched.

Retry outcome (measured, Pillow mean R-B, not judged by eye):
| shot | pre-retry R-B | post-retry R-B | verdict |
|---|---|---|---|
| L28 | -12.4 (old, cool) | +42.2 | PASS |
| L84 | -25.2 (old) | -14.3 | STILL net cool -- PARKED |
| L86 | -1.4 (old) | +40.2 | PASS |

L86's retry frame was initially misread by eye as having red-ink lettering; Pillow colour-distance
sampling against the locked `#241a12` ink refuted this (302px match to the locked ink, 0px anywhere
near the `#d7402b` accent in the whole frame) -- retracted, not a real defect.

Final: 6/7 verified + promoted into `assets/scenes/` (L28, L65, L86, L112, L114, L198); 1/7 (L84) stays
on the OLD pre-doctrine pixels -- retry budget exhausted, still net cool-biased, flagged for Daniel's
ruling. Old pixels for every shot preserved at `scratchpad/plate-regen/old/`.

Review-store integrity (never downgrade a pre-existing verified entry):
- `assets/scenes/manifest.json`: 30 verified / 9 parked / 16 unreviewed, IDENTICAL pre- and
  post-stamp counts across the whole video (only the 6 promoted shots' PIXELS changed; no status flip
  anywhere, L84/L86-untouched-pre stayed verified throughout).
- `visual-kit/_staging/review.json` (channel-wide seed-review store): +1 record (the tile).

Spend: 1 (tile) + 7 (plates) + 3 (retries) = 11 calls x $0.039/1K call = **$0.429** vs $6.00 cap.

## Phase 3 — review board (DONE)
`scratchpad/plate-regen/board.html`, 1,069,465 bytes. Tile OLD/NEW at top, all 7 place plates OLD/NEW
below (L84 NEW = the parked `_staging/L84-warmretry.png` candidate, not the live file), lightbox-wired
(copied from `scratchpad/overnight-board/build_board.py`), honest verified/parked badge per card.
Approval gate for Daniel: rule on L84 (accept the residual cool bias, try a different fix, or hold the
shot) before any further Pass-2 remint proceeds.
