# Workflow Platform Arc — Design

**Date:** 2026-08-11. **Approved by:** Daniel (section-by-section, boss session).
**Branch:** `claude/workflow-platform` (own worktree off main `a2e6e2b`).
**Structure:** Approach A — sequential phases, features then trim, each phase gated.

## Goal

Make kb workflows a platform where agents iterate with each other on artifacts, runs are
watchable and steerable live, human gates actively reach Daniel, agents improve from run
feedback under human gates, running agents always execute current logic, and the dashboard
codebase is slimmer than when the arc started.

## Ground truth (mapped 2026-08-11, sonnet explorer, file:line verified)

- **Stage chaining exists, strictly forward**: commit lineage (`execution.ts:1797`,
  `canonicalResultIntegrator.ts:863`) + bounded inert summaries (`claudeWorkerAdapter.ts:233`).
  No mid-run peer messaging, no fan-in negotiation. Dashboard run engine and queue-card DAG
  are separate chaining implementations bridged by W7.
- **`ReviewLoop` primitive exists** (`control/types.ts:157`): checker↔creator rework cycles,
  `maxCreatorReworks`, generation supersession, receipts, park-to-gate. It is the B↔C half of
  the iteration requirement; the creator↔creator half does not exist.
- **Live run graph (PR #115) is mature**: per-agent cards, live badges, gate chips, mini-tails,
  click-in `AgentWorkPanel` (full stream, composer to the running worker, inline gate answers),
  SSE-signal + REST catch-up. Confirmed green on today's main (38/38 SPA, 63/63 queueBridge,
  49/49 activation+surface, tsc baseline 7, build clean). **Never attested on a live run.**
- **W7 (PR #116)**: def-card launches a full workflow def as one run. Reviewed hard (fatal F1
  validator bug caught pre-merge), tests green, **live full-flow acceptance never run**; local
  prod daemon is pinned at #115 and does not contain it.
- **Gates surface pull-only**: unified inbox (`Approvals.tsx`) + plain-language asks
  (`humanRequestAsk.ts`) + graph chips. No push path of any kind.
- **Self-improvement scaffold dormant**: `skills/learned|evolved/` empty, `ledgers/grades/`
  never written, delivery-gate hook warn-only. No outcome→fix mechanism.
- **Freshness strong in code, one operational hole**: resolution-not-assignment ladder
  (`workflows/defaults.ts:103`), per-launch re-read + hash refusal
  (`agentAssignmentResolver.ts:47`). Hole: daemon executes from the ops checkout; merged
  def/agent edits on main are not live until a MANUAL main→ops sync + restart.
- **File health**: subsystem ~56k lines incl. tests; `store.ts` 5,334 lines (every entity
  writes through it); legacy candidates: `timeline/stream.ts` planeB path (dead for
  control-plane), `Approvals`/`ApprovalsLive` naming, empty `queue/approvals/` card path.

## Decisions

1. **No external agent-coordination framework.** The engine already has artifact lineage,
   bounded rework, receipts, gates; external frameworks sit outside kb governance
   (server-owned channels, hash-verified defs, card audit). Phase-1 research includes a cheap
   sanity check of this decision; overturning it requires Daniel.
2. **Iteration = bounded artifact ping-pong, not chat.** Generalize `ReviewLoop` so any stage
   can send the artifact back to a named upstream stage with structured instructions.
   Loop-termination rule is NOT designed here: Phase 1 researches how Daniel actually iterates
   (steering messages in run records, `decisions.md` rulings, boss memory) and proposes a rule
   imitating it — human gate before build.
3. **Gate push = native Windows toast** subscribing to the daemon's existing SSE gate events,
   deep-linking to the agent card in the run tab. Dashboard remains answerable in BOTH the run
   tab and the inbox. No external notification services. Post-cutover: same notifier over the
   tunnel.
