/**
 * The ONE canonical launch body for an already-approved proposal revision.
 *
 * Every governed launch surface (the manual `POST /api/control/proposals/:ref/revisions/:rev/launch`
 * route and the one-step `POST /api/workflows/:id/launch` convenience route) calls
 * `executeApprovedLaunch`. Nothing else is allowed to re-implement it: a hand-copied fork silently
 * drops route-level controls (idempotency, the policy-snapshot audit, the canonical-base guard), which
 * is exactly the defect this module exists to make impossible.
 *
 * The caller owns only the surface-shaped preconditions — session subject, locating the stored
 * revision, the exact-hash check, and the `approved` decision check. Everything from "reconcile
 * canonical ops" through "publish cards + audit under one ops transaction" lives here and is returned
 * as a transport-neutral `{ status, body }` so each route can serialise it with its own reply.
 */
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { activateManagedRootCards, launchWorkflowRun } from '../write/workflowRun.ts';
import { loadPolicy } from '../routing/policy.ts';
import type { SurfaceContext } from '../http/context.ts';
import { validateServerCompiledPlanProposal } from './proposal.ts';
import { compileApprovedProposal } from './compiler.ts';
import { loadPolicyEnvironment, loadRuntimeSkillRegistry } from './environment.ts';
import { reconcileCanonicalPublication } from './publication.ts';
import type { AgentWorkspaceLaunchProvenance, ControlResult, HumanRequest, JsonObject } from './types.ts';
import { OPERATOR_SUBJECT, type CreateHumanRequestInput } from './store.ts';
import type { InternalServiceCaller } from '../auth/session.ts';

/** A transport-neutral HTTP outcome. Routes serialise it with `reply.code(status).send(body)`. */
export interface LaunchOutcome {
  status: number;
  body: Record<string, unknown>;
}

export interface ApprovedLaunchInput {
  proposalRef: string;
  revision: number;
  /** The exact approved revision hash the caller already verified against the request. */
  storedHash: string;
  snapshot: JsonObject;
  /** The verified session token forwarded to the launch auth gate (never minted here). */
  sessionToken: string | undefined;
  /**
   * A sanctioned internal service caller (the activation-gated queue bridge) that authorizes the launch in
   * lieu of `sessionToken`. Never set by any HTTP launch route (they build this input explicitly and pass
   * only `sessionToken`); only the gated bridge threads it. See `control/activation.ts#createInternalServiceCaller`.
   */
  internalService?: InternalServiceCaller;
  /** Client-supplied launch identity. Empty is rejected by the store, never invented server-side. */
  idempotencyKey: string;
  /**
   * The verified session that AUTHORIZED this launch, when that is not the owner it executes as (ruling
   * 3: a verified operator may launch/retry another subject's approved revision; the run is still
   * created under the REVISION'S OWNER — ownership never moves — and the operator is only the actor).
   *
   * Omitted by every own-subject caller (the workflow route, the queue bridge), so their audit rows and
   * their idempotency keys are byte-unchanged.
   */
  actorSubject?: string;
  predecessorRunRef: string | null;
  expectedPredecessorVersion: number;
  /** Optional provenance discriminator recorded in the launch audit detail (e.g. `workflow:<id>`). */
  source?: string;
  /** Optional, trusted origin resolved by the HTTP workflow route from an owned Composer workspace. */
  agentWorkspaceLaunch?: AgentWorkspaceLaunchProvenance | null;
}

export function statusOf(result: Extract<ControlResult<unknown>, { ok: false }>): number {
  if (result.reason === 'not-found') return 404;
  if (result.reason === 'conflict' || result.reason === 'idempotency-conflict' || result.reason === 'not-approved') return 409;
  return 400;
}

/** The `{ status, body }` a failed store result serialises to (matches routes.ts#sendResult). */
function failure(result: Extract<ControlResult<unknown>, { ok: false }>): LaunchOutcome {
  return { status: statusOf(result), body: { error: result.reason, detail: result.detail } };
}

