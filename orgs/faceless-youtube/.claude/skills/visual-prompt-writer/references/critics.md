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
>
> Apply the canonical six shot questions in the channel `style-bible.md` review-criteria section and
> the canonical plan-level chain/disclosure contract in `references/shots-schema.md`. For every
> adjacent beat, ask both directions: could camera, set, and primary subject honestly hold
> (a missed hold), and does every authored delta visibly advance a story-needed state (a forced hold or
> no-op)? Hard-cut when vantage, setting, primary subject, or register must change. Report findings, not
> hold totals. Calibrate forced-hold/no-op judgment against
> `references/delta-materiality-calibration.json`: 26 human-labelled fresh cases used to learn the
> distinction, never as a lexical checklist, lint oracle, or target count.
> At plan level, flag a dominant palette axis repeated across distinct stages when the bases give no
> physical/story basis; holds are exempt, complements remain legal, and palette codes are not policed.
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