4. **Self-improvement feeds** = post-run retro agent mining the full run record, PLUS Daniel's
   inline `AgentWorkPanel` feedback promoted to durable per-agent feedback items. Applies to
   workflow runs AND single-agent runs. Grading-ledger revival explicitly deferred. Every
   proposed fix is a human-gated diff; nothing self-applies; skill proposals land in
   `skills/learned/` per provenance tiers.
5. **Trim scope = dashboard-wide** (server + SPA), run LAST so it sweeps arc-added code.
6. **Workers**: claude subagents (Daniel's instruction this session), explicit models,
   model-verified at grading via transcript grep. Boss orchestrates, never builds inline.

## Phases

Every phase ends: targeted tests + tsc baseline (exactly 7) → opus adversarial review →
**live run proof** → Daniel gate → one PR. Nothing merges on green suites alone.

### Phase 0 — Foundation attestation
Advance `dashboard-prod` pin ab14839→main tip (keeps windowsHide commit 5874532), rebuild,
restart. Daniel arms via passkey. File a real no-spend `workflow-def` card. Acceptance:
multi-stage run appears in live graph; click into an agent's live stream; answer one gate from
the run tab and one from the inbox; ledger row lands on ops; queueBridge date-serialization
stderr flag explained. Evidence recorded in the run record + handoff.

### Phase 1 — Iteration loops
Research: termination-rule proposal from Daniel's observed iteration behavior + external
framework sanity check. **Gate: Daniel approves the rule.**
Build: `IterationLoop` generalizing `ReviewLoop` — def-declared upstream partner, structured
rework request (instructions + artifact via existing commit lineage), def-declared cycle cap,
exhaustion parks to the normal gate surface, graph shows loop state on agent cards.
Live proof: a demo def runs A⇄B then B⇄C(checker) cycles to completion and once to park.

### Phase 2 — Gate push
Thin desktop notifier subscribed to daemon SSE gate events → Windows toast (plain-language
ask), click deep-links to the gate's agent card. Live proof: toast fires with dashboard
closed; gates answered in run tab and inbox.

### Phase 3 — Feedback capture + retro agent
Durable per-agent feedback items from AgentWorkPanel messages. Retro stage on terminal runs
(workflow + single-agent) mines record → proposed diffs to agent defs / workflow defs /
skills, surfaced in dashboard with motivating evidence, human-gated, applied via normal
branch flow. Live proof: a real run yields a retro proposal citing real feedback; Daniel
approves one and rejects one; approved diff lands and next launch hash-verifies it.

### Phase 4 — Logic freshness
Automate main→ops sync of `agents/` + `orgs/*/workflows/` + daemon reload on merge, absorbing
or superseding PR #52 `sync_daemon_dirs` (never duplicating it). Hash-verification refusal
remains the safety net. Live proof: merge an agent-def edit; next launch runs the new def with
no manual step.

### Phase 5 — Dashboard-wide trim
Fresh bloat inventory (2026-08-04 inventory is the template) → `store.ts` decomposition,
planeB/`timeline/stream.ts` control-path retirement, `Approvals`/`ApprovalsLive` naming,
dedupe/dead-code sweep server + SPA. **Ruling for Daniel: is `queue/approvals/` still
load-bearing or retired?** Every cut regression-proven by existing suites; adversarial review
on the decomposition.

## Non-goals

Free-form agent-to-agent chat; external coordination frameworks; grading-ledger revival;
repo-wide (beyond dashboard) trimming; codex live-stream injection; any self-applying fix.

## Deliverable

After Daniel approves this spec: a runnable mega-prompt (fed back by Daniel in a fresh
session) encoding the phases as a tasklist — skills to invoke per phase (writing-plans, TDD,
code-review/adversarial review, save-session), every human checkpoint at its position, worker
routing + model rules, per-phase acceptance evidence. The cloud cutover may land mid-arc; the
arc builds on main and flows to the VM; only Phase 0's local pin-advance is
cutover-superseded.
