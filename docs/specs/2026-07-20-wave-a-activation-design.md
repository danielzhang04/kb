# Wave A activation — dispatch → governed control plane

Approved by Daniel 2026-07-20 (boss terminal, option card + explicit design sign-off).
Supersedes nothing; implements item 1–3 of the Wave A build list in the 2026-07-19
next-arc handoff (`memory/claude-boss.md` on ops). Chief of Staff is the NEXT leg,
not this one. Signed-T3 fast-lane is explicitly OUT (deferred to its own wave).

## Goal

Cards owned by a fleet agent and marked `execution-controller: dashboard` execute
through the governed control plane (`dashboard/server/control/`) via the production
`claudeWorkerAdapter`, with results written back canonically — ending in one
SUPERVISED live-fire on the dormant `orgs/kb-ops` `self-lint-report` T1 cadence.
Nothing recurring is enabled by this wave.

## Authorization boundary (binding)

The auto-mode classifier twice denied building live executor activation autonomously;
that stands as a substantive human gate. Daniel's 2026-07-20 direction authorizes the
BUILD. The LIVE flip does not move: everything ships inert and env-gated default-OFF,
and only Daniel sets the gate, in a session he is watching (control-plane design D3).
Gate absent ⇒ the daemon behaves exactly as today: adapter never constructed, no
`claude` subprocess can spawn.

## What already exists (verified in main via PR #33)

- `dashboard/server/control/claudeWorkerAdapter.ts` — production spawner (~530 lines):
  `claude -p --output-format stream-json`, work order over stdin (never argv),
  kill-timeout + output cap, env allowlist shared with `pty/host.ts` (strips
  `ANTHROPIC_API_KEY` and credential-named vars), Evidence held inside an explicit
  INERT CONTEXT BOUNDARY. `claudeSessionAdapter.ts` likewise.
- Injection points — `http/surface.ts` accepts `controlBroker` / `runAutomatic` as
  overrides; production simply never populates them.

## Components to build

### 1. Engine construction + injection (env-gated, default OFF)

Daemon bootstrap constructs the engine and populates `runAutomatic` /
`cancelAutomatic` / `controlBroker` in `makeSurfaceContext` — only when the explicit
env gate is set. Gate name and semantics follow the existing control-plane design
doc's D3 section; the builder follows that doc, not a new invention.

### 2. Queue→engine bridge

- Poller over `queue/{inbox,working}` for cards with `owner == <agent>` AND
  `execution-controller: dashboard`. This is the exact inverse of
  `agent_runner.ps1:204`'s filter — that frontmatter flag is the sole arbiter
  between the two executors and the double-execution guard. Preserve it exactly.
- Card body → work order using the inert-context prompt pattern of
  `agent_runner.ps1:290–350`. Card `## Evidence` never enters the prompt as
  instructions (constitution rule).
- `## Result` writeback via `canonicalResultIntegrator.ts` (the file integrator is a
  self-documented decoy) inside `write/asyncGit.ts#withOpsTransaction`, then
  `cards.transition`.
- Cost accounting to BOTH ledgers: fleet `scripts/ledger.py` rows AND the control
  plane's own accounting. They are separate systems, not substitutes.

### 3. Acceptance, staged

1. Synthetic two-stage low-risk acceptance (per the triple-arc HANDOFF): gate ON in a
   session Daniel watches, synthetic card, no real work product.
2. Only after that passes: supervised live-fire on `orgs/kb-ops` `self-lint-report`
   (T1, currently dormant), Daniel watching.
3. `kb-codex-runner` stays DISABLED (disabled 2026-07-20) until Daniel deliberately
   re-enables it after this wave.

## Error handling / safety invariants

- Gate off ⇒ zero behavior change to the running daemon (this is testable: bootstrap
  with gate unset must not construct the adapter).
- Double-execution: a card claimed by the bridge must never also be executable by
  `agent_runner.ps1`, and vice versa — the `execution-controller` frontmatter decides,
  with tests on both sides of the predicate.
- All writes to ops-coordinated files go through `withOpsTransaction`.
- Budget/preamble: bridge runs honor `scripts/preamble.py` semantics (STOP file,
  budget) before dispatching work.
- Adapter invariants (env stripping, stdin-only work order, kill-timeout) are already
  enforced in `claudeWorkerAdapter.ts` and are NOT to be re-implemented or weakened.

## Testing

- Vitest: bridge filter predicate (owner × execution-controller matrix), card→work
  order mapping (Evidence inert), writeback path (canonical integrator inside the
  transaction), gated bootstrap (gate off → no engine; gate on → injected).
- Pytest where the bridge touches python fleet tooling (`cards.transition`,
  `scripts/ledger.py` row emission).
- End-to-end proof = the staged acceptance above, human-supervised by design.

## Execution

Fresh worktree `kb-worktrees/wave-a-activation` (branch `claude/wave-a-activation`,
off main 2031663). SDD: fresh Opus 4.8 implementer + fresh Opus 4.8 reviewer per
task, boss terminal orchestrates. Work products stay on this branch; coordination
writes go to ops per constitution.
