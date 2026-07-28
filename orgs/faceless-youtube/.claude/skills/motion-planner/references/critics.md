# motion-planner critic — fresh-eyes decomposition check

Run a fresh-context reviewer over the emitted `shots.motion.json` + the source `shots.json`. It flags,
per layered shot:

1. **Leaked element** — does the `plate_prompt` still imply/describe an element that was moved to a
   cutout layer? (e.g. plate still says "a ship" when the ship is a cutout). The #1 defect. (In-video text
   is NOT a leak — it stays baked in the plate; see check 4.)
2. **Over-animation (CUTOUTS only)** — is a cutout layer (slide/path/bob/appear) added where the measured
   grammar wants a plain hard cut? The menu is cutout-only; there is no other family to weigh. A baked
   payoff figure is CORRECT, not a miss — never flag a number left baked into the still.
3. **Menu/asset mismatch** — an animation that isn't on the cutout menu (slide/path/appear/bob) or whose
   asset contract isn't satisfiable — e.g. a `fade` (killed at the render root; hard cuts only) or a
   `zoom`/`pan` (camera-space, and the camera is locked).
4. **Text & seed integrity** —
   (a) Baked in-plate text is now the INTENDED path, never a defect. Flag instead any plan that authors an
   `engine`/`text`/device layer: `source:"engine"` is INVALID (the engine device family is gone; the
   engine draws only the route line via `draw_line`).
   (b) Seed check: flag any moved element (a cutout layer) whose cutout has **no seedable source** — no
   character/prop canonical AND not seedable off the plate it lands on + a `refs/env/` style anchor. An
   unseeded cutout invents its own register (a discrete-but-unseedable element belongs in a delta-chain, or
   its plate/style anchor must be named).
5. **Re-base seed** — a re-base frame inside the SAME location that doesn't chain from the stage's BASE
   frame (it seeds a fresh canonical, or a different prior stage) → flag. A re-base must seed the prior
   stage's base frame or the held set drifts into two different versions of the same place.
6. **Missed motivated layer** — flag a clearly separable object that enters, travels, accumulates, or
   reveals on the spoken beat but was baked static without a stated practical or visual reason. Do not
   demand layers for ordinary held tableaux, integrative changes, or to hit a coverage quota.

Output: a ranked list of concrete fixes. The planner applies them (one revise pass), then the human gate.
