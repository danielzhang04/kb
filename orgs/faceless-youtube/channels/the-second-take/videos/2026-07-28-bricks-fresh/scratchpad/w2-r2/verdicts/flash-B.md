# W2-R2 ARM-FLASH — Verifier B (fidelity/style) — notes

10/10 covered. Result: 0/10 pass on strict merge.

## Systemic finding (affects all 10/10 cards)
None of the 10 cards show the payload-required "thin visible ground line" — every card
shows only a soft contact-shadow ellipse under the feet, no distinct line. This alone fails
`framing` on every card under strict merge, including the 4 otherwise-clean cards
(back-to-viewer, hold-one-hand/ecc1ee75, carry-by-handle, terry-johnson/armscrossed). This
reads as a mechanism-level miss on the "ground line" clause, not per-card noise — worth a
forge/prompt-mechanism look before re-spend.

## Second systemic pattern: scene/prop leakage on "empty-handed and alone" cards
6 of 10 cards fully render the object/scenery the payload explicitly orders omitted, even
though the payload's own instruction is unambiguous ("empty-handed and alone, the object...
left out... no scenery, no props, no furniture"):
- `fig-brick-foreman--action-shrug...1a78cea1` — cartons + pallet leaked in
- `fig-brick-foreman--hold-one-hand...16cc9e92` — brick drawn in hand
- `fig-drive-maker--action-present...5e51ec13` — full wooden counter + pick + shovel
- `fig-drive-maker--hold-both-hands...12637e2e` — rake + large banknote pile
- `fig-miniscribe-rep--action-celebrate...d0a1613b` — full 4-tier pallet tower + roof truss
- `fig-miniscribe-rep--action-recoil...b5fa2de9` — glowing red test-bench + smoke

Two of these also show flat-cel register drift (gradient/bloom/sheen rather than flat
colour): the shrink-wrap on `...d0a1613b` and the glow halo + smoke trails on `...b5fa2de9`.

## Best-in-set
`fig-brick-foreman--back-to-viewer--7a3b93be`, `fig-brick-foreman--hold-one-hand...ecc1ee75`,
`fig-drive-maker--carry-by-handle...f1c1d333`, and `fig-terry-johnson--action-armscrossed...5ccd2153`
are otherwise clean single-figure reference sheets (neutral backdrop, no leaked props, correct
payload omission of scene) — their only fail axis is the shared ground-line miss.

## Not evaluated (out of axis-B scope, left to Verifier A)
Costume/identity match to canonical (e.g. `fig-terry-johnson...5ccd2153` renders a green
T-shirt + tan cargo pants rather than the registry-pinned white shirtsleeves + tie) is a
canonical-match/costume question, routed to Verifier A per the disjoint-axis split.

Lettering: no unrequested text observed on any of the 10 cards; axis passes across the board.
