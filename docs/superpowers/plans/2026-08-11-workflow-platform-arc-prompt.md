# RUN PROMPT — Workflow Platform Arc

Feed this prompt to a boss session to execute the arc. Authority: the Daniel-approved spec
`docs/superpowers/specs/2026-08-11-workflow-platform-design.md` (read it FIRST; it wins on any
conflict with this prompt). Today-relative dates resolve from the session date.

---

You are the boss session executing the **workflow-platform arc**. Do the standard startup
(preamble, memory, `_index.md`), then read the spec above and this prompt fully before acting.

## Standing discipline (all phases)

- **Worktree:** `claude/workflow-platform` cut from `origin/main`, its own worktree under
  `C:/Users/danie/kb-worktrees/`. If the cloud cutover has happened, the equivalent VM path.
  Never build in the main checkout.
- **Delegation:** you orchestrate; claude subagents build. Explicit model per dispatch —
  haiku mechanical / sonnet standard / opus security-critical, design synthesis, and ALL
  adversarial reviews. Workers never commit; you commit after grading. EVERY grade starts
  with the transcript model-grep (BOSS.md rule); ungrepped grades are invalid.
- **Tasklist:** create EXACTLY one task per phase (six tasks), plus none. No micro-tasks.
- **Per-phase skill sequence:** `superpowers:writing-plans` (plan from the spec's phase
  section) → build under `superpowers:test-driven-development` → `code-review` skill +
  separate opus adversarial-review worker briefed to REFUTE → live proof → present Daniel's
  gate → on approval, `commit-commands:commit-push-pr` for the phase PR. Close every session
  with `save-session`; append lessons to `memory/claude-boss.md`.
- **Merge bar (Daniel's mandate):** targeted suites green, `tsc --noEmit` exactly the 7
  baseline errors, opus adversarial review findings closed or Daniel-waived, and a LIVE RUN
  PROOF — green suites alone never count as working.
- **Human gates:** present one at a time, at their phase position, with context in prose
  before any option widget. Dispatch workers in background and end your turn so Daniel's
  messages always reach you.
- **Known baseline:** `workflowRun.test.ts:265` is the one accepted pre-existing failure;
  reconciliation suites are load-flaky — judge them ISOLATED. Never accept any OTHER failing
  baseline without reproducing its cause on stashed changes.

## Phase tasks (objectives + gates; full detail in the spec)

**P0 — Foundation attestation.** Advance the `dashboard-prod` pin to the arc-start main tip
(preserving windowsHide commit `5874532`), rebuild, restart pm2. GATE: Daniel arms via
passkey. File a real no-spend `workflow-def` card. Evidence: multi-stage run live in the
graph, click-in stream, one gate answered in the run tab + one in the inbox, ops ledger row,
queueBridge date-serialization stderr explained. If the daemon already runs on the VM,
attest there instead and skip the pin-advance.

**P1 — Iteration loops.** Research worker (sonnet) mines Daniel's iteration behavior (run
records' steering messages, `orgs/*/knowledge/decisions.md`, `memory/claude-boss.md`) →
termination-rule proposal + external-framework sanity check. GATE: Daniel approves the rule.
Then build `IterationLoop` generalizing `ReviewLoop` (`control/types.ts:157`): def-declared
upstream partner, structured rework requests over the existing commit-lineage channel,
def-declared cycle cap, exhaustion → normal gate surface, loop state on graph agent cards.
Live proof: demo def completes A⇄B and B⇄C cycles once to success and once to park. GATE:
Daniel accepts the phase.

**P2 — Gate push.** Thin desktop notifier subscribed to the daemon's SSE gate events →
native Windows toast with the plain-language ask, click deep-links to the gate's agent card.
No external services. Live proof: toast fires with the dashboard closed; gate answered from
the deep link. GATE: Daniel accepts.

**P3 — Feedback + retro.** Promote AgentWorkPanel operator messages to durable per-agent
feedback items. Retro stage on terminal runs (workflow AND single-agent) proposes diffs to
agent defs / workflow defs / skills with motivating evidence, surfaced human-gated in the
dashboard; approved diffs apply via normal branch flow; skill proposals land in
`skills/learned/`. Nothing self-applies. Live proof: real run → real proposal citing real
feedback; Daniel approves one and rejects one; approved diff hash-verifies on next launch.
GATE: Daniel accepts.

**P4 — Freshness automation.** Automate main→ops sync of `agents/` + `orgs/*/workflows/` +
daemon reload on merge; absorb or supersede PR #52 `sync_daemon_dirs`, never duplicate it.
Live proof: merge an agent-def edit; next launch runs it with zero manual steps. GATE:
Daniel accepts.

**P5 — Dashboard-wide trim.** Fresh bloat inventory (template:
`docs/superpowers/specs/2026-08-04-dashboard-bloat-inventory.md`) → `store.ts`
decomposition, planeB/`timeline/stream.ts` control-path retirement, `Approvals`/
`ApprovalsLive` naming, dedupe/dead-code sweep server + SPA. GATE (early in phase): Daniel
rules whether `queue/approvals/` is load-bearing or retired. Change actual logic — no
bolt-ons, no dead information left behind; combine where possible; full suite + tsc must end
green at baseline. Adversarial review on the decomposition. GATE: Daniel accepts.

## Arc completion

All six phase PRs merged, `save-session` handoff written, memory lessons appended, worktree
swept per BOSS.md ritual. Report: what shipped per phase with evidence links, what was cut,
total spend from ledgers.
