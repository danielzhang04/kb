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

## Merge readiness is a tree property, not a commit-label property

### Context
- The FYT handoff correctly named six engagement commits, but their consolidation branch inherited an older shorts pipeline that current `main` did not contain.

### Root Cause / Core Insight
- Reviewing only named commits proved their local intent while hiding the aggregate tree that a pull request would actually merge. Cherry-pick conflicts also carried unrelated parent context, so accepting a whole "theirs" side would have silently restored out-of-scope behavior.

### The Pattern (transferable)
- Next time I inherit a consolidation branch, I will compare `origin/main...HEAD` by changed path before calling it merge-ready; if unrelated domains appear, I will rebuild from current main and resolve conflicts from the source commit's actual delta rather than either whole side.
- Signal to recognize: the aggregate changed-path set contains owners or artifacts absent from the requirement map, even though every named feature commit looks correct in isolation.

## Session handoff 2026-07-22 (FYT engagement overhaul integrated)

**Topic:** Recover, audit, repair, isolate, and propose the six-axis FYT engagement overhaul for human review.

### What WORKED (with evidence)

- **Fresh lane review** — story/selection, voice, and visual-motion-audio agents each persisted findings and returned READY after focused infrastructure repairs.
- **Infrastructure fixes** — opaque-card pauses now require authored cues; voice marker placement and dry-run spoken-region parity are covered; blockquoted dialogue cannot bypass lint; research viability canonically controls writer/metadata promises; renderer pull intensity now affects output.
- **Clean integration** — the final work branch `codex/poyais-engagement-overhaul-final` is based on current main `03ba187`, excludes inherited shorts/publish/compliance/video-artifact paths, and is published as PR #76.
- **Verification** — independent final review is READY; 109 targeted and 411 broad local tests passed, renderer camera math passed 2/2, all nine changed skills passed structural validation, and `git diff --check` passed.
- **Durable closeout** — the live FYT status, project dashboard, consolidated audit, independent audit, and exact-next-step handoff are committed on the work branch.

### What Did NOT Work (and why)

- **Directly proposing `codex/poyais-engagement-resume`** — its aggregate diff carried an older shorts pipeline not present on current main, so it was retained only as provenance.
- **Naive clean-branch cherry-pick** — several conflicts mixed engagement changes with shorts-only context. Resolutions kept current-main behavior and replayed only the source commit's engagement delta, including dedicated engagement-only tests.
- **First independent review** — correctly requested changes after main advanced, the renderer ignored pull intensity, and current docs retained superseded creative locks. All three were repaired before the READY re-review.
- **TypeScript type-check** — not run because the isolated render engine had no local TypeScript installation and no dependency download was authorized; a dependency-free Node engine test covers the new camera math.

### What Has NOT Been Tried Yet

- Human review or merge of PR #76.
- The zero-spend Poyais baseline/cuts/life/camera comparison and selected-visual audio comparison.
- The later blind Bricks script/voice dry-run, any paid generation, full render, publication, or stale queue-card reconciliation.

### Current State of Files

| File / branch | Status | Notes |
| ---- | ------ | ----- |
| `codex/poyais-engagement-overhaul-final` / PR #76 | DONE / HUMAN GATE | Clean current-main work product; independent verdict READY |
| `orgs/faceless-youtube/docs/handoffs/2026-07-22-poyais-engagement-overhaul-final-handoff.md` | DONE | Work evidence, failures, untried steps, and exact next action |
| `orgs/faceless-youtube/output/audits/2026-07-22-engagement-overhaul-independent-final-review.md` | DONE | Fresh-context final READY review |
| `codex/poyais-engagement-resume` | SUPERSEDED FOR MERGE | Provenance only; inherited scope is intentionally excluded |
| `memory/codex-worker.md` | DONE / COORDINATION PR | This growth entry and session handoff target `ops` through a separate worker PR |

### Exact Next Step

Have a human review and merge PR #76 only if the production-logic diff is accepted, and merge the separate coordination PR into `ops`. Then execute the documented zero-spend Poyais calibration one axis at a time and return the comparisons for a human eye/ear gate. Do not begin paid generation, full rendering, publication, queue transitions, or stale-card cleanup from this handoff.

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

## Session handoff 2026-07-23 (agent-first post-merge QA)

- Verified merged `main` and `ops` exactly matched their pre-merge validation trains, then found the
  live dashboard still served the older PR #69 checkout and its ops data root lacked PR #79's FYT
  `governedBy` metadata.
