# Cadence execution profile (P6-F1)

Ruling: Daniel, 2026-09-17 (queue card `3d4e5f60-8192a3b4`, ops branch). Finding: an agent-owner
cadence (a schedule row whose `owner.type` is `agent`, not `workflow`) had no execution profile at
all. When it fired, nothing bounded the launched attempt's tools/model/budget. Nine such cadences
were disarmed on prod for exactly that reason — see
`C:\Users\danie\kb-rehearsal\tooling\rehearsal\p8\prod-schedules-before.json` (before-state
evidence, read-only, not touched by this change).

Ruling: every agent-owner cadence must name an execution profile explicitly. A `cadence` profile
was added for exactly this class of row.

## The field

`workflowProfile` (`Schedule.workflowProfile`, `dashboard/server/control/p2Contracts.ts`) — the
same field name and id-space a workflow stage already uses (`stage.workflowProfile`,
`dashboard/server/workflows/defs.ts`). Reused deliberately rather than inventing a second name for
the same concept.

- **Required** for `owner.type === 'agent'`, and must name an existing server-owned
  `WorkflowExecutionProfile` id (`dashboard/server/control/workflowProfiles.ts`). Enforced at:
  - **create** (`POST /api/schedules`) — `services/scheduleService.ts#createBody` shapes the field
    (present iff the owner is an agent); `schedules/service.ts#ScheduleService.create` checks the
    named id against the real catalog. Missing or unknown → `400`
    (`invalid-schedule-create-body` / `schedule-workflow-profile-unknown`).
  - **arm** (`POST /api/schedules/:id/arm`) — `schedules/service.ts#ScheduleService.setArmed`
    refuses to arm an agent-owner row whose stored `workflowProfile` is missing or names an unknown
    profile: `409 schedule-workflow-profile-required`. Disarming is never blocked (a disarmed
    schedule never launches). This is what makes a **pre-ruling ("legacy") row fail closed**
    instead of silently launching unbounded.
- **Unused** for `owner.type === 'workflow'` — a workflow-owner schedule's profile comes from the
  workflow definition itself (`registeredWorkflowRequest` in
  `dashboard/server/control/queueBridge.ts`); naming one here is refused at create (`400`) since it
  would never be read.

## The `cadence` profile

`dashboard/server/control/workflowProfiles.ts` — same tool set as `research`
(`WebSearch`, `WebFetch`, `Read`, `Glob`, `Grep`, `Write`; `research` already carries `Write` as of
PR #194, so the two lists are identical today). Do not widen it without a fresh ruling.

## The tick path (traced end to end)

1. `scripts/dispatch.py` (the "dispatcher Routine") fires a due cadence and claims the occurrence
   over the schedule Unix socket (`dashboard/server/schedules/socketRoutes.ts`).
2. The store's `claimScheduleOccurrence` (`dashboard/server/control/store.ts`) calls
   `options.renderScheduleClaim`, now passing the schedule's stored `workflowProfile` through.
3. `createPythonScheduleClaimRenderer` (same file) spawns `scripts/cards.py
   --schedule-occurrence-claim`, now forwarding `workflowProfile` on stdin.
4. `cards.py#schedule_occurrence_claim` stamps it onto the rendered card as `meta.profile` for an
   agent owner (required — raises `ValidationError` if absent/invalid, so a malformed claim never
   renders a card at all rather than rendering one that fails four hops later).
5. The card lands in `queue/inbox` with `execution-controller: dashboard`. The TS queue bridge
   (`dashboard/server/control/queueBridge.ts`) picks it up; `cardToWorkflowRequest` requires
   `card.meta.profile` for a bare (non-`workflow-def`) card
   (`requireMetaString(card.meta.profile, 'profile')`, ~line 496) and synthesizes a one-stage
   workflow definition whose top-level `profile:` carries it.
6. `compileWorkflowDef` / `resolveAssignment` and, at launch, `createWorkflowToolPolicyResolver`
   (`dashboard/server/control/claudeLaunchPolicy.ts`) resolve that profile id to the same
   `--allowedTools` cap a workflow stage naming the same `workflowProfile` id would get — an
   agent-owner cadence's launched attempt is capped **exactly as a workflow stage would be**.

**Before this change, step 4 never happened for an agent-owner cadence** (`cards.py` had no
`profile:`/`workflowProfile` parameter at all), so step 5 always refused with a `400`
(`card '<id>' meta 'profile' is required to map to a governed run`) — the schedule ticked and a
card landed in `queue/inbox`, but nothing ever launched from it. That refusal is the
"dispatcher Routine cannot launch" boundary this ruling closes; it was fixable by threading the
field through (steps 2–4 above), not a structural wall, so it was wired rather than reported as a
dead end.

## Re-arming the nine disarmed cadences — a real remaining gap

`prod-schedules.ps1 -ArmFromSnapshot <file>` (`C:\Users\danie\kb-rehearsal\tooling\`, read-only,
not edited by this change) **cannot inject a profile**: it calls only `Set-Armed`
(`POST /api/schedules/:id/arm`) with body `{expectedVersion, idempotencyKey, armed}`. That body's
closed wall (`armedBody`, `services/scheduleService.ts`) has no `workflowProfile` field, and the
script itself has no `-WorkflowProfile` parameter. So on the *already-imported* prod store, arming
any of the nine rows will now correctly fail closed with `409
schedule-workflow-profile-required` until one of:

- `commitScheduleSeedImport` (`dashboard/server/control/store.ts`) now assigns
  `workflowProfile: 'cadence'` to every freshly-imported agent-owner seed row — this fixes any
  **new** environment (rehearsal, tests, a from-scratch store) automatically, but it is gated by
  the seed-import marker (`validMarker`) and never re-runs against an **already-imported** document,
  so it does not retroactively backfill prod's nine existing rows.
- A one-time backfill for the already-persisted prod rows (a schema-version migration edge in
  `dashboard/server/control/migrations.ts`'s `UP_EDGES` ladder, mirroring
  `migrateLegacyStoreLoop`/`migrateLegacyStoreReceipt`, or an operator-run equivalent) was
  deliberately **not** added by this change — it requires regenerating
  `dashboard/server/control/generated/controlPlaneSchema.ts` from its codegen source, which is
  outside this task's scope and risk profile.
- Extending `prod-schedules.ps1` with a `-WorkflowProfile` (or per-row profile map) option lives
  under `C:\Users\danie\kb-rehearsal`, off-limits to this change (`Do NOT ... touch ...
  C:\Users\danie\kb-rehearsal`).

Until one of those lands, re-arming the nine snapshot rows needs a human step beyond
`-ArmFromSnapshot` alone. This is the fail-closed behavior the ruling asked for (no agent-owner
cadence launches unbounded), not a defect in this change.
