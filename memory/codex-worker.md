# Codex worker memory

## 2026-07-22 — FYT autonomous runner and dashboard control plane

- Worked: resumed the existing `codex/fyt-autonomous-runner` worktree from the FYT pickup, kept each implementation checkpoint isolated, and required independent GO/NO-GO review before commit.
- Worked: persisted canonical review generations, durable creator/checker loops, the T3 completion-gate resolver, agent-workspace launches, immutable assignment projections, and governed assignment amendments. The amendment path now uses exact source CAS, a distinct durable worktree, exact work-branch proof, conservative byte patching, restart-persistent pending state, and server-side launch refusal until the proposed source is canonical.
- Worked: added direct-checkout, no-spend FYT acceptance for `video-run` plus all four segment source contracts. The tests parse/compile without evaluating segment bodies and pin the complete 14-stage DAG, paid guards, independent image review, and no-publish boundary.
- Verification: dashboard suite passed with one worker (200 files; 2,000 passed; 2 skipped), TypeScript typecheck passed, focused FYT acceptance passed 98/98, and `python scripts/preamble.py` passed.
- Failed/lesson: the default parallel Vitest run repeatedly timed out one filesystem-heavy `control/store` case at 5 seconds; the case passed alone and the complete suite passed serially. Do not weaken the test to hide Windows filesystem contention.
- Failed/lesson: the first amendment draft aliased live/durable roots, kept pending state only in React, and trusted indentation-only YAML patching. Independent adversarial review caught those P0s before commit; persist safety state server-side and verify exact parsed semantic deltas.
- Preserved: user-owned `.playwright-mcp/`, `acceptance.sh`, and both existing video asset trees were never staged or modified.
- Remains human-gated: merge the large work-product PR; merge this coordination PR to `ops`; bind the four FYT declarations; approve exact assignment/review/gate semantics; set `DASHBOARD_EXECUTION_ACTIVATED=1` only in a watched session; approve G1; and record a queue-card spend ceiling before images/voiceover. Publishing remains a separate T3/G3 decision.

