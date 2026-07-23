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

## Runtime identity is more than an environment refresh

### Context
- The dashboard process needed to move from a primary checkout to an isolated reviewed checkout, and the first audit proposed `pm2 startOrRestart <config>`.

### Root Cause / Core Insight
- PM2's `startOrRestart` restarts an existing same-named application and refreshes environment, but it does not replace the stored `pm_exec_path` or `cwd`; HTTP 200 and even correct feature behavior therefore do not prove which checkout is serving.

### The Pattern (transferable)
- Next time a supervised process must move between source checkouts, I will inspect the supervisor's stored script path/cwd and use a delete-plus-start transition when identity must change, followed by path/cwd and endpoint verification.
- Signal to recognize: a restart command accepts a new config path while the process name already exists.

## Code/data alignment is a deployment invariant

### Context
- Reviewed dashboard source and `dist` were ready, but the configured `ops` worktree still lacked six main-authored daemon-read files, including the four FYT declarations and `video-run` parameters.

### Root Cause / Core Insight
- The daemon loads code from one checkout and canonical workflow/agent data from another; validating either revision alone misses byte-CAS failures and stale registry projections at their boundary.

### The Pattern (transferable)
- Next time a daemon projects Git data from a separate branch/worktree, I will verify the complete source-plus-data revision pair before restart and use the generic mirror mechanism rather than patching one observed file.
- Signal to recognize: runtime configuration names a repo/data root different from the checkout containing the server code.

## Session handoff 2026-07-22 (post-restart alignment)

**Topic:** Align the FYT dashboard to reviewed PR #69, provision its durable workspace, and determine the safe restart boundary.

### What WORKED (with evidence)

- **Sandbox recovery** - `python scripts/preamble.py`, ordinary `Get-Content`, and a create/delete `apply_patch` probe all succeeded after restart.
- **Reviewed checkout/build** - `C:/Users/danie/kb/_private/codex-worktrees/fyt-dashboard-alignment` is exactly `e07ea841249353c0ef8de2e91d1724d3ef0c39d7`; TypeScript typecheck and Vite production build passed. Its dependency lock is byte-identical to the primary checkout's lock, and its ignored `node_modules` junction points to that matching installation.
- **Verification** - focused FYT registration/segment/activation tests passed 37/37; environment and assignment-resolver tests passed 15/15; `tests/test_sync_daemon_dirs.py` passed 23/23 with a workspace-local pytest base temp; the full dashboard suite passed 2,055 tests with 2 skipped across 200 files, serially.
- **Durable root** - provisioned `C:/Users/danie/kb-worktrees/dashboard-durable` as a clean, distinct Git worktree on `claude/m1-dashboard`, exactly at `e07ea841`; it does not alias `dashboard-ops` or `DASHBOARD_STATE_ROOT`.
- **Generic ops reconciliation prepared** - PR #72's branch now contains a six-file `agents/**` + `orgs/*/workflows/**` mirror from `origin/main`. Every staged/committed blob was proven identical to `origin/main`; this resolves all current daemon-read drift once merged.
- **Independent iteration** - three lower-model audits were rerun after the ops drift was found. They converged on NO-GO for restart before the mirror merges and corrected the PM2 transition from `startOrRestart` to delete-plus-start.

### What Did NOT Work (and why)

- **Initial dependency junction command** - it was run from inside `dashboard/` with a redundant `dashboard/node_modules` path, creating a scratch nested junction and leaving tools undiscoverable. The exact junction and empty parent were removed, then the link was recreated correctly as `dashboard/node_modules`.
- **First mirror pytest run** - 22 fixtures failed before test bodies because pytest selected owner-only `C:/Users/danie/AppData/Local/Temp/pytest-of-danie`. Re-running with `--basetemp .pytest-tmp-sync` passed all 23 tests.
- **Immediate PM2 restart** - deliberately not performed: `origin/ops` is stale for six dynamically read declarations/workflows, and deploying reviewed code against that state would be a mismatched code/data pair. Also, PM2 `startOrRestart` cannot retarget the stored script path/cwd.
- **GitHub PR query** - `gh pr view 72` returned HTTP 401 in this session; PR existence/state is inferred from the supplied URL plus the still-unmerged remote branch and `origin/ops` ancestry.