- Prepared PR #80 as the standard one-file daemon mirror. The workflow blob is byte-identical to
  `origin/main`; sync-daemon tests passed 23/23. Do not retarget production until this ops PR merges
  and `dashboard-ops` passes `sync_daemon_dirs.py --check`.
- Built an isolated current-main dashboard and ran the focused agent/workflow suite (106/106), full
  dashboard suite (2,101 passed, 2 skipped), typecheck, build, and an inert port-4317 semantic smoke.
  The smoke proved four declared unbound FYT agents, two canonical system workers, the exact
  7/4/1/2 ownership map, zero executable bindings, and no pending amendment.
- A clean install exposed two newly published production dependency advisories. Both predated PR
  #79 and their vulnerable preconditions are absent, but compatible patches existed; PR #81 updates
  only the lockfile and passes `npm audit` with zero findings plus the full validation suite.
- Browser pointer QA remains untried because the connected browser runtime exposed no browser
  backend. Component tests cover node position persistence, local-only ownership drafting, and the
  single-batch/no-assignment-write boundary; no live write, launch, paid stage, or activation ran.
- Removed nine clean integrated worktrees and thirteen proven integrated/tree-equivalent local
  branches. Preserved the active old dashboard checkout for rollback, the new live candidate, both
  open-PR worktrees, daemon ops/durable roots, every dirty or unique worktree, and all Poyais assets.
- Exact next step: human merges PR #80 (`ops`) and #81 (`main`); then fast-forward `dashboard-ops`,
  move the live candidate to merged main, re-run parity/build/audit smoke, delete-plus-start PM2 from
  that checkout, verify the inert live APIs/SPA, save PM2, and only then remove the rollback checkout.

## Session closeout 2026-07-23 (agent-first dashboard live)

- PR #80 and PR #81 merged. `dashboard-ops` is clean at merged `ops`, the live source is clean at
  merged `main`, and `sync_daemon_dirs.py --check` proves all daemon-read paths match.
- Reinstalled the patched lockfile (`npm audit`: zero findings), then passed typecheck, production
  build, and the 106-test focused agent/workflow suite. The same merged tree previously passed the
  full 2,101-test dashboard suite with 2 skipped.
- Used PM2 delete-plus-start to move `kb-dashboard` from the PR #69 rollback checkout to
  `dashboard-postmerge-live` at merged main. PM2 is online with zero restarts, stores the new script
  path/cwd, and its verified process list is saved.
- Live `/healthz`, SPA, index, agents, system-workers, workflows, and video-run detail all return
  200. The served SPA exactly matches the built index. Live semantic assertions prove four declared
  unbound FYT agents, two system workers, the exact 7/4/1/2 governance map, zero executable bindings,
  no pending amendment, activation absent, and no Anthropic API key.
- Removed the old rollback checkout, both merged repair worktrees, and their integrated local
  branches. Preserved the active live source, daemon ops/durable roots, managed runtime worktrees,
  every dirty or unique checkout, and all Poyais assets.
- No live launch, ownership submission, assignment amendment, external spend, upload, or publish was
  attempted. The only remaining acceptance item is a human visual pointer-drag check because this
  terminal had no connected browser backend.

## Session checkpoint 2026-07-24 (accepted-run Resume deployed; live click pending)

- Corrected the supplied resume path to the Git-registered worktree
  `C:/Users/danie/kb/_private/codex-worktrees/dashboard-resume-accepted-run` and read its binding
  handoff. PR #89 was already human-merged: refreshed `origin/main` is merge commit `a6fea53` and
  contains implementation `649c9f7` plus handoff `3ef2ce4`.
- Verified `dashboard-postmerge-live` was clean and fast-forwardable, advanced it from `b7c772e` to
  `a6fea53`, and passed dashboard typecheck and production build. The only build note was the known
  chunk-size advisory.
- Confirmed PM2 already stored the deployment worktree's exact script path/cwd. Used plain
  `pm2 restart kb-dashboard` without `--update-env`; `kb-dashboard` and the independent
  `atlas-worker` remained online. `/healthz`, `/`, and `/api/index` returned 200. The error log's
  last write was 2026-07-23 23:24, before this deployment; the output log recorded the fresh
  2026-07-24 13:40 listen event.
- Read-only durable preflight found the exact stranded run unchanged and Resume-eligible:
  `run-87d8aef2-f78b-4e78-ba00-323c67cc8fc6`, proposal
  `proposal-82000862-688a-4570-b713-8ccae2d8dfa8`, hash
  `d33265bf6d55c4455ff7b22f0f028b9ce009809d61d70e14aa0e42b3be933cf8`, published
  `waiting-human`, version 5, one `report` stage at `waiting-human`, interrupted generation-1
  Manager, interrupted attempt, zero activation receipts, and one resolved `intervention` request
  with decision `responded`.
