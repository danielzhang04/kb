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

## Amendment 2026-09-21 (review findings C-1/C-2): the allowlist, and which of the nine fit it

Finding C-2: being a **known** profile was not enough for an agent-owner (unattended, periodic)
cadence — `producer` (`['Bash','Read','Write','Edit','Glob','Grep']`, unrestricted shell + file edit)
is a known profile, and nothing stopped an operator or a future automated seed importer from naming
it on an agent-owner row, reproducing almost exactly the unbounded-unattended-worker hazard this whole
ruling exists to close.

Fix: `dashboard/server/control/workflowProfiles.ts#AGENT_CADENCE_PROFILE_ALLOWLIST = ['cadence']`.
`ScheduleService.create` and `ScheduleService.setArmed` (`dashboard/server/schedules/service.ts`) both
now check the declared/stored `workflowProfile` against this allowlist, IN ADDITION TO the pre-existing
"is it a known profile at all" check — a known-but-not-allowlisted profile is refused with
`schedule-workflow-profile-not-allowed` (`400` on create, `409` on arm). `commitScheduleSeedImport`
(`dashboard/server/control/store.ts`) needed no change: it already unconditionally assigns
`workflowProfile: 'cadence'` (or `null` for a workflow owner) server-side — `PreparedScheduleSeed`
(`dashboard/server/schedules/seedImport.ts`) carries no `workflowProfile` field at all, so there is no
input for a seed to "name another profile" through in the first place. Widening the allowlist beyond
`{cadence}` needs a fresh ruling, not a code change alone.

Finding C-1: `cadence`'s tool set (`WebSearch`, `WebFetch`, `Read`, `Glob`, `Grep`, `Write` — no
`Bash`) genuinely cannot run `nightly-review`/`weekly-audit`'s prompts, which say verbatim "Run:
python scripts/preamble.py" and "Commit ... to ops and push." **Those two cadences are NOT made
re-armable by this allowlist and are not intended to be** — they stay served by the cloud dispatcher
leg (the `tier: cloud, agent: dispatcher-cloud` HEARTBEAT.md cadences), outside the dashboard's own
schedule-store arm/disarm surface, and were already `armed: false` in the dashboard store before this
amendment (`prod-schedules-before.json` rows `ceef96b6…` and `81e283bf…`). A future ruling that wants
to re-arm them through the dashboard store would need either a new bounded profile carrying a
narrowly-scoped `Bash` or a rewrite of those two prompts to work within `cadence`'s tool set — this
amendment does neither.

### Which of the nine disarmed rows fit `cadence` as-is

The nine rows in `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p8\prod-schedules-before.json` that
were `armed: true` in that "before" snapshot (and were disarmed by the original P6-F1 ruling for
carrying no profile at all — distinct from the two dispatcher-cloud rows above, which were already
`armed: false` before this snapshot) belong to seven agents. Read from each agent's own declaration
(`agents/<id>.md`, `origin/ops`) rather than root `HEARTBEAT.md` (which today only declares the
dispatcher-cloud and desktop-tier cadences, not these seven agents' — their cadence prompts live in
their own agent files, referenced by `EXPECTED_SEED_OWNER_BY_CADENCE` in
`dashboard/server/schedules/seedImport.ts`):

| Owner (rows) | Cadence prompt shape | Fits `cadence`? |
|---|---|---|
| `hygiene` (×3: root `HEARTBEAT.md` weekly:sun + `15 3 * * 0`, `orgs/kb-ops/HEARTBEAT.md` daily) | "declared tool-free worker" reads evidence, produces a report + at most 5 proposal records, "publish[es] in coordination mode straight to ops: no PR"; never deletes/edits/merges/pushes | **Yes** |
| `context-lifecycle` (daily `15 1 * * *`) | same shape, "declared tool-free worker," never edits a proposal target or changes hooks/settings | **Yes** |
| `model-audit` (weekly, `45 2 * * 1`) | same shape, "declared tool-free worker," never edits governance/routing/agent declarations | **Yes** |
| `system-sweeper` (every 15 min) | reads a snapshot and "run[s] runSweeper over read-only ports," emits reconciliation intents for a server-owned publisher to apply (no PR, no direct mutation); "[n]ever mutate cards, Inbox state, schedules, HEARTBEAT files, git, or ledgers" | **Likely yes** — no prompt line names a script invocation the way the dispatcher-cloud cadences do, but this is a judgment call, not a traced fact; confirm the emitted-intent write is a plain `Write` before re-arming |
| `grader` (daily `15 2 * * *`) | reads pinned rows "via `agent_evals.py#run_suite(...)`" | **No, as written** — invoking a named `.py` entry point the way `nightly-review`/`weekly-audit` invoke `scripts/preamble.py` needs `Bash`; the report/records output alone would fit `cadence` |
| `lessons-miner` (daily `45 1 * * *`) | reads evidence "by running `session_miner.py` + `agent_maintainer.py#run_fire(...)`" | **No, as written** — same reason as `grader` |
| `learnings-implementer` (daily `30 3 * * *`) | "[a]pply the smallest tested batch on one work branch and open exactly ONE... PR... through the durablePrWrites publisher" | **No** — needs `Bash` (tests, git branch) and `Edit`, and a PR-open capability no default profile grants |

Re-arming any of these still needs the human backfill step described above (the seed-import path does
not retroactively touch already-persisted prod rows); this table is scoping information for whoever
does that, not an instruction to re-arm them.
