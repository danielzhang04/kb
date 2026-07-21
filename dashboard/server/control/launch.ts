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
import { validatePlanProposal } from './proposal.ts';
import { compileApprovedProposal } from './compiler.ts';
import { loadPolicyEnvironment, loadRuntimeSkillRegistry } from './environment.ts';
import { reconcileCanonicalPublication } from './publication.ts';
import type { ControlResult, HumanRequest, JsonObject } from './types.ts';
import type { CreateHumanRequestInput } from './store.ts';
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
  predecessorRunRef: string | null;
  expectedPredecessorVersion: number;
  /** Optional provenance discriminator recorded in the launch audit detail (e.g. `workflow:<id>`). */
  source?: string;
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
 */
export async function executeApprovedLaunch(
  ctx: SurfaceContext,
  sub: string,
  input: ApprovedLaunchInput,
): Promise<LaunchOutcome> {
  const { proposalRef, revision, storedHash, snapshot, idempotencyKey } = input;
  return withOpsTransaction(async (): Promise<LaunchOutcome> => {
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
    const parsed = validatePlanProposal(snapshot, registry);
    if (!parsed.ok) return { status: 409, body: { error: 'stored-proposal-invalid', detail: parsed.detail } };
    const compiled = compileApprovedProposal(parsed.value, storedHash, storedHash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, parsed.value.project, parsed.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!compiled.ok) return { status: 400, body: { error: compiled.reason, detail: compiled.detail } };
    const predecessorRunRef = input.predecessorRunRef;
    if (predecessorRunRef) {
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
      idempotencyKey,
      predecessorRunRef,
      expectedPredecessorVersion: predecessorRunRef === null ? undefined : input.expectedPredecessorVersion,
      stages: parsed.value.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: [...stage.dependsOn] })),
    });
    if (!created.ok) return failure(created);
    const runRef = created.value.run.runRef;
    let launchRun = created.value.run;
    let gatesAlreadySatisfied = false;
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
      if (created.value.run.publicationState === 'waiting-human') {
        const requests = created.value.humanRequests;
        const accepted = requests.length > 0 && requests.every(acceptsBoundary);
        if (!accepted) return { status: 200, body: { ok: true, runRef, replayed: true, waitingHuman: true } };
        const released = ctx.controlStore.transitionPublication(
          sub, runRef, created.value.run.version, 'pending',
        );
        if (!released.ok) return failure(released);
        const planned = ctx.controlStore.transitionRun(sub, runRef, released.value.version, 'planned');
        if (!planned.ok) return failure(planned);
        launchRun = planned.value;
        gatesAlreadySatisfied = true;
        ctx.controlStore.appendEvent(sub, runRef, {
          kind: 'governance', source: 'system', status: 'success', summary: 'all launch gates resolved; canonical publication released',
        });
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
    const waitingPolicies = compiled.value.stagePolicies.filter((item) => item.decision.disposition === 'waiting-human');
    if (!gatesAlreadySatisfied && (compiled.value.humanGates.length > 0 || waitingPolicies.length > 0)) {
      const requests: CreateHumanRequestInput[] = waitingPolicies.map((pending) => {
        const stage = created.value.stages.find((item) => item.stageId === pending.stageId);
        return {
          stageRef: stage?.stageRef ?? null,
          kind: 'governance-refusal',
          title: `Governance review: ${pending.stageId}`,
          prompt: pending.decision.reason,
        };
      });
      requests.push(...compiled.value.humanGates.map((pending) => {
        const stage = created.value.stages.find((item) => item.stageId === pending.stageId);
        return {
          stageRef: stage?.stageRef ?? null,
          kind: pending.gate.kind,
          title: pending.gate.id,
          prompt: pending.gate.prompt,
        };
      }));
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

    if (!compiled.value.workflow) {
      return { status: 409, body: { error: 't3-approval-release-not-implemented', runRef } };
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
    try {
      const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
      const riskTier = parsed.value.stages.some((stage) => stage.riskTier === 'T3') ? 'T3'
        : parsed.value.stages.some((stage) => stage.riskTier === 'T2') ? 'T2' : 'T1';
      appendLocal(ctx.repoRoot, {
        action: 'control-run-launch', owner: sub, target: parsed.value.project, riskTier,
        result: `launched:${runRef}:${storedHash}`,
        detail: {
          proposalRef,
          proposalRevision: revision,
          proposalHash: storedHash,
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
        // The cards and audit were compiled against policyBaseCommit. A rejected push means the
        // canonical base changed, so do not rebase and publish stale routing under a newer ops head.
        // The route enters reconcile-required and a fresh launch/reconciliation must recompile.
        maxRetryPushes: 0,
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
          kind: 'governance-refusal', title: 'Automatic execution activation is gated',
          prompt: 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.',
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
        authorizeAfterPrepare: () => {
          const currentProposal = validatePlanProposal(snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
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
        },
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
