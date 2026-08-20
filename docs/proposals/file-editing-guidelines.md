# Proposal: fleet-wide file-editing guidelines

**Status:** PROPOSAL — requires human ratification; this document does not change live policy.
**Built:** 2026-08-18, Agent Platform Wave 1, unit U13.
**Ratification:** Open question for the human: should this become an extension to
`governance/agent-rules.md` or a standing standard under `docs/`? Committer: human.

## Purpose and scope

These are editing norms for every kb agent, whether interactive, delegated, or scripted.
They turn the build discipline in the Wave-1 plan into a shared standard: make the smallest
coherent change that belongs to the existing system. They complement the dispatch rules in
[subagent governance](subagent-governance.md); branch, card, and autonomy rules remain in
`CLAUDE.md` and `governance/card-schema.md`.

## Hard boundaries

- `governance/**` and the root constitution files (`CLAUDE.md`, `BOSS.md`, `AGENTS.md`, and
  `GEMINI.md`) are human-edited only and hook-blocked. Agents must not edit them.
- `evals/**` and `evals/MANIFEST.sha256` are human-promoted only. Any agent diff touching either
  is a violation; `py -3 scripts/canary.py --diff-guard` detects it.
- Tests are never deleted or weakened. A passing result must preserve the acceptance bar rather
  than bypassing it.

These boundaries from `governance/agent-rules.md` §8 apply before any advice to remove stale
material or keep files slim.

## Read before writing

Before changing a file, read the file, its relevant neighbors, and its tests. Establish the
local idiom for naming, structure, error handling, and test style. Then preserve behavior
consistently across every affected file. A change must fit the owner of the behavior: revise
existing logic coherently rather than attaching a side path beside it.

## Keep the architecture singular

- Do not duplicate logic. Find and extend the subsystem that owns the concern; reuse its
  interfaces and data rather than creating a parallel implementation.
- Keep files slim. Remove obsolete information as part of a replacement only when it is safe,
  in scope, and outside the hard boundaries above; do not leave dead code, stale prose, unused
  configuration, or compatibility debris.
- Prefer the minimal diff that completes the task and matches the local idiom. Add a file only
  when a self-contained unit is the natural boundary, not to avoid understanding the existing
  design.
- Check cross-file consistency: callers, configuration, documentation, tests, and visible
  behavior must agree after the edit.
- Recommendation: write comments only for non-obvious constraints or decisions that the code
  itself cannot make clear. Comments are not a substitute for clear structure.

## Build and verify

Use test-driven development where the work has executable behavior: write or adjust the test
first, then implement the smallest change that passes. A unit is not complete until its relevant
tests pass and its runnable demonstration or acceptance command works. Never delete, weaken,
bypass, or lower the expectation of a test merely to make a change pass.

For documentation-only work, verify links, headings, examples, and stated procedures against
their source material instead of inventing an equivalent test claim.

## Work safely with other editors

Parallel workers receive disjoint file sets. Shared integration points — such as routing,
navigation, manifests, registrations, and global configuration — are edited once by a named,
serial owner or merged through an isolated worktree. Do not make opportunistic shared-file edits
outside the assigned scope; surface the needed integration as an integration request. An
integration request asks the named serial owner to make a scoped shared-file change; it is not a
session handoff.

Recommendation: before writing, re-check the target file when another worker may have changed
it. Resolve collisions by preserving the owner subsystem and its tests, not by layering duplicate
logic.

## Related sources

This proposal generalizes `docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md` §3 and the
boss-session direction in `BOSS.md`. Its hard boundaries come from
`governance/agent-rules.md` §8 and `scripts/canary.py --diff-guard`. Dispatch, independent
review, retry, and decision rules are proposed separately in
[subagent governance](subagent-governance.md). Human-ratified constitutional and card
requirements continue to live in `CLAUDE.md` and `governance/card-schema.md`.

