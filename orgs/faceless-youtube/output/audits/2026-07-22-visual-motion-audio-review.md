# Visual, Motion, and Semantic-Audio Review — 2026-07-22

## Review status

Complete. Read-only audit of `8243553`, `8ea2f3d`, and `c0f064c` against design `5857709`, with `5c901947` as base and `6dd5dfa` as supplied integration head. No production, decision, handoff, card, ledger, or artifact files were changed.

## Review plan

1. Read binding project context, the live skill registry/design rules, latest handoffs, the approved design, and channel DNA/tokens.
2. Enumerate each scoped commit and read every changed implementation and test file in full, then trace validators, builders, schemas, engine callers, and legacy paths.
3. Run only focused local Python tests and a non-network TypeScript check if available; record exact results.
4. Apply the finding gate and finish with requirement mapping, severity-ordered findings, verdict, and smallest infrastructure-level fixes.

## Initial repository evidence

- `python scripts/preamble.py`: passed (`PREAMBLE OK`).
- Integration worktree was clean at `cb37cb6` (a handoff commit following supplied head `6dd5dfa`).
- `git diff --check 5c901947...6dd5dfa` found two trailing-whitespace lines in the newly added design document (`docs/superpowers/specs/2026-07-22-engagement-overhaul-design.md:3-4`). This is documentation hygiene outside the requested implementation/test finding lane; it is not treated as a release finding.
- A non-mutating `git merge-tree` could not complete because the sandbox identity has no permission to add objects to the shared repository object database. This is an infrastructure limitation, not a detected merge conflict.

## Findings (preliminary; evidence complete)

### HIGH — A normal opaque card can pass without its required authored pause

- **Kind:** design noncompliance / correctness regression.
- **Locations:** `.claude/skills/render-builder/scripts/build_motion.py:310-347`, specifically `apply_cards()` accepts any co-located merged gap; `.claude/skills/render-builder/scripts/breath.py:214` emits automatic `source: "sentence"` gaps at an incoming sentence's first word.
- **Trigger:** A motion plan contains a normal `cards[]` entry anchored to the first word after a sentence break, but `audio-plan.json` contains no `kind: "pause"` at that anchor. The universal sentence-gap law produces a `{"at_s": <anchor>, "dur_s": ..., "source": "sentence"}` gap.
- **Bad outcome:** `_colocated_gap()` selects that automatic gap solely by time and returns its duration; `apply_cards()` emits the opaque card rather than failing. This bypasses the design's mandatory authored, same-anchor pause for normal cards and can give the card only the automatic sentence breath rather than its deliberately authored hold.
- **Inspected guard/context:** The design requires a normal card to hard-fail without a co-located audio-director pause (`docs/superpowers/specs/2026-07-22-engagement-overhaul-design.md:329-336`). The motion schema repeats that `audio-director` authors the pause and that no co-located pause is a hard failure. `merge_gaps()` deliberately labels a pure automatic boundary `source: "sentence"`; `apply_cards()` does not require `source == "cue"` or otherwise prove an authored pause. Existing test coverage only exercises a `source: "cue"` success and an empty-gap failure, so it misses this bypass.
- **Smallest infrastructure fix:** Make the card lookup accept only a co-located gap whose merged source is `"cue"` (or pass/retain explicit authored-pause identity), and add a focused regression test with a same-anchor `source: "sentence"` gap asserting `SystemExit`.

## Requirement mapping

| Requirement | Evidence reviewed | Result |
| --- | --- | --- |
| 2–5s new-video visual cadence; `runtime / 5`; long-hold reason | `visual-prompt-writer/scripts/lint_shots.py:53-54,140-162`; schema/skill/critic changes; 17 focused tests | Implemented. The linter keeps this as a floor plus explicit reason, while critic guidance avoids a new quota taxonomy. |
| Baseline-life opt-in, both scene and layered paths; legacy unchanged | `render-builder/scripts/build_motion.py:103-114,188-259`; `engine/src/Video.tsx:70-93`; `engine/src/tokens.ts:132-137`; channel token block | Implemented. Absent/false returns the original token object and legacy layers receive no `baseline_life` marker. |
| Supported cutout layers, stills-first identity, stage-start push/pull only | motion-plan validation/lineage and planner rules; `motion_plan.py:113-160`; `build_motion.py:77-114,202-238,604-629` | Implemented. No layer quota or camera derivation was added; later-stage declarations are rejected. |
| Opaque/static cards require an authored co-located pause | `build_motion.py:262-348`; `breath.py:214,304-332`; plan/schema/skill contracts | **Not met:** the HIGH finding above shows an automatic sentence gap is accepted as the required pause. Cards otherwise remain opaque/static. |
| Semantic coverage without rates/schema ledger; no automatic cue insertion | audio-director procedure/critic; `audio_plan.py:43-107`; `build_audio.py:92-129,315-479`; audio schema | Implemented. Four cue kinds stay intact; QA is derived and no cue is inserted. |
| Authored-versus-resolved QA; unresolved/silent drops visible | `audio_plan.py:43-107`; `build_motion.py:630-686`; `audio_checker.py:169-184,219-227` | Implemented. The default bed is excluded from authored/resolved counts and presence is separately reported. |
| Music through consequence; rare line-specific dry | audio-director skill/critic/grammar and `build_audio.py:121-129,315-340` | Implemented. `register_audio()` remains a no-op; only authored dry spans carve a bed. |

