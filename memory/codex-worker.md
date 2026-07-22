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

## Session handoff 2026-07-22

**Topic:** Recover the FYT autonomous-runner terminal, verify the completed control plane, and start the local dashboard before a Windows sandbox restart.

### What WORKED (with evidence)

- **Recovered plan status** - branch history confirms canonical generation durability, durable review-loop execution, completion-gate resolution, Composer-backed agent workspaces, immutable workflow assignments, governed assignment amendments, and no-spend FYT registration were already committed.
- **Merge status** - GitHub CLI confirmed PR #69 merged to `main` at `2026-07-22T18:17:45Z`, merge commit `e07ea841249353c0ef8de2e91d1724d3ef0c39d7`.
- **Focused verification** - the 18-file runner/workspace/workflow suite passed 350 tests with 1 skipped.
- **Full verification** - the dashboard suite passed 2,055 tests with 2 skipped; TypeScript typecheck and `git diff --check` passed.
- **Preservation** - the FYT runner worktree still showed only the four pre-existing user-owned untracked paths named in the pickup; none were modified or staged.
- **Dashboard startup** - PM2 launched `kb-dashboard` with zero restarts. `http://localhost:5317/` and `/api/workflows` both returned HTTP 200; the API listed one workflow.

### What Did NOT Work (and why)

- **Three lower-model audit agents** - each stopped before inspection because mandatory preamble execution hit `windows sandbox: helper_unknown_error: apply deny-read ACLs`; escalation was denied or timed out. They made no repository changes.
- **Built-in `apply_patch`** - failed on the same Windows ACL helper while applying deny-read ACLs. This was not a repository permission failure.
- **First coordination attempt** - its temporary worktree was clean and removed after the built-in patch failed; no debris or unique commit remained.
- **Dashboard source alignment** - PM2 started `C:/Users/danie/kb/dashboard/server/pm2Entry.ts`; that checkout is `codex/new-projects-deep-dive`, not merged `main`. HTTP 200 proves availability, not that the served UI contains PR #69.
- **Durable Composer root** - `C:/Users/danie/kb-worktrees/dashboard-durable` was absent. The server came online, but durable-save behavior was not tested.

### What Has NOT Been Tried Yet

- Restarting the sandbox and confirming normal sandboxed reads and built-in `apply_patch` work again.
- Opening the dashboard manually and checking the FYT Agent/Workflow surfaces.
- Launching the dashboard from a reviewed checkout containing merge commit `e07ea841...`, with a matching `dashboard/dist` build.
- Provisioning and verifying the distinct `dashboard-durable` worktree.
- Any live FYT acceptance. It remains gated by `runner-bound: false`, watched `DASHBOARD_EXECUTION_ACTIVATED=1`, approved assignment/review/gate semantics, Daniel's G1 decision, and per-run paid-stage authorization. Upload remains a separate T3/G3 leg.
- `pm2 save`; the process is running now, but its resurrection list was not persisted this session.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/faceless-youtube/docs/handoffs/2026-07-21-fyt-autonomous-runner-pickup.md` | DONE / STALE NEXT STEP | Its engine checkpoints were subsequently completed. Keep as history. |
| `orgs/faceless-youtube/docs/handoffs/2026-07-22-dashboard-registration-acceptance.md` | DONE | Current no-spend evidence and authoritative human blockers. |
| `memory/codex-worker.md` | DONE | This appended section is the current resume record. |
| FYT runner implementation files | DONE | Merged through PR #69; unchanged in this recovery session. |
| `dashboard/dist/` in the primary checkout | UNVERIFIED REVISION | It served HTTP 200, but its source revision was not tied to PR #69. |

### Exact Next Step

After restart, run `python scripts/preamble.py` from `C:/Users/danie/kb`; read `CLAUDE.md`, `governance/agent-rules.md`, this memory section, the FYT contract/router/operating law, and the 2026-07-22 acceptance handoff. Confirm normal sandboxed `Get-Content` and built-in `apply_patch` work. Before reviewing new dashboard functionality, run `pm2.cmd show kb-dashboard`, verify its serving checkout contains PR #69, and deliberately restart from a reviewed checkout/build if it does not. Do not enable live execution or paid stages during alignment.

