# W2-R2 ARM-PRO — Verifier A (identity/rig) — notes

Fresh-eyes pass over the 10 STEP-1 seed cards in `scratchpad/w2-r2/pro/`, judged only against
cast canonicals in `visual-kit/refs/<character>/` and pose/expression primitives in
`visual-kit/refs/base/`. Coverage: 10/10 cards.

## Result: 8/10 PASS

1. **fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333** — PASS. Identity, carry-by-handle
   pose, expr-deadpan all correct. Note (non-scoring): the card is not empty-handed — a full
   hand-truck of cartons is drawn, which the reference-sheet law says shouldn't appear on a seed
   card; flagging for the record, not scored under this axis.
2. **fig-drive-maker--hold-both-hands--expr-greedy--12637e2e** — FAIL (pose). The hold-both-hands
   reference grips a box with both hands at the same height. This card grips the rake shaft with
   a staggered top/bottom two-hand hold instead — a real hand-height/arm-configuration deviation
   from the reference, not just a different held object.
3. **fig-drive-maker--action-present--expr-smug--5e51ec13** — PASS. Clean identity/pose/expression;
   correctly drawn empty-handed.
4. **fig-brick-foreman--back-to-viewer--7a3b93be** — FAIL (rig). A distinct ear shape is visible
   protruding from under the hair on the right side of the head. The back-to-viewer rig reference
   is fully hair-covered from behind with no ear drawn at all.
5. **fig-brick-foreman--action-shrug--expr-deadpan--1a78cea1** — PASS. Shrug pose and deadpan
   expression (correctly overriding the shrug reference's own open-mouth face) both correct.
6. **fig-brick-foreman--hold-one-hand--expr-deadpan--16cc9e92** — PASS.
7. **fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75** — PASS.
8. **fig-terry-johnson--action-armscrossed--expr-thinking--5ccd2153** — PASS.
9. **fig-miniscribe-rep--action-recoil--expr-surprised--b5fa2de9** — PASS.
10. **fig-miniscribe-rep--action-celebrate--expr-delighted--d0a1613b** — PASS. Eyes correctly
    closed/crescented to match expr-delighted's register (this axis's prior-arm concern about
    open round eyes does not recur here).

## Coverage
10/10 covered — all applicable axes (identity, rig, proportion, pose, expression, integrity)
checked per card.