- Two independently requested lower-tier audits confirmed their actual responding model was
  `gpt-5.6-terra` (orchestrator: `gpt-5.6-sol`). Both accepted the corrected post-merge/live
  checklist and its stop-on-error containment.
- Live Resume was not clicked: browser discovery returned no available backend. No raw authenticated
  endpoint was substituted and no credential/session material was inspected. Exact next step:
  connect a browser to this terminal, open the stranded run, verify `Resume run` is present and the
  manual Manager-successor action is absent, snapshot the same public identities, then click Resume
  exactly once. On `automatic-runtime-not-activated`, stop and ask Daniel to re-arm the watched
  runtime; on any other mismatch/error, preserve the run and diagnose without retry, relaunch, or a
  manual successor.
- Continuation check: a bare `Continue` did not satisfy the external approval gate's requirement for
  explicit authorization to publish the operational checkpoint to the Codex Git remote, and browser
  discovery still returned no backend. No push or run mutation occurred.


# codex-worker

## 2026-08-11 — Task A2, codex image engine

- A single `p4_probe.py --sandbox read-only` attempt exited in 34.1 seconds with certificate and
  transport failures, no images, and no timeout; do not re-issue it because the probe budget is one.
- A before/after `Get-Process codex` count of 13/12 showed no excess process, but `kill_tree()` was
  not called because the process exited early; this does not verify the timeout kill path.
- In this sandbox the linked-worktree Git metadata at `C:/Users/danie/kb/.git/worktrees/...` is
  read-only: local `git config` and the exact `git add` both fail on lock creation. The A2 artifacts
  are prepared but cannot be committed until the worktree Git metadata is writable.

## 2026-08-11 — Task A2 evidence rewrite

- A nested `codex exec` launched by a dispatch worker measures the worker cage when that cage blocks
  shell-level network; it is not evidence about the child's requested sandbox mode. Real codex-API
  probes must run from the host shell, and evidence should preserve the confounded raw/stderr pair
  separately from the valid measurement.

## 2026-08-11 — Task A3, exec-resume session contract

- `exec resume` re-emits `thread.started` and writes cleanly into the existing thread image
  directory, but replayed history made uncached input about 3x higher than a like-for-like fresh
  call; do not enable session mode by default on this evidence.
- Fidelity checks over JSONL must decode each event before matching multi-line source text; raw
  substring checks produce false negatives when newlines are escaped as `\\n`.

## 2026-08-11 — Task A4, canvas rows

- The verbatim local measurement commands found 23 baseline Gemini PNGs at `1376x768` and no PNGs
  under the specified video assets tree; the baseline SHA re-verification returned `MISMATCHES: none`.

## Synthetic identifiers do not prove transport freshness

### Context
- A transport-reissue regression incorrectly expected two fresh fake subprocesses to return distinct
  thread IDs, even though the frozen fake deterministically initializes the same synthetic ID.

### Root Cause / Core Insight
- Freshness is an invocation contract, while an identifier's uniqueness is provider behavior; a fake
  may model the former faithfully without reproducing the latter.

### The Pattern (transferable)
- Next time I test a fresh-vs-resume transport boundary, I will assert the call shape directly (for
  example, `resume_thread=None`) and treat returned ID uniqueness as a separate provider contract.
- Signal to recognize: a test infers how a call was made from a synthetic output value that the fake
  generates independently in each process.

## Expected red failures must respect expression evaluation order

### Context
- A TDD plan predicted that a call using two not-yet-implemented attributes would first fail on the
  argument attribute, but Python resolved the callable attribute first.

### Root Cause / Core Insight
- An expected exception names an observable execution path, not just a set of missing symbols;
  language evaluation order determines which missing symbol is observable first.

### The Pattern (transferable)
- Next time a plan requires an exact red failure, I will trace expression evaluation order before
  promising the failing symbol and will preserve the genuine output if the prediction is impossible.
- Signal to recognize: one statement references multiple absent names or attributes and the plan
  asserts which one must fail first.

