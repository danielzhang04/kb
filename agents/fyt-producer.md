---
id: fyt-producer
role: manager
runtime: claude
model: claude-opus-4-8
runner-bound: false
status: superseded
description: SUPERSEDED 2026-07-20 by agents/fyt-runner.md. Do not dispatch this agent.
---

# fyt-producer — SUPERSEDED

**Superseded by [`agents/fyt-runner.md`](fyt-runner.md) on 2026-07-20**, per the synthesis spec
`orgs/faceless-youtube/docs/superpowers/specs/2026-07-20-fyt-runner-synthesis-design.md` (Part 3).

The fyt-run-001 postmortem ordered "rewrite `agents/fyt-producer.md` to encode gates rather than
commands." The FYT Runner IS that rewrite: same conductor role, now organized around the gate spine
(three human gates + the mechanical gates between them), with the `image-review` DAG node, the third
`review_status` state (`parked`), the post-render tail (thumbnail → compliance → shot board → publish
→ analytics), and everything fyt-producer learned (R1–R12, single-writer staging, spend rules, resume
discipline) carried forward.

**Do not dispatch this agent.** Dispatch `fyt-runner` instead.

The full original text (13-stage command-first conductor) is preserved in git history at commit
`f0c73cb^` — restore with `git show f0c73cb^:agents/fyt-producer.md` if you need the old body.
