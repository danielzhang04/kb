# KB VM platform: architecture audit and overhaul proposal — DRAFT

Prepared 2026-09-06 on `codex/kb-platform-overhaul-20260906`.
Audit baseline: `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea` (main after PR #172).
Outage evidence: ops commit `913011cceb3bd0170fa8b29960ecefded03d456b`,
`handoffs/2026-09-06-dashboard-outage-recovery.md`.
Pending repair inspected: `e8bf8d35` / PR #173; not part of the audit baseline.

## Assessment

KB has substantial working machinery and serious investment in local correctness.
Its weakness is the consistency of the complete execution path. State ownership,
failure reporting, broker/process lifecycle, UI contracts, and release helpers have
evolved independently. The integration code now carries much of the platform's
complexity. The September 6 outage is a concrete example: a per-run writer accepted
valid state that a whole-document reader later rejected when another run existed.

The highest-value overhaul is to simplify runtime authority and prove the real
workflow path early. Preserve the useful governance, runtime confinement, immutable
provenance, and explicit human decisions. Replace duplicated lifecycle rules and
manual synchronization with a small number of typed, transactional boundaries.
File splitting alone will not accomplish that.

The proposed default is a modular application with one local runtime database and
one write interface, retaining the lower-privilege worker/PTY broker. SQLite WAL is
a candidate for the current single-VM baseline. A narrow Temporal comparison and
realistic load/recovery tests must challenge that choice before migration. There is
no demonstrated need here for Kubernetes, Redis, or a new microservice estate.

## Read this packet

September 6 follow-on: Daniel requested all capabilities and a pre-build summary.
Read the [implementation sequence](implementation-sequence.md) for the current
delivery proposal. It refines the original plan's early vertical/dashboard gates
and removes silent capability retirement as a default. No implementation has begun.

| Document | Purpose |
| --- | --- |
| [Implementation sequence](implementation-sequence.md) | Current pre-build proposal, bounded packages, dashboard journeys and initial scopes |
| [Design synthesis](synthesis-reports/implementation-prebuild/report.md) | Source briefs, three review perspectives, and disposition of design objections |
| [Overhaul plan](overhaul-plan.md) | Phases, affected code, acceptance gates, cutover/backout and capability preservation |
| [Architecture brief](architecture-brief.md) | Desired behavior, design reasoning, assumptions and non-negotiable boundaries |
| [Execution audit](execution-audit.md) | Store, execution, worker/session, iteration and error-path findings |
| [Operations audit](operations-audit.md) | Scheduler, VM deployment, outbox, health and desktop hazards |
| [Surface and coverage](surface-and-coverage.md) | Inventory, module sizes, UI/API traces and coverage limits |
| [Per-file inventory](platform-file-inventory.tsv) | 1,120 tracked platform paths, classification, physical line count and lane coverage |
| [Supporting subsystem audit](supporting-audit.md) | Declarations, learning/reconciliation, knowledge and placement |
| [Prior-art comparison](prior-art.md) | n8n, ECC, Temporal, LangGraph and Prefect; source status, adopt/adapt/skip |
| [Adversarial review](adversarial-review.md) | Independent challenges, revisions and remaining limitations |

The lower-cost Codex workers authored the investigation reports and plan. The boss
checked source evidence, ran focused gates, challenged speculative claims, and
directed revisions. Requested worker models were `gpt-5.6-terra` and
`gpt-5.6-sol`; independent responding-model and token/cost telemetry were not exposed
by native delegation. These are review reports, not promotion-ledger grades.

## Findings that drive the plan

Severity here reflects practical availability/integrity risk; no new exploitable
security vulnerability is claimed. Supporting reports distinguish observed behavior,
static evidence, historical incident evidence, and unproved risks.

| ID | Finding and consequence | Evidence and status |
| --- | --- | --- |
| F01 / HIGH | Valid state from concurrent runs can fail global hydration, preventing dashboard startup and all its dependent work | `control/store.ts:1695` joins requests without subject/run; recorded September 6 outage. Pending #173 repairs this specific defect. Live recovery not observed here. |
| F02 / HIGH | Three detached route continuations can fail while reporting an execution error, leaving an unhandled rejection that can terminate Node | `control/routes.ts:1730`, `:2504`, `:2601`; source-traced, outside #173. Requires child-process fault regression tests. |
| F03 / HIGH conditional | Desktop wrapper operates in the shared checkout, attempts `git checkout ops`, then pulls/rebases without checking checkout success | `scripts/desktop_dispatch.ps1:10`, `:26`; contradicts BOSS worktree ownership. On the observed worktree layout, `ops` is already elsewhere. Task installation/execution not checked. |
| F04 / capability defect | Windows fallback invokes a scheduler client for a VM-local Unix socket | `scripts/desktop_dispatch.ps1:40`, `scripts/dispatch.py:1214`, `scripts/schedule_store.py:15`. Retire the unsupported story or specify a real fenced remote authority; don't silently create a second scheduler. |
| F05 / MEDIUM | Runtime health omits proxy/map failures by supplying constant healthy inputs | `dashboard/server/health/routes.ts:45`; source-confirmed placeholders. Whether these components are required or retired must be explicit. |
| F06 / MEDIUM | Run-detail read tests write the default user naming registry; a presentation dependency can fail the GET | `dashboard/server/naming.ts:70`, `:94`, `:110`; `control/routes.ts:207`. Two tests failed with EPERM, then both passed with isolated state. |
| F07 / delivery gap | The committed release workflow runs on main push, builds Linux artifacts, and omits the TypeScript test suite | `.github/workflows/kb-platform-release.yml:2`, `:23`. Manual checks exist in the handoff; this workflow does not enforce them before producing the release. |
| F08 / HIGH capability gap | Production composition does not supply the node placement dependencies, so the intended cross-host claim/renew/report routes are never registered | `dashboard/server/index.ts:145`, `:220`; `api/v1/routes.ts:195`. Does not mean all single-VM execution is unavailable. |
| F09 / HIGH capability gap | Seven System learning paths exist as tested library functions without the schedule-FIRE binding that invokes them | `dashboard/server/learnings/execution.ts:18`; its explicit wiring disclosure is corroborated by caller tracing. The Implementer poll starts with no recorded batches. |
| F10 / HIGH before enabling placement | Lease renewal/report validation accepts missing fresh capability evidence | `dashboard/server/placement/leaseService.ts:108`, `reportService.ts:110`. Boss independently reproduced renewal returning success with no advertisement. Latent while F08 prevents production binding. |
| F11 / MEDIUM | Open Implementer PR tracking is process-local and is not reconstructed at restart | `dashboard/server/learnings/execution.ts:350`. Must be fixed when wiring F09, or work can be stranded after a restart. |
| F12 / MEDIUM | Brain search lacks a source-revision freshness contract | `scripts/brain/store.py:93`; `dashboard/server/brain/routes.ts:70`. An embedding-model fingerprint does not prove corpus freshness. |
| R01 / unproved risk | Lock drops wiring before asynchronous drain is complete; generation ownership is implicit | `control/activation.ts:801`. Initially overstated as a Windows HIGH; boss challenge found normal microtask ordering prevents the proposed simple HTTP trigger. Retained as MEDIUM design/coverage risk, not a demonstrated duplicate launch. |

All `control/` paths in this table are beneath `dashboard/server/`.
The queue bridge's attempted-as-`dispatched` count is low-priority naming debt;
no current production consumer was found, so it is not a headline bug.

## What the outage history reveals

The handoff records repeated failures in five classes, not twenty unrelated reasons
to add new special cases:

1. **Two sides disagree about a protocol.** Operation keys, cursor/revision meanings,
   DTO fields, runtime argv/stdio, and prompt/result contracts diverged. Move their
   definitions to shared/generated boundary contracts and test real producers
   against real consumers.
2. **More than one component owns a lifecycle.** Session binding, exit observation,
   queue claims and canonical integration crossed independently evolving stores.
   Assign one owner; preserve the necessary intent/receipt boundaries around effects.
3. **Failure reporting depends on the failing subsystem.** Hydrate refusal triggers
   another store read inside a detached error handler. Use never-throw supervisors
   and diagnostics that do not require a healthy run store.
4. **A release is an incomplete operational unit.** Resident validators, systemd
   contracts, broker artifacts and data mirrors can be out of step with application
   code. Verify a versioned compatibility set, plus a broken-daemon recovery path.
5. **Tests stop before the real seam.** Mocks proved component behavior while actual
   CLI/broker execution remained untried. Add a Linux vertical harness and separately
   report live model execution, artifact correctness and operator usability.

The source already has writer leases, CAS, idempotency, quarantine/restore support,
schema generation, an outbox, and integration tests. The plan extends and consolidates
these; it must not describe them as absent. In particular, `control-plane.json`
already lives outside Git. Git is only one part of the multi-store coordination path.

## Where public platforms help

The comparison is by mechanism and inspected evidence, not stars or a claim that
popular software cannot fail. Detailed primary links and source-reading limits are
in [prior-art.md](prior-art.md).

| Reference | Useful lesson | KB decision |
| --- | --- | --- |
| n8n | Separate persisted execution, workflow engine, worker capacity and task-runner isolation | Adopt the separation and real deployment/worker tests; preserve KB-specific authority and broker controls |
| ECC (Everything Claude Code) | Task-scoped skills, harness adapters, memory trust and repeatable review | Selectively adapt existing curated skills; ECC is not a durable VM orchestration engine |
| Temporal | Durable history/task delivery, deliberate activity retries and deterministic replay | Run a narrow comparison before committing to custom recovery complexity |
| LangGraph | Checkpoints and durable human interrupts, with idempotency around resumed nodes | Useful worker-level semantics; not a replacement for platform authorization/deployment |
| Prefect | Explicit run states and worker/pool contracts | Useful vocabulary for supported capabilities and visible pause/failure states |

KB's reviewed policy files, worktree/artifact provenance, cross-runtime roles and
content-bound human approvals can fit Daniel's work better than a generic automation
product. This is a design-fit advantage. No throughput, cost, quality, or security
superiority was measured.

## What “working” must mean

A definition resolves defaults, launches a real supported worker, produces a verified
artifact, and ends in the same state in the runtime repository, UI and exported work
record. It must also survive a restart at each important effect/receipt boundary.
Two runs with identical stage names must coexist. A stopped worker or stale approval
must not act on a replacement generation. One malformed historical run must not
hide the status of unrelated work; a physically corrupt database must close
execution and leave an independent diagnostic/restore path.

The acceptance harness must exercise scheduled and manual launch, fan-out and
consolidation, a producer/checker iteration, a human pause/resume, terminal
attach/disconnect, broker loss, outbox backpressure, restore to an empty instance,
and extension with a small new adapter. These are separate from “all unit tests pass.”

Slimness is measured by fewer authorities, transitions, adapters, contract copies,
manual release steps, and extension touchpoints, with source size as supporting
evidence. Every replacement has a retirement proof; no arbitrary line target
justifies weakening a test or removing a safety boundary.

## Verification and scope

Boss ran 156 focused Python cases successfully. In three focused TypeScript files,
23 cases passed and two run-detail cases failed because they wrote real user state;
the two then passed with an isolated state root. The execution investigator reports
402 passing focused TypeScript cases in four other files and 123 in eight supporting
subsystem files. This totals 706 passing selected cases across the bounded runs
(worker counts are attributed, not independent boss reruns), with the initial two failures and
environment corrections preserved in the supporting reports. It is not a full-suite
or Linux/VM acceptance result.

The baseline repository has 2,438 tracked files. The platform inventory covers 1,120
tracked paths in the specified source/test/deployment/schema families; semantic
review is deeper on critical paths and limited elsewhere. The coverage manifest and
per-lane reports state which files were read, traced, or only inventoried. This is a
comprehensive architecture assessment, not a claim that every source line has been
audited or that hidden bugs are exhausted. Project business logic and secret-bearing
files are excluded. No production system was accessed or changed.

## Decisions still needed from Daniel

Three questions were sent during the audit: the three highest-priority real workflows,
whether the deployment target is one VM or also desktop execution/multiple hosts,
and whether this first task should remain audit/plan or include implementation.
Until answered, the plan assumes audit/plan only and the present single-VM topology.
Historical standing preference is preserved: workflows supply default managers and
agent chains; agents supply default models, with optional overrides.

Before migration, choose acceptable recovery time/data loss, expected concurrency,
and offline publisher duration. The plan supplies workload hypotheses and bounded
experiments so these choices can be concrete. In particular, “VM continues locally”
and “all results are already published to remote Git” are distinct promises when the
trusted promoter is offline.
