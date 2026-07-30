# Image-prompting research — boss synthesis (2026-07-29)

Three-sweep research (a-vendor-academic / b-tools-eval / c-practitioner) cross-checked against what
our doctrine ALREADY encodes. Status: DRAFT — awaiting Daniel's ruling alongside the _bricks-seg
feedback; nothing here is doctrine until approved and routed per operating-law §G-route.

## Already encoded — research VALIDATES, no action
- Narrative prose content prompts + fixed style suffix appended last (vendor's own recommended shape).
- ≤4-word lettering cap, quoted-verbatim literals, blank-surface authoring, carried-literal re-quoting.
- Canonical character registry + reference-PNG seeding; gate-before-spend review checkpoints.
- One-changed-element delta chains (vendor's "direct and specific single-property edits").

## Tier 1 — encode now (high confidence, converging sources)

1. **Rig clauses become keep/change CONSTRAINTS, not re-descriptions.** Google + OpenAI converge:
   when a reference image carries a trait, the prompt states what to keep/change — never re-describes
   it. Our §2d/§2e verbatim clauses (~570–1,100 chars/shot) are the anti-pattern: redundant with the
   refs, they bloat prompts into the measured >300-token degradation zone, and generic-boilerplate-
   before-named-character ordering is a plausible mechanism for the attribute bleed the segment critic
   caught 5 times. Fix shape: VPW authors a compact per-figure marker (who's anonymous, base-rig vs
   crowd-rig, which figures it governs); image-gen/forge expands it at gen time into reference
   conditioning + a short constraint clause. Kills the bloat, the singular/plural defect class, and
   the per-delta "give them a distinct outfit" self-contradiction in one move.
   *Owners: style-bible §2d/§2e, visual-grammar §2, image-gen forge.*

2. **Three-zone prompt ordering rule.** Persistent identity anchors (named characters + pinned traits)
   FIRST; scene content middle; the single payload instruction — the exact quoted lettering, or the
   one delta change — LAST, closest to generation. Vendor-documented for Gemini; first-mention bias
   research predicts exactly our leakage symptom when boilerplate leads.
   *Owner: visual-grammar §2/§3 (an ordering law), VPW SKILL step 2.*

3. **Delta preserve-clause law.** Every delta prompt carries "only X changes; everything else exactly
   as established" phrasing and re-lists the held elements compactly (we mostly do this by instinct —
   make it law). Image-gen side: pass the previous rendered still as an extra reference on
   scene-continuous shots (cheap, reportedly kills adjacent-shot drift).
   *Owners: visual-grammar chain logic; image-gen forge.*

4. **Multi-figure risk caps.** gemini-3-pro-image has 5 character-reference slots (vendor-documented);
   measured subject-collapse approaches 100% at high counts, interaction worse than co-presence.
   Encode: ≤5 must-stay-distinct figures per shot (VPW plans around it; >3 named figures interacting =
   flagged high-risk in notes); pin scale/gaze/interaction geometry explicitly in multi-figure shots
   (we largely do); per-figure indexed reference assignment at gen time.
   *Owners: visual-grammar §2, image-gen forge.*

5. **Lettering micro-rules (lint tightenings).** Vendor ceiling is 25 chars/phrase and ≤3 phrases per
   image — our 4-word cap sits AT the ceiling, not under it. Add to lint: ≤25 chars per quoted literal
   (HARD), ≤3 literals per prompt (HARD), prefer short/common words (SOFT heads-up on words >8 chars
   or rare). Keep the existing 4-word cap.
   *Owner: lint_shots.py.*

6. **Exclusions as positive state.** Google (our platform): never "no X" lists — author absence as a
   property ("every surface blank and unlettered", "an empty street"). Most segment shots already do
   this; some don't ("No prices, no words and no labels"). Encode as a grammar rule + SOFT lint
   heads-up on "no X, no Y" list phrasing in prompts.
   *Owners: visual-grammar, lint (SOFT).*

## Tier 2 — pipeline upgrades (image-gen side, bigger builds)

7. **DSG-style checklist verification.** Decompose each shot prompt into dependency-ordered atomic
   facts (one LLM call); a multimodal call answers each against the rendered still, short-circuiting
   children on parent failure. Upgrades the holistic verify-retry verdict into structured, loggable
   per-element pass/fail. No off-the-shelf tool exists (confirmed) — reimplement inside image-gen.
8. **Surgical retries.** On checklist failure, rewrite only the failing clause, not the whole prompt
   (VisualPrompter: +4–9pt alignment). Pairs with 7.
9. **Critic rubric enrichment.** Fold the relevant subset of PromptEnhancer's 24-point failure
   taxonomy (counting n≥3, cross-entity binding, text rendering/layout, hand action, negation) +
   two-granularity judgment (whole-scene vs per-object) into critics.md charters.
10. **Resolution probe.** One-command check that forge renders at the model's top tier (a controlled
    study found resolution swamps prompt wording for adherence). Do before any prompt-side tuning.

## Tier 3 — A/B in-house before encoding (genuinely contested)

- **Restate 2–3 signature anchors per character even with refs attached** vs **"consistency comes from
  reference, not repetition"** — two experience-backed sources directly conflict.
- **Explicit negative exclusions** ("no extra text") — OpenAI recommends, Google forbids; targets our
  control-leak failure exactly. Test on our shots, don't resolve by authority.
- **Style-suffix length** — "style soup" claim (long adjective lists average unpredictably) is
  folklore; our suffix is already short, low priority.
- **Letter-by-letter spelling of hard words** in lettering-bearing prompts — cheap, test on one video.

## Explicitly rejected (don't re-investigate)
Promptist / NeuroPrompts (SD-era aesthetic rewriters), StoryDiffusion (needs model internals),
GenEval / T2I-CompBench as tools (local CV stacks; API-only constraint), mcp-image / claude-image-gen
(we already exceed), SDXL hobby comic repos.