### What Has NOT Been Tried Yet

- Human review/merge of updated PR #72, then pulling `origin/ops` into `dashboard-ops` and running `python scripts/sync_daemon_dirs.py --check` without `--prune`.
- Deleting the existing PM2 app and starting the absolute `fyt-dashboard-alignment/dashboard/pm2.config.cjs`, followed by script-path/cwd, `/healthz`, `/api/index`, `/api/workflows`, `/api/agents`, and SPA verification, then `pm2 save`.
- Any authenticated durable save or assignment amendment. Before such a test, resolve or explicitly approve the daemon identity/work-branch mismatch: the durable route is hard-coded to `claude/m1-dashboard`, while the current Git identity is `codex-worker` and worker rules require Codex work on `codex/*` branches.
- Any live FYT execution, binding, paid stage, or publish. The four declarations remain `runner-bound: false`; activation, G1/G2, a paid-stage queue card with spend ceiling, and G3/T3 publish approval remain human gates.

### Current State of Files

| File / path | Status | Notes |
| ---- | ------ | ----- |
| `codex/session-handoff-2026-07-22` / PR #72 | WIP / HUMAN GATE | Contains prior handoff plus commit `da3d31a`, the exact generic daemon mirror; final memory/ledger commit follows. |
| `C:/Users/danie/kb/_private/codex-worktrees/fyt-dashboard-alignment` | DONE / READY | Reviewed source, built `dist`, matching dependency junction, full suite green; scratch audit notes were consolidated here and removed. |
| `C:/Users/danie/kb-worktrees/dashboard-durable` | DONE / INSPECTION-ONLY | Clean worktree on `claude/m1-dashboard` at `e07ea841`; no save exercised. |
| PM2 `kb-dashboard` | ONLINE / OLD PATH | Still serves `C:/Users/danie/kb/dashboard/server/pm2Entry.ts`, zero restarts at last inspection. Intentionally not changed before ops alignment. |
| `C:/Users/danie/kb-worktrees/dashboard-ops` | TODO AFTER MERGE | Pull PR #72 after human merge, then prove daemon-directory parity. |

### Exact Next Step

Have a human review and merge PR #72 into `ops`. In the owner session, pull `origin/ops` into `C:/Users/danie/kb-worktrees/dashboard-ops` and run the main-copy `scripts/sync_daemon_dirs.py --check` against that worktree. Only if it is clean, verify `DASHBOARD_EXECUTION_ACTIVATED` is not `1`, run `pm2.cmd delete kb-dashboard`, then `pm2.cmd start C:/Users/danie/kb/_private/codex-worktrees/fyt-dashboard-alignment/dashboard/pm2.config.cjs --only kb-dashboard`; confirm PM2's stored script path/cwd and the HTTP/API probes before `pm2.cmd save`. Do not exercise a durable save or live FYT run during this alignment.

## Session handoff 2026-07-22 (dashboard alignment completed)

**Topic:** Complete the post-merge ops synchronization, move PM2 to the reviewed dashboard build, and persist the verified process.

### What WORKED (with evidence)

