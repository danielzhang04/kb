# Wave-2 Overnight Run Implementation Plan

> **For agentic workers:** executed by the boss terminal via background codex dispatches
> (dispatch-codex skill), one task = one worker brief + one fresh-context adversarial
> review. Not subagent-driven-development; the boss grades every hop.

**Goal:** Land Wave-2 (units A–G of the spec) on `claude/agent-platform-w1` overnight,
codex-only, nothing armed, morning report + relaunched :4630 as the deliverable.

**Architecture:** Boss orchestrates from the main-repo terminal; all edits happen in
worktree `C:/Users/danie/kb-worktrees/agent-platform-w1`. Build workers = codex terra;
adversarial reviewers = codex deep tier, fresh context, different worker than the
builder. Max 2 rework cycles per task, then PARK (documented) and continue.

**Tech stack:** existing kb stack only — python (pytest), TS/React dashboard (vitest,
tsc), kb skills/cards/ledgers. No new dependencies without a PARK note.

**Spec:** `docs/superpowers/specs/2026-08-19-wave2-overnight-design.md` (travels with
this plan; workers get both).

## Global Constraints

- Branch `claude/agent-platform-w1` only; coordination writes via ops branch per CLAUDE.md.
- Nothing armed: no hook registration, no cadence commit, no live maintainer fire, no unpause.
- evals/ dispensation: CREATE new suites/cards via factory path only; NEVER edit existing
  eval content; manifests left unblessed.
- Proof floor after every landed task: `py -3 -m pytest` all green + dashboard
  `npm test` (vitest) + `tsc` clean + 21/21 canaries + panel/view/surface manifests.
- File-editing law (Daniel): change core logic, never bolt on; no dead info left behind;
  cross-file consistency swept every task; keep files slim.
- Every worker brief names exact files in scope, what NOT to touch, acceptance criteria.
- Worker models verified at grading (codex: tier recorded on the dispatch card).

---

### Task F: Rule-8 rewrite + card-schema amendment drafts (proposal only)

**Files:**
- Create: `docs/proposals/rule8-governed-eval-authoring.md`
- NOT touched: `governance/**` (human-edited only — the proposal is a paste-ready draft)

Content: rewrite of `governance/agent-rules.md` §8 in two variants side by side —
(V-human) agents draft eval content, nothing counts until Daniel's `--update-manifest`
blessing; (V-review) independent non-author/non-judged agent blesses after adversarial
review, Daniel ratifies in bulk at merge. Both variants: self-judgment wall verbatim
("no agent authors or edits an eval that judges itself"), factory-path-only creation,
review-before-bless. Plus a paste-ready `governance/card-schema.md` amendment declaring
`scheduled_for` / `dispatched_at` / `kit_sha` (dispatcher-stamp family, snake_case).
Acceptance: a cold reader can apply either variant by copy-paste; trade-offs stated in
≤6 lines each; no other governance change smuggled in.

### Task G: Small cleanups (one worker, one commit)

**Files:**
- Modify: `evals/canaries/README.md` (stale "20 canaries" count → derive the real count
  from the directory at edit time)
- Modify: `evals/agents/README.md` + `scripts/agent_evals.py` ONLY IF the ladder-union
  exclusion of `eval-suite` is not already enforced in code — verify first via the
  existing promotion canary; if enforced, record "already covered" in the task result.
- Create: fleet cards `evals/agents/_fleet/lesson-appended.md` + `ledgers-cost-row.md`
  (factory-path dispensation; deterministic judges; manifests left unblessed)
- Exercise: L2 `when`-routing — run the documented L2 routing path once against a
  fixture card and record the observed routing in the task result (no code change unless
  it fails; failure = PARK with diagnosis).

Acceptance: pytest green; no eval EDITS (only the two new cards); README counts true.

### Task A: Maintainer cadence agent

**Files:**
- Create via factory: `agents/agent-maintainer.md`, `memory/agent-maintainer.md`,
  `evals/agents/agent-maintainer/` (unblessed)
- Create: `scripts/agent_maintainer.py` (the per-fire job, runnable headless) +
  `tests/test_agent_maintainer.py` + `tests/fixtures/maintainer/` (fixture ledgers,
  eval report, memory lessons, parked card)
- Create: `docs/proposals/maintainer-cadence-entry.md` (drafted HEARTBEAT entry with
  cron, NOT committed to HEARTBEAT.md)

**Interfaces:**
- Consumes: `scripts/eval_trigger` report format, grades-ledger row shape, card schema.
- Produces: `run_fire(repo_root, sources) -> FireResult` where FireResult =
  {proposals: list[ProposalDraft], parked: bool, reason: str}; ProposalDraft renders to
  a PR-able diff or ops card body targeting agent defs / memory / role policies ONLY.

