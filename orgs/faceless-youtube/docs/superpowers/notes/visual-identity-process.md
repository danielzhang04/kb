# Visual-identity establishment — PROCESS learnings (reusable across channels)

**Purpose:** capture the *process* of establishing a channel's visual system — the questions to ask, inputs
needed, tooling, and workflow order — so future channels are faster. This is NOT the channel-specific art
rules (those live in each channel's `visual-kit/style-bible.md`). To be formalized into a niche-agnostic
`style-lock` establisher skill later. Running log; started 2026-07-05 (The Second Take).

## The workflow that worked
1. **Lock the base character rig first** — identity invariants, via *anchored iteration* (seed off the
   approved frame, change ONE variable) + verify-by-looking. Never text-only.
2. **Prove robustness before mass-building** — an angle/depth/in-scene stress test to find where identity drifts.
3. **Prove the cast system** — one shared rig → many distinct people (lineup is the tell) — before building a cast.
4. **Build the reaction library once on the rig** — a shared facial rig makes one reaction map onto all cast.
5. **Lock the scene/world style on REAL story beats**, not abstract backdrops.
6. **Layered architecture** — cheap model for environment plates, precise model for people; composite.
7. **Lock recurring elements** (ship, locations, props) exactly like characters.
8. **Harden spec → prove → then generalize** (don't skill an unproven process).

## Questions to ask when starting a channel's visuals
- On-screen host, or a VOICE + a cast acting the story? (changes the whole model)
- The ONE art style / which reference channels?
- Identity INVARIANTS vs. what flexes? (define "the rig")
- What recurs across videos (characters, props, locations) → the lock list?
- Motion model — hard-cut stills vs. rigged puppet vs. frame-by-frame? (determines asset FORMAT)
- Cost tier per asset type?

## Inputs you need
- Approved reference frame(s) to seed from (never generate a known thing from text alone).
- A locked invariant checklist = the verify gate. Everything that must stay constant is *explicitly
  prompted AND checked* (unspecified traits drift — e.g. ears).
- Model ids + rough cost per tier.

## Tooling
- Gemini image: **`gemini-2.5-flash-image`** (cheap; holds STYLE) vs **`gemini-3-pro-image`** (precise; holds
  IDENTITY). Seed-from-reference by passing ref PNGs as `inlineData` parts + a verbatim style descriptor.
- On Windows: run with `py -3` (native interpreter has the CA bundle; msys python 404s TLS). Prefer `certifi`.
- Review via self-contained HTML **artifacts** (downscaled data-URI images + click-to-enlarge lightbox);
  keep under the 16 MB artifact cap (downscale w/ PIL to JPEG ~1000px).
- **Verify = actually READ every output** and check the invariants. This step is non-optional; skipping it is
  how the no-nose bug slipped in on 3/18 frames.

## Failure modes learned
- The verify loop must actually RUN on every frame — coupling generation with the vision-check is the fix.
- The rig drifts most *inside busy scenes* → verify every character in every scene; **composite** locked
  characters over plates instead of letting the cheap model free-draw them.
- Flash drifts identity; pro holds it. → flash for plates, pro for people.
- **Unspecified traits drift** (ears were never in the spec → the model improvised "one ear"). Everything
  must be explicitly specified + checked.
