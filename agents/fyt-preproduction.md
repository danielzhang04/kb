---
id: fyt-preproduction
role: work
runtime: claude
model: claude-fable-5
runner-bound: false
status: superseded
description: SUPERSEDED 2026-07-30 by agents/fyt-story.md + agents/fyt-visuals.md. Do not dispatch this agent.
---

# fyt-preproduction — SUPERSEDED

**Superseded by [`agents/fyt-story.md`](fyt-story.md) (idea/research/script/shorts/metadata) and
[`agents/fyt-visuals.md`](fyt-visuals.md) (shots/motion, with image-gen), on 2026-07-30**, per
`docs/specs/2026-07-30-fyt-gated-pipeline-design.md`. The old codex-worker role/preproduction cut
mixed text and planning stages under one bounded worker with no phase ownership; the new roster owns
whole phases end to end and drives its own subagents.

**Do not dispatch this agent.** Dispatch `fyt-story` or `fyt-visuals` instead.

The full original text is preserved in git history — restore with
`git show b17a00e:agents/fyt-preproduction.md` if you need the old body.