## Focused verification

All commands ran locally from `C:\Users\danie\kb` against the specified worktree. No render, media generation, network, or production artifact operation was run.

```text
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\visual-prompt-writer\scripts\test_lint_shots.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\motion-planner\scripts\test_lint_motion_plan.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_motion_plan.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_motion_plan_merge.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_build_motion.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_audio_plan.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_audio_checker.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_shorts_gap_skip.py
```

- Passed: 94 focused assertions/tests (17 visual lint, 17 motion-plan lint, 19 motion-plan validator, 11 plan merge, 12 build-motion, 5 audio-plan, 10 audio-checker, 3 shorts-gap).
- Skipped: 3 audio-checker acoustic tests because `ffmpeg` is not on `PATH`; all non-acoustic checks in that file passed.
- TypeScript attempted without downloading tools: `tsc --noEmit` from `.claude/skills/render-builder/engine`; skipped because no local compiler and no `tsc` on `PATH`.
- Manual no-write reproducer: a card with no audio-plan pause and a co-located `{"source":"sentence"}` gap emitted `{'type':'chapter-card', 'at_s':0.35, 'dur_s':0.65}` instead of raising. This confirms the finding's runtime path.

## Review scope and notes

- Read design `5857709`, implementation commits `8243553`, `8ea2f3d`, and `c0f064c`, plus their caller/schema/engine contracts at supplied integration head `6dd5dfa` (worktree `cb37cb6` only adds the resume handoff).
- Read changed implementation and test surfaces for visual-prompt-writer, motion-planner, render-builder motion/audio schemas and scripts, engine `Video.tsx`/`tokens.ts`, audio-director, Second Take DNA, and motion tokens, alongside the latest handoff/status, project operating law, decision log, and live skill-registry rules.
- `git diff --check 5c901947...6dd5dfa` reports only two trailing-whitespace lines in the newly added design doc. It is outside this implementation/test finding lane and is not counted as a release finding.
- Merge simulation was not available: `git merge-tree` could not add an object to the shared repository object database under the sandbox identity. No conflict was reported.

## Pre-fix technical lane verdict — REQUEST CHANGES

One required card/audio contract is bypassable in a normal, expected input state. The smallest infrastructure-level correction is confined to `apply_cards`: distinguish an authored pause gap from an automatic sentence-rhythm gap, reject the latter for a normal opaque card, and cover that exact state in `test_motion_plan_merge.py`. With that guard in place, the reviewed visual cadence, opt-in motion, semantic audio, QA, and legacy-preservation paths are otherwise technically ready for the human feel gate.

## Post-fix verification — 2026-07-22

### Reviewed fix

- `.claude/skills/render-builder/scripts/build_motion.py:310-323` now accepts a normal card's co-located gap only when its source is `"cue"`; a pure automatic `"sentence"` gap returns `None` and the existing hard failure at lines 346-353 applies.
- The source check intentionally uses `g.get("source", "cue")`. This retains compatibility for legacy gap dictionaries that predate source tagging, while current automatic sentence gaps are explicitly tagged `"sentence"` by `breath.py:214`.
- `breath.py:304-332` preserves the required cue-plus-sentence stacking invariant: a merged gap is `"sentence"` only when every contribution is automatic; any authored pause sets `"cue"` and keeps the summed duration.
- `.claude/skills/render-builder/scripts/test_motion_plan_merge.py:128-142` adds the missing regression: a same-anchor pure sentence gap must raise rather than authorize an opaque card. The existing card success test continues to cover a cue-marked merged gap.

### Verification performed

```text
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_motion_plan_merge.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_build_motion.py
py -3 C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume\orgs\faceless-youtube\.claude\skills\render-builder\scripts\test_shorts_gap_skip.py
```

- Passed: 27 focused tests (12 motion-plan merge, 12 build-motion, 3 shorts-gap).
- Direct no-write stack check: `merge_gaps([{sentence: 0.5s}, {cue: 2.0s}])` returned one `{"dur_s": 2.5, "source":"cue"}` gap; `apply_cards()` rendered the corresponding 2.5-second card window.
- Direct no-write compatibility check: a legacy co-located gap without a `source` key still produced its expected card window, matching the pre-tagged cue behavior.
- No new finding met the concrete issue gate.

## Revised technical lane verdict — READY

The HIGH card/audio bypass is resolved: automatic sentence rhythm alone cannot authorize a normal opaque card, whereas an authored cue (including a cue-plus-sentence merged gap) still authorizes the full co-located silence. Legacy untagged cue-gap behavior remains compatible. The lane remains subject to the existing human feel gate.
