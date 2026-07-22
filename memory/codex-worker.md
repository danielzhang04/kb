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
- Final integration: merged current `origin/main` into the feature branch after PR conflict detection. Six textual conflicts were split across three independent agents; the resolution preserved both main's read-scope/no-Bash work and this branch's assignments/reviews/completion gates. Post-merge dashboard verification passed 2,055 tests with 2 skipped plus typecheck.
- Review gates opened: work product PR #69 targets `main`; coordination PR #68 targets `ops`. Neither was merged by Codex.

## 2026-07-22 — Automated income project portfolio deep dive

- Worked: recovered two unmerged 2026-07-21 portfolio research branches, preserved both DRAFT inputs, and synthesized the requested top-eight commercial analysis on `codex/new-projects-deep-dive` without moving or modifying `main`.
- Worked: delegated models 1–3, 4–6, and 7–8 to three `gpt-5.6-terra` research agents, then used a separate adversarial review and re-review before committing the report.
- Key lesson: the ranked list was not eight independent projects. Models 1/2/4/6 form one decision-data property; model 7 is its retention channel; model 5 is a gated surface; model 8 is a capital-entry strategy. Revenue ranges must be explicitly non-additive.
- Key recommendation: validate one calculator-led decision property and one commercially specific media-licensing catalog under a combined 120-hour/$2.3k first-90-day cap; defer app work and acquisition diligence until the day-90 gates.
- Verification: preamble passed; local Markdown links resolved; no placeholders or trailing whitespace; Git diff check passed; adversarial re-review returned SHIP; work branch pushed at `43f1660`.
- Preserved: user-owned `.tmp/` contents and `orgs/faceless-youtube/.claude/settings.local.json` were never staged or modified.
- Remains human-gated: review/merge the work-product branch and this coordination branch; select the decision niche before any implementation or spend.

