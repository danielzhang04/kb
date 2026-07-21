---
id: 6a5ec41c-caabe932
project: atlas
action: dashboard Atlas view + global mini-orb
target: dashboard/src/views/Atlas.tsx
risk-tier: T2
owner: claude-boss@agents.local
claim-token: 4b80de47ce1004ed
state: done
approval: null
workflow: atlas-v1
depends-on: []
variant-group: null
role: work
session-id: null
runtime: claude
model: opus
---

## Work order
Per docs/plans/2026-07-20-atlas-v1-plan.md Task 8 (branch claude/atlas). Deliverable = the task contract in the plan; TDD; commit locally, never push.

## Result
Delivered on claude/atlas commit 87552c2 (worker: Opus 4.8 subagent, model self-reported claude-opus-4-8, orchestrator-verified).
- src/lib/useAtlasState.ts: single refcounted module-singleton poller (~1s visible, pauses on document.hidden, SSE-tick refetch) feeding both consumers; deriveWorker normalizer.
- src/views/Atlas.tsx + styles/views/atlas.css: big orb (OFFLINE dashed hollow + last-seen, ASLEEP faint, LISTENING 3.4s breathe, THINKING conic shimmer, SPEAKING 1.1s pulse; brightness/motion only, no state hues; prefers-reduced-motion honored), live transcript in Timeline idiom, activity history, cards table.
- src/components/AtlasMiniOrb.tsx: shell-level corner orb on every non-Atlas view, hidden ASLEEP/OFFLINE, click -> Atlas view.
- nav atlas soon->live (IA amendment per V1 design); Sentinel LayerPanels down to 3 tabs; stub views/panels/Atlas.tsx DELETED, grep-proof no dangling refs.
- New component/unit tests + 6 existing tests updated to the contracted promotion. Full suite: 182 files / 1551 passed; typecheck clean; build clean.
- Gate A live desk check deliberately outstanding (worker /state landed in parallel); daemon-deploy note: pm2/5317 runs pre-branch code — gate uses a dev daemon from the worktree.
