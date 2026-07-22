# The shot critic (Step 8) — fresh-eyes review of shots.json, before any pixel is bought

This is the enforcement layer for the defects a shot-writer **cannot catch in its own plan** — the
logic, staging, and taste flaws that survive self-review because the writer already made the judgment
call when it authored the shot. The chain-test fixture proved it: a careful VPW run shipped a
wrong-direction map arc, co-stars not facing each other, freeze-frame walking poses, and a bland hook
straight through its own Step-2.5 discipline. A fresh, single-mandate reader with no attachment to the
plan catches what the writer structurally can't — and catches it **before generation tokens are spent
on 12+ scenes.**

**Scope:** runs as VPW Step 8, after `lint_shots.py` passes, before the folder hands off to
`image-generation`/`voiceover`. It is deliberately **thin**: ONE fresh critic + the author's edit
pass + the lint re-run. The critic returns FINDINGS ONLY — it never writes or rewrites prompts; the
author (the VPW run) is the one hand that edits, so the plan stays coherent.

## Orchestration (one cycle, no loops)

```
shots.json (lint passed)
  → shot critic            (one fresh subagent; returns findings only)
  → author edits           (the VPW run rewrites the flagged shots itself)
  → lint_shots.py --write  (mandatory re-run; anchors/order must still pass; vo_text re-derived)
```

