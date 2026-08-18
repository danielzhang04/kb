# Verifier A (identity/rig) — flash arm, W2-R2

Fresh-eyes pass, no generator context. Cast canonicals read from `visual-kit/refs/<character>/<character>.png`; pose/expression primitives read from `visual-kit/refs/base/`. All 10 cards read directly as PNGs, compared against canonical + named pose ref + named expression ref, per card spec in `fig-items.json`.

## Result: 0/10 pass

Every card has at least one Axis-A defect. Breakdown by defect type:

- **Pose not depicted (6 cards):** `action-shrug` (1a78cea1), `back-to-viewer` (7a3b93be), `action-present` (5e51ec13), `carry-by-handle` (f1c1d333), `action-recoil` (b5fa2de9), `action-armscrossed` (5ccd2153). In most of these the figure defaults to a plain neutral standing pose (arms at sides) instead of the named pose primitive's distinctive stance. `back-to-viewer` is the most severe: a full front-facing view was rendered where a rear view was required.
- **Held prop where empty-handed is required (2 cards):** both `hold-one-hand` cards (16cc9e92, ecc1ee75) render a visible box/brick-shaped prop gripped in the hand; the card payload explicitly calls for an empty gripping hand with the object left out.
- **Identity/costume drift (2 cards):** `fig-miniscribe-rep--action-celebrate` renders a bald, hairless head — looks like the generic rig-template head from the pose/expression reference sheets rather than the character's canonical dark hair. `fig-terry-johnson--action-armscrossed` swaps the canonical's white dress shirt/black tie/black trousers for a casual green t-shirt and khaki cargo trousers, though the scene text authors no clothing change.
- **Expression mismatch (4 cards):** `action-present--expr-smug`, `hold-both-hands--expr-greedy`, and `action-armscrossed--expr-thinking` all read as a neutral/generic or plain-happy expression rather than the named expression's distinctive brow/eye/mouth shape.

No cards showed integrity defects (missing limbs, garbled anatomy) or proportion/rig-scale problems — the base body rig and canonical costume rendering are generally solid where the pose/expression themselves aren't the issue. The recurring failure pattern is that the generator is defaulting to a baseline standing pose and a baseline neutral/happy expression rather than actually applying the named pose/expression reference's distinctive shape.

Card-by-card verdicts: `flash-A.json`.
