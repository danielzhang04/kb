# kb platform — current-state capability map

_Compiled 2026-08-17 by a research subagent, read-only, from live repo inspection (no branch switches). Repo root `C:/Users/danie/kb`._

Method: read `_index.md`, `dashboard/` (server + SPA), `dashboard/server/control/`, `governance/`, `queue/`, `ledgers/`, git branch/worktree/PR state, and cross-referenced against `MEMORY.md` arc notes. Where a claim rests on a doc/PR description rather than code I read directly, that's flagged.

---

## Part A — Capability map

### 1. Fleet orchestration & dispatch (cards, codex/claude routing)
**Maturity: prod-live.**
- All coordination flows through `queue/` markdown cards (`governance/card-schema.md`, normative). Card frontmatter carries `owner`, `risk-tier` (T1-T3, T4 never carded), `runtime` (claude/codex, dispatcher-set only), `model`, `execution-controller` (dashboard/terminal/null — a double-execution guard), `depends-on` + `variant-group` for DAGs, and a cooperative stop ladder (`stop-requested → halting → halted`).
- Card DAGs express three coordination patterns: parallel parts, pipelines (`depends-on` chains), and variants→consolidate (fan-out + judge card). Reusable pipelines are declared in `workflows/<name>.md`; the dispatcher expands them into card DAGs.
- Codex routing goes through `dispatch-codex` (skill) → a `queue/` card with `owner: codex`. Claude routing is native Agent-tool subagents, model chosen explicitly per stakes tier (haiku/sonnet/opus).
- Live queue snapshot (via `ops` executive dashboard, generated 2026-08-17 06:39 UTC): inbox 27, working 2, done 542, approvals 0 — this is a working, populated system, not a prototype.
- Gap: several human-owned decision/"wake-me" cards are visibly piling up unaddressed in inbox (daemon-dir-drift ×4, budget-gate-measures-nothing, etc.) — dispatch works but the human-gate backlog isn't self-clearing.

