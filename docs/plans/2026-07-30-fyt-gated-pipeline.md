# FYT Gated Multi-Agent Pipeline — Implementation Plan

> **For agentic workers:** Each task below is one build phase, executed as a dispatched worker
> (or small worker wave) with this plan section + the spec as the brief. Work TDD inside each
> task: failing test → minimal change → pass → commit. Checkboxes track phases.

**Spec:** `docs/specs/2026-07-30-fyt-gated-pipeline-design.md` (rev 2 — read it first, fully)

**Goal:** Daniel talks to the fyt-runner or any phase-agent terminal; a per-run roster of
channel-agnostic Fable-5 pty terminals runs idea → published-private with G0–G4 human gates
blocking structurally and surfacing in the dashboard Inbox, monitored via a live workflow canvas.

**Architecture:** Reuse the existing control-plane store (runs/stages/HumanRequests) as the
coordination brain; execution moves to persistent interactive pty sessions (dashboard
`server/pty/` infra) driven by work-order delivery that is withheld until upstream gates approve.
Gates are declared in the org workflow `.md`, threaded through the compiler, approved in the
Inbox. Craft stays in the 20 project skills; doctrine stays in the project tree; agents are lean
declarations.

**Tech stack:** Node 24 + Fastify + TS (dashboard server, tests via `node --test` siblings),
React/Vite + xterm.js (dashboard UI), node-pty, markdown agent/workflow definitions,
Claude CLI terminals.

## Global constraints (apply to every task)

- Change logic in place; never bolt on parallel paths; never append to dodge an edit
  (operating-law §F-docs). Every server change updates its `.test.ts` sibling.
- No `git add -A` / `commit -a`; stage exact paths (§F-git). Work lands on work branches, PRs to
  `main`; Daniel merges. Coordination writes → ops branch rules per CLAUDE.md.
- `governance/` and `CLAUDE.md` are human-edited only. `runner-bound: true` reaches `main` only
  through Daniel's PR merge (the human-flip law).
- Author-never-grades: no agent grades its own phase's output; fyt-checker owns judge-gate,
  image-review, render-verify + compliance.
- Spend law: images + voiceover spend requires the recorded G2 approval; undeclared spend
  vocabulary still hard-refuses in policy.
- Agents are channel-agnostic (channel = run parameter, `channels/<name>/` loaded as data) and
  compact-context (declaration + doctrine pointers + channel data + run state; read-on-demand;
  compact subagent briefs).
- Dispatch routing per BOSS.md: sonnet for standard build, opus for exploitable surfaces
  (activation/unlock, policy, work-order delivery), haiku for mechanical sweeps. Worker models
  verified by transcript grep at grading.

---

### Task 1: Reconcile branches ✅-gated by Daniel's merge

**Files:** none edited — pure git. Branches `claude/boss-20260729` (spec + 4 skill-overhaul
commits) and local-only `claude/fyt-silver-fresh` (14 commits, worktree
`C:/Users/danie/kb-worktrees/fyt-silver-fresh`).

