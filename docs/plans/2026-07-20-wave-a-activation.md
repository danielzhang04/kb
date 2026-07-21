# Wave A activation — implementation plan

Implements `docs/specs/2026-07-20-wave-a-activation-design.md` (binding) and the D1–D8
activation decisions in `docs/specs/2026-07-19-executor-activation-and-integrations-design.md`.

**Authorization boundary (unchanged, binding).** Everything below ships **inert and
env-gated default-OFF**. The gate is `DASHBOARD_EXECUTION_ACTIVATED === '1'` (D3). With the
gate absent, the daemon must behave byte-for-byte as today: no engine constructed, no broker,
no `claude` subprocess reachable. The LIVE flip (setting the gate, in a watched session) is
Daniel's and Daniel's alone — it is **not** part of any code task here. `kb-codex-runner`
stays DISABLED until Daniel re-enables it after this wave.

**SDD.** Fresh Opus 4.8 implementer + fresh Opus 4.8 reviewer per task; boss terminal
orchestrates. Work products stay on `claude/wave-a-activation`. Coordination writes go to
`ops` per constitution — and **only** via the designated steps in T7/T8 (the human-supervised
acceptance), never from the build tasks.

**Ground-truth note.** Line numbers in the design docs were not trusted; every file/function
below was read in this worktree. Where a design bullet and the code disagree, the code wins and
the discrepancy is called out.

---

## Decisions needed (boss decides — do not silently pick)

### D0 — CRITICAL: the canonical integrator is hard-bound to `workflowCardId(runRef, stageId)`; the bridge cannot push an arbitrary pre-existing fleet card through canonical writeback

**What the code actually enforces** (verified, not from the design):

- `dashboard/server/control/canonicalResultIntegrator.ts`
  - `CANONICAL_RESULT_CARD_SCRIPT` requires `card.meta["id"] == cardRef`, `card.meta["workflow"] == runRef`, and `card.meta["execution-controller"] == "dashboard"` (the embedded Python raises `ValidationError` otherwise).
  - `readState()` validates every journaled record with `record.cardRef === workflowCardId(record.runRef, record.stageId)`, and `integrate()` rejects unless `input.canonicalCardRef === workflowCardId(input.runRef, input.stageId)`.
- `dashboard/server/write/workflowRun.ts#workflowCardId(runId, stageId)` is a **deterministic derivation** of the card id from the run + stage. An arbitrary fleet cadence card (e.g. the dormant `self-lint-report` card) has an id chosen by `cards.new_id()` and a `workflow: null`; it can **never** equal `workflowCardId(runRef, stageId)` for a runRef minted later.