### 2. Dashboard UI (what screens exist, are they live)
**Maturity: prod-live**, actively iterated (5 PRs merged in the last 3 days fixing live-discovered defects — see Part B).
- SPA (`dashboard/src/views/`) has ~20 screens: Home, Agents/AgentDetail, Approvals/ApprovalsLive, Atlas, Browser, Connectors, Control, Editor, Ledgers, Pipeline, Projects, Registry, Tasks, Terminal, Timeline, Vibe, WorkflowAgentGraph, WorkflowDetail, Workflows, CodeView — each with a paired `*.test.tsx`, indicating this is real shipped surface area, not scaffolding.
- Server (`dashboard/server/`) has matching domains: `agents/`, `approvals/`, `audit/`, `auth/`, `composer/`, `connectors/`, `control/`, `dag/`, `hub/`, `panels/`, `planeA/`, `planeB/`, `pty/`, `registry/`, `routing/`, `runner/`, `security/`, `timeline/`, `trace/`, `workflows/`, `write/`.
- Auth: WebAuthn/passkey-gated (per `governance/webauthn-credentials.yaml`, `humans.yaml`, and PR #125's "unauthenticated boot" fix — confirms the deployed VM is fail-closed, all pre-auth reads 401).
- Gap found live in production: unauthenticated boot used to crash the SPA before Sign-in mounted (fixed in PR #125, merged during this arc). Session-expiry UX behavior changed as a result (documented, reviewer-flagged, intended).

### 3. Git / branch / worktree / run visibility
**Maturity: partial-to-live.**
- `dashboard/server/timeline/stream.ts` + SPA `Timeline.tsx` exist as a dedicated timeline view/stream — this is the "git-timeline visibility" feature area.
- `WorkflowAgentGraph.tsx` / `WorkflowDetail.tsx` + `dashboard/server/control/` give live run-graph visibility (per merged PR #115 "live run graph — running graph w/ live mini-tails, interactive governed workers, queue-bridge chaining", #116 "card launches a full registered workflow def as ONE run").
- Real managed worktrees exist on disk today under `AppData/Local/kb-dashboard/control/integration/*` and `.../control/worktrees/run-*/attempt-*` — confirms the control-plane reconciler is actually running and materializing worktrees for live runs (not just designed). These are explicitly exempted from the boss's worktree-sweep hygiene rules (per BOSS.md) because "its reconciler owns them."
- Gap: I did not find a first-class "branch diff / PR status" dashboard panel — branch/PR state is still read via `gh` CLI by boss sessions, not surfaced natively in the dashboard UI as far as the view list shows.

### 4. Human gates & approvals
**Maturity: prod-live.**
- `queue/approvals/` is a first-class queue state; T3 actions (merge to main, external publish, deploy) require a WebAuthn-signed approval token via the dashboard channel only — weak/unsigned channels (e.g. Telegram) cannot authorize T3 (`governance/risk-tiers.md` "Approval channels (D2.13)").
- SPA has dedicated `Approvals.tsx` and `ApprovalsLive.tsx` views; server has `dashboard/server/approvals/{assurance,humanInbox,inbox,routes}.ts`.
- Two "cutover gates" (Gate-1, Gate-2, referenced in PR #118 body) are explicitly reserved as **Daniel's ceremonies** — the platform deliberately does not auto-arm VM cutover; execution stays locked and no credential of any kind lands on the VM without a human-run ceremony.
- Gate-1 is live and in-progress right now (see Part B).

### 5. Workflow definitions & execution (manager+agent chains, governedBy)
**Maturity: built, largely merged (P0 merged; P1 "workflow-platform" branch still unmerged, 25 commits ahead / 46 behind main).**
- `dashboard/server/workflows/{defs,compile,amendments,amendmentStore,orgDefSource,profiles,routes}.ts` — workflow definitions compile into executable graphs; `orgs/faceless-youtube/workflows/video-run.md` is a concrete registered workflow.
- `dashboard/server/control/` is the governed-execution engine: `activation.ts`, `execution.ts`, `managedExecution.ts`, `agentAssignmentResolver.ts`, `policy.ts`, `broker.ts`/`brokerStore.ts`, `claudeSessionAdapter.ts`/`claudeWorkerAdapter.ts`, `reviewOutcome.ts`, `queueBridge.ts`, `canonicalResultIntegrator.ts`, `synthetic-acceptance.ts`. This is a mature, heavily-tested control plane (each file has a paired `.test.ts`).
- PR #117 "Workflow-platform P0: live-fire blockers, operator authority, auto-resume, multi-stage fixes" MERGED 2026-08-12 — the base engine is live on main.
- The `claude/workflow-platform` branch is still ahead of main with unmerged work (P1: iteration-state DTOs, ReviewLoop cutover, amendments A4/A5 "engine sibling scheduling", durable-ref lineage fix). Per memory (`workflow-defaults-doctrine`), the design intent is workflows carry a default manager + agent chain (`governedBy`), agents carry default models — resolution, not per-run assignment ceremony.
- Gap: `claude/workflow-platform` is 46 commits behind main — it needs a rebase before it can land; unclear if P1 is still targeted for near-term merge or superseded.

### 6. Control plane / reconciler / managed worktrees
**Maturity: prod-live**, currently mid-cutover to a VM host (see Part B).
- Confirmed live and executing today: `AppData/Local/kb-dashboard/control/integration/<id>` (4 managed integration worktrees, one per `codex/managed-*` branch) and `.../control/worktrees/run-*/attempt-*` (per-attempt execution worktrees). These map 1:1 to real `codex/managed-*` branches found in `git branch -a`.
- `dashboard/server/control/store.ts`, `runTransactions.ts`, `publication.ts`, `publicEvents.ts` back the reconciliation/state-machine layer.
- The platform is built as VM-native: `deploy/bootstrap_vm.py`, `deploy/validate_vm_runtime.py`, `deploy/export_tier0.py`, `deploy/activate_release.py`, `deploy/systemd/kb-dashboard.service` all exist on `main` today (landed via PR #118, kb-structure Phase I). This is the deployment target the control plane reconciler runs under in production.

### 7. Observability: cost ledgers, grades, activity, metrics
**Maturity: prod-live.**
- `ledgers/{activity,audit,cost,dispatch,grades}` — sharded per writer+date, actively written (executive dashboard shows real $ figures, e.g. "$0 API-billed today, subscription claude-opus-4-8 steps at $0", "daily limit $30.00").
- `governance/budget.yaml` + `scripts/preamble.py` enforce a daily budget gate checked at the start of every agent run (per `CLAUDE.md` "Shared preamble").
- `governance/graders.yaml` + the Inspector skill provide fresh-context grading (`ledgers/grades/`) independent of the agent that did the work — a genuine trust/promotion mechanism, not just logging.
- `dashboards/executive.md` and `dashboards/handover.md` are auto-regenerated (dashboard-generator skill) and read as the daily status source of truth — this file is itself evidence the observability loop runs continuously (dispatcher-cloud tier, nightly-review cadence).
- Gap flagged in the dashboard itself: `scripts/sync_daemon_dirs.py` (a nightly drift-check step) is missing on `ops` branch, causing repeat wake-me cards with no owner — an observability gap in the observability system.

---

## Part B — In-flight: VM merge

### What it is
Daniel's "VM merge" is the **kb-structure Phase I "ship-now" platform cutover** — migrating the dashboard/orchestration daemon off the Windows desktop and onto a Linux VM, running as an immutable, recoverable, credential-free deployment. It landed as **PR #118** ("kb-structure Phase I: ship-now platform, schema, and Gate-1 evidence set (20 tasks)"), merged to `main` **2026-08-12** at `986990f9` (per memory `kb-structure-arc`), plus follow-on **PR #120**.

PR #118 body confirms scope: 20 tasks / 28 commits / 144 files / +15,956/−756, covering:
- Deterministic release artifact built on every main merge
- VM release install/select/validate/rollback (`deploy/bootstrap_vm.py`, `deploy/validate_vm_runtime.py`, `deploy/activate_release.py`)
- Tier-0 backup + restore drill (15-min RPO / 60-min RTO, `deploy/export_tier0.py`)
- Durable VM→desktop outbox (Git bundles + atomic manifests) and desktop-side promotion with signature-before-parse
- Session required on every non-health SPA read; unauthenticated `/readyz`
- A signed **Gate-1 evidence package** — the live cutover is explicitly gated behind a human-run ceremony ("This branch does not arm anything... both cutover gates remain Daniel's ceremonies").

This supersedes (absorbs) the earlier `claude/cloud-migration` branch/arc (Hetzner CCX23 pilot, `vm_verify.sh`, Wave-3 cutover runbook) — that branch is now stale (18 unique commits, 79 behind main) and its concerns (VM bootstrap, systemd unit, quiescent cutover) have been re-implemented and merged through the kb-structure track instead. `claude/cloud-migration` is very likely dead/abandonable, not the active thread.

### Current status: IN PROGRESS, not finished
The "Gate-1 ceremony" — the human-run live cutover run on the production VM — is actively happening right now, evidenced by a burst of same-day fix PRs all triggered by defects **found live during the ceremony**:

| PR | Title | Merged | Note |
|---|---|---|---|
| #121 | fix(release): bootable artifact + bootstrap hardening | 2026-08-14 | "(Gate-1 live-ceremony defects)" |
| #122 | feat(deploy): sanctioned DASHBOARD_RP_ORIGIN channel | 2026-08-14 | WebAuthn origin for the VM's real domain |
| #123 | fix(deploy): tier-zero export quiescence proof survives stopped-unit ControlGroup loss | 2026-08-17/18 | |
| #124 | fix(deploy): bootstrap seeds the daemon's initial control-plane document | 2026-08-18 | |
| #125 | fix(dashboard): unauthenticated boot renders sign-in instead of crashing | 2026-08-18 | **"Found live during the Gate-1 ceremony... the ceremony is paused on this bug only."** |

PR #125's body is the clearest evidence of live status: *"On the production VM (fail-closed: all pre-auth reads 401), loading the dashboard unauthenticated crashed the SPA... Found live during the Gate-1 ceremony... After merge: CI artifact → redeploy VM → resume Gate-1 collect (the ceremony is paused on this bug only)."*

**Interpretation:** this is not planning-stage work — Daniel (or an agent under his supervision) is actively running the real cutover ceremony against a real production VM right now, hitting real bugs (auth boot crash, control-plane document seeding, export quiescence under systemd ControlGroup teardown) one at a time, each triaged and fixed same-day, then the ceremony resumes. As of the latest merge (#125, 2026-08-18T02:37:53Z — after this research's "today" per repo history), the ceremony was paused pending redeploy+resume; whether it has since completed is not visible from the repo alone (would need to check the live VM / a fresher dashboard snapshot or ask Daniel directly).

### What remains before it's fully landed
1. Redeploy the VM with #125's fix and **resume/complete Gate-1 collect** (evidence package assembly) — explicitly the next step per #125's own PR body.
2. Per memory (`kb-structure-arc`), 3 rulings and deferred tasks 9/21/23-25 are still blocked, some specifically on `workflow-platform` reaching commit `≥804acec` — i.e. Gate-1 completion may itself be gated on part of the still-unmerged `claude/workflow-platform` P1 work (see capability area 5).
3. A **Gate-2** ceremony is referenced (PR #118: "both cutover gates remain Daniel's ceremonies") but not yet described in what's landed — its scope wasn't located in this pass; likely the actual traffic/production cutover (Gate-1 reads as evidence-collection/validation, Gate-2 as the live flip) — worth confirming with Daniel rather than assuming.
4. `orgs/kb-ops/STATE.md` is stale (last touched 2026-07-16) and does not reflect any of this — there is no single current-truth STATE file for this arc; status must be read from PR bodies + `dashboards/executive.md`, which is a documentation gap.

### Relation to a dashboard/orchestration overhaul
This VM-merge work **is the foundation**, not a parallel track: it changes where and how the entire dashboard/control-plane/queue system runs (desktop pm2 process → VM systemd service, `deploy/systemd/kb-dashboard.service`), changes the auth model (session-required, fail-closed WebAuthn origin), and changes durability guarantees (outbox/promotion, tier-0 backup/restore). Any dashboard UX or orchestration-feature overhaul Daniel is now discussing would sit on top of this — deploying to the same VM, subject to the same Gate-1/Gate-2 ceremony discipline, and inheriting whatever the VM's current control-plane/reconciler contract looks like once Gate-1 finishes. Concretely: an overhaul plan should NOT assume desktop-pm2 as the runtime target, and should treat "Gate-1 not yet closed" as a live blocker/variable — new dashboard surface built this week could itself need to survive the same live-ceremony class of defect (auth-boot-crash-style issues) once it hits the VM for the first time.
