# figment — standing guardrails

These hold regardless of permission mode. They are not permission-based; bypassing
the permission system does not relax them. Restated here so they survive a session
restart.

## Hard lines

1. **No real-person likeness.** Reference accounts may be studied as a SET to derive an
   aesthetic register (face-shape tendencies, makeup, skin, styling, lighting, framing,
   body type as a type). Never build per-person anatomical dossiers. Never generate a
   face resembling a specific real individual — discard it if it happens. Never put a
   real person's name in a generation prompt.

2. **Unambiguously adult output.** Every generated persona must clearly read as an adult
   woman. Cull anything ambiguous rather than keeping it. A declared or prompt-stated
   age does not cure a youthful appearance — destination platforms judge by eye, and
   this pipeline's paid tier is explicit content, which makes an ambiguous face an
   unrecoverable mistake rather than a cosmetic one.

3. **Explicit-tier generation is the operator's, not the agents'.** Agents build the
   pipeline, do research, and generate at the Instagram register (clothed). The operator
   runs explicit generation himself through the chosen tool.

4. **Mandatory visual QA.** Silent clothing-render failures (a garment failing to render,
   exposing the body) have recurred three times in this project despite negative
   prompting. Every generated image is visually inspected before delivery; failures are
   quarantined to `rejected/` and regenerated. This is not optional at volume.

5. **Credentials are never handled as objects.** API keys are read from the environment
   as ambient config — never printed, echoed, copied into scripts, written to files, or
   included in reports. Credential stores are not opened.

6. **Rented compute is terminated on every exit path** — success, failure, or error —
   and termination is VERIFIED via API, not assumed. A forgotten pod silently drains the
   balance.

## Operating norms

- Research browsing (operator ruling 2026-09-03): the operator's Chrome is signed in to
  Instagram, Fansly, Fanvue, and OnlyFans for research. Agents use those existing sessions;
  they never sign in, sign out, change account settings, or enter credentials. Permitted:
  viewing and clicking around; on the paid platforms, FREE subscriptions/follows for research
  only. Forbidden, no exceptions: spending ANY money (no paid subscriptions, PPV, tips,
  unlocks, bundles, or "free trial" flows that attach billing), linking or entering any
  payment method, likes/comments/DMs/messages/posts on any platform, scraping, downloading
  other creators' media. If a paywall, bot wall, or rate limit appears, record "evidence
  unavailable" — never work around it.
- In the operator's live Chrome: open your own tab, never touch or close his existing
  tabs, close only your own.
- Disclosure is the operator's to place; the pipeline carries it as a persona field and
  sets `is_ai_generated` on API-published posts.
