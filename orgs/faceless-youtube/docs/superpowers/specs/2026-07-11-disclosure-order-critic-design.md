# Design — "disclosure order": stop a shot from revealing what the narration hasn't (2026-07-11)

## Problem

VPW can author a shot that **visually discloses information the narration is deliberately
withholding** for a later beat — spoiling a setup→payoff. Evidence: the fresh-agenda-blind Poyais
retest showed MacGregor as the salesman (L04) and the enthroned prince (L09) *before* his spotlight
reveal (L12–13). Nothing caught it. The author can't self-catch this: it made the call to place him
there when it authored those shots (the same blind spot that produces every other Step-8 finding).

This is a **logic** defect (objectively checkable: is this entity established in the narration by this
shot's position?), not a taste defect — which is why it earns both an authoring discipline *and*
fresh-eyes enforcement, matching how every existing authoring law in this skill works.

## The rule (narrow)

> An entity the narration has **not yet introduced** must not appear in a shot **at all — in any pose
> or form** — when the script deliberately withholds it for a later beat.

- **Scope generalizes past characters:** the primary case is a withheld *character identity*
  (MacGregor as prince), but the same law covers any withheld payload the script sequences for a
  reveal — a fate, a twist object, a number, a place.
- **Narrow trigger:** it fires **only** on a real setup→payoff withholding. A character (or thing)
  simply introduced at its first mention, with no withholding intent, is **never** flagged. This is
  the guard against the critic's documented over-trigger failure mode.
- **"Introduced" is measured by narration position** — an entity is fair game in a shot once the VO
  has named/established it at or before that shot's `vo_ref` position.

## Placement — both an authoring law and a critic check (no new critic)

The reliance is on the fresh-eyes critic; the authoring law is cheap prevention. This mirrors the
existing author-intent + critic-enforcement pattern for all six current laws.

1. **New canonical authoring law — "disclosure order"** (plan-level, parallel to `delta decisiveness`).
   Added to the canonical named-laws list in `SKILL.md`. The author follows it while authoring;
   because it's plan-level (a cross-shot sequencing property), it is realized by the critic at plan
   level, not as a per-shot question.
2. **New plan-level check in the EXISTING Step-8 shot critic** (`references/critics.md`). This is *not*
   a new subagent or a new pass — it joins the critic's current plan-level checks (delta decisiveness +
   stage grouping), which become a trio. Orchestration is unchanged: one fresh subagent, one cycle
   (critic → author edits → `lint_shots.py --write`), subtractive (findings only).

Rejected alternatives:
- **Authoring rule alone** — shares the author's blind spot (the exact reason L04/L09 slipped).
- **Lint / authored marker** — "does an earlier image disclose the withheld thing?" is a semantic
  judgment, not mechanical; lint can't do it, and a marker adds schema + authoring burden authored by
  the same blind-spot author, for a job that should be small.

## Critic check — what it does

Added to the critic charter's plan-level section:

> **Disclosure order.** Does the script deliberately withhold a payload for a later beat (a
> setup→payoff — a character's identity, a fate, a twist object/number/place)? If so, flag the
> **earliest** shot that visually discloses it before the narration does. The fix direction is to
> **re-author** that shot (or, if it is a `base`/`delta` in a stage, rework the chain) so the withheld
> entity is **absent entirely** — never merely obscured (back-to-viewer/silhouette still puts a
> recognizable figure in frame and dodges the rule).

Add to the critic's **"NEVER flag"** list:

> - A character or thing shown at (or after) its first narration mention, where the script isn't
>   withholding it for a later reveal. Disclosure order fires only on a real setup→payoff withholding,
>   never on ordinary first introductions.

The critic already receives `script.md` + `shots.json` + `registry.json` — **no new inputs**. It reads
the script's disclosure sequence and cross-references the shots; this is precisely the fresh-eyes,
cross-shot job the author structurally cannot do.

## Fix mechanism (author's edit pass — already supported)

On a flag, the author **re-authors** the offending shot so the not-yet-introduced entity does not
appear, composing the shot around only what the narration has established. If the shot is part of a
stage chain, the existing edit-pass rule already covers "a fix that forces other shots to move (e.g.
splits a chain)," followed by the mandatory `lint_shots.py --write` re-run. **No obscuring hacks.**

## Downstream: nothing changes

- **No schema change**, no `lint_shots.py` change, no **image-generation** change. image-gen renders
  whatever `shots.json` says; because the fix re-authors the shot upstream, the correction is entirely
  in VPW + its critic. Nothing already generated is invalidated by this addition.

## Edit surface & consistency (the file-editing discipline)

Two files. The only real hazard is the hard-coded "six" counts and the 1:1 law↔question map, which
must stay in sync. Every site:

**`SKILL.md`**
- The `five fundamentals … distinct from the six authoring laws` reference → **seven authoring laws**.
- The canonical list `held tableau · scene facts · acting · casting · delta decisiveness · hook bar`
  → add **`· disclosure order`** (plan-level).
- The realization line `six per-shot questions + one plan-level pair` → reword to keep six per-shot
  questions but reflect the plan-level checks now being delta decisiveness **+ disclosure order**
  (+ stage grouping as the semantic check). Point at `critics.md` for the map (don't restate it).
- Add the law's concise **authoring statement** once, in the appropriate body location (near the
  scene-logic / delta-decisiveness discussion), stated as intent — not a new numbered *mechanical*
  rule (those are render-contract rules; disclosure order does not break the render).

**`references/critics.md`**
- Add the **Disclosure order** plan-level check to the charter (after delta decisiveness + stage
  grouping).
- Add the **never-flag** guard line above.
- Update **"Notes for the skill"**: the `six authoring laws` reference → seven, and extend the 1:1
  map with `disclosure order → plan-level`.

**One home rule:** the check's *definition* lives in `critics.md`; `SKILL.md` names the law and states
the authoring intent, then references — no duplicated definition. Consistent with how
`delta decisiveness` is already split across the two files.

## Non-goals

- Not touching the other two parked composition-variety items (`staged-interaction` bar; identity-
  review hardening — the latter lives in image-gen, not here).
- Not adding a per-shot question (guardrail: the critic's six per-shot questions stay six).
- Not building an automated test — the critic is a prose charter.

## Validation

No unit test (prose charter). Validation is the next VPW dogfood — the Poyais gold-exemplar slice:
with the check in place, the critic should flag the premature-disclosure case (a MacGregor-before-
reveal shot) and the author should re-author it to absent the character, then re-lint clean. Confirm
the never-flag guard holds (ordinary first-introduction shots are not flagged).