export function acceptsBoundary(request: HumanRequest): boolean {
  if (request.state !== 'resolved' || !request.response) return false;
  if (request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') return request.response.decision === 'approved';
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

export function defaultWorkers(repoRoot: string): Record<string, string> {
  return Object.fromEntries(Object.entries(loadPolicy(repoRoot).runtimes ?? {})
    .filter((entry): entry is [string, { default_worker: string }] => typeof entry[1].default_worker === 'string' && entry[1].default_worker.length > 0)
    .map(([runtime, spec]) => [runtime, spec.default_worker]));
}

/**
 * Launch an approved revision. One ops transaction: reconcile, compile, publish cards + audit,
 * activate. Nested transaction helpers (prepare/commit/audit/activate) reenter the held lock instead
 * of deadlocking.
 *
 * `sub` is the subject the launch EXECUTES AS — the owner of every record it creates (the run, its
 * stages, attempts, sessions, boundaries, events) and the subject the executor is handed. On a
 * cross-subject operator launch that is the REVISION'S owner, not the caller; `input.actorSubject` then
 * names the caller and appears as the audit row's `owner` beside `detail.runOwnerSubject`.
 */
export async function executeApprovedLaunch(
  ctx: SurfaceContext,
  sub: string,
  input: ApprovedLaunchInput,
): Promise<LaunchOutcome> {
  const { proposalRef, revision, storedHash, snapshot } = input;
  const actorSubject = input.actorSubject ?? sub;
  const crossSubject = actorSubject !== sub;
  /**
   * IDEMPOTENCY SAFETY, both directions.
   *
   * `createRun` keys replay on `(subject, launchOperationKey)` and guards it with a content fingerprint.
   * A cross-subject launch writes into the OWNER's key space, where the owner's own launcher (the queue
   * bridge, keyed `queue-bridge:<cardId>`) already lives — so a client-supplied key could collide with
   * an operation the operator never performed. Namespacing the operator's key removes the collision
   * outright rather than relying on the fingerprint to reject it:
   *
   *   - operator → bridge: an operator key can never equal a bridge key, so no operator request can
   *     replay, alias, or poison (`idempotency-conflict`) the bridge's launch record;
   *   - bridge → operator: a bridge re-tick of the same card still finds its OWN run and replays it,
   *     because nothing the operator wrote can occupy `queue-bridge:<cardId>`.
   *
   * Operator retries stay idempotent among themselves (the namespace is deterministic). Own-subject
   * launches are untouched — same key, byte for byte.
   *
   * The namespace parses back injectively only while the actor is the ONE literal operator subject: for
   * a free-form actor, `a` + `b:c` and `a:b` + `c` build the same key, so two distinct operations would
   * share one launch identity. The guard below ENFORCES that invariant instead of inheriting it from the
   * fact that `readScope` widens for `operator` alone.
   */
  if (crossSubject && actorSubject !== OPERATOR_SUBJECT) {
    return { status: 403, body: { error: 'cross-subject-launch-actor-refused' } };
  }
  const idempotencyKey = crossSubject && input.idempotencyKey
    ? `operator:${actorSubject}:${input.idempotencyKey}`
    : input.idempotencyKey;
  return withOpsTransaction(async (): Promise<LaunchOutcome> => {
    // NO CROSS-SUBJECT LAUNCH MAY DUPLICATE A LIVE RUN.
    //
    // One-directional by design: only cross-subject launches consult this guard. The owner's own
    // launcher (e.g. the queue bridge) skips it — an own-subject fresh key is a deliberate second run.
    //
    // The namespace above buys collision safety at the cost of recognition: an operator key can never
    // equal the owner's, so `createRun` cannot replay the owner's in-flight run and would mint a SECOND
    // engine-owned run for the same revision — stranding the first (this is exactly what the SPA's
    // pre-publication resume did to a bridge-launched run). Own-subject launches keep their existing
    // contract: their raw key IS their launch identity, and a fresh key there is a deliberate second run.
    //
    // Retry is exempt because it carries a predecessor and is already gated by the quiescence check
    // below; a TERMINAL prior run never blocks a fresh launch.
    if (crossSubject && input.predecessorRunRef === null) {
      const active = ctx.controlStore.findActiveRunForRevision(sub, proposalRef, revision, idempotencyKey);
      if (active) {
        return {
          status: 409,
          body: { error: 'run-already-exists-for-revision', runRef: active.runRef, runOwnerSubject: sub },
        };
      }
    }
    try {
      // Reconcile canonical ops before loading executable policy, routing, or running the post-pull
      // preamble. The launcher below receives no second pull hook, so approval checks and publication
      // are evaluated against the same local canonical snapshot.
      await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner);
    } catch {
      return { status: 409, body: { error: 'canonical-reconciliation-failed' } };
    }
    const policyBaseCommit = (await (ctx.opsGit ?? defaultGitRunner)(ctx.repoRoot, ['rev-parse', 'HEAD'])).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(policyBaseCommit)) {
      return { status: 409, body: { error: 'canonical-policy-base-unavailable' } };
    }
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    // Stored workflow snapshots may carry compiler-only immutable agent assignments. Browser-authored
    // proposals are still validated by `validatePlanProposal` before they can be stored; launch only
    // accepts the server-compiled shape here.
    const parsed = validateServerCompiledPlanProposal(snapshot, registry);
    if (!parsed.ok) return { status: 409, body: { error: 'stored-proposal-invalid', detail: parsed.detail } };
    const compiled = compileApprovedProposal(parsed.value, storedHash, storedHash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, parsed.value.project, parsed.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!compiled.ok) return { status: 400, body: { error: compiled.reason, detail: compiled.detail } };
    const predecessorRunRef = input.predecessorRunRef;
    if (predecessorRunRef) {
      // Resolved as the OWNER, like every other read here. A Retry successor belongs to the same subject
      // as the run it succeeds, so a predecessor under any other subject is correctly not-found — an
      // operator cannot graft one subject's run onto another subject's revision.
      const predecessor = ctx.controlStore.getRun(sub, predecessorRunRef);
      if (!predecessor.ok) return failure(predecessor);
      if (predecessor.value.run.version !== input.expectedPredecessorVersion
        || predecessor.value.run.proposalHash !== storedHash) {
        return { status: 409, body: { error: 'retry-predecessor-changed' } };
      }
      const canonical = await reconcileCanonicalPublication({
        repoRoot: ctx.repoRoot, runRef: predecessorRunRef, proposal: parsed.value,
        defaultWorkers: defaultWorkers(ctx.repoRoot), runGit: ctx.opsGit ?? defaultGitRunner,
      });
      if (!canonical.ok || canonical.cards.some((card) => !['succeeded', 'failed', 'stopped'].includes(card.stageState))) {
        return {
          status: 409,
          body: {
            error: 'retry-predecessor-not-quiescent',
            detail: canonical.ok ? 'canonical predecessor cards are still active or unresolved' : canonical.detail,
          },
        };
      }
    }
    const created = ctx.controlStore.createRun(sub, {
      title: parsed.value.title,
      proposalRef,
      proposalRevision: revision,
      expectedProposalHash: storedHash,
      managerRuntime: parsed.value.manager.runtime,
      managerModel: parsed.value.manager.model,
      managerAssignment: parsed.value.manager.assignment ?? null,
      idempotencyKey,
      predecessorRunRef,
      expectedPredecessorVersion: predecessorRunRef === null ? undefined : input.expectedPredecessorVersion,
      agentWorkspaceLaunch: input.agentWorkspaceLaunch ?? null,
      iterationGroups: parsed.value.iterationGroups ? structuredClone(parsed.value.iterationGroups) : [],
      stages: parsed.value.stages.map((stage) => ({
        stageId: stage.id,
        title: stage.title,
        dependsOn: [...stage.dependsOn],
        assignment: stage.assignment ?? null,
        workflowProfile: stage.workflowProfile ?? null,
        review: stage.review ?? null,
        completionGate: stage.completionGate ?? null,
      })),
    });
    if (!created.ok) return failure(created);
    const runRef = created.value.run.runRef;
    const launchRun = created.value.run;
    if (created.replayed) {
      if (created.value.run.publicationState === 'published') {
        return {
          status: 200,
          body: {
            ok: true,
            runRef,
            replayed: true,
            cards: created.value.stages
              .filter((stage) => stage.canonicalCardRef !== null)
              .map((stage) => ({ stageId: stage.stageId, cardId: stage.canonicalCardRef })),
          },
        };
      }
      // `waiting-human` publication means the launch compile hit a governance refusal (below), never a
      // human gate: the only boundaries this path creates are `governance-refusal`, which no response can
      // accept. Such a run is parked until the plan itself is amended and re-approved, so a replay
      // truthfully reports the park instead of pretending an approval could release it.
      if (created.value.run.publicationState === 'waiting-human') {
        return { status: 200, body: { ok: true, runRef, replayed: true, waitingHuman: true } };
      }
      if (launchRun.publicationState !== 'pending') {
        return {
          status: 409,
          body: {
            error: 'launch-reconciliation-required',
            runRef,
            publicationState: launchRun.publicationState,
          },
        };
      }
    }
    // ENTRY-GATE MODEL — launch NEVER creates a boundary for a stage's declared `humanGates`.
    // A gate is born at its own stage boundary (`execution.ts#stageBoundary`, titled
    // `stableHumanTitle('gate', stageId, gateId)`) at the moment that stage is about to start, so the
    // operator judges the artifact the gate exists to judge. Minting them here produced every gate at
    // launch — before any script, shot list, board, or cut existed — under titles the engine does not
    // recognise, so each gate then had to be approved a second time at its real boundary. That trained
    // rubber-stamping of exactly the two gates that release money and perform an upload. Launch's job is
    // to reconcile, compile, publish cards, audit, and activate; it authorizes nothing.
    //
    // What remains here is the governance refusal: a `waiting-human` policy that NO stage-boundary human
    // decision can release (see `CompiledStagePolicy.releasableByStageGate`). That is a plan defect, not
    // an approvable boundary, so it parks the run's canonical publication before any card is written.
    const waitingPolicies = compiled.value.stagePolicies.filter(
      (item) => item.decision.disposition === 'waiting-human' && !item.releasableByStageGate,
    );
    if (waitingPolicies.length > 0) {
      const requests: CreateHumanRequestInput[] = waitingPolicies.map((pending) => {
        const stage = created.value.stages.find((item) => item.stageId === pending.stageId);
        return {
          stageRef: stage?.stageRef ?? null,
          kind: 'governance-refusal',
          title: `Governance review: ${pending.stageId}`,
          prompt: pending.decision.reason,
        };
      });
      // The `:gates` suffix is a durable idempotency identity, not a description: renaming it would make
      // an in-flight relaunch mint a second refusal set for the same run.
      const requested = ctx.controlStore.createHumanRequests(sub, runRef, {
        idempotencyKey: `${idempotencyKey}:gates`, requests,
      });
      if (!requested.ok) return failure(requested);
      const publication = ctx.controlStore.transitionPublication(
        sub, runRef, launchRun.version, 'waiting-human',
      );
      if (!publication.ok) return failure(publication);
      const waiting = ctx.controlStore.transitionRun(sub, runRef, publication.value.version, 'waiting-human');
      if (!waiting.ok) return failure(waiting);
      return { status: 202, body: { ok: true, runRef, waitingHuman: true } };
    }

    // Fail-closed invariant, not a live branch: the compiler only withholds the card DAG for a T3 stage
    // with no releasing gate, and that stage always carries a non-releasable `waiting-human` policy, so
    // the park above already returned. Reaching here means the compiler dropped the DAG for a reason this
    // path cannot name — publish nothing.
    if (!compiled.value.workflow) {
      return { status: 409, body: { error: 'compiled-workflow-withheld-without-boundary', runRef } };
    }
    const workflow = compiled.value.workflow;
    const publishing = ctx.controlStore.transitionPublication(sub, runRef, launchRun.version, 'publishing');
    if (!publishing.ok) return failure(publishing);
    const outcome = await launchWorkflowRun(workflow, { token: input.sessionToken, config: ctx.sessionConfig, internalService: input.internalService }, {
      repoRoot: ctx.repoRoot,
      runPreamble: ctx.runPreamble,
      runPy: ctx.runPy,
      makeRunId: () => runRef,
      publishBlocked: true,
      // The managed approvals path is the only caller entitled to admit a T3 stage, and it says so here
      // rather than inheriting it from `publishBlocked`.
      admitApprovalBoundT3: true,
      stageRouting: (stage) => {
        const approved = parsed.value.stages.find((candidate) => candidate.id === stage.id);
        if (!approved) throw new Error(`approved proposal is missing stage '${stage.id}'`);
        return { runtime: approved.worker.runtime, model: approved.worker.model };
      },
    });
    if (!outcome.ok) {
      const reconciliation = ctx.controlStore.transitionPublication(sub, runRef, publishing.value.version, 'reconcile-required');
      if (reconciliation.ok) ctx.controlStore.transitionRun(sub, runRef, reconciliation.value.version, 'failed');
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Launch failed', prompt: 'detail' in outcome ? outcome.detail : outcome.problems.join('\n'),
      });
      return { status: 500, body: { error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems } };
    }
    /**
     * Re-prove that the compiled routing this launch is publishing is STILL the routing the current
     * canonical ops head compiles to. Called after any git step that moved the local checkout onto a
     * newer head — the reconciling `pull --rebase` of a rejected push, and the managed-root activation's
     * own post-prepare gate — so `policyBaseCommit` never silently becomes a claim about a head whose
     * policy differs. A change throws, which parks the run exactly as a bare failure would have.
     */
    const reassertCompiledPolicy = (): void => {
      const currentProposal = validateServerCompiledPlanProposal(snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
      const currentCompiled = currentProposal.ok
        ? compileApprovedProposal(currentProposal.value, storedHash, storedHash, {
            policy: loadPolicyEnvironment(ctx.repoRoot, currentProposal.value.project, currentProposal.value.governanceRefs),
            defaultWorkers: defaultWorkers(ctx.repoRoot),
          })
        : null;
      if (!currentCompiled?.ok
        || JSON.stringify(currentCompiled.value.stagePolicies) !== JSON.stringify(compiled.value.stagePolicies)) {
        throw new Error('managed root activation policy changed');
      }
    };
    try {
      const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
      const riskTier = parsed.value.stages.some((stage) => stage.riskTier === 'T3') ? 'T3'
        : parsed.value.stages.some((stage) => stage.riskTier === 'T2') ? 'T2' : 'T1';
      appendLocal(ctx.repoRoot, {
        // `owner` is the ACTOR that authorized this launch — the operator session on a cross-subject
        // launch — while `runOwnerSubject` names the subject the launch executes as and the run belongs
        // to. They are equal for every own-subject launch; the row is what makes them attributable when
        // they are not.
        action: 'control-run-launch', owner: actorSubject, target: parsed.value.project, riskTier,
        result: `launched:${runRef}:${storedHash}`,
        detail: {
          proposalRef,
          proposalRevision: revision,
          proposalHash: storedHash,
          runOwnerSubject: sub,
          policyBaseCommit,
          policyHashes: compiled.value.stagePolicies.map((stage) => ({ stageId: stage.stageId, policyHash: stage.decision.policyHash })),
          ...(input.source === undefined ? {} : { source: input.source }),
        },
      }, ctx.now);
      const [first, ...rest] = outcome.cards.map((card) => card.cardPath);
      await commitPreparedCoordination(ctx.repoRoot, first, {
        runGit: ctx.opsGit ?? defaultGitRunner,
        alsoStage: [...rest, AUDIT_REL_PATH],
        message: `chore(queue): launch approved run ${runRef}`,
        // `ops` has many concurrent writers, so ANY of them pushing inside this launch's compile window
        // rejects this push non-fast-forward. That is a lost race, not divergence, and the repository
        // constitution answers it directly: "a rejected push means: re-read state, reconcile, retry."
        // Parking the run on a human intervention for it (observed on both live bridge launches,
        // 2026-08-11 and -12) implemented the opposite doctrine.
        //
        // What the old `maxRetryPushes: 0` was really protecting is preserved by `onReconciled`, not by
        // refusing to retry: the cards and audit were compiled against `policyBaseCommit`, so before the
        // retried push the reconciled head is recompiled and its stage policies compared. Identical
        // policy means this routing is not stale and may publish; a changed policy throws and the route
        // enters reconcile-required, exactly as before. A conflicting rebase aborts and parks too
        // (`write/opsPushRetry.ts`).
        onReconciled: reassertCompiledPolicy,
      });
      for (const card of outcome.cards) {
        const stage = created.value.stages.find((candidate) => candidate.stageId === card.stageId);
        const proposalStage = parsed.value.stages.find((candidate) => candidate.id === card.stageId);
        if (!stage || !proposalStage) throw new Error(`run projection missing stage '${card.stageId}'`);
        const linked = ctx.controlStore.linkStageCard(sub, stage.stageRef, stage.version, card.cardId);
        if (!linked.ok) throw new Error(linked.detail);
        const attempt = ctx.controlStore.createAttempt(sub, stage.stageRef, {
          expectedStageVersion: linked.value.version,
          runtime: proposalStage.worker.runtime,
          model: proposalStage.worker.model,
        });
        if (!attempt.ok) throw new Error(attempt.detail);
        const session = ctx.controlStore.createWorkerSession(sub, attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
        if (!session.ok) throw new Error(session.detail);
      }
      const published = ctx.controlStore.transitionPublication(sub, runRef, publishing.value.version, 'published');
      if (!published.ok) throw new Error(published.detail);
      if (!ctx.controlBroker || !ctx.runAutomatic) {
        const waiting = ctx.controlStore.transitionRun(sub, runRef, published.value.version, 'waiting-human');
        if (!waiting.ok) throw new Error(waiting.detail);
        ctx.controlStore.createHumanRequest(sub, runRef, {
          // Runtime wiring is an operationally recoverable boundary, not a verdict that the approved
          // plan violates governance. The passkey latch still independently prevents `/activate` while
          // locked; resolving this intervention only records that the operator is ready to retry the
          // already-published run after execution has been unlocked.
          kind: 'intervention', title: 'Automatic execution activation is gated',
          prompt: 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.',
        });
        ctx.controlStore.appendEvent(sub, runRef, {
          kind: 'governance', source: 'system', status: 'waiting', summary: 'canonical run published; runtime activation remains gated',
        });
        return { status: 202, body: { ok: true, runRef, cards: outcome.cards, waitingHuman: true, activationGated: true } };
      }
      const rootStageIds = new Set(parsed.value.stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id));
      const rootCards = outcome.cards.filter((card) => rootStageIds.has(card.stageId)).map((card) => card.cardId);
      if (rootCards.length !== rootStageIds.size) throw new Error('managed root card projection differs from the approved proposal');
      await activateManagedRootCards({
        repoRoot: ctx.repoRoot, runRef, cardRefs: rootCards, runPy: ctx.runPy,
        runGit: ctx.opsGit ?? defaultGitRunner,
        authorizeAfterPrepare: reassertCompiledPolicy,
        // The same proof at a different moment: `authorizeAfterPrepare` runs once after the opening
        // pull, `reassertAfterReconcile` after every pull a rejected push forces. This closure is pure
        // (recompile and compare, no writes), so repeating it costs nothing and duplicates nothing.
        reassertAfterReconcile: reassertCompiledPolicy,
      });
      ctx.controlStore.appendEvent(sub, runRef, {
        kind: 'lifecycle', source: 'system', status: 'running',
        summary: 'approved run published; automatic executor owns Manager and Worker startup',
      });
      const runAutomatic = ctx.runAutomatic;
      void runAutomatic({ subject: sub, runRef, proposal: parsed.value }).catch((error: unknown) => {
        ctx.controlStore.createHumanRequest(sub, runRef, {
          kind: 'intervention', title: 'Automatic execution needs intervention',
          prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
        });
      });
      return { status: 201, body: { ok: true, runRef, cards: outcome.cards } };
    } catch (error) {
      const latest = ctx.controlStore.getRun(sub, runRef);
      if (latest.ok && latest.value.run.publicationState === 'publishing') {
        ctx.controlStore.transitionPublication(sub, runRef, latest.value.run.version, 'reconcile-required');
      } else if (latest.ok && latest.value.run.publicationState === 'published' && latest.value.run.state === 'planned') {
        ctx.controlStore.transitionRun(sub, runRef, latest.value.run.version, 'waiting-human');
      }
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Launch reconciliation required',
        prompt: 'Canonical publication may have succeeded but the durable projection did not finish. Reconcile by runRef before retrying.',
      });
      return { status: 500, body: { error: 'launch-reconciliation-required', detail: error instanceof Error ? error.message : String(error) } };
    }
  });
}
