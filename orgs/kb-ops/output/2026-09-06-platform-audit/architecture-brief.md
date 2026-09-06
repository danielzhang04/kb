# KB platform overhaul: design brief — DRAFT

Date: 2026-09-06. Author: Codex boss session (`codex-worker` identity).
Source: `origin/main` at `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`.
This is an architecture proposal, not authorization to deploy or change governance.

## Outcome

Daniel can define an agent once, give a workflow a default manager and agent chain,
launch or schedule it without assigning models each time, watch real work, steer
or stop it, answer meaningful gates, and retrieve verified outputs. Reboot,
worker failure, broker disconnect, a malformed historical run, and temporary Git
unavailability produce bounded, visible states with recoverable work. Adding a
runtime, workflow, or project should not require changing the execution engine.

Preserve all current intended capability families: agent declarations and versions;
skills and scoped memory; model routing; task/card intake; workflow compilation,
DAGs, fan-out/consolidation, bounded iteration; scheduler; process supervision;
interactive terminals and replay; human decisions and authorization; artifacts and
lineage; dashboard/CLI/API; health, reconciliation, independent grading and learning
proposals; deployment, backup/restore, and desktop connectivity. Do not confuse a
declared feature with a feature demonstrated working on the VM.

## Current assumptions and open questions

The user has been asked for three priority workflows, deployment topology, and
whether this task includes implementation. Pending answers, the scope is a complete
architecture audit and overhaul plan; current single Linux VM is the planning
baseline, with desktop/browser clients and an executor interface permitting later
desktop workers. No production changes are authorized by this brief.

Further decisions should be asked when they change the design: tolerated loss of
accepted work, recovery time, required concurrency, disconnected operation duration,
whether the desktop must be on for archival publication, and desired automatic
recovery powers. Performance and recovery numbers in the plan are proposed test
targets, never claims about today's platform.

## Working diagnosis

The repeated failures concentrate at ownership and protocol boundaries. The outage
handoff reports two runs whose valid state was rejected by an insufficiently scoped
join, followed by an error handler that reloaded the same store and crashed. Earlier
attempts crossed multiple session/state owners, and separately tested server and
client DTOs drifted. Several real worker argv/stdio/uid problems were discovered only
after deployment. A larger unit-test count has not established an end-to-end system.

Existing `control-plane.json` already lives outside Git; do not falsely describe KB
as storing every runtime event in Git. The actual problem spans an aggregate JSON
store, separate PTY/session documents, Git cards/ledgers, and publication receipts.
Some are legitimate trust boundaries. Remove duplicate *authority*, not every
receipt, signature, or independent witness.

## Architecture direction to test

Keep a modular application with a small number of necessary operating-system
process boundaries. Preserve the lower-privilege PTY/worker broker. Separate web
availability from execution readiness, including a restricted diagnostic surface
when the run store cannot hydrate. A process boundary and a module boundary solve
different problems; do not split every domain module into a service.

Use one local transactional runtime database, provisionally SQLite in WAL mode on
the VM's local disk, behind one service write interface. Remote or local workers
call that interface; they do not open the database or share it on a network
filesystem. Multiple workers do not alone require Postgres. Measure write
contention and upgrade to Postgres only for independently justified multi-writer,
availability, or operational requirements. Compare this option with a narrow
Temporal implementation using the same reference workflow before final selection.
No Redis, Kubernetes, event-bus service, or new microservice estate by default.

Database owns run/stage/attempt state, schedule occurrences, claims, decisions,
resource reservations, event sequence, and pending publication intent. Git owns
reviewed workflow/agent definitions, policy, source code, and exported durable work
records. Files or object storage own immutable artifact and transcript bytes;
database stores digests and cursors. The UI is a projection with no execution state
of its own. The exact Git/card transition requires a human-reviewed governance
amendment; until approved, keep the existing card protocol behind a compatibility
adapter and honor its current authority.

One transition transaction checks expected version and authorization, changes the
target aggregate, allocates events, and writes an outbox record. Enqueue/start and
external effects are not part of a fictitious distributed transaction. Delivery is
at least once; operation IDs and fenced acknowledgments make repeated delivery
safe. After a crash between external effect and receipt, reconcile with the real
provider/process/artifact; if the effect is uncertain and non-idempotent, park for
review. Never promise exactly-once external side effects.

