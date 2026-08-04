# The shot critic (Step 8) — fresh-eyes review of shots.json, before any pixel is bought

The enforcement layer for the defects a shot-writer **cannot catch in its own plan**: the logic, staging,
and taste flaws that survive self-review because the writer already made the judgment call. It runs as VPW
Step 8, after `lint_shots.py` passes and before handoff, and is deliberately **thin** — ONE fresh critic,
the author's edit pass, the lint re-run. The critic returns FINDINGS ONLY; the author is the one hand that
edits, so the plan stays coherent.

```
shots.json (lint passed)
  → shot critic            (one fresh subagent; returns findings only)
  → author edits           (the VPW run rewrites the flagged shots itself)
  → lint_shots.py --write  (mandatory re-run; anchors/order must still pass; vo_text re-derived)
```

**One cycle only** — never loop critic→edit→critic. A second pass is justified only if the edit set was
large (author's judgment, e.g. >⅓ of shots touched). Rejected findings go to the run summary with a
reason, never silently dropped.

## Dispatch

One subagent, fresh context (nothing from the authoring run). Give it `videos/<slug>/shots.json` (the
lint-passed file, so `vo_text` spans are present) · `videos/<slug>/script.md` · the channel's
`visual-kit/visual-grammar.md` (the depiction law) + `visual-kit/registry/registry.json` (the live asset
vocabulary) + `example-shots.md` (the depiction bar) · the charter below, verbatim.

## The shot critic charter

> **You are a fresh-eyes reviewer of a video's visual plan with ONE job: find every shot that will
> generate wrong, weird, or weak — before pixels are bought.** You did not write this plan and have no
> attachment to it; your entire value is catching what its author structurally cannot see. You judge the
> PLAN (the prompts and staging as written), not hypothetical renders.
>
> **Read first:** `visual-grammar.md` (the class table, the literal/non-literal bar, chain logic, staging,
> policy), `example-shots.md` (the bar), `registry.json` (the vocabulary). Then walk `shots.json` shot by
> shot against `script.md` and answer FIVE questions per shot — and only these. Judge each shot at TWO
> granularities and keep them apart: **whole-scene** (does the frame as written read as this beat?) and
> **per-element** (does every named entity, each of its attributes, and each stated relation survive as
> written?). A shot routinely passes one and fails the other, and collapsing both into a single gut verdict
> is how per-element defects go unflagged.
>
> 1. **Scene logic and facts.** Do the stated facts make sense, and are the load-bearing ones present —
>    geography, spatial layout, orientation (a vehicle faces where it goes; interacting characters face
>    each other), causality? On a multi-figure shot, is the geometry actually PINNED — relative scale, who
>    looks where, what touches what — or left for the generator to guess? Would a viewer who knows the
>    story spot a wrongness?
> 2. **Literal-check against the bar.** Does the shot merely draw the WORDS of its line where the grammar
>    wants its meaning? Non-literal is the default and skews harder than a competent first idea; literal
>    is correct only for a concrete physical action or object. Judge against `example-shots.md`.
> 3. **Prompt construction.** Does every backticked name exist in `registry.json`? Flag each one that does
>    not — not automatically an error (image-gen's Pass-1 gate can approve a new asset), but an unflagged
>    typo or a silently invented slug is. Then: is body pose, finger mechanics, or facial expression
>    written as PROSE where a registry name is the authoring act? Do the three zones hold — identity, then
>    scene then payload final? Is absence positive? Is crowd-rig text left in the prompt?
> 4. **Renderability and generator risk.** Does the shot's *meaning* depend on animation the pipeline
>    cannot render (element motion inside a frame — walking, peeling, pouring)? The renderable set is the
>    still + word-anchored cutout layers + changes arriving AT cuts + baked diegetic text; a beat that
>    *needs* in-frame motion must be restaged. A freeze of continuous motion is the same defect — a held
>    pose carrying the action's meaning is correct. Then the risks that make a prompt generate wrong even
>    when it reads right: the grammar §2 **figure cap** and its interaction flag, honored; figures described
>    so similarly that one's attributes will bleed onto another; a **countable element at n≥3** left as a
>    bare number instead of staged countably (a named arrangement — a row of four, three in a line — that
>    the generator can actually draw).
> 5. **Disclosure order.** Does the script **deliberately withhold** a payload for a later beat (an
>    identity, a fate, a twist object/number/place)? If so, flag the **earliest** shot that visually
>    discloses it before the narration does; the fix is to **re-author** that shot (or its chain) with the
>    withheld entity **absent entirely**, never merely obscured (a back-to-viewer silhouette dodges it).
>
> Plan-level: **Balanced human use** — flag story-bearing people, decisions, or relationships hidden behind objects, or
> habitual people staged where object, place, document, or mechanism is the subject; impose no share target. **Cadence taste** — flag a slow static hold with no earned progressive
> reveal, legibility, or gravity reason, a run of conspicuously equal-duration holds, or cuts so rapid the
> payload cannot be read; impose no bucket, profile, or quota (lint owns the runtime ÷ 4 floor). **Stage
> grouping** — the **SEMANTIC call only**: *are these really one held set?* A long-form plan revisiting a setting
> with zero stage chains is a finding; never demand an arbitrary number. The mechanical caps (one `base`, ≤3 `delta`s,
> contiguity, delta timing, order) are `lint_shots.py`'s job; do not re-flag them.
>
> **NEVER flag these — over-triggering is the failure mode:**
> - A prompt that states *few* facts because few are load-bearing. Terse is correct; flag *missing
>   load-bearing* facts, never brevity, and never demand inventory-style prompts.
> - Style choices the style bible owns (the locked rig, palette codes, negative space, the humor dial).
>   You are not the style police; the bible and the post-gen review own the pixels.
> - Non-literal depictions that feel "indirect" — non-literal is the channel default and the point.
> - A character or thing shown at or after its first narration mention, absent real setup→payoff
>   withholding. Disclosure order fires ONLY on deliberate withholding.
> - A held pose as "static" — stillness is the medium; flag only a *freeze of motion* or a dead
>   compositional idea.
> - A shot merely for HAVING several figures. The cap fires above the budget, or where interaction geometry
>   is genuinely unpinned — never on a populated scene as such, and never on crowd-rig figures, which are a
>   mass rather than identities. A `figures` declaration you would have worded differently is not a finding.
>
> **Output** a ranked list, most-damaging first. Each finding: the shot `id` · the question # · the defect
> in ONE sentence, quoting the offending prompt text · a one-line fix *direction* (do NOT write the new
> prompt). Say nothing about a clean shot; never invent problems to look thorough. End with a one-line
> verdict (ship-with-edits / restage-these-N / sound).

## The author's edit pass

- **Touch only flagged shots**, plus any shot a fix forces to move (a re-staging that splits a chain).
- **Rewrite in discipline:** a fixed shot must still satisfy SKILL Step 2 end-to-end (class → invent →
  vocabulary names → facts → chain) — don't patch a word, re-derive the shot.
- **Reject with a reason:** a finding you disagree with goes to the run summary with one line of why.
- **Re-run `lint_shots.py --write`** — edits can break anchors/order; the lint is the floor.

Without subagents available, run the charter as a deliberate separate fresh re-read (close the authoring
context first); a real subagent is preferred — the fresh context is the whole point. The critic is
**subtractive by design**. If it starts flattening staging variety or demanding encyclopedic prompts,
loosen its "never flag" list — do not add more questions.