**One cycle only** — do not loop critic→edit→critic. A second critic pass is justified only if the
edit set was large (author's judgment, e.g. >⅓ of shots touched). Findings the author rejects are
noted with a reason in the run summary to the human — never silently dropped.

## Dispatch

One subagent, fresh context (nothing from the authoring run). Give it:
- `videos/<slug>/shots.json` (the lint-passed file, so `vo_text` spans are present)
- `videos/<slug>/script.md`
- `channels/<name>/visual-kit/visual-grammar.md` (the staging law) + `registry/registry.json`
  (the live cast/prop index)
- The critic charter below, verbatim.

## The shot critic charter

> **You are a fresh-eyes reviewer of a video's visual plan with ONE job: find every shot that will
> generate wrong, weird, or weak — before pixels are bought.** You did not write this plan, you have
> no attachment to it, and your entire value is catching what its author structurally cannot see.
> You judge the PLAN (the prompts and staging as written), not hypothetical renders.
>
> **Read first:** the channel's `visual-grammar.md` (staging law: tableau poses, eye-line,
> expression-by-beat, role legibility) and `registry.json` (who exists in the cast). Then walk
> `shots.json` shot by shot against `script.md`. Answer SIX questions per shot — and only these:
>
> 1. **Scene logic.** Do the shot's stated facts make sense — geography (the right landmasses,
>    the right direction of travel), spatial layout, orientation (a vehicle faces where it goes;
>    interacting characters face each other), causality? Would a viewer who knows the story spot a
>    wrongness the author missed?
> 2. **Tableau.** Would this still read as a *deliberate composition* if frozen for its full
>    `duration_s`? A freeze of continuous motion (mid-stride, mid-shuffle, mid-sweep, mid-fall) is a
>    finding. A held pose that carries the action's meaning (a salute, a planted stance, presenting,
>    a held point) is correct.
> 3. **Casting.** Is every story-named or story-referenced figure cast from the registry — including
>    inside diegetic media (a brochure figure, a portrait, a poster who IS a named character)? Does
>    every role read at a glance (a king reads as a king)? Is any named figure in the wrong
>    canonical outfit without the shot authoring the change?
> 4. **Acting.** Does expression/pose track the beat and the channel's register map — or is one
>    default face riding every beat? (A character identical across a swagger beat and a ruin beat is
>    a finding.)
> 5. **Staging interest.** Is this the most interesting *legitimate* staging of the beat — or the
>    first competent one? Hold the hook shot to the scroll-stop bar: if it would look at home
>    mid-video, it fails. Flag bare scenes whose interest depends on nothing (no composition idea,
>    no palette code, no world-detail).
> 6. **Renderability.** Does the shot's *meaning* depend on animation the pipeline cannot render
>    (element motion inside a frame — walking, peeling, pouring)? The renderable set is: the still +
>    one camera move + word-anchored overlays + changes arriving AT cuts (stage deltas). A beat that
>    *needs* in-frame element motion must be restaged (as a delta chain, a tableau that implies the
>    motion, or an overlay-carried reveal).
>
> Also judge cadence as a plan-level taste check: flag a slow static hold that has no earned progressive
> reveal/legibility/gravity reason, a run of conspicuously equal-duration holds, or cuts so rapid that the
> visual payload cannot be read. Do not impose a bucket, cadence profile, or numerical quota; lint owns
> the runtime ÷ 5 floor and the presence of `hold_reason`, while you judge whether the reason earns it.
>
> Also check the plan-level checks. **Delta decisiveness** (a world-flip delta must flip the frame —
> flag timid partial changes, e.g. a "paradise peels away" where paradise visibly remains). **Stage
> grouping** — here your job is the **SEMANTIC call only**: *are these really one held set?*
> (consecutive shots on one set that were NOT chained into a stage, or a chain whose set changes so
> much it isn't really held); the **mechanical caps** (exactly one `base`, ≤3 `delta`s, contiguity,
> delta timing, `stage_role` order) are `lint_shots.py`'s job — do **not** re-flag those.
> **Disclosure order** — does the script **deliberately withhold** a payload for a later beat (a
> setup→payoff: a character's identity, a fate, a twist object/number/place)? If so, flag the
> **earliest** shot that visually discloses it before the narration does. Fix direction: **re-author**
> that shot (or rework the chain if it's a `base`/`delta`) so the withheld entity is **absent
> entirely** — never merely obscured (back-to-viewer/silhouette still puts a recognizable figure in
> frame and dodges the rule).
>
> **NEVER flag these — over-triggering is the failure mode:**
> - A prompt that states *few* facts because few are load-bearing. Terse is correct; you flag
>   *missing load-bearing* facts, never brevity. Do not demand inventory-style prompts.
> - Deliberate style choices the staging law owns (the locked rig, palette codes, negative space,
>   the humor dial). You are not the style police; the style bible and taste gate own the pixels.
> - Non-literal depictions that feel "indirect" — non-literal is the channel default and the point.
> - A character or thing shown at or after its first narration mention, absent a real setup→payoff
>   withholding. Disclosure order fires ONLY on deliberate withholding — never on ordinary first
>   introductions.
> - A held pose as "static" — stillness is the medium; only flag a *freeze of motion* or a dead
>   compositional idea.
>
> **Output** a ranked list, most-damaging first. Each finding: the shot `id` · the question # ·
> the defect in ONE sentence, quoting the offending prompt text · a one-line fix *direction* (what
> to restage/restate — do NOT write the new prompt; the author rewrites). If a shot is clean, say
> nothing about it — do not invent problems to look thorough. End with a one-line verdict on the
> plan as a whole (ship-with-edits / restage-these-N / sound).

## The author's edit pass

Apply the findings yourself — you are the one hand that keeps the plan coherent:
- **Touch only flagged shots** (plus any shot a fix forces to move, e.g. re-staging splits a chain).
- **Rewrite in discipline:** a fixed shot must still satisfy Step 2.5 end-to-end (class → cast →
  tableau → facts → intent note) — don't patch a word, re-derive the shot.
- **Reject with a reason:** a finding you disagree with goes to the run summary with one line of
  why; the human arbitrates patterns of disagreement.
- **Re-run `lint_shots.py --write`** — edits can break anchors/order; the lint is the floor.

## Notes for the skill

- Without subagents available, run the charter as a deliberate separate fresh re-read (close the
  authoring context first); prefer a real subagent — the fresh context is the whole point.
- The critic is **subtractive by design**: it flags, the author decides. If it starts flattening
  staging variety or demanding encyclopedic prompts, its "never flag" list needs loosening — do not
  add more questions.
- The critic checks **the seven authoring laws** named canonically in `SKILL.md` → *Load-bearing rules*
  (**held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order**,
  under the *author intent, never mechanism* / engine-reality frame). Do **not** restate a divergent set
  here — reference that named list. The 1:1 map: Q1 scene logic → **scene facts** · Q2 → **held tableau** ·
  Q3 → **casting** · Q4 → **acting** · Q5 staging interest → **hook bar** · Q6 renderability → the
  **engine-reality** frame; the plan-level checks cover **delta decisiveness** + **disclosure order**
  (+ stage grouping, the semantic half). If a law's name changes in SKILL.md, update these references in
  the same edit.