- **Coordination merge** - `dashboard-ops` fast-forwarded to `467b86a38c76009770b93d46c1f23005cdd41227`, which contains PR #72 commit `2208aef`; its tracked worktree remained clean.
- **Code/data parity** - the reviewed main-copy `sync_daemon_dirs.py --check` reported `clean - ops matches main for all daemon-read dirs` against `C:/Users/danie/kb-worktrees/dashboard-ops`.
- **PM2 retarget** - delete-plus-start moved `kb-dashboard` to `C:/Users/danie/kb/_private/codex-worktrees/fyt-dashboard-alignment/dashboard/server/pm2Entry.ts` with the matching dashboard cwd; PM2 reported online with zero restarts.
- **Safety and API state** - `DASHBOARD_EXECUTION_ACTIVATED` was absent before and after the switch; `/healthz`, `/api/index`, `/api/workflows`, `/api/agents`, and `/` returned 200, while unauthenticated `/api/control/runs` returned the expected 401.
- **FYT projection** - the live API exposed valid, launchable `video-run` with 14 stages and `channel`/`slug`; `fyt-runner`, `fyt-preproduction`, `fyt-production`, and `fyt-checker` were all declared with no declaration problem and `runnerBound=false`.
- **Persistence** - `pm2 save` completed successfully and wrote the current one-process resurrection list to `C:/Users/danie/.pm2/dump.pm2`.

### What Did NOT Work (and why)

- **PM2 JSON through PowerShell** - `pm2 jlist | ConvertFrom-Json` failed because PM2 includes both `username` and `USERNAME`, which PowerShell treats as duplicate case-insensitive dictionary keys. A filtered `pm2 env 0` capture verified only the activation field without exposing the environment.
- **First semantic assertion** - it assumed workflow parameters were objects with `.name` and `/api/agents` returned `{items: [...]}`. The actual public schemas are string parameters and a top-level agent array; after inspecting keys, corrected assertions passed.
- **Visual browser smoke** - the browser runtime reported no available browser backends. No unrelated automation substitute was used; the built SPA and semantic HTTP/API checks remain the available evidence.

### What Has NOT Been Tried Yet

- An authenticated, visual click-through of the Agents and Workflows pages in a connected browser.
- Any authenticated durable save or assignment amendment; the `codex-worker` identity versus hard-coded `claude/m1-dashboard` durable route still needs a reviewed policy/design decision first.
- Any FYT binding, live execution, paid API stage, or publish. All prior human gates remain intact.

### Current State of Files

| File / path | Status | Notes |
| ---- | ------ | ----- |
| `C:/Users/danie/kb-worktrees/dashboard-ops` | DONE | Clean at merged ops `467b86a`; daemon-read parity passed. |
| `C:/Users/danie/kb/_private/codex-worktrees/fyt-dashboard-alignment` | LIVE / VERIFIED | Reviewed `e07ea841` source and build now serve port 5317. |
| `C:/Users/danie/kb-worktrees/dashboard-durable` | READY / INSPECTION-ONLY | Clean at `e07ea841`; no durable write attempted. |
| PM2 `kb-dashboard` | DONE | Online at reviewed path, zero restarts, activation absent, resurrection list saved. |
| `codex/dashboard-alignment-final-handoff` | WIP / COORDINATION PR | Contains only this memory addition and the final zero-cost ledger row. |

### Exact Next Step

Open and merge the `codex/dashboard-alignment-final-handoff` coordination PR into `ops`; no dashboard-alignment work remains after that. Before any live FYT run, the human must next approve the assignment/review/completion-gate semantics and runner bindings, resolve the durable-save branch/identity policy, and separately authorize any paid stages. Publishing remains its own T3/G3 decision.

## Session lesson 2026-07-22 (OAuth gate retirement and branch pruning)

- High-level operational evidence is enough to retire a credential gate without reading credential
  stores: the protected-main Poyais publish record plus MCP health proved the uploader gate.
- Do not overstate auth completion. The legacy Google Workspace MCP failed its health probe and the
  analytics bootstrap lacked a durable completion record, so their cards were retired at the
  operator's direction with explicit non-attestation notes.
- Coordination branches may lag card-state infrastructure on `main`; validate moved cards against
  the target branch's own `scripts/cards.py`. `ops` did not yet accept `archived`, so `done` was the
  compatible terminal state.
- `git branch -d` compares against current HEAD. For branches integrated into a different base,
  first prove `git merge-base --is-ancestor <branch> <intended-base>`, then delete only that exact
  proven ref. Every Poyais worktree/ref was excluded from cleanup.