**Work order (boss-inline, mechanical):**
- [ ] Push `claude/boss-20260729` → origin; open PR to `main` (title: "FYT image/VPW/render
  overhauls + gated-pipeline spec").
- [ ] Push `claude/fyt-silver-fresh` → origin (first push — branch has NO remote copy; do this
  before anything else can lose it); open PR to `main` (title: "long-form-writer doctrine waves +
  silver/nikola test runs").
- [ ] Present both PRs to Daniel with the one known conflict called out:
  `orgs/faceless-youtube/knowledge/decisions.md`, append-append, resolve keep-both
  (silver-fresh block first, boss block second, chronological). Whichever PR merges second
  carries the resolution.
- [ ] **GATE: Daniel merges both.** After merge: `git fetch --prune`, delete merged locals,
  remove `fyt-silver-fresh` worktree if its arc is closed (nikola verdict may still need it —
  ask, don't assume), cut fresh work branch `claude/fyt-gated-pipeline` from `origin/main` for
  Tasks 2–5.

**Acceptance:** `git rev-list --count origin/main..<branch>` == 0 for both; new work branch
current.

---

### Task 2: Agent roster rewrite

**Files:**
- Rewrite: `agents/fyt-runner.md` (conductor: run launch/monitor, work-order delivery,
  single-writer merges, targeted repairs; image-review REMOVED; no craft/gate-grading/spend/publish)
- Create: `agents/fyt-story.md`, `agents/fyt-visuals.md`, `agents/fyt-audio-render.md`,
  `agents/fyt-publish.md` (ownership per spec roster table)
- Rewrite: `agents/fyt-checker.md` (adds image-review + compliance-check to judge-gate +
  render-verify; cross-cutting service, not a phase)
- Tombstone: `agents/fyt-preproduction.md`, `agents/fyt-production.md` (pattern: fyt-producer,
  commit 9b752f1 — short superseded-by notice, history preserved)
- `governance/` is human-edited only: if the fable profile ids require additions to
  `governance/model-routing.yaml`, do NOT edit it — hand Daniel the exact diff to apply as part
  of this task's gate.

**Contracts every phase-agent file must carry (spec "Locked decisions" — restate, don't invent):**
frontmatter `role`, `runtime: claude`, `default-profile: manager:claude:claude-fable-5`,
`allowed-profiles` (+sonnet fallback), `projects: [faceless-youtube]`, `runner-bound: true`;
body sections: identity/mission; owned stages + skills driven; doctrine pointers (project router
+ phase skills — pointers, never copied doctrine); channel-agnostic law; compact-context law;
workflow-independence (standalone work order OR run-roster member — never assumes DAG position);
structured handoffs (artifacts/manifests/verdicts as interface); forbidden authority (per spec
table + spend/publish/gate laws); subagent dispatch policy (haiku/sonnet/opus by stakes, codex
via cards).

**Interfaces produced:** agent ids `fyt-runner|fyt-story|fyt-visuals|fyt-audio-render|
fyt-publish|fyt-checker` — consumed verbatim by Task 3's `agentId` stage fields and Task 4's
roster spawn.

**Dispatch:** one sonnet worker authors all six against the spec table + existing files as
style reference; opus adversarial review pass (these files are binding authority injected into
live terminals — an exploitable surface); boss grades.

- [ ] Six files authored, two tombstoned, review clean, committed on `claude/fyt-gated-pipeline`.

**Acceptance:** `dashboard/server/agents/roster.ts` parses all six (existing roster tests
extended to cover the new ids); each file < ~250 lines (compact-context law applies to the
declarations themselves); no channel name appears in any agent body; forbidden-authority
sections present in all six.

---

### Task 3: Gate machinery + workflow re-shape

**Files:**
- Modify: `dashboard/server/workflows/defs.ts` (~line 249 allowed-keys array) — add `humanGates`
  stage key: list of `{id, kind: approval|input|review, prompt, spendAuthorization?: boolean}`;
  validate ids unique per workflow, kind in enum.
- Modify: `dashboard/server/workflows/compile.ts:234` — thread parsed `humanGates` into the
  compiled `ProposalStage.humanGates` (shape already defined in `control/proposal.ts` —
  extend that type only if `spendAuthorization` needs carrying; do NOT fork a parallel type).
- Modify: `dashboard/server/control/policy.ts` — new disposition: a stage whose declared
  `humanGates` includes `spendAuthorization: true` evaluates to `waiting-human` (approvable),
  recorded as the run's spend authorization on approval; the existing `requestsSpending` hard
  refuse and restricted-vocabulary scan in `execution.ts:495-511` stay untouched for
  UNDECLARED spend.
- Rewrite: `orgs/faceless-youtube/workflows/video-run.md` — the ~11-stage shape from the spec
  (stage list, `agentId`+`profileId` per stage, `humanGates` at G0–G4, G2 gate carries
  `spendAuthorization: true`, `channel`+`slice` launch parameters, single-writer staging rules
  preserved in stage workOrders, analytics explicitly out).
- Tests: `defs.test.ts`, `compile.test.ts`, `policy.test.ts` siblings — failing-first for: gate
  parse, gate threading (the `[]` hardcode is gone), spend-gate → `waiting-human` not refuse,
  undeclared spend still refuses, video-run.md compiles with all six agentIds resolving.

**Interfaces:** consumes Task 2 agent ids; produces compiled proposals with populated
`humanGates` — consumed by Task 4's boundary logic (already existing `stageBoundary`/
`createBoundary` in `execution.ts:1240-1342`).

**Dispatch:** sonnet builds defs/compile + video-run.md; **opus** builds the policy change
(spend gating = exploitable surface) and reviews the whole task; boss grades.

- [ ] All five files changed + tests green (`node --test` on the three siblings), committed.

**Acceptance:** compiling `video-run.md` yields 5 human gates at the spec positions; a stage
downstream of an unapproved gate can never reach a runnable disposition (test proves it);
zero references to `governedBy` as an execution field remain load-bearing.

---

### Task 4: Run orchestration over pty terminals + unlock latch

**Files (recon first — this task STARTS by reading, then locks its own file list):**
- Read fully before writing: `dashboard/server/control/claudeSessionAdapter.ts` (evaluate reuse
  — spec mandates this before new code), `server/pty/` modules, `control/execution.ts`,
  `control/store.ts`, `control/activation.ts`, `control/routes.ts`.
- Modify: `control/activation.ts` — boot locked; lazy-construct execution wiring on unlock;
  `DASHBOARD_EXECUTION_ACTIVATED` demoted to headless/testing override.
- Create/modify (per recon): roster session manager — per-run spawn of six pty Claude sessions
  with agent declaration + channel data injected as first-load context; work-order delivery that
  consults the store (`runBoundariesAccepted`) before writing a phase's work order into its
  session; state tracking (per-agent activity line + waiting-on edges) persisted to the store;
  retire-on-ship + worktree sweep; resume after daemon restart.
- Modify: `control/routes.ts` — unlock route (WebAuthn-gated via existing `auth/`), Lock
  control, roster/run state endpoints for the canvas.
- Tests: siblings for the latch (locked boot refuses launch; unlock enables; restart re-locks),
  work-order withholding (unapproved gate ⇒ no delivery — the structural-halt test), resume.

**Interfaces:** consumes Task 3 compiled gates + Task 2 ids; produces
`GET /api/control/runs/:runRef` roster-state shape (agents[] with `sessionId`, `status`,
`activity`, `waitingOn[]`) — consumed by Task 5 canvas. HumanRequest approve→resume stays the
existing `respond` + `activate` routes (`routes.ts:976-1019`, `:696-750`) — reuse, don't fork.

**Dispatch:** **opus** for activation/unlock + work-order gating (security-critical);
sonnet for session lifecycle plumbing; opus adversarial review; boss grades.

- [ ] Latch + roster lifecycle + gated delivery + resume, tests green, committed.

**Acceptance:** with daemon live: launch while locked prompts unlock; after unlock a video-run
launch spawns six pty sessions; killing the daemon and restarting resumes them; a G1-blocked run
shows fyt-visuals with no work order delivered (verified by session transcript, not by claim).

---

### Task 5: Workflow canvas UI → GATE: Daniel's maiden-run go

**Files:**
- Create: `dashboard/src/views/RunCanvas.tsx` (+ nav entry in `src/nav/config.ts`) — roster
  tiles on artifact-flow edges.
- Tiles: live xterm surface scaled small (reuse the existing Terminal view's xterm wiring
  against `/api/pty` sessions — render real terminal, CSS-scaled, read-only when mini);
  click → expand to full interactive terminal (the existing Terminal component, same session);
  shrink back. State badge per tile from Task 4's roster-state endpoint
  (`active: <activity>` / `waiting on <agent>` / `blocked: <gate> in your inbox` / `idle`).
- Inbox untouched as approval surface (HumanRequestsPanel already resumes on approve).
- Tests: component tests per existing dashboard UI test conventions (badge mapping,
  expand/collapse state, edge layout from run stage graph).

**Interfaces:** consumes Task 4 roster-state endpoint + existing pty session API; produces the
monitoring/engagement surface only — no new write paths besides expand-terminal input (which is
the pty session itself).

**Dispatch:** sonnet builds; design pass per dashboard design direction v2 (Claude-dark
near-black, no accents, condensed); boss grades against a live daemon.

- [ ] Canvas view live; mini-terminal fidelity + expand/interact verified in browser.
- [ ] **GATE: end-to-end dry check shown to Daniel** — launch compiles, roster spawns on canvas,
  G0 blocks in Inbox, approve resumes — then his go for the maiden run.

**Acceptance:** Daniel can watch a run without opening any terminal, and can open any tile,
type into the agent mid-run, and shrink back with the run intact.

---

### Task 6: Maiden run (live-fire, graded)

**Not a build task — an operated run.** Fresh idea from the-second-take backlog. Launch
`video-run` with `channel: the-second-take`, `slice: ~2min`.

- [ ] G0: pick + edit idea in Inbox (iterate in fyt-story's terminal if wanted).
- [ ] Full script written; judge-gate verdict; G1 approve.
- [ ] Packaging ∥ visual plan; lint; G2 approve = spend authorized (images ~slice-scoped +
  VO; expect well under the $17–27 full-run cost).
- [ ] Images (slice) → image-review + shot-board → G3 approve.
- [ ] Audio + render (slice) → verify + compliance → G4 approve.
- [ ] publish-private lands; roster retires; worktrees swept.
- [ ] Boss grades the run against the spec success condition; lessons →
  `memory/claude-boss.md` + project doctrine per §G; STATUS.md updated.

**Acceptance:** all five gates fired in the Inbox in order, each downstream phase provably idle
until approval; a private upload exists for the 2-minute slice; no ungated spend anywhere in
ledgers.
