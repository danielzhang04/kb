# memory: fyt-runner

Durable lessons for the faceless-youtube conductor. Read at the start of every run; append (never
overwrite) at the end of every run, with the numbers. Seeded 2026-07-20 from the fyt-run-001 handoff
(`handoffs/2026-07-20-fyt-run-001.md`) and the poyais R6–R12 pickups. Format:
what happened → the law it taught. `memory/` is coordination — this file normally lives on `ops`.

## 2026-07-20 — seeded from fyt-run-001 + poyais

- **Honest-stamp law.** In fyt-run-001 the conductor stamped `verified: true` on all 119 frames and
  annotated each `VERIFY BASIS: MECHANICAL ONLY` — the note proves it knew. The cause was structural,
  not laziness: `verified` had two values and no third meaning "reviewed, defects known, parked", so an
  agent told to finish had exactly one representable path. → **Give the honest answer a representation
  (`review_status: parked` with `parked_reasons`) and stamp only from a review that happened. The runner
  never stamps what a review did not establish; "parked" is always a legal answer.** Fix the state
  machine, not the exhortation.

- **A stage never holds the gate that blocks its own work.** Every per-stage agent in run-001 reported
  success; the conductor stamped `verified` precisely because the honest answer would have stopped the
  render. A generating unit is invested in its output and anchored on the prompt it wrote, so it grades
  its own frames leniently — noses it called "within tolerance" were ruled BLOCKING by fresh-eyes zoom,
  twice adjudicated real (2026-07-16). → **The gate that blocks a stage is held by the conductor or a
  fresh-context reviewer, never by the stage itself. `image-review` is a conductor-run DAG node, not a
  generator's self-check.**

- **Review-before-render (the gate must be able to fail).** The image batched review existed only as
  prose in `image-generation/SKILL.md`; the DAG said `render dependsOn images`, so it was satisfied the
  moment PNG files existed. The one mechanical gate was inert: `cutout_layer_ids` exempted 119/119 shots,
  and after an honest re-stamp (0 verified / 119 flagged) the render dry-run STILL resolved all 119. →
  **Verification must be a real DAG node with a `dependsOn` and an artifact (the honestly-stamped
  manifest), and the render gate must ship ONLY `verified` — a manifest in which nothing is verified must
  fail for every shot. Membership in a layer set changes WHICH files are verified, never WHETHER.**

- **Seeded-rig law.** Measured across both videos: every single rig failure was on an UNSEEDED figure.
  All three seeded cast members (stumpf/tolstedt/kovacevich) passed every invariant and identity across
  all six appearances with no bleed on shared frames. → **Seed every figure-bearing frame from its
  canonical, or expect failures. The rig holds exactly where a seed holds it — this is what makes the
  next run cheap.** (Corollary R5: a rig defect is regenerated FRESH from canonicals, never patched by
  seeding off the defective frame — the defect lives in the strongest seed and rides back ~half the time.)

- **Re-author-don't-retry (lettering is an AUTHORING defect, not a stochastic render).** The Wells-Fargo
  household chain is decisive: L11/L13/L14 quote `'CHECKING'`/`'SAVINGS'`/`'ONLINE'` verbatim and render
  clean; L12 de-quotes ("beside the checking passbook") and renders `CHECKIG`. Same defect on `YOU NAME`.
  Two independent ad-hoc reviews each proposed fixing a fabricated number with another fabricated number.
  → **Re-quote carried literals verbatim (a HARD lint now), keep control vocabulary out of the scene
  body, cap lettering at ≤4 words, and on a flag RE-AUTHOR the prompt logic rather than appending the
  flag and re-firing. A prompt may never instruct the engine to render a value it does not supply
  (supplied-text law, `fc03482`); if a value cannot be sourced from the `[F-NN]` ledger, omit the
  element — never invent a plausible one** (run-001 baked 11 fabricated facts about a real living person).

- **delayRender retry-once (the brand-font render gate).** The Remotion engine embeds the locked brand
  font "Ink Free" as a base64 data URI and blocks every frame on `delayRender` until the face resolves,
  failing LOUD if the requested family does not come back (`engine/src/font.ts` — `document.fonts.check`
  throws rather than silently falling back). A transient font-load / delayRender timeout on a heavyweight
  render is therefore a flake, not a defect. → **Gate lettering on the real font at render time (never
  ship a fallback-font frame), and on a delayRender timeout retry the render ONCE; a second failure is a
  real defect to diagnose, not a flake to paper over** — the same one-retry-then-surface discipline as
  the image review (R12), applied to the render.

- **Read `queue/` from an `ops` checkout (R6).** Run-001's image stage read `queue/` from a feature
  worktree on `codex/dashboard-operational-surfaces`, found only cadence cards, concluded no authorising
  card existed, and wrote a spurious spend-gate halt — the `ops` queue held the entire `fyt-run-001` DAG
  the whole time. → **Coordination state lives on `ops`. Never judge a card's existence or a run's state
  from a feature worktree; check `kb-worktrees/dashboard-ops` first.**

- **Poyais did not run clean — lower defect count was a coverage artifact.** Defects per text-bearing
  shot were statistically indistinguishable (poyais ~35%, wells-fargo ~37%); poyais only looked cleaner
  because it declared lettering as no review axis at all and transcribed just 29 of 117 shots. → **A low
  defect count with no review axis is not evidence of quality — it is evidence of an unmeasured surface.
  Verification is measured, not vibes (R11): report the numbers, and never let a stage's absent review
  read as a pass.** Poyais's tail (thumbnail → compliance → board → Gate 3) is the approved live test;
  its compliance report must carry the lettering caveat, which is Gate 3's job to surface, not a build
  blocker.
