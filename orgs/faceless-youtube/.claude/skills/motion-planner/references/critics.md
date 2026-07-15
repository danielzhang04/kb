# motion-planner critic — fresh-eyes decomposition check

Run a fresh-context reviewer over the emitted `shots.motion.json` + the source `shots.json`. It flags,
per layered shot:

1. **Leaked element** — does the `plate_prompt` still imply/describe an element that was moved to a
   cutout layer or to engine text? (e.g. plate still says "a ship" when ship is a cutout). The #1 defect.
2. **Over-animation (CUTOUTS only)** — is a *cutout* layer (slide/path/bob/appear) added where the
   measured grammar wants a plain hard cut? Scope this to cutouts. **Device cards are ASSERTIVE by
   default** (`animation-rules.md` Family B): a `stat-card`/`counter`/`meter`/`chapter-card`/`reveal` on a
   payoff number, section-turn, or debunk-list is the EXPECTED default, never over-animation — do not flag
   it. Conversely, flag the OPPOSITE miss here too: a payoff figure left **baked** into a still where the
   promote-and-subtract rule says it should be a card.
3. **Menu/asset mismatch** — an animation whose asset contract isn't satisfiable (e.g. `sprite-walk`,
   not built).
4. **Diegetic text** — is on-object text still baked in the plate instead of an engine `text` layer?

Output: a ranked list of concrete fixes. The planner applies them (one revise pass), then the human gate.