- 2026-08-03: For Bricks round-3 Lane P, the valid L73 parent is `_staging/L72-round2-J.png` (SHA-256 `69a3d23824a1ded1fab332be8454335ba428727d24a1ebbb05dced40781389ad`). Never route L76 through either staged auditor powerstance figure; a fresh STEP-1 derivation uses the auditor canonical, `expr-deadpan`, and generic `action-powerstance`.
- 2026-08-03: Lane P's first authorized live request, `L73-round3-P`, received provider HTTP 429 (current quota) after the preamble passed. Forge published neither PNG nor lock; treat it as an external quota blocker rather than a visual failure or precision-retry case.
- 2026-08-04: The resumed Lane P provider attempt recovered. L73 plus fresh L76 STEP-1 → L76 → L77, L78, and L79 all staged at $0.709. The fresh auditor STEP-1 had one no-image mechanical issue, then succeeded unchanged; this did not consume the sanctioned content/§3 retry.
- 2026-08-03: Lane N received three consecutive HTTP 429 responses before image creation (two unchanged STEP-1 attempts, then an independent scene). Log each as $0 actual, stop the lane at the third mechanical failure, and do not issue remaining independent scenes or dependent children.
- 2026-08-04: A human-ordered resumed Lane N correctly treated the first post-stop SHA-pinned L58 request as a quota probe; it succeeded, after which the remaining independent scene, fresh STEP-1, and dependent scene were run in order. Preserve the old failed-attempt history, but add a dated resume outcome with separate actual spend and fresh SHA-256 values rather than rewriting it.
- 2026-08-04: For the approved B2 channel style-card candidate batch, forge `style` mode accepts an approved scene as the temporary style seed before a human-approved channel card exists. Dry-run each request first; three 1K calls staged cleanly at $0.039 each. Keep every candidate unregistered and use a self-contained comparison board with display-sized JPEG data URIs to remain below the 9 MB artifact cap.
- 2026-08-04: The follow-up one-shot L100 probe held the current authored prompt verbatim across a neutral baseline and three digest-pinned style-card seeds. In this one-render-per-condition sample, no card improved flat finish or warm palette; candidate 3 visibly copied its swatch strip into the scene. Retain the four outputs and exact slate as negative empirical evidence; do not register a style card from these results.
- 2026-08-04: L100 probe round 2 distinguishes textual reinforcement from a full rendered-scene anchor. The hardened flat-cel/warm-palette text on a neutral seed produced the only on-target result (red accent still omitted); a verified L160 seed stayed grey without the text and, with it, reproduced L160's people/furniture/calendar wholesale. Do not use full rendered scenes as style anchors; retain F as evidence for testing a future hardened descriptor.
- 2026-08-04: Bricks Round-4 Lane T used 13 successful 2K calls ($1.742 / $1.80): 11 planned `-b4T` scenes plus L85/L92 precision retries. The normal forge batch loader accepts string seeds only, not SHA seed objects; record all SHA pins in the round genlog (retry overlays alone enforce SHA objects). L92 retry restored its missing glasses/case; L85 retry introduced a wrong body outline, so retain the original as flagged and stop that chain.
- 2026-08-04: Bricks B4 Lane U: a zero-seed root must explicitly set `root_scene: true` in forge specs or the dry-run rejects before provider contact. With $1.65, reserve dependency-chain capacity before a discretionary retry: the L96 precision retry could not be afforded after funding L97→L99. The auditor canonical intentionally carries its round spectacles perched above its eyes; do not “correct” that identity detail in a scene prompt.
- 2026-08-04: Bricks B5 Lane W: the re-authored rear-zone boardroom chain landed cleanly through L68 when its fresh staging parent replaced the canonical place seed and the final dry-run kept truthful four-part seed roles. L70's one allowed overlay retry still turned its required transverse corridor stop line into a boundary stripe; preserve the evidence, do not generate L71-L73 from it, and log confirmed cost separately from a no-PNG transport timeout's conservative exposure.
- 2026-08-05: The governed Poyais L24 four-wing test stopped all providers at STEP1 after one retry each: Codex retained gradients/outline drift, Qwen collapsed multi-reference routing to the generic template, FLUX traded expression hold against canonical identity/costume, and HiDream added forbidden anatomy and ignored pose. Do not infer scene quality from this run; no provider legally received the place plate.
- 2026-08-05: HiDream Full 8B setup on an L40S is fast when the venv/repo live on the pod's ephemeral `/root` and only the 33 GB Hugging Face cache lives on `/workspace`: PyTorch 2.10 + dependencies installed in under two minutes and weights downloaded in ~41 seconds. Its official pipeline snapped 688×1024 to 1664×2496, so record requested and actual dimensions separately.
- 2026-08-05: A frozen provider contract built from `kit.prompt_for()` can miss later live-gen prompt injections. In the L24 fixture, STEP1 matched the live dry run but the unused STEP2 record omitted `HARDENED SCENE STYLE`; freeze at the final provider boundary or diff every frozen prompt against `forge gen --dry-run` before spending.
