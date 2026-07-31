---
id: fyt-production
role: work
runtime: claude
model: claude-fable-5
runner-bound: false
status: superseded
description: SUPERSEDED 2026-07-30 by agents/fyt-visuals.md + agents/fyt-audio-render.md. Do not dispatch this agent.
---

# fyt-production — SUPERSEDED

**Superseded by [`agents/fyt-visuals.md`](fyt-visuals.md) (image-gen) and
[`agents/fyt-audio-render.md`](fyt-audio-render.md) (voiceover/audio-plan/render), on 2026-07-30**,
per `docs/specs/2026-07-30-fyt-gated-pipeline-design.md`. The old codex-worker production cut bundled
paid image generation with audio and render under one bounded worker; the new roster splits visuals
from audio+render so each phase drives its own skills end to end.

**Do not dispatch this agent.** Dispatch `fyt-visuals` or `fyt-audio-render` instead.

The full original text is preserved in git history — restore with
`git show b17a00e:agents/fyt-production.md` if you need the old body.