**Consequence.** The Wave-A design §2.2 ("card body → work order … `## Result` writeback via
`canonicalResultIntegrator.ts` … then `cards.transition`") cannot be read as "take the fleet
card as-is and let the engine write its Result." The engine's only reviewed, D4-approved
writeback path (`createCanonicalGitResultIntegrator`) will refuse any card it did not name. And
D4 explicitly forbids the app-local `createFileResultIntegrator` for activation.

**Resolution options** (pick one):

- **Option A — Bridge synthesizes a workflow-shaped run that *mints* the canonical card; the
  fleet trigger card is only a signal.** The bridge, on seeing a dashboard-marked trigger card,
  compiles a one-stage `kb.plan-proposal/v1` and drives it through the **existing, already-built
  launch machinery** (`dashboard/server/workflows/compile.ts` + `control/launch.ts#executeApprovedLaunch`),
  which creates a canonical card named `workflowCardId(runRef, stageId)`, links it to the stage,
  and (gate on) calls `runAutomatic`. The engine's canonical integrator then writes `## Result`
  into *that minted card* and transitions it to done — every existing invariant intact.
  - *Blast radius:* **smallest / lowest-risk.** Zero change to `canonicalResultIntegrator.ts` or
    any reviewed security-critical code. Reuses the 6-pass-reviewed launch path. Cost: the fleet
    trigger card and the minted canonical card are two different cards; the bridge must reconcile
    the trigger card (e.g. transition it to done/blocked with a pointer to the run) so it is not
    re-picked. For the Wave-A live-fire this is cleanest if `self-lint-report` is shipped as an
    `orgs/kb-ops/workflows/self-lint-report.md` **workflow definition** launched via the existing
    `POST /api/workflows/:id/launch` route — the queueBridge then only needs to exist for the
    *synthetic* acceptance, and the live-fire rides the launch route. **Recommended.**
- **Option B — Add a second, equally-transactional canonical writeback path keyed by an
  arbitrary existing card id.** Introduce a sibling of `createCanonicalGitResultIntegrator` (or a
  parameter) that accepts `canonicalCardRef = <existing fleet card id>` and drops the
  `workflowCardId` identity checks, keeping every other invariant (ops-transaction, `workflow ==
  runRef` stamp, `execution-controller == dashboard`, digest/lineage, single-`## Result`).
  - *Blast radius:* **large.** Touches the most security-sensitive, most-reviewed module in the
    control plane; each removed identity check is a new proof obligation; needs its own adversarial
    re-review. Still requires stamping the fleet card's `workflow: runRef` before integration.
    Only choose this if fleet cards genuinely must retain their original ids through execution.
- **Option C — Rename the fleet card to `workflowCardId(runRef, stageId)` at claim time.** The
  bridge renames/rewrites the trigger card in place so its id matches the minted run.
  - *Blast radius:* **medium and semantically ugly.** Rewriting a card id breaks `depends-on`
    back-references, dispatch/ledger provenance, and any external reference to the card; violates
    the "id is stable identity" assumption across `scripts/cards.py`. Not recommended.

**Recommendation: Option A.** It is the only option that changes no reviewed code, and it matches
the executor-activation design's own D15 ("run workflows through the EXISTING launch path")
better than a bespoke card executor. Under Option A, T4/T5 below are written against the
compile→launch machinery, and the live-fire (T8) is a workflow-definition launch. If the boss
wants raw fleet cards to execute *as themselves* (Option B), T4/T5 change materially and a
canonical-integrator re-review task must be inserted — flagged inline.

### D1 — The single dashboard executor subject / agent id
The broker persistence is **subject-scoped** (`brokerStore.ts#createSubjectBrokerPersistence(store, subject)`)
and `surface.ts` holds exactly one `controlBroker`. So Wave A runs under **one** dashboard subject.
The executor-activation design says `owner == dashboard-engine` (D5). **Decision:** confirm the id
(proposed: `dashboard-engine`) used as (a) card `owner` for bridge-claimed cards, (b) broker
persistence subject, (c) fleet ledger `agent` for cost rows, (d) `subject` passed to
`runToBoundary`/`cancelRun`. Recommend a single dedicated id, registered in the agent registry.

### D2 — Which `PolicyEnvironment` the engine holds
`AutomaticExecutionOptions.policy` is a **single** `PolicyEnvironment` fixed at construction, but
`loadPolicyEnvironment(repoRoot, project, refs)` (`control/environment.ts`) is project-scoped, and
runs may span projects. The engine passes each run's own `project`/`governanceRefs` into
`evaluateExecutionPolicy(..., this.options.policy)` at stage time, so the held env's **profiles +
curatedSkills** must be global and only `governanceRefs` vary per run. **Decision:** confirm that
`loadPolicyEnvironment` yields globally-valid profiles/curatedSkills (implementer verifies in
`environment.ts`); if it is genuinely project-scoped, the engine must be constructed per-project or
the load must be widened. Recommend loading once with the ops project and verifying profile globality.

### D3 — Manager adapter realization (real `claude` manager vs. no-subprocess stub)
`ManagerAdapter` has **no production constructor** today (only an inline fake in
`execution.test.ts`). `AutomaticExecutionEngine.ensureManager` calls `managers.ensure(...)` then
marks the session running; the DAG itself is driven **in-process** by `runToBoundary`, not by a
manager LLM. **Decision:**
- **(a)** broker-backed real `claude` manager session via `claudeSessionAdapter` (design §2 literal
  reading) — spawns a second `claude` per run, more cost/surface; or
- **(b)** a minimal manager adapter whose `ensure()` is idempotent and spawns **no** subprocess
  (records the logical manager as ensured), since the engine coordinates in-process. **Recommended
  for Wave A** — lower blast radius, no extra spawn, sufficient for single-stage T1 runs; defer (a).

### D4 — Where the fleet (`scripts/ledger.py`) cost row is emitted
D8 says "the accounting adapter also appends `scripts/ledger.py` cost rows." But
`AccountingAdapter.settle({operationKey, reservationRef, usage})` (`execution.ts`) has **no model
and no card id** in scope, and `ledger.append` / the routed-vs-ran audit want `usd`, `model`,
`card_id`. So an accounting-adapter wrapper structurally cannot emit a compliant row. **Decision:**
emit the fleet cost row from the **bridge/post-run seam** (T5), where `runRef`→stage routing
(`model`) and the canonical `card_id` are known and usage is readable from the control-plane run
detail. Recommend the bridge seam; keep the control-plane accounting adapter unmodified (the "both
ledgers" invariant is satisfied — control-plane accounting via the engine, fleet ledger via the
bridge).

### D5 — `pm2.config.cjs` gate default + roots/base-commit resolution
`DASHBOARD_EXECUTION_ACTIVATED` is documented but read **nowhere** in code today, and is **not** in
`pm2.config.cjs`. **Decision:** ship `pm2.config.cjs` with the var **unset** (a commented
placeholder documenting the one-line flip), so default is OFF and the committed repo is inert; the
bootstrap reads `process.env.DASHBOARD_EXECUTION_ACTIVATED === '1'`. Also confirm the engine's
`worktreeRoot` location (proposed: `<DASHBOARD_STATE_ROOT>/control/worktrees`) and the immutable
`baseCommit` source for `createCanonicalGitResultIntegrator` (proposed: `git rev-parse HEAD` of the
ops `repoRoot` at boot, asserted to match `/^[a-f0-9]{40}$/`). These are construction params, not
policy — but they must be pinned somewhere; confirm the location.

### D6 — Documenting `execution-controller` in `governance/card-schema.md`
`execution-controller` is load-bearing (it is the double-execution guard) but is **absent** from
`governance/card-schema.md` (verified). `governance/` is **human-edited only** (constitution). So
this plan **cannot** edit it. **Decision:** the boss/human should add `execution-controller:
dashboard|<null>` to the schema. This plan emits a `docs/proposals/` note requesting it (T3) rather
than touching governance.

### D7 — Preamble enforcement mechanism in the bridge
The bridge must honor `scripts/preamble.py` semantics (STOP file, `ANTHROPIC_API_KEY` unset, daily
budget) before dispatching (design §"Error handling"). **Decision:** shell `python
scripts/preamble.py` and gate on exit code (2 = fail), reusing the existing
`write/preambleGate.ts#PreambleRunner` seam already in `SurfaceContext` (`ctx.runPreamble`), rather
than re-implementing the three checks in TS. Recommend reusing `ctx.runPreamble`.

---

## What already exists (verified) vs. what this wave builds

| Piece | File | Status |
|---|---|---|
| `AutomaticExecutionEngine` (DAG driver, `runToBoundary`/`cancelRun`) | `control/execution.ts` | built, tested, **never wired** |
| `WorkerAdapter` (`createClaudeWorkerAdapter`) | `control/claudeWorkerAdapter.ts` | built, inert |
| `ManagedSessionAdapter` (`createClaudeSessionAdapter`) | `control/claudeSessionAdapter.ts` | built, inert |
| `ManagedSessionBroker` | `control/broker.ts` | built |
| broker persistence (`createSubjectBrokerPersistence`) | `control/brokerStore.ts` | built |
| `WorktreeAdapter`/`SkillResolver`/`AccountingAdapter` factories | `control/adapters.ts` | built |
| canonical integrator (`createCanonicalGitResultIntegrator`) | `control/canonicalResultIntegrator.ts` | built, D4-approved |
| workflow compile + launch route | `workflows/compile.ts`, `workflows/routes.ts`, `control/launch.ts` | built; stalls "activation gated" when `!ctx.controlBroker \|\| !ctx.runAutomatic` |
| **`ManagerAdapter` production constructor** | — | **MISSING → T1** |
| **`ExecutionCancellationController` production constructor** | — | **MISSING → T1** |
| **engine assembly + env gate + injection** | — | **MISSING → T2** |
| **queue→engine bridge** (`queueBridge.ts`) | — | **MISSING → T3–T5** |

The launch path already returns `202 … activationGated` (`control/launch.ts` ~L287) when the
broker/executor are absent. **Injecting them (T2) is what makes launches execute** — so much of
Wave A is "construct + inject behind the gate," not new execution logic.

---

## Tasks

Each task: files, exports/interfaces, **test written first**, verification command, reviewer notes.
Verification vocabulary (from `dashboard/package.json`): `npm test` = `vitest run`; single file
`npx vitest run <path>`; `npm run typecheck` = `tsc --noEmit`; strip-types load =
`node --experimental-strip-types <file>`; python `python -m pytest tests/<file>`.

### T1 — Broker-backed `ManagerAdapter` + `ExecutionCancellationController` + shared worker-cancellation registry

The engine cannot be constructed without both (they are mandatory fields of
`AutomaticExecutionOptions`). Neither has a production constructor today.

- **New file:** `dashboard/server/control/managedExecution.ts`
- **Exports:**
  - `createWorkerCancellationRegistry(): WorkerCancellationRegistry` — a tiny map keyed by the
    worker `operationKey` (`automatic-attempt:<attemptRef>`). Methods: `register(operationKey, cancel)`,
    `cancel(operationKey)`, `clear(operationKey)`. Passed as `registerCancellation` into
    `createClaudeWorkerAdapter`.
  - `createBrokerManagerAdapter(options): ManagerAdapter` — implements `ManagerAdapter.ensure`
    (`execution.ts`). Per **D3**, default realization **(b)**: idempotent, spawns no subprocess;
    validates the incoming `profile`/`proposalHash` and returns. (If boss picks **(b→a)**, it wraps
    `broker.start({runRef, sessionRef, role:'manager', profileId, approvedPrompt})` and maps
    idempotency to `broker.isRunning`.)
  - `createBrokerCancellationController(options): ExecutionCancellationController` — `cancelManager`
    → `broker.stop(sessionRef)` (or no-op under D3(b)); `cancelWorker({attemptRef})` → look up the
    registry key `automatic-attempt:${attemptRef}` and invoke the registered `cancel`. Both
    idempotent (missing key = no-op), matching the "injected, idempotent stop authority" contract.
- **Test first:** `dashboard/server/control/managedExecution.test.ts`
  - registry: register→cancel invokes once; double-cancel is a no-op; clear removes.
  - manager adapter: `ensure` is idempotent across repeated calls with the same `sessionRef`;
    throws on missing `profile`.
  - cancellation controller: `cancelWorker` maps `attemptRef` → `automatic-attempt:<attemptRef>`
    and fires the registered cancel; `cancelManager` calls `broker.stop` with the right `sessionRef`;
    unknown refs are no-ops. Use a fake broker + fake registry (no real spawn).
- **Verify:** `npx vitest run dashboard/server/control/managedExecution.test.ts` (green) →
  `npm run typecheck` → `node --experimental-strip-types dashboard/server/control/managedExecution.ts`
  (loads clean under the strip-types floor: no enums/param-properties/namespaces).
- **Reviewer notes:** confirm the `operationKey` mapping is **exactly** `automatic-attempt:<attemptRef>`
  (grep `executeAttemptUnsafe` in `execution.ts`); confirm no path spawns a real process under D3(b);
  confirm idempotency (engine reconciliation calls `ensure`/cancel repeatedly).

### T2 — Engine assembly + env gate + injection into `makeSurfaceContext`

- **New file:** `dashboard/server/control/activation.ts`
- **Exports:**
  - `isExecutionActivated(env = process.env): boolean` — `env.DASHBOARD_EXECUTION_ACTIVATED === '1'`.
  - `buildActivatedExecution(options): { controlBroker, runAutomatic, cancelAutomatic } | null` —
    returns `null` when the gate is off (**the whole point**: gate off ⇒ nothing constructed).
    When on, constructs, in order:
    1. `broker = new ManagedSessionBroker(createClaudeSessionAdapter({ resolveLaunch }), createSubjectBrokerPersistence(controlStore, subject))`.
    2. adapters: `worktrees = createGitWorktreeAdapter(...)`, `skills = createCuratedSkillResolver(policy.curatedSkills)`,
       `accounting = createFileAccountingAdapter(...)`, `results = createCanonicalGitResultIntegrator({ repoRoot, coordinationRoot: repoRoot, integrationRoot, worktreeRoot, stateRoot, baseCommit })`
       (**D4/D5** — canonical integrator, not the file integrator; `baseCommit` = ops HEAD at boot).
    3. `registry = createWorkerCancellationRegistry()`; `workers = createClaudeWorkerAdapter({ resolveToolPolicy: createWorkflowToolPolicyResolver(), registerCancellation: registry.register })`.
    4. `managers = createBrokerManagerAdapter(...)`; `cancellation = createBrokerCancellationController({ broker, registry })`.
    5. `engine = new AutomaticExecutionEngine({ store: controlStore, policy, worktreeRoot, maxConcurrency, budget, worktrees, managers, workers, skills, accounting, results, cancellation })`.
    6. return `{ controlBroker: broker, runAutomatic: (i) => engine.runToBoundary(i), cancelAutomatic: (i) => engine.cancelRun(i) }`.
- **Wire:** `dashboard/server/http/surface.ts#makeSurfaceContext` — after `controlStore` is
  resolved, if `overrides.controlBroker`/`runAutomatic`/`cancelAutomatic` are unset, call
  `buildActivatedExecution(...)` and spread its result (or leave the fields `undefined` when it
  returns `null`). Tests keep injecting overrides, so the security chain and hermetic route tests
  are untouched. **Do not** change `index.ts` bootstrap ordering beyond what `makeSurfaceContext`
  needs; `pm2Entry.ts`/`index.ts` remain the entry.
- **`pm2.config.cjs`:** add a **commented** placeholder documenting the one-line flip
  (`// DASHBOARD_EXECUTION_ACTIVATED: '1',  // Daniel-only live flip`), var **unset by default** (D5).
- **Test first:**
  - `dashboard/server/control/activation.test.ts`: `isExecutionActivated` truth table; gate off ⇒
    `buildActivatedExecution` returns `null` and constructs nothing (assert no broker/engine created —
    inject fakes and assert their factories are never called); gate on ⇒ returns all three fields and
    `runAutomatic` delegates to `engine.runToBoundary`.
  - `dashboard/server/http/surface.test.ts` (extend): **gate unset ⇒ `ctx.controlBroker`/`runAutomatic`/`cancelAutomatic` are `undefined`** (the safety invariant — "gate off ⇒ zero behavior change"); gate set (via injected env) ⇒ fields populated. Assert overrides still win.
- **Verify:** `npx vitest run dashboard/server/control/activation.test.ts dashboard/server/http/surface.test.ts`
  → `npm run typecheck` → **gate-off boot smoke:** start the daemon with the var unset and confirm it
  listens and no adapter/broker is constructed (log-free path); then stop.
- **Reviewer notes:** the null-return path is the **most important test** — verify that with the gate
  off, `buildActivatedExecution` touches none of the construction factories (a lazy/guarded import is
  fine; an eager top-level `new` is not). Confirm `results` is the **canonical** integrator (D4) and
  `ANTHROPIC_API_KEY` handling is untouched (the worker adapter already strips it; this task adds no env logic).

### T3 — Queue→engine bridge: discovery + inverse filter predicate (no dispatch yet)

- **New file:** `dashboard/server/control/queueBridge.ts`
- **Exports:**
  - `bridgeClaimsCard(meta): boolean` — **pure**, the exact inverse of `scripts/agent_runner.ps1`
    (verified L216–221): claim iff `meta['execution-controller'] === 'dashboard'` **AND**
    `meta['owner'] === <subject>` **AND** `meta['state'] ∈ {'inbox','working'}`. Note the ps1 side
    uses `!= 'dashboard'`, so an **absent/null** controller belongs to the ps1 runner and the bridge
    must require the value to **equal** `'dashboard'` exactly.
  - `scanOwnedDashboardCards(...)` — enumerate `queue/inbox` + `queue/working` under the ops
    `repoRoot`, parse each card via a python helper (below) for parse-parity with `cards.py`, and
    return the ids where `bridgeClaimsCard` holds.
  - Poller (`chokidar` is already a dep) or interval, with a single-flight guard and STOP/preamble
    gate (via `ctx.runPreamble`, D7) **before** any dispatch.
- **New python helper:** `scripts/queue_bridge_select.py` (mirrors the
  `CANONICAL_RESULT_*_SCRIPT` embedded-python discipline; uses `cards.parse`) that prints JSON
  `[{id, path, state}]` for owned dashboard cards — keeps parse semantics identical to
  `agent_runner.ps1`. Invoked via `ctx.runPy`.
- **New proposal (not governance edit):** `docs/proposals/2026-07-20-execution-controller-schema.md`
  requesting the human add `execution-controller` to `governance/card-schema.md` (**D6** — this
  plan must not edit `governance/`).
- **Test first:**
  - `dashboard/server/control/queueBridge.test.ts`: the **owner × execution-controller × state
    matrix** — claim only on (`dashboard`, matching owner, inbox|working); reject on absent
    controller, wrong owner, other controller value, terminal states. This is the double-execution
    guard; it must have a test on the bridge side matching the ps1 side.
  - `tests/test_queue_bridge_select.py` (**pytest**): the python selector returns exactly the
    dashboard-owned inbox/working cards from a temp `queue/` fixture and **excludes** absent-controller
    cards (parity with `tests/test_agent_runner.py`'s filter expectations).
- **Verify:** `npx vitest run dashboard/server/control/queueBridge.test.ts` →
  `python -m pytest tests/test_queue_bridge_select.py` → `npm run typecheck`.
- **Reviewer notes:** put the ps1 predicate and the TS predicate **side by side** and confirm they
  partition the card space with no overlap and no gap (absent controller ⇒ ps1 only; `'dashboard'`
  ⇒ bridge only). Confirm the poller cannot dispatch while STOP is present or the preamble fails.

### T4 — Card → run mapping (inert-context work order) and run creation via the launch machinery

Per **D0 Option A**: a claimed trigger card becomes a **one-stage run whose canonical card the
launch machinery mints**; the trigger card is reconciled (not reused as the canonical card).

- **File:** `dashboard/server/control/queueBridge.ts` (extend) + reuse
  `dashboard/server/workflows/compile.ts` and `control/launch.ts#executeApprovedLaunch`.
- **Exports:**
  - `cardToWorkflowRequest(card): {...}` — map the card body sections to a one-stage proposal input:
    `## Work order` → the stage `workOrder` (authoritative); `## Result from …` and `## Feedback`
    → inert dependency/feedback context; **`## Evidence` is excluded entirely** (constitution +
    `agent_runner.ps1` parity — verified: the ps1 prompt builder reads only `Work order`,
    `Feedback`, `Result from …`). The actual worker prompt is assembled downstream by
    `claudeWorkerAdapter.ts#buildWorkerPrompt` (do **not** re-implement it); this task only maps
    card sections → proposal/stage fields so the engine passes the right `workOrder`/scopes.
  - Drive `executeApprovedLaunch` (gate on ⇒ it calls `runAutomatic`); on the returned `runRef`,
    reconcile the trigger card (transition it out of inbox/working with a pointer to `runRef`) so
    it is not re-claimed.
- **Test first:** `dashboard/server/control/queueBridge.test.ts` (extend): mapping puts `## Work
  order` verbatim into the stage work order; **`## Evidence` content never appears** in the mapped
  request (assert absence); `## Feedback`/`## Result from` land as inert context only; risk-tier and
  action/target come from card meta, never from Evidence.
- **Verify:** `npx vitest run dashboard/server/control/queueBridge.test.ts` → `npm run typecheck`.
- **Reviewer notes:** confirm Evidence exclusion is tested with a hostile Evidence body (contains
  fake "instructions"); confirm the mapping never sources `action`/`target`/`risk-tier` from body
  text. **If boss picks D0 Option B/C, this task changes** (map onto the existing card id) and a
  canonical-integrator re-review task is inserted before T5.

### T5 — Result writeback verification + `cards.transition` + dual ledger + preamble gate

- **File:** `dashboard/server/control/queueBridge.ts` (extend).
- **Writeback:** happens **inside the engine** via `createCanonicalGitResultIntegrator` (wired in
  T2), which already does the `## Result` write + `cards.transition` to `done` **inside
  `withOpsTransaction`** (verified: `CANONICAL_RESULT_CARD_SCRIPT` calls `cards.transition`, and the
  integrator's ops writes run under the transaction). This task **verifies** that path end-to-end,
  it does not re-implement writeback.
- **Dual ledger (D4/D8):** after a run reaches a terminal stage state, the bridge emits a fleet
  cost row via `ctx.runPy` → `scripts/ledger.py#append(repo, 'cost', <subject>, {usd, billing:'subscription',
  model, card_id})`, reading `model` from the stage routing and `card_id` from the minted canonical
  card, and `usd` from the control-plane run/accounting usage (`costUsdMicros/1e6`). The
  control-plane accounting row is written by the engine's `AccountingAdapter`; the two ledgers are
  **not** substitutes (D8).
- **Preamble/STOP (D7):** re-assert `ctx.runPreamble` before dispatch (belt-and-suspenders with T3).
- **Test first:**
  - `dashboard/server/control/queueBridge.test.ts` (extend): the fleet-ledger emission seam is
    called once per terminal run with `{usd, billing:'subscription', model, card_id}` and the correct
    values (fake `runPy`); no emission when preamble fails or STOP present.
  - `tests/test_queue_bridge_ledger.py` (**pytest**): feeding the emitted record through
    `ledger.append` produces a `ledgers/cost/<subject>-<date>.tsv` row whose columns include `usd`,
    `model`, `card_id` (compatible with `ledger.cost_today` and the routing routed-vs-ran audit).
- **Verify:** `npx vitest run dashboard/server/control/queueBridge.test.ts` →
  `python -m pytest tests/test_queue_bridge_ledger.py` → `npm run typecheck`.
- **Reviewer notes:** confirm **all** ops-coordinated writes go through `withOpsTransaction` (the
  integrator's do; the ledger emission is a per-writer daily TSV and does not need the ops
  transaction, but confirm it is not double-counted); confirm `usd` is derived, never invented, and
  subscription rows are `0.0` with `billing: 'subscription'`.

### T6 — Gated boot smoke + full-suite gate (the "vitest-green but boot-broke twice" guard)

D7 mandates a **real daemon boot**, because vitest-green code has failed at boot before.

- **New file:** `dashboard/server/control/activation.boot.test.ts` **or** a scripted smoke in
  `scripts/` — boot the daemon **gate-off** (assert listens, inert: no broker/engine) and
  **gate-on with all real adapters but a fake `ClaudeSpawner`** (assert `controlBroker`/`runAutomatic`
  are present and the engine constructs without throwing — no real `claude`). No real subprocess in CI.
- **Verify (full gate):** `npm test` (all vitest) → `npm run typecheck` → `python -m pytest tests/`
  (touched files) → `node --experimental-strip-types dashboard/server/index.ts` boots and listens
  (gate off) then exits cleanly.
- **Reviewer notes:** this is the "does it actually boot" gate; a green unit suite is **not**
  sufficient to call the wave done.

### T7 — Synthetic two-stage acceptance script + runbook (human-supervised)

Per design §3.1 and executor-activation D7: **gate ON in a session Daniel watches**, a synthetic
low-risk **two-stage** workflow, **no real work product**, with fault injection (daemon restart,
Stop, Retry, Reroute, HumanRequest round-trip, publication fault), on the **REAL daemon**, plus a
real `claude -p` echo-style T1 smoke to prove the spawn path under subscription auth.

- **New files:** `dashboard/server/control/synthetic-acceptance.ts` (or `scripts/`) — a scripted,
  idempotent two-stage synthetic run + a `docs/plans/2026-07-20-wave-a-acceptance-runbook.md`
  recording every check and its expected transcript line.
- **This task writes the harness + runbook only.** Running it is a **human-supervised step**
  (Daniel flips `DASHBOARD_EXECUTION_ACTIVATED=1`, watches, runs the script). The script must be
  safe to author/commit inert (it constructs nothing at import).
- **Verify:** `npm run typecheck`; dry-run the harness gate-off (asserts it refuses to run without
  the gate). Live run is **not** a build step.
- **Reviewer notes:** confirm the synthetic card is genuinely low-risk/no-op and cannot mutate real
  project state; confirm every D7 fault (restart/Stop/Retry/Reroute/HumanRequest/publication-fault)
  has an explicit assertion in the runbook.

### T8 — Supervised live-fire runbook (human steps only, no code)

Per design §3.2: **after T7 passes**, a supervised live-fire on the dormant `orgs/kb-ops`
`self-lint-report` T1 cadence, Daniel watching. Per **D0 Option A**, ship `self-lint-report` as an
`orgs/kb-ops/workflows/self-lint-report.md` workflow definition launched via the existing
`POST /api/workflows/:id/launch` route (canonical card minted by the launch path).

- **New file:** `docs/plans/2026-07-20-wave-a-live-fire-runbook.md` — human steps only: preconditions
  (T7 green, STOP absent, budget OK, `kb-codex-runner` DISABLED), the exact flip, what to watch, the
  canonical-card `## Result`/`done` success check, the fleet-ledger `0.0/subscription` row check, and
  rollback (unset the gate, restart) if anything drifts.
- **This task writes the runbook only.** The live flip and run are **Daniel's**, in a watched
  session. No code, no coordination writes from the build.
- **Verify:** N/A (doc). Reviewer confirms the runbook has an explicit rollback and never instructs
  an unattended run.

---

## Cross-cutting invariants every task must preserve (reviewer checklist)

- **Gate off ⇒ zero behavior change.** Bootstrap with the var unset constructs no adapter and
  spawns no `claude` (tested in T2 + T6).
- **Double-execution guard.** `execution-controller` partitions the two executors; tested on both
  the bridge side (T3 vitest) and the ps1 side (`tests/test_agent_runner.py`), with no overlap/gap.
- **Adapter invariants are NOT re-implemented or weakened** — env stripping (`ANTHROPIC_API_KEY` +
  credential-named vars), stdin-only work order, kill-timeout/output-cap all live in
  `claudeWorkerAdapter.ts`/`pty/host.ts` and are reused verbatim.
- **All ops-coordinated writes go through `withOpsTransaction`** (the canonical integrator already
  does; no new bypass).
- **No credential-as-object handling; never touch `ANTHROPIC_API_KEY` logic; never spend real
  money** (synthetic + live-fire are T1/no-op, subscription `0.0`).
- **`governance/` and `CLAUDE.md` untouched** (D6 is a proposal, not an edit).
- **Live flip is Daniel's** (T7/T8 are runbooks; the build ships inert).

## Global verification gate (before calling the wave done)
`npm test` (all vitest green) → `npm run typecheck` (clean) →
`python -m pytest tests/` (touched files green) →
`node --experimental-strip-types dashboard/server/index.ts` boots gate-off and listens →
T7 synthetic acceptance passes on the real daemon (human-supervised) →
T8 live-fire passes (human-supervised). Only then is Wave A complete.