Loop-design-check applied in the brief: per-fire scope bound (max N proposals,
readonly sources), decidable done (sources exhausted or bound hit), no-progress → parks.
Hard walls in code + tests: refuses to emit any diff touching `evals/`, `governance/`,
or executable code; PR/card output only.
Acceptance: fixture end-to-end produces ≥1 coherent ProposalDraft citing its evidence;
wall tests prove evals/governance refusal; full proof floor green.

### Task D: Dashboard cluster

**Files:**
- Create: `dashboard/src/components/RecurrencePicker.tsx` + `.test.tsx` (day-of-week
  toggles, 1..n times-of-day, preview line; emits a validated 5-field cron string;
  pure component, no fetch)
- Modify: `dashboard/src/views/agentPlatform/panels/Schedules.panel.tsx` (+ test):
  edit/create prefill flow embeds RecurrencePicker → cron lands in the HEARTBEAT
  prefill; run-history expansion per schedule row (fired `scheduled_for`/
  `dispatched_at`, outcome, output from card `## Result` + ledger rows via a new
  server read endpoint)
- Modify: `dashboard/src/nav/config.ts` (+ stack/tests): Schedules becomes a sidebar
  top-level entry OUTSIDE the Agent Platform section; Agent Platform section keeps the
  rest
- Modify: server: add read-only `/api/panels/schedules/history?cadence=` in the
  existing panels server module (same auth gate; read-only; no new write endpoints)

Acceptance: vitest + tsc green; panel manifests updated; pause-only law intact (grep
proves no unpause/run/arm affordance added); picker reused — zero cron strings
hand-built in panel code.

### Task B: Agent-building skill

**Files:**
- Create: `skills/curated/agent-builder/SKILL.md` (+ `references/guidelines.md`)
- No code changes; the skill drives existing `scripts.agent_factory` + `agent_evals`.

Content: trigger description (creating/iterating any agent); elicitation checklist
(job, read/write surface, loop bounds, delegation, never-do, failure modes → suggested
eval cards); drives factory; drafts eval cards for Daniel's blessing; kit/fleet-floor/
factory inheritance stated so nothing agent-general lands in a def.
Acceptance: fresh-context codex worker, given ONLY the skill, produces a correct toy
agent (def+memory+suite drafts) in a scratch dir; toy artifacts deleted after grading;
skill file ≤ existing curated-skill length norms.

### Task C: Grades-history panel

**Files:**
- Create: `dashboard/src/views/agentPlatform/panels/GradesHistory.panel.tsx` + test
- Modify: server panels module: read-only `/api/panels/grades-history?agent=` sourcing
  the pinned grades ledger (incl. `worker=eval-suite` rows, visually distinguished)

Acceptance: per-identity timeline with grade, source (eval vs task), date; filterable;
read-only; manifests + vitest + tsc green.

### Task E: U7 regrounding-hook rework

**Files:**
- Modify: `scripts/hooks/regrounding_hook.js`, `tests/test_regrounding_hook.py`,
  `docs/proposals/regrounding-hook.md` (arming section updated to three registrations)

Per the ruling header already in the proposal: SessionStart(source: compact) always
injects; PostToolUse + UserPromptSubmit consult a shared state file
(`%LOCALAPPDATA%/kb-regrounding/state.json`, throttle: inject if ≥25 tool calls or
≥30 min since last injection, both configurable via env with those defaults); payload
byte-stable; every unhappy path still `{}`/exit 0/empty stderr. Inert-guard tests stay
green (still NOT registered anywhere).
Acceptance: new tests cover throttle-hit, throttle-skip, compact-source always-inject,
state-file corruption → fail-open; pytest green.

### Final task: Morning deliverable

- Relaunch :4630 display build on the night's tip (same state root, display-only).
- Write `MORNING-REPORT-WAVE2.md` at worktree root: per-function summaries FIRST
  (Daniel's ask), then per-task evidence (commits, proofs, reviews, parks + diagnosis),
  then his morning gates verbatim from the spec.
- Append lessons to `memory/claude-boss.md`; update personal memory arc files; push.

---

## Order & parallelism

F → G (serial, cheap) → then A ∥ D (disjoint files) → B (after A: reuses factory
learnings) ∥ C (after D: panel patterns fresh) → E → Final. Dashboard tasks (D, C)
never parallel with each other; agent tasks (A, B) never parallel with each other.

## Self-review (done)

Spec coverage: A–G all mapped; morning deliverable = spec's morning gates + Daniel's
dashboard+summaries ask. No placeholders; interfaces pinned where tasks touch
(FireResult, RecurrencePicker emit, endpoint paths). Type names consistent.