Each attempt gets a distinct immutable ID, pinned definition/profile/version, lease
epoch/fencing token, workspace ownership, resource reservation, and final outcome.
Stopping prevents new starts immediately but does not claim all children are dead.
Draining is an observable state; a new execution epoch cannot accept an old worker's
result. Interactive terminal sessions have their own lifecycle and attach to an
attempt when applicable; output sequence, document revision, and byte cursor remain
different typed fields.

Human task feedback, output acceptance, and authorization for a privileged effect
are distinct resources. Bind privileged grants to the exact action/input digest,
actor, expected version, and expiry; T3 remains the existing human-signed channel.
A resume after changed scope needs a new grant. Keep independent judges, protected
eval manifests, STOP, and token/time/attempt bounds. Models propose semantic work;
deterministic code schedules, retries, measures liveness, and performs bounded repair.

Version one schema at each real trust boundary. Generate or derive TypeScript
types, runtime decoders, fixtures, and Python compatibility readers from it where
appropriate. Never merge different authorization hash preimages merely because
their field names resemble one another. Read responses may support negotiated
additive evolution; privileged commands stay strictly validated.

## Migration conditions

Fix and verify immediate blockers first, including pending PR #173 through its
existing review/recovery ceremony. Do not implement a second outage repair here.
Build a Linux acceptance harness against the shipped binary/uid/stdio/profile path
before large refactoring. Existing tests form regression evidence, not proof of
production success.

Migrate behind current interfaces by bounded capability slices. A shadow database
receives immutable committed observations or a snapshot at a pinned cutoff and
replays idempotently; it never launches work and never becomes a second authority.
Do not introduce uncontrolled dual writes. Freeze admissions and drain/park owned
work for cutover, reconcile a complete ID/digest/count inventory, set one durable
authority marker, then admit new runs. Old incomplete runs are explicitly resumed
through the old engine under disjoint ownership or parked; never guessed migrated.

Rollback before new-authority writes can restore the pinned snapshot. After new
writes, reverting the binary alone is unsafe: use a tested backward-compatible
reader or forward recovery/export. Define this boundary in each phase. Restore
tests include DB-consistent backup, artifacts, approvals, receipts, definitions,
and prevention of duplicate side effects.

## Slimness and extensibility

The target is fewer authoritative stores, transition implementations, bespoke
protocol conversions, configuration owners, and manual operational steps. Track
these with production LOC, largest-module size, transitive dependencies and time
to add a runtime/workflow. Small files created by slicing a giant class are not an
architectural improvement by themselves. No arbitrary LOC percentage gate and no
test weakening to meet a size target.

For each replacement, list exactly which old exports, route implementations,
wrappers, adapters and runbooks retire, with evidence of zero callers and fixture
equivalence. Keep Linux and Windows adapters only for supported capabilities; make
unsupported capabilities explicit. Start with one monorepo and release package,
not a repository split during incident recovery.

## Verification already run by boss

- `python scripts/preamble.py`: PASS.
- `python -m pytest -q tests/test_preamble.py tests/test_schedule_store.py tests/test_queue_bridge_select.py tests/test_validate_vm_runtime.py --basetemp C:/Users/danie/kb/_private/audit-20260906-pytest`: 156 passed.
- Focused Vitest: `runDetailWireContract`, `iterationOutcome`,
  `attemptVertical.integration`, serial, native config loader, cache disabled:
  23 passed, 2 failed. Both failures were the run-detail fixture attempting a write
  to the real user `naming.json`, blocked by the sandbox.
- Rerun only `runDetailWireContract` with an isolated `DASHBOARD_STATE_ROOT`:
  2 passed. Thus all 25 selected cases pass across the original run and bounded
  environment correction; no source or test assertions changed.
- Default Vitest bundled config could not write `.vite-temp` in a shared dependency
  install. `--configLoader native --no-cache` removed that infrastructure obstacle.
- No live VM, browser, full Linux suite, restore drill, or production recovery was
  run. Handoff statements about VM health remain historical evidence.

## Review questions

Does the plan preserve the real privilege boundary while reducing duplicated
state? Does every effect have an owner and uncertain-outcome policy? Can the
operator diagnose a failed store without booting the failed store? Can stopping,
restart and deployment race safely? Can a stale human decision or worker receipt
authorize changed work? Is offline outbox handling bounded without making routine
archival progress depend on daily human intervention? Does adding a new adapter
require only the adapter contract and its conformance suite? Does cutover have one
authority and an honest post-write recovery path? What does each phase delete?
