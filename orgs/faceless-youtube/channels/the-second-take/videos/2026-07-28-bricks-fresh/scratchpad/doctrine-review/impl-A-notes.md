# impl-A — doctrine fix list A1-A11 (2026-08-18)

Approved fix list implemented in place. Scope: `visual-grammar.md`, `style-bible.md`,
VPW `SKILL.md`, VPW `references/critics.md`, one mechanical `shots.json` suffix copy.
`forge.py` untouched (paired change is another worker's).

## Baseline (untouched tree)
- `lint_shots.py` on `2026-07-28-bricks-fresh/shots.json`: exit 0, **HARD violations: none**, 37 heads-up.
- `pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/`: **562 passed**.

## What changed, per item
- **A1** `visual-grammar` §3 — vantage restored as a payload-driven choice ("Framing, scale, and vantage
  are a choice…"); the `d1f771a7` lock ("vantage is not a choice — it is the house eye-level frontal")
  deleted; eye-level frontal restated as the house REST position with the pre-window default
  ("centered eye-level medium — fine once, deadly on repeat"). §2 reveal menu regains `low angle`
  alongside `scale`.
- **A2** `style-bible` §5 Environments — `eye-level frontal` removed from the LOOK law; the pre-window
  fore/mid/background depth read restored, built from **overlap and recession**. Composition doctrine now
  lives only in `visual-grammar` §3.
- **A3** `visual-grammar` §1 chain logic — departure-as-default (`52b17ab2`) inverted in place: the CHAIN
  is the default where consecutive beats play on one set; departure is what a changed place, subject, or
  register earns; the guard is the ≤2-delta cap + re-base. Feasibility gate, entrance-is-never-a-delta,
  and the ≤2 cap untouched.
- **A4** VPW 2.3 displacement (1) — crowd exemplar now displaceable when the place plate **OR the in-chain
  parent frame** carries the rear-zone mass.
- **A5** `visual-grammar` §1 — the two subject bullets merged into one subject-driven rule ("the beat's
  true SUBJECT bears the frame — a person, an object, or a place"). Performance clause kept; the
  `27bc7e25` "EARNS its absence" framing and the 29-of-41 war story deleted. The ~10s figureless
  self-audit flag kept (a taste flag, not a rule).
- **A6** `critics.md` Q8 — semantic-belonging test extended to personified objects: a canonical entity
  (`pc-boxy` included) is reused only where that entity AS ACTOR bears the beat; otherwise the
  environment, the product, or an anonymous bearer already allowed by doctrine carries the frame. Cadence
  context carried as prose ("pre-reset it was an OPENING device"), no number written into the doc.
- **A7** warmth, three coordinated changes: (a) §2b drops the "or cool" licence — "any grey or neutral
  clearly TINTED WARM, so the frame never drains to greyscale; a genuinely cold scene cools its LIGHT,
  never its neutrals"; (b) `global_prompt_suffix` gains "warm-biased" ("locked 2-3 colour warm-biased
  scene palette"), copied VERBATIM into `shots.json` (verified byte-equal against
  `lint_shots.channel_suffix`); (c) §5 style-tile grant now "line register, palette saturation AND
  TEMPERATURE … ONLY".
- **A8** VPW 2.4 — the rote `stage-left / centre / stage-right` + fixed layered-depth template replaced by
  a payload-driven THREE-PLANE read (what occupies fore/mid/background of THIS beat, at what scale, from
  where the camera sees them, payload owning its plane), explicitly "in whatever sentence the scene wants".
- **A9** `critics.md` plan-level — repetition of vantage, figure scale, depth shape, and palette
  temperature folded into the existing place-monotony rubric (no numbers, no counters); the same bullet's
  stale "departure is the grammar's default" line updated to match A3.
- **A10** VPW Step 3 — disjoint contiguous act partitions stated as the default execution once 3a's
  cast/place/stage plan locks; every planned `stage` whole inside one partition; coordinator merges in
  narration order; ONE whole-file lint + critic pass. Replaced the old closing rationale sentence.
- **A11** VPW 2.3 — the ~9-line seed-cap arithmetic worked examples deleted; the restage rule that closed
  the block kept (it is law, not arithmetic).

## Coherence follow-through (flagged, not silent)
- VPW SKILL 2.2 restated A5's deleted "must EARN its absence" rule and pointed at `visual-grammar` §1 for
  "the full law". Left as-is it would contradict the doc it cites, so it was rewritten to the merged
  subject-driven rule. Same for `critics.md`'s plan-level "Concrete presence is the DEFAULT" sentence.
  No new rule added in either place — only the deleted framing removed.

## Verification (after edits)
- lint: exit 0, **0 HARD**, 37 heads-up — output **byte-identical** to baseline (`diff` empty), which is
  the suffix-copy proof.
- pytest: **559 passed, 3 failed** — all three are the §2b / suffix drift-locks living in
  `image-generation/scripts/` (forge's tree, out of scope here). See the report for exact constants.
- Encoding: all five files decode clean as UTF-8, no BOM, no mojibake; em dash / `≤` / `§` / `→`
  verified present by codepoint after editing.

## Line deltas
| file | before | after | Δ |
| --- | --- | --- | --- |
| visual-grammar.md | 294 | 288 | −6 |
| style-bible.md | 201 | 201 | 0 |
| SKILL.md | 310 | 305 | −5 |
| critics.md | 151 | 156 | +5 |
| shots.json | 3392 | 3392 | 0 |
| **total** | | | **−6** |
