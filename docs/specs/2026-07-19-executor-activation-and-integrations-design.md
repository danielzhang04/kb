# Executor activation + dashboard external integrations — design (2026-07-19)

Author: claude-boss (Fable 5 orchestrator, autonomous session authorized by Daniel 2026-07-19).
Status: approved-by-mandate — Daniel instructed this session to brainstorm, plan, and build without
surfacing; the two questions the prior brainstorm paused on are resolved per its own recorded
recommendations (activation owned here; signed-T3 fast-lane deferred).

Scope: (Phase 0) activate the governed execution control plane built on
`codex/dashboard-operational-surfaces`; (Phase 1) give dashboard-spawned workers external reach —
web research, Google Workspace (Gmail/Drive/Calendar), YouTube upload + analytics — and ship three
runnable workflow definitions (email-triage, research, faceless-youtube-run).

Grounding: two Opus explorer sweeps of `dashboard/server/` (2026-07-19, this session), the
2026-07-18 execution-control HANDOFF, the 2026-07-19 operational-hardening HANDOFF, and an Opus
web-research sweep on headless Google access (findings inline in §5).

## 1. Decisions table

| # | Decision | Choice | Why / alternatives rejected |
|---|----------|--------|------------------------------|
| D1 | Activation owner | This session, branch `claude/fleet-arc` off `codex/dashboard-operational-surfaces` | Prior brainstorm's recorded recommendation; Daniel's WS2 instruction ("run workflows from the dashboard") is the explicit go the plan docs gated on. Building off unmerged codex branch because the control plane exists only there; Daniel merges later. |
| D2 | Worker runtime | Spawn `claude -p --output-format stream-json --input-format stream-json` per stage attempt, prompt via stdin | The HANDOFF's own Wave-A build list item 1. Codex runtime stays on `agent_runner.ps1` (unchanged). |
| D3 | Activation gating | Env flag `DASHBOARD_EXECUTION_ACTIVATED=1` in pm2.config.cjs injects broker + engine + cancellation + canonical integrator in `makeSurfaceContext`; absent ⇒ today's inert behavior byte-for-byte | Reversible one-line rollback; preserves the deliberate-inactivity default for any other deployment of this code. |
| D4 | Result writeback | `canonicalResultIntegrator.ts` only, inside `withOpsTransaction` | The file integrator is a self-documented decoy; canonical path already reviewed (6-pass Opus, clean). |
| D5 | Queue→engine bridge | Poller module `dashboard/server/control/queueBridge.ts` scanning `queue/{inbox,working}` for `owner == <agent> && execution-controller == dashboard` — the exact inverse of `scripts/agent_runner.ps1:204` | That predicate IS the double-execution guard; prompt build mirrors agent_runner.ps1:290–350 (work order authoritative, deps/feedback inside an INERT CONTEXT BOUNDARY, Evidence excluded). |
| D6 | Signed-T3 release | DEFERRED (stub `t3-approval-release-not-implemented` stays) | Prior brainstorm's recommendation; T1/T2 live-fire never needs it; T3 correctly stalls waiting-human. |
| D7 | Acceptance | Synthetic low-risk two-stage workflow, end-to-end with fault injection (daemon restart, Stop, Retry, Reroute, HumanRequest round-trip, publication fault), MUST boot the real daemon | Mandated by the execution-control HANDOFF; vitest-green code has failed at boot twice before. |
| D8 | Accounting | Both ledgers: control-plane accounting adapter AND fleet `scripts/ledger.py` cost rows ($0.0 subscription steps) | The two systems are explicitly not substitutes (prior explorer finding). |
| D9 | Google Workspace access | ONE local MCP server: `taylorwilsdon/google_workspace_mcp` via `uvx workspace-mcp --tools gmail drive calendar`, registered `--scope user` | claude.ai connectors DO NOT load in headless `claude -p` (claude-code#72914). Single server beats three (GongRzhe Gmail + nspady Calendar + Drive) on moving parts. gog CLI = more glue, weaker structure. |
| D10 | YouTube upload | Keep existing `youtube-uploader-mcp` (global, Go, stdio). OAuth never completed → human gate card | Token cache auto-refreshes headlessly once minted. |
| D11 | YouTube analytics | Small Python script `scripts/yt_analytics.py` on the SAME OAuth client (`config/client_secret.json`), separate persisted token with `yt-analytics.readonly` | Uploader's scopes lack analytics; forking the Go server is invasive; no maintained analytics MCP exists. |
| D12 | Web research | Native WebSearch/WebFetch in headless workers via `--allowedTools` (confirmed working under subscription in raw CLI); deep-research skill available to workers | No extra infra. The claude-code-action bug is Action-only, we spawn raw CLI. |
| D13 | Worker tool policy | Per-execution-profile allowlists: profiles declare `allowedTools` (e.g. research profile gets WebSearch/WebFetch; triage profile gets `mcp__google-workspace__*` read/draft tools only; publish tools NEVER in any default profile) | Server-owned profiles are the existing control-plane concept; tool caps are the natural extension. |
| D14 | Email triage workflow | kb-native rebuild of the cowork workflow: 4-tier taxonomy (skip / info_only / meeting_info / action_required) from ECC chief-of-staff; DRAFT-ONLY (creates Gmail drafts, never sends); output = triage report in `orgs/kb-ops/output/` | Cowork workflow itself isn't exportable; the taxonomy is its portable core. Send stays human-gated per contract + risk tiers. |
| D15 | Workflow definitions | `orgs/<project>/workflows/<name>.md` (YAML frontmatter: id, project, riskTier, profile, schedule-hint, stages[] with action/target/workOrder/dependsOn) compiled to `kb.plan-proposal/v1` by a small server module; Workflows view lists + launches them through the EXISTING control-plane launch path | Reuses the reviewed proposal→approval→launch→canonical-cards machinery instead of inventing a second executor. The registry the HANDOFF called "working, inert" becomes live with a compiler, not a new engine. |
| D16 | OAuth human gates | Four one-time gates written as T3 approval cards with click-by-click steps: G1 GCP project (enable Gmail/Drive/Calendar/YouTube-Data/YouTube-Analytics APIs; consent screen External + self as test user; PUBLISH the app to kill the 7-day refresh-token expiry), G2 Workspace-server OAuth run, G3 youtube-uploader authenticate→accesstoken, G4 analytics script OAuth | Testing-mode tokens die every 7 days (2026 policy, confirmed); publishing (no verification needed for personal use) makes tokens durable. |

## 2. Architecture (Phase 0 — activation)

New modules, following the registrar/SurfaceContext conventions
(`dashboard/server/<domain>/`, injectable runners, co-located vitest):

- `control/claudeWorkerAdapter.ts` — implements `WorkerAdapter.execute` (execution.ts:103–122).
  Spawns `claude -p` via the tracked-process runner pattern (spawn, off-loop, kill-timeout, output
  cap — reuse/extend `runTrackedProcess` from asyncGit.ts). Builds the prompt: authoritative
  workOrder + read/write scope statement + INERT CONTEXT BOUNDARY for dependency results.
  cwd = the attempt's `worktreePath`. Flags: `--output-format stream-json --verbose`,
  `--allowedTools <profile allowlist>`, `--permission-mode` per profile, `--model` from routing.
  Parses stream-json events → `WorkerExecutionResult {state, summary, usage, artifacts, checkpoints}`;
  nonzero exit or malformed stream ⇒ `failed` with stderr tail in summary. NO `ANTHROPIC_API_KEY`
  in env (preamble invariant); strips credential-named vars like the PTY host does.
- `control/claudeSessionAdapter.ts` — implements `ManagedSessionAdapter.start` (broker.ts:16–21):
  same spawn machinery, streaming events to the observer, `stop()` kills the child.
- `control/queueBridge.ts` — chokidar/interval poller over `queue/inbox` + `queue/working`
  (DASHBOARD_REPO_ROOT ops worktree) selecting cards `execution-controller: dashboard` +
  `owner == dashboard-engine`; feeds `runAutomatic`; honors STOP file via `assertFleetRunnable()`
  before every dispatch; idempotent (operationKey = card id + attempt).
- `http/surface.ts` — when `DASHBOARD_EXECUTION_ACTIVATED === '1'`: construct broker
  (claudeSessionAdapter), engine (`AutomaticExecutionEngine` with real adapters: worktrees, skills,
  accounting, canonical integrator, workers=claudeWorkerAdapter, cancellation), inject
  `controlBroker`/`runAutomatic`/`cancelAutomatic`. Otherwise identical to today.
- Fleet cost rows: accounting adapter also appends `scripts/ledger.py` cost rows (model, step, 0.0)
  per attempt via the transaction span.

Error handling: adapter failures map to attempt `failed` (engine retry/reroute semantics unchanged);
spawn-level failures (binary missing, profile invalid) are `governance-refusal` HumanRequests, not
silent retries. Every spawn/exit is audited (existing NDJSON audit trail).

## 3. Architecture (Phase 1 — integrations + workflows)

- `server/workflows/registry.ts` — reads `orgs/*/workflows/*.md`, validates frontmatter, lists.
- `server/workflows/compile.ts` — workflow def → `kb.plan-proposal/v1` (stages, riskTier floors via
  `classifyActionRisk`, governanceRefs auto-included). Launch = existing
  `/api/control/proposals` → decision → launch flow; a convenience route
  `POST /api/workflows/:id/launch` (write surface, session-gated) does import+launch of an
  unmodified def in one step. T3 defs stall at approval exactly like any T3 proposal.
- Workflows view wiring: list registry entries, show compiled preview, launch button, link to run.
- Execution profiles (environment.ts data): add `research` (WebSearch/WebFetch + read tools),
  `gmail-triage` (google-workspace Gmail read/label/draft tools + Read/Write in org output dir),
  `drive-author` (Drive create/upload tools), `producer` (faceless pipeline: Bash, Read/Write/Edit,
  image/TTS scripts — no publish tools). Profiles never include `upload_video` by default.
- Workflow definitions shipped:
  1. `orgs/kb-ops/workflows/email-triage.md` — single stage, `gmail-triage` profile, T2
     (action `research:email-triage` — actions must use registry namespaces). Work order encodes
     the 4-tier taxonomy, draft-only rule, output report path, and the follow-through checklist.
  2. `orgs/kb-ops/workflows/research-brief.md` — parameterized topic research → cited brief in
     `orgs/kb-ops/output/`, `research` profile, T2.
  3. `orgs/faceless-youtube/workflows/video-run.md` — the produce-one-video DAG (stages mirror the
     pipeline skills; see the faceless design doc). Render stages are heavyweight; first runs stay
     orchestrator-driven — the def exists so the dashboard can launch later runs.
- `scripts/yt_analytics.py` + tests: reports.query wrapper, token file
  `%USERPROFILE%\.yt-analytics-token.json`, `--auth` one-time flow, graceful `not-authed` exit.
- Gate cards G1–G4 in `queue/inbox` (T3, owner human-operator) with exact console steps.

## 4. Testing

- Unit: adapter prompt construction (inert boundary, no Evidence), stream-json parsing (success /
  failed / waiting-human / garbage), queueBridge selection predicate (inverse-guard parity table
  vs agent_runner.ps1), workflow compile (valid → proposal hash-stable; invalid → typed errors;
  T3 floors preserved), profile allowlist emission.
- Integration: engine + fake adapters (existing pattern) with the real canonical integrator against
  a fixture repo; queueBridge end-to-end on a temp queue.
- Acceptance (D7): scripted synthetic two-stage run on the REAL daemon with fault injection;
  transcript of every check recorded in the run report. A real `claude -p` smoke (echo-style T1
  work order) proves the spawn path under subscription auth.
- Full `npm test` + `tsc --noEmit` + strip-types load + daemon boot before calling anything done.

## 5. Research evidence (condensed)

Connectors headless: anthropics/claude-code#72914 (connected but tools never registered in CLI).
Workspace server: github.com/taylorwilsdon/google_workspace_mcp (active 2026; uvx; token at
`~/.google_workspace_mcp/credentials/`). 7-day testing-mode refresh-token expiry + publish
workaround: Google audience docs + 2026 field reports. Analytics scopes: developers.google.com/
youtube/analytics/reference (yt-analytics.readonly). Headless web tools: code.claude.com/docs/en/
headless (`--allowedTools`). Uploader internals verified on disk: scopes youtube.upload+readonly
only; token cache auto-refresh; cache file ABSENT ⇒ never authenticated.

## 6. Out of scope

Atlas (explicitly excluded by Daniel). Signed-T3 release path (D6). Retention purge policy.
Cross-user PTY isolation. Sending email (drafts only until Daniel gates send).
