# W2-r2 ARM-PRO — Verifier B (fidelity/style) notes

Fresh-eyes, no generator context. Reviewed all 10 cards in `scratchpad/w2-r2/pro/` against style-bible.md
(§2/§2c "keep the same rig, flat cel"), the card-spec payloads in `fig-items.json` ("thin visible ground
line with one soft contact shadow", "flat solid pale-grey studio backdrop, no scenery, no props, no
furniture", "empty-handed and alone, the object ... left out"), and general clean-card doctrine.

**Score: 0/10 full pass.** Two independent, recurring defects:

## 1. Missing ground line (8/10 cards)
The payload requires "a thin visible ground line with one soft contact shadow directly beneath it." Only
2 of 10 cards (`drive-maker--carry-by-handle`, `drive-maker--hold-both-hands`) actually draw a horizontal
ground line across the backdrop. The other 8 draw only a soft grey drop-shadow ellipse under the feet —
no line. Confirmed by close crop on several cards (line absent on brick-foreman/miniscribe-rep/terry-johnson
cards; clearly present as a thin dark line on the two drive-maker cards). This alone fails every one of
those 8 cards on framing even though everything else about them is clean.

## 2. Leaked scene props on 4 cards
Every payload ends the beat clause with "...the object or person it acts on left out" and "Draw none of
its setting, props, lettering or other people." Four cards violate this directly by rendering the very
object the clause says to omit:
- `fig-brick-foreman--hold-one-hand--...16cc9e92` — holds a rendered red clay brick.
- `fig-brick-foreman--hold-one-hand--...ecc1ee75` — one hand fists a rendered grey dust sheet.
- `fig-drive-maker--carry-by-handle--...f1c1d333` — a full hand truck with two stacked cartons is drawn.
- `fig-drive-maker--hold-both-hands--...12637e2e` — a full garden rake plus a drift of rendered banknotes.

These four also fail payload_fidelity for the same reason (not empty-handed as the clause requires).

## What passed clean
Style/render register (flat cel, correct outline weight, correct warm palette, no lettering issues) is
solid across all 10 — no style-bible rig/palette defects found on this axis. `fig-terry-johnson--action-
armscrossed--...5ccd2153`, both `miniscribe-rep` cards, `fig-brick-foreman--action-shrug` and `--back-to-
viewer`, and `fig-drive-maker--action-present` are all otherwise clean single-defect cards (framing only) —
the closest to a full pass in this batch.

## Per-card (axes: clean_card / framing / payload_fidelity / style / lettering)

| Card | clean_card | framing | payload_fidelity | style | lettering | verdict |
|---|---|---|---|---|---|---|
| brick-foreman--action-shrug--1a78cea1 | pass | fail (no line) | pass | pass | pass | FAIL |
| brick-foreman--back-to-viewer--7a3b93be | pass | fail (no line) | pass | pass | pass | FAIL |
| brick-foreman--hold-one-hand--16cc9e92 | fail (brick) | fail (no line) | fail | pass | pass | FAIL |
| brick-foreman--hold-one-hand--ecc1ee75 | fail (dust sheet) | fail (no line) | fail | pass | pass | FAIL |
| drive-maker--action-present--5e51ec13 | pass | fail (no line) | pass | pass | pass | FAIL |
| drive-maker--carry-by-handle--f1c1d333 | fail (hand truck+cartons) | pass | fail | pass | pass | FAIL |
| drive-maker--hold-both-hands--12637e2e | fail (rake+banknotes) | pass | fail | pass | pass | FAIL |
| miniscribe-rep--action-celebrate--d0a1613b | pass | fail (no line) | pass | pass | pass | FAIL |
| miniscribe-rep--action-recoil--b5fa2de9 | pass | fail (no line) | pass | pass | pass | FAIL |
| terry-johnson--action-armscrossed--5ccd2153 | pass | fail (no line) | pass | pass | pass | FAIL |
