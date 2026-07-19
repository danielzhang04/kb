import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { visibleAssistantText } from '../composer/publicTimeline.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { setCardRouting } from '../write/cardRouting.ts';
import { activateManagedRootCards, launchWorkflowRun } from '../write/workflowRun.ts';
import { defaultPreambleRunner } from '../write/preambleGate.ts';
import {
  createProposalRevision as protocolRevision,
  diffPlanProposals,
  parseProposalFromAssistant,
  validatePlanProposal,
  type PlanProposal,
} from './proposal.ts';
import { compileApprovedProposal } from './compiler.ts';
import { loadExecutionProfiles, loadPolicyEnvironment, loadRuntimeSkillRegistry } from './environment.ts';
import { loadPolicy } from '../routing/policy.ts';
import type { ControlResult, HumanRequest, JsonObject, ProposalDecision } from './types.ts';
import type { CreateHumanRequestInput } from './store.ts';
import { reconcileCanonicalPublication } from './publication.ts';
import { classifyActionRisk, evaluateExecutionPolicy } from './policy.ts';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1;
}

function statusOf(result: Extract<ControlResult<unknown>, { ok: false }>): number {
  if (result.reason === 'not-found') return 404;
  if (result.reason === 'conflict' || result.reason === 'idempotency-conflict' || result.reason === 'not-approved') return 409;
  return 400;
}

function sendResult<T>(reply: FastifyReply, result: ControlResult<T>, success = 200) {
  return result.ok ? reply.code(success).send({ ok: true, value: result.value, replayed: result.replayed ?? false })
    : reply.code(statusOf(result)).send({ error: result.reason, detail: result.detail });
}

function subject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

function acceptsBoundary(request: HumanRequest): boolean {
  if (request.state !== 'resolved' || !request.response) return false;
  if (request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') return request.response.decision === 'approved';
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

function defaultWorkers(repoRoot: string): Record<string, string> {
  return Object.fromEntries(Object.entries(loadPolicy(repoRoot).runtimes ?? {})
    .filter((entry): entry is [string, { default_worker: string }] => typeof entry[1].default_worker === 'string' && entry[1].default_worker.length > 0)
    .map(([runtime, spec]) => [runtime, spec.default_worker]));
}

/** Authenticated app-local proposal/run control plane. Queue cards remain canonical execution truth. */
export function registerControlRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);

  scope.get('/api/control/proposals', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const composerRef = string((req.query as { composerRef?: unknown }).composerRef);
    const values = composerRef
      ? ctx.controlStore.listProposalRevisionsForComposer(sub, composerRef)
      : ctx.controlStore.listProposalRevisions(sub);
    return reply.send({ proposals: values });
  });

  scope.get('/api/control/proposals/:proposalRef/revisions/:revision', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { proposalRef, revision } = req.params as { proposalRef: string; revision: string };
    return sendResult(reply, ctx.controlStore.getProposalRevision(sub, proposalRef, Number(revision)));
  });

  scope.post('/api/control/proposals/import', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const composerRef = string(body.composerRef);
    const turnId = string(body.turnId);
    const workspace = ctx.composerStore.get(sub, composerRef);
    if (!workspace.ok) return reply.code(404).send({ error: 'not-found' });
    const turn = workspace.workspace.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn) return reply.code(404).send({ error: 'turn-not-found' });
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    const parsed = parseProposalFromAssistant({
      role: 'assistant', state: turn.state, visibility: 'visible', text: visibleAssistantText(turn.model),
    }, registry);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid-proposal', detail: parsed.detail });
    const proposalRef = body.proposalRef === undefined ? undefined : string(body.proposalRef);
    let previous: ReturnType<typeof protocolRevision> | undefined;
    if (proposalRef) {
      const latest = ctx.controlStore.listProposalRevisions(sub, proposalRef)[0];
      if (!latest) return reply.code(404).send({ error: 'proposal-not-found' });
      const stored = ctx.controlStore.getProposalRevision(sub, proposalRef, latest.revision);
      if (!stored.ok) return sendResult(reply, stored);
      const prior = validatePlanProposal(stored.value.snapshot, registry);
      if (!prior.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: prior.detail });
      previous = protocolRevision(prior.value, latest.revision);
    }
    const created = ctx.controlStore.createProposalRevision(sub, {
      proposalRef,
      expectedPreviousHash: body.expectedPreviousHash === undefined ? null : string(body.expectedPreviousHash),
      sourceComposerRef: composerRef,
      sourceTurnId: turnId,
      title: parsed.value.title,
      snapshot: parsed.value as unknown as JsonObject,
    });
    if (!created.ok) return sendResult(reply, created);
    const revision = protocolRevision(parsed.value, created.value.revision, previous);
    return reply.code(201).send({ ok: true, value: created.value, diff: revision.diff });
  });

  scope.post('/api/control/proposals/:proposalRef/revisions', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { proposalRef } = req.params as { proposalRef: string };
    const body = record(req.body);
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    const parsed = validatePlanProposal(body.proposal, registry);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid-proposal', detail: parsed.detail });
    const latest = ctx.controlStore.listProposalRevisions(sub, proposalRef)[0];
    if (!latest) return reply.code(404).send({ error: 'proposal-not-found' });
    const previous = ctx.controlStore.getProposalRevision(sub, proposalRef, latest.revision);
    if (!previous.ok) return sendResult(reply, previous);
    const created = ctx.controlStore.createProposalRevision(sub, {
      proposalRef,
      expectedPreviousHash: string(body.expectedPreviousHash),
      sourceComposerRef: latest.sourceComposerRef,
      sourceTurnId: latest.sourceTurnId,
      title: parsed.value.title,
      snapshot: parsed.value as unknown as JsonObject,
    });
    if (!created.ok) return sendResult(reply, created);
    return reply.code(201).send({
      ok: true,
      value: created.value,
      diff: diffPlanProposals(previous.value.snapshot as unknown as PlanProposal, parsed.value),
    });
  });

  scope.post('/api/control/proposals/:proposalRef/revisions/:revision/decision', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { proposalRef, revision } = req.params as { proposalRef: string; revision: string };
    const body = record(req.body);
    const decision = string(body.decision) as ProposalDecision;
    if (!['approved', 'rejected', 'changes-requested'].includes(decision)) {
      return reply.code(400).send({ error: 'invalid-decision' });
    }
    if (integer(body.expectedApprovalRevision) !== 0) return reply.code(409).send({ error: 'approval-revision-mismatch' });
    const current = ctx.controlStore.getProposalRevision(sub, proposalRef, Number(revision));
    if (!current.ok) return sendResult(reply, current);
    if (current.value.hash !== string(body.expectedHash)) return reply.code(409).send({ error: 'revision-mismatch' });
    if (current.value.approval === null) {
      try {
        const decisionStages = Array.isArray(current.value.snapshot.stages) ? current.value.snapshot.stages : [];
        const decisionRisk = decisionStages.some((stage) => record(stage).riskTier === 'T3') ? 'T3'
          : decisionStages.some((stage) => record(stage).riskTier === 'T2') ? 'T2' : 'T1';
        await auditFn(ctx)(ctx.repoRoot, {
          action: 'control-proposal-decision-authorize', owner: sub, target: proposalRef,
          riskTier: decisionRisk, result: `authorized:${decision}:${current.value.hash}`,
          detail: { proposalRef, revision: Number(revision), proposalHash: current.value.hash, decision },
        }, { runGit: ctx.opsGit, now: ctx.now });
      } catch {
        return reply.code(500).send({ error: 'decision-audit-required' });
      }
    }
    const decided = ctx.controlStore.decideProposal(sub, proposalRef, Number(revision), {
      expectedHash: string(body.expectedHash),
      expectedApprovalRevision: 0,
      decision,
      idempotencyKey: string(body.idempotencyKey),
      note: body.note == null ? null : string(body.note),
    });
    if (!decided.ok) return sendResult(reply, decided);
    return sendResult(reply, decided);
  });

  scope.post('/api/control/proposals/:proposalRef/revisions/:revision/launch', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { proposalRef, revision } = req.params as { proposalRef: string; revision: string };
    const body = record(req.body);
    const stored = ctx.controlStore.getProposalRevision(sub, proposalRef, Number(revision));
    if (!stored.ok) return sendResult(reply, stored);
    if (stored.value.hash !== string(body.expectedHash)) return reply.code(409).send({ error: 'revision-mismatch' });
    if (stored.value.approval?.decision !== 'approved') return reply.code(409).send({ error: 'not-approved' });
    // One ops transaction: reconcile, compile, publish cards + audit, activate. Nested transaction
    // helpers (prepare/commit/audit/activate) reenter the held lock instead of deadlocking.
    return withOpsTransaction(async () => {
    try {
      // Reconcile canonical ops before loading executable policy, routing, or running the post-pull
      // preamble. The launcher below receives no second pull hook, so approval checks and publication
      // are evaluated against the same local canonical snapshot.
      await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner);
    } catch {
      return reply.code(409).send({ error: 'canonical-reconciliation-failed' });
    }
    const policyBaseCommit = (await (ctx.opsGit ?? defaultGitRunner)(ctx.repoRoot, ['rev-parse', 'HEAD'])).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(policyBaseCommit)) {
      return reply.code(409).send({ error: 'canonical-policy-base-unavailable' });
    }
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    const parsed = validatePlanProposal(stored.value.snapshot, registry);
    if (!parsed.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: parsed.detail });
    const compiled = compileApprovedProposal(parsed.value, stored.value.hash, stored.value.hash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, parsed.value.project, parsed.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!compiled.ok) return reply.code(400).send({ error: compiled.reason, detail: compiled.detail });
    const predecessorRunRef = body.predecessorRunRef == null ? null : string(body.predecessorRunRef);
    if (predecessorRunRef) {
      const predecessor = ctx.controlStore.getRun(sub, predecessorRunRef);
      if (!predecessor.ok) return sendResult(reply, predecessor);
      if (predecessor.value.run.version !== integer(body.expectedPredecessorVersion)
        || predecessor.value.run.proposalHash !== stored.value.hash) {
        return reply.code(409).send({ error: 'retry-predecessor-changed' });
      }
      const canonical = await reconcileCanonicalPublication({
        repoRoot: ctx.repoRoot, runRef: predecessorRunRef, proposal: parsed.value,
        defaultWorkers: defaultWorkers(ctx.repoRoot), runGit: ctx.opsGit ?? defaultGitRunner,
      });
      if (!canonical.ok || canonical.cards.some((card) => !['succeeded', 'failed', 'stopped'].includes(card.stageState))) {
        return reply.code(409).send({
          error: 'retry-predecessor-not-quiescent',
          detail: canonical.ok ? 'canonical predecessor cards are still active or unresolved' : canonical.detail,
        });
      }
    }
    const created = ctx.controlStore.createRun(sub, {
      title: parsed.value.title,
      proposalRef,
      proposalRevision: Number(revision),
      expectedProposalHash: stored.value.hash,
      managerRuntime: parsed.value.manager.runtime,
      managerModel: parsed.value.manager.model,
      idempotencyKey: string(body.idempotencyKey),
      predecessorRunRef,
      expectedPredecessorVersion: predecessorRunRef === null ? undefined : integer(body.expectedPredecessorVersion),
      stages: parsed.value.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: [...stage.dependsOn] })),
    });
    if (!created.ok) return sendResult(reply, created);
    const runRef = created.value.run.runRef;
    let launchRun = created.value.run;
    let gatesAlreadySatisfied = false;
    if (created.replayed) {
      if (created.value.run.publicationState === 'published') {
        return reply.code(200).send({
          ok: true,
          runRef,
          replayed: true,
          cards: created.value.stages
            .filter((stage) => stage.canonicalCardRef !== null)
            .map((stage) => ({ stageId: stage.stageId, cardId: stage.canonicalCardRef })),
        });
      }
      if (created.value.run.publicationState === 'waiting-human') {
        const requests = created.value.humanRequests;
        const accepted = requests.length > 0 && requests.every(acceptsBoundary);
        if (!accepted) return reply.code(200).send({ ok: true, runRef, replayed: true, waitingHuman: true });
        const released = ctx.controlStore.transitionPublication(
          sub, runRef, created.value.run.version, 'pending',
        );
        if (!released.ok) return sendResult(reply, released);
        const planned = ctx.controlStore.transitionRun(sub, runRef, released.value.version, 'planned');
        if (!planned.ok) return sendResult(reply, planned);
        launchRun = planned.value;
        gatesAlreadySatisfied = true;
        ctx.controlStore.appendEvent(sub, runRef, {
          kind: 'governance', source: 'system', status: 'success', summary: 'all launch gates resolved; canonical publication released',
        });
      }
      if (launchRun.publicationState !== 'pending') {
        return reply.code(409).send({
          error: 'launch-reconciliation-required',
          runRef,
          publicationState: launchRun.publicationState,
        });
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
        idempotencyKey: `${string(body.idempotencyKey)}:gates`, requests,
      });
      if (!requested.ok) return sendResult(reply, requested);
      const publication = ctx.controlStore.transitionPublication(
        sub, runRef, launchRun.version, 'waiting-human',
      );
      if (!publication.ok) return sendResult(reply, publication);
      const waiting = ctx.controlStore.transitionRun(sub, runRef, publication.value.version, 'waiting-human');
      if (!waiting.ok) return sendResult(reply, waiting);
      return reply.code(202).send({ ok: true, runRef, waitingHuman: true });
    }

    if (!compiled.value.workflow) {
      return reply.code(409).send({ error: 't3-approval-release-not-implemented', runRef });
    }
    const workflow = compiled.value.workflow;
    const publishing = ctx.controlStore.transitionPublication(sub, runRef, launchRun.version, 'publishing');
    if (!publishing.ok) return sendResult(reply, publishing);
    const outcome = await launchWorkflowRun(workflow, { token: verifiedSession(req)?.token, config: ctx.sessionConfig }, {
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
      return reply.code(500).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
    }
    try {
      const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
      const riskTier = parsed.value.stages.some((stage) => stage.riskTier === 'T3') ? 'T3'
        : parsed.value.stages.some((stage) => stage.riskTier === 'T2') ? 'T2' : 'T1';
      appendLocal(ctx.repoRoot, {
        action: 'control-run-launch', owner: sub, target: parsed.value.project, riskTier,
        result: `launched:${runRef}:${stored.value.hash}`,
        detail: {
          proposalRef,
          proposalRevision: Number(revision),
          proposalHash: stored.value.hash,
          policyBaseCommit,
          policyHashes: compiled.value.stagePolicies.map((stage) => ({ stageId: stage.stageId, policyHash: stage.decision.policyHash })),
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
        return reply.code(202).send({ ok: true, runRef, cards: outcome.cards, waitingHuman: true, activationGated: true });
      }
      const rootStageIds = new Set(parsed.value.stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id));
      const rootCards = outcome.cards.filter((card) => rootStageIds.has(card.stageId)).map((card) => card.cardId);
      if (rootCards.length !== rootStageIds.size) throw new Error('managed root card projection differs from the approved proposal');
      await activateManagedRootCards({
        repoRoot: ctx.repoRoot, runRef, cardRefs: rootCards, runPy: ctx.runPy,
        runGit: ctx.opsGit ?? defaultGitRunner,
        authorizeAfterPrepare: () => {
          const currentProposal = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
          const currentCompiled = currentProposal.ok
            ? compileApprovedProposal(currentProposal.value, stored.value.hash, stored.value.hash, {
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
      void ctx.runAutomatic({ subject: sub, runRef, proposal: parsed.value }).catch((error: unknown) => {
        ctx.controlStore.createHumanRequest(sub, runRef, {
          kind: 'intervention', title: 'Automatic execution needs intervention',
          prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
        });
      });
      return reply.code(201).send({ ok: true, runRef, cards: outcome.cards });
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
      return reply.code(500).send({ error: 'launch-reconciliation-required', detail: error instanceof Error ? error.message : String(error) });
    }
    });
  });

  scope.get('/api/control/runs', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    return sub ? reply.send({ runs: ctx.controlStore.listRuns(sub) }) : reply.code(401).send({ error: 'unauthenticated' });
  });

  scope.get('/api/control/runs/:runRef', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    return sendResult(reply, ctx.controlStore.getRun(sub, (req.params as { runRef: string }).runRef));
  });

  scope.get('/api/control/runs/:runRef/events', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const query = req.query as { after?: string; limit?: string };
    return sendResult(reply, ctx.controlStore.listEvents(sub, (req.params as { runRef: string }).runRef, Number(query.after ?? 0), Number(query.limit ?? 200)));
  });

  scope.post('/api/control/runs/:runRef/stages/:stageRef/reroute', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { runRef, stageRef } = req.params as { runRef: string; stageRef: string };
    const body = record(req.body);
    const runtime = string(body.runtime);
    const model = string(body.model);
    const expectedStageVersion = integer(body.expectedStageVersion);
    const expectedAttemptRef = string(body.expectedAttemptRef);
    const expectedAttemptVersion = integer(body.expectedAttemptVersion);
    const idempotencyKey = string(body.idempotencyKey);
    if (!runtime || !model || !expectedAttemptRef || !idempotencyKey || idempotencyKey.length > 512
      || expectedStageVersion < 1 || expectedAttemptVersion < 1) {
      return reply.code(400).send({ error: 'invalid-reroute', detail: 'runtime, model, positive stage/attempt versions, attempt identity, and idempotencyKey are required' });
    }

    const authorize = () => {
      const detail = ctx.controlStore.getRun(sub, runRef);
      if (!detail.ok) return { ok: false as const, status: 404, error: 'not-found', detail: detail.detail };
      const stage = detail.value.stages.find((candidate) => candidate.stageRef === stageRef);
      if (!stage) return { ok: false as const, status: 404, error: 'not-found', detail: 'stage was not found' };
      const attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef);
      const session = detail.value.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
      const amendmentRequired = stage.state === 'waiting-human'
        || detail.value.humanRequests.some((request) => request.stageRef === stageRef);
      if (amendmentRequired) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'plan-amendment-required' as const,
          detail: 'approval, review, or Human Request bound this stage routing; amend the plan and collect a new exact-hash approval',
        };
      }
      if (['succeeded', 'failed', 'stopped'].includes(stage.state) || ['succeeded', 'failed', 'stopped'].includes(attempt?.state ?? '')) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'immutable' as const,
          detail: 'terminal stage and attempt routing is immutable; Retry creates a new successor run',
        };
      }
      if (!['ready', 'blocked'].includes(stage.state) || attempt?.state !== 'queued' || session?.state !== 'pending') {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'successor-attempt-required' as const,
          detail: 'active or interrupted work cannot reroute in place; stop it and create a successor attempt with an explicit handoff',
        };
      }
      if (detail.value.run.publicationState !== 'published' || ['stopping', 'succeeded', 'failed', 'stopped'].includes(detail.value.run.state)) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'immutable' as const,
          detail: 'run is not in a published reroutable state',
        };
      }
      if (stage.version !== expectedStageVersion || attempt.attemptRef !== expectedAttemptRef || attempt.version !== expectedAttemptVersion) {
        return { ok: false as const, status: 409, error: 'reroute-state-changed', detail: 'stage or attempt version changed' };
      }
      if (!stage.canonicalCardRef) {
        return { ok: false as const, status: 409, error: 'reroute-state-changed', detail: 'stage lacks a canonical card link' };
      }
      if (attempt.runtime === runtime && attempt.model === model) {
        return { ok: false as const, status: 400, error: 'invalid-reroute', detail: 'reroute must change runtime or model' };
      }
      const stored = ctx.controlStore.getProposalRevision(
        sub, detail.value.run.proposalRef, detail.value.run.proposalRevision,
      );
      if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
        return { ok: false as const, status: 409, error: 'approved-proposal-binding-lost', detail: 'approved proposal binding was lost' };
      }
      const parsed = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
      if (!parsed.ok) return { ok: false as const, status: 409, error: 'stored-proposal-invalid', detail: parsed.detail };
      const proposalStage = parsed.value.stages.find((candidate) => candidate.id === stage.stageId);
      if (!proposalStage) return { ok: false as const, status: 409, error: 'proposal-binding-lost', detail: 'proposal stage was not found' };
      if (proposalStage.riskTier === 'T3' || proposalStage.humanGates.length > 0) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'plan-amendment-required' as const,
          detail: 'T3 or human-gated stage routing is approval-bound; amend the plan and collect a new exact-hash approval',
        };
      }
      const classified = classifyActionRisk(proposalStage.action);
      if (classified.disposition === 'forbidden') {
        return { ok: false as const, status: 409, error: 'reroute-policy-refused', detail: classified.reason };
      }
      const profile = loadExecutionProfiles(ctx.repoRoot).find((candidate) =>
        candidate.role === 'worker' && candidate.runtime === runtime && candidate.model === model,
      );
      if (!profile) return { ok: false as const, status: 400, error: 'worker-profile-refused', detail: 'runtime/model is not a server-owned worker profile' };
      const policy = evaluateExecutionPolicy({
        project: parsed.value.project,
        riskTier: proposalStage.riskTier,
        role: 'worker',
        runtime: profile.runtime,
        model: profile.model,
        target: proposalStage.target,
        requiredSkills: proposalStage.requiredSkills,
        scope: proposalStage.scope,
        governanceRefs: parsed.value.governanceRefs,
        proposalHash: stored.value.hash,
        approvedHash: stored.value.hash,
      }, loadPolicyEnvironment(ctx.repoRoot, parsed.value.project, parsed.value.governanceRefs));
      if (policy.disposition !== 'allow') {
        return { ok: false as const, status: 409, error: 'reroute-policy-refused', detail: policy.reason };
      }
      return { ok: true as const, detail: detail.value, stage, attempt, session, proposalStage, cardId: stage.canonicalCardRef };
    };

    const initial = authorize();
    if (!initial.ok) {
      if (initial.error === 'reroute-state-changed') {
        const replay = ctx.controlStore.rerouteStage(sub, stageRef, {
          expectedStageVersion,
          expectedAttemptRef,
          expectedAttemptVersion,
          runtime,
          model,
          idempotencyKey,
        });
        if (replay.ok && replay.replayed) return reply.send({ ok: true, value: replay.value, replayed: true });
        if (!replay.ok && replay.reason === 'idempotency-conflict') {
          return reply.code(409).send({ error: 'idempotency-conflict', detail: replay.detail });
        }
      }
      return reply.code(initial.status).send({ error: initial.error, detail: initial.detail, ...('disposition' in initial ? { disposition: initial.disposition } : {}) });
    }
    const canonical = await setCardRouting({
      repoRoot: ctx.repoRoot,
      cardId: initial.cardId,
      sessionToken: verifiedSession(req)?.token,
      sessionConfig: ctx.sessionConfig,
    }, { runtime, model }, {
      runPy: ctx.runPy,
      runGit: ctx.opsGit,
      appendAudit: ctx.appendAuditLocal,
      now: ctx.now,
      managedAssignedInbox: { workflowRef: runRef },
      authorizeAfterReconcile: () => {
        const checked = authorize();
        return checked.ok ? null : {
          ok: false as const,
          status: checked.status === 400 ? 400 : 409,
          error: checked.error,
          reason: checked.detail,
          ...('disposition' in checked ? { disposition: checked.disposition } : {}),
        };
      },
    });
    if (!canonical.ok) {
      return reply.code(canonical.status).send({
        error: canonical.error ?? 'reroute-canonical-write-failed', detail: canonical.reason,
        ...(canonical.disposition ? { disposition: canonical.disposition } : {}),
      });
    }
    const projected = ctx.controlStore.rerouteStage(sub, stageRef, {
      expectedStageVersion,
      expectedAttemptRef,
      expectedAttemptVersion,
      runtime,
      model,
      idempotencyKey,
    });
    if (!projected.ok) {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        stageRef,
        kind: 'intervention',
        title: `reroute:reconcile:${stageRef}`,
        prompt: `Canonical card routing changed to ${runtime}/${model}, but the managed successor projection failed: ${projected.detail}`,
      });
      return reply.code(409).send({ error: 'reroute-projection-reconciliation-required', detail: projected.detail });
    }
    ctx.controlStore.appendEvent(sub, runRef, {
      kind: 'lifecycle', source: 'human', stageRef, attemptRef: projected.value.attempt.attemptRef,
      sessionRef: projected.value.session.sessionRef, status: 'pending',
      summary: `queued successor attempt ${projected.value.attempt.generation} with ${runtime}/${model}`,
    });
    return reply.send({ ok: true, value: projected.value, canonicalCard: canonical, replayed: projected.replayed ?? false });
  });

  scope.post('/api/control/runs/:runRef/reconcile-publication', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const initial = ctx.controlStore.getRun(sub, runRef);
    if (!initial.ok) return sendResult(reply, initial);
    if (initial.value.run.version !== integer(body.expectedRunVersion)
      || !['publishing', 'reconcile-required'].includes(initial.value.run.publicationState)) {
      return reply.code(409).send({ error: 'publication-state-changed' });
    }
    const stored = ctx.controlStore.getProposalRevision(
      sub, initial.value.run.proposalRef, initial.value.run.proposalRevision,
    );
    if (!stored.ok || stored.value.hash !== initial.value.run.proposalHash) {
      return reply.code(409).send({ error: 'proposal-binding-lost' });
    }
    // One ops transaction (nested audit/reconcile helpers reenter the held lock).
    return withOpsTransaction(async () => {
    try { await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner); }
    catch { return reply.code(409).send({ error: 'canonical-reconciliation-failed' }); }
    const parsed = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
    if (!parsed.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: parsed.detail });
    const reconciled = await reconcileCanonicalPublication({
      repoRoot: ctx.repoRoot, runRef, proposal: parsed.value, defaultWorkers: defaultWorkers(ctx.repoRoot),
      runGit: ctx.opsGit ?? defaultGitRunner,
    });
    if (!reconciled.ok) return reply.code(409).send({ error: reconciled.reason, detail: reconciled.detail });
    try {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'control-publication-reconcile', owner: sub, target: runRef, riskTier: 'T2',
        result: `verified:${runRef}:${stored.value.hash}`,
        detail: {
          runRef, proposalHash: stored.value.hash, proposalRevision: stored.value.revision,
          canonicalCards: reconciled.cards.map((card) => ({ stageId: card.stageId, cardId: card.cardId, state: card.stageState })),
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'publication-reconciliation-audit-required' });
    }
    try {
      if (initial.value.run.publicationState === 'publishing') {
        const marked = ctx.controlStore.transitionPublication(
          sub, runRef, initial.value.run.version, 'reconcile-required',
        );
        if (!marked.ok) throw new Error(marked.detail);
      }
      for (const card of reconciled.cards) {
        let detail = ctx.controlStore.getRun(sub, runRef);
        if (!detail.ok) throw new Error(detail.detail);
        let stage = detail.value.stages.find((candidate) => candidate.stageId === card.stageId);
        const proposalStage = parsed.value.stages.find((candidate) => candidate.id === card.stageId);
        if (!stage || !proposalStage) throw new Error(`stage '${card.stageId}' disappeared`);
        if (stage.canonicalCardRef === null) {
          const linked = ctx.controlStore.linkStageCard(sub, stage.stageRef, stage.version, card.cardId);
          if (!linked.ok) throw new Error(linked.detail);
        } else if (stage.canonicalCardRef !== card.cardId) throw new Error(`stage '${card.stageId}' card link differs`);
        detail = ctx.controlStore.getRun(sub, runRef);
        if (!detail.ok) throw new Error(detail.detail);
        stage = detail.value.stages.find((candidate) => candidate.stageId === card.stageId);
        if (!stage) throw new Error(`stage '${card.stageId}' disappeared`);
        let attempt = stage.currentAttemptRef
          ? detail.value.attempts.find((candidate) => candidate.attemptRef === stage?.currentAttemptRef)
          : undefined;
        if (!attempt) {
          const createdAttempt = ctx.controlStore.createAttempt(sub, stage.stageRef, {
            expectedStageVersion: stage.version, runtime: proposalStage.worker.runtime, model: proposalStage.worker.model,
          });
          if (!createdAttempt.ok) throw new Error(createdAttempt.detail);
          attempt = createdAttempt.value;
        }
        let session = detail.value.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
        if (!session) {
          const currentAttempt = ctx.controlStore.getRun(sub, runRef);
          if (!currentAttempt.ok) throw new Error(currentAttempt.detail);
          attempt = currentAttempt.value.attempts.find((candidate) => candidate.attemptRef === attempt?.attemptRef);
          if (!attempt) throw new Error('attempt disappeared');
          const createdSession = ctx.controlStore.createWorkerSession(sub, attempt.attemptRef, { expectedAttemptVersion: attempt.version });
          if (!createdSession.ok) throw new Error(createdSession.detail);
          session = createdSession.value;
        }
      }
      const current = ctx.controlStore.getRun(sub, runRef);
      if (!current.ok) throw new Error(current.detail);
      const projection = reconciled.cards.map((card) => {
        const stage = current.value.stages.find((candidate) => candidate.stageId === card.stageId);
        const attempt = current.value.attempts.find((candidate) => candidate.attemptRef === stage?.currentAttemptRef);
        const session = current.value.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
        if (!stage || !attempt || !session) throw new Error(`stage '${card.stageId}' projection chain is incomplete`);
        const attemptState = card.stageState === 'running' ? 'running' as const
          : card.stageState === 'waiting-human' ? 'waiting-human' as const
            : card.stageState === 'succeeded' ? 'succeeded' as const
              : card.stageState === 'failed' ? 'failed' as const
                : card.stageState === 'stopped' ? 'stopped' as const : 'queued' as const;
        const sessionState = card.stageState === 'running' ? 'running' as const
          : card.stageState === 'waiting-human' ? 'waiting' as const
            : card.stageState === 'succeeded' ? 'completed' as const
              : card.stageState === 'failed' ? 'failed' as const
                : card.stageState === 'stopped' ? 'stopped' as const : 'pending' as const;
        return {
          stageRef: stage.stageRef, expectedStageVersion: stage.version,
          canonicalCardRef: card.cardId, state: card.stageState,
          attemptRef: attempt.attemptRef, expectedAttemptVersion: attempt.version, attemptState,
          sessionRef: session.sessionRef, expectedSessionVersion: session.version, sessionState,
        };
      });
      const projected = ctx.controlStore.reconcileCanonicalProjection(sub, runRef, {
        expectedRunVersion: current.value.run.version,
        expectedProposalHash: stored.value.hash,
        stages: projection,
      });
      if (!projected.ok) throw new Error(projected.detail);
      if (projected.value.run.state === 'waiting-human'
        && !projected.value.humanRequests.some((request) => request.state === 'open')) {
        ctx.controlStore.createHumanRequest(sub, runRef, {
          kind: 'intervention', title: 'Canonical publication reconciled; runtime release required',
          prompt: 'The committed cards were recovered exactly. Review and release the inactive automatic runtime separately.',
        });
      }
      return sendResult(reply, ctx.controlStore.getRun(sub, runRef));
    } catch (error) {
      return reply.code(409).send({ error: 'projection-reconciliation-required', detail: error instanceof Error ? error.message : String(error) });
    }
    });
  });

  scope.post('/api/control/runs/:runRef/manager/messages', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const detail = ctx.controlStore.getRun(sub, runRef);
    if (!detail.ok) return sendResult(reply, detail);
    if (!ctx.controlBroker?.isRunning(detail.value.run.managerSessionRef)) {
      return reply.code(409).send({ error: 'manager-not-running' });
    }
    const committed = ctx.controlStore.recordManagerCommand(sub, runRef, {
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      idempotencyKey: string(body.idempotencyKey),
      kind: 'message', message: string(body.message),
    });
    if (!committed.ok) return sendResult(reply, committed);
    if (!ctx.controlBroker.queueInstruction(
      detail.value.run.managerSessionRef, string(body.message), string(body.idempotencyKey),
    )) {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Manager message delivery needs reconciliation',
        prompt: 'The operator message committed durably, but the live Manager could not accept its checkpoint queue.',
      });
      return reply.code(409).send({ error: 'manager-message-reconciliation-required', value: committed.value.event });
    }
    return reply.send({ ok: true, value: committed.value.event, replayed: committed.replayed ?? false });
  });

  scope.post('/api/control/runs/:runRef/manager/steer', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const detail = ctx.controlStore.getRun(sub, runRef);
    if (!detail.ok) return sendResult(reply, detail);
    if (!ctx.controlBroker?.isRunning(detail.value.run.managerSessionRef)) {
      return reply.code(409).send({ error: 'manager-not-running' });
    }
    const instruction = string(body.instruction);
    const checkpoint = string(body.checkpoint);
    const committed = ctx.controlStore.recordManagerCommand(sub, runRef, {
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      idempotencyKey: string(body.idempotencyKey),
      kind: 'steer', message: instruction, checkpoint,
    });
    if (!committed.ok) return sendResult(reply, committed);
    if (!ctx.controlBroker.queueInstructionAtCheckpoint(
      detail.value.run.managerSessionRef, checkpoint, instruction, string(body.idempotencyKey),
    )) {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Manager steering needs reconciliation',
        prompt: 'The checkpoint-bound instruction committed durably, but the live Manager could not accept its queue.',
      });
      return reply.code(409).send({ error: 'manager-steering-reconciliation-required', value: committed.value.event });
    }
    return reply.send({ ok: true, value: committed.value.event, replayed: committed.replayed ?? false });
  });

  scope.post('/api/control/runs/:runRef/manager/stop', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const detail = ctx.controlStore.getRun(sub, runRef);
    if (!detail.ok) return sendResult(reply, detail);
    if (!ctx.cancelAutomatic) return reply.code(409).send({ error: 'automatic-stop-not-activated' });
    if (detail.value.run.version !== integer(body.expectedRunVersion)
      || detail.value.run.managerGeneration !== integer(body.expectedManagerGeneration)) {
      return reply.code(409).send({ error: 'run-state-changed' });
    }
    try {
      const outcome = await ctx.cancelAutomatic({
        subject: sub, runRef, idempotencyKey: string(body.idempotencyKey), reason: 'operator requested stop',
      });
      return reply.send({ ok: true, value: outcome, replayed: outcome.replayed });
    } catch (error) {
      return reply.code(409).send({
        error: 'automatic-stop-reconciliation-required',
        detail: error instanceof Error ? error.message : 'the executor could not confirm Manager and Worker cancellation',
      });
    }
  });

  scope.post('/api/control/runs/:runRef/manager/successor', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const detail = ctx.controlStore.getRun(sub, runRef);
    if (!detail.ok) return sendResult(reply, detail);
    const runtime = string(body.runtime);
    const model = string(body.model);
    const profile = loadExecutionProfiles(ctx.repoRoot).find((candidate) =>
      candidate.role === 'manager' && candidate.runtime === runtime && candidate.model === model,
    );
    if (!profile) return reply.code(400).send({ error: 'manager-profile-refused' });
    const stored = ctx.controlStore.getProposalRevision(
      sub, detail.value.run.proposalRef, detail.value.run.proposalRevision,
    );
    if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
      return reply.code(409).send({ error: 'approved-proposal-binding-lost' });
    }
    const proposal = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
    if (!proposal.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: proposal.detail });
    try {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'control-manager-successor-authorize', owner: sub, target: runRef, riskTier: 'T2',
        result: `authorized:generation:${integer(body.expectedManagerGeneration) + 1}`,
        detail: {
          runRef, proposalHash: stored.value.hash, expectedManagerGeneration: integer(body.expectedManagerGeneration),
          runtime, model, profileId: profile.id,
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'manager-successor-audit-required' });
    }
    const successor = ctx.controlStore.createManagerSuccessor(sub, runRef, {
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      runtime, model, idempotencyKey: string(body.idempotencyKey),
    });
    if (!successor.ok) return sendResult(reply, successor);
    if (!ctx.controlBroker || !ctx.runAutomatic) {
      return reply.code(202).send({ ok: true, value: successor.value, replayed: successor.replayed ?? false, activationGated: true });
    }
    void ctx.runAutomatic({ subject: sub, runRef, proposal: proposal.value }).catch((error: unknown) => {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Manager successor needs intervention',
        prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
      });
    });
    return reply.code(202).send({ ok: true, value: successor.value, replayed: successor.replayed ?? false, starting: true });
  });

  scope.post('/api/control/runs/:runRef/activate', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    if (!ctx.controlBroker || !ctx.runAutomatic) return reply.code(409).send({ error: 'automatic-runtime-not-activated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    if (!string(body.idempotencyKey)) return reply.code(400).send({ error: 'idempotency-key-required' });
    const detail = ctx.controlStore.getRun(sub, runRef);
    if (!detail.ok) return sendResult(reply, detail);
    if (detail.value.run.state === 'running' && ctx.controlBroker.isRunning(detail.value.run.managerSessionRef)) {
      return reply.send({ ok: true, value: detail.value.run, replayed: true });
    }
    if (detail.value.run.version !== integer(body.expectedRunVersion)
      || detail.value.run.managerGeneration !== integer(body.expectedManagerGeneration)
      || detail.value.run.publicationState !== 'published' || detail.value.run.state !== 'waiting-human') {
      return reply.code(409).send({ error: 'activation-state-changed' });
    }
    if (detail.value.humanRequests.some((request) => !acceptsBoundary(request))) {
      return reply.code(409).send({ error: 'human-boundary-unresolved' });
    }
    const stored = ctx.controlStore.getProposalRevision(
      sub, detail.value.run.proposalRef, detail.value.run.proposalRevision,
    );
    if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
      return reply.code(409).send({ error: 'approved-proposal-binding-lost' });
    }
    // Captured before the span closure: the handler's early activation gate proved it non-null, but
    // control-flow narrowing does not cross the closure boundary.
    const runAutomatic = ctx.runAutomatic;
    if (!runAutomatic) return reply.code(409).send({ error: 'automatic-runtime-not-activated' });
    // One ops transaction (nested audit/activation helpers reenter the held lock).
    return withOpsTransaction(async () => {
    try {
      await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner);
    } catch {
      return reply.code(409).send({ error: 'canonical-reconciliation-failed' });
    }
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    const proposal = validatePlanProposal(stored.value.snapshot, registry);
    if (!proposal.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: proposal.detail });
    const compiled = compileApprovedProposal(proposal.value, stored.value.hash, stored.value.hash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, proposal.value.project, proposal.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!compiled.ok) return reply.code(409).send({ error: compiled.reason, detail: compiled.detail });
    try {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'control-run-activate-authorize', owner: sub, target: runRef, riskTier: 'T3',
        result: `authorized:${runRef}:${stored.value.hash}`,
        detail: { runRef, proposalHash: stored.value.hash, managerGeneration: detail.value.run.managerGeneration },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'activation-audit-reconciliation-required' });
    }
    const postAuditPreamble = (ctx.runPreamble ?? defaultPreambleRunner)(ctx.repoRoot);
    if (postAuditPreamble.exitCode !== 0 || !postAuditPreamble.stdout.includes('PREAMBLE OK')) {
      return reply.code(409).send({ error: 'post-audit-preamble-refused' });
    }
    const postAuditProposal = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
    const postAuditCompiled = postAuditProposal.ok
      ? compileApprovedProposal(postAuditProposal.value, stored.value.hash, stored.value.hash, {
          policy: loadPolicyEnvironment(ctx.repoRoot, postAuditProposal.value.project, postAuditProposal.value.governanceRefs),
          defaultWorkers: defaultWorkers(ctx.repoRoot),
        })
      : null;
    if (!postAuditCompiled?.ok
      || JSON.stringify(postAuditCompiled.value.stagePolicies) !== JSON.stringify(compiled.value.stagePolicies)) {
      return reply.code(409).send({ error: 'activation-policy-changed' });
    }
    const rootStageIds = new Set(proposal.value.stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id));
    const rootCards = detail.value.stages
      .filter((stage) => rootStageIds.has(stage.stageId))
      .map((stage) => stage.canonicalCardRef)
      .filter((cardRef): cardRef is string => typeof cardRef === 'string' && cardRef.length > 0);
    if (rootCards.length !== rootStageIds.size) {
      return reply.code(409).send({ error: 'managed-root-card-binding-lost' });
    }
    try {
      await activateManagedRootCards({
        repoRoot: ctx.repoRoot, runRef, cardRefs: rootCards, runPy: ctx.runPy,
        runGit: ctx.opsGit ?? defaultGitRunner,
        authorizeAfterPrepare: () => {
          const currentProposal = validatePlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
          const currentCompiled = currentProposal.ok
            ? compileApprovedProposal(currentProposal.value, stored.value.hash, stored.value.hash, {
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
    } catch (error) {
      return reply.code(409).send({
        error: 'canonical-activation-failed', detail: error instanceof Error ? error.message : String(error),
      });
    }
    void runAutomatic({ subject: sub, runRef, proposal: proposal.value }).catch((error: unknown) => {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Automatic execution needs intervention',
        prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
      });
    });
    return reply.code(202).send({ ok: true, value: detail.value.run, starting: true });
    });
  });

  scope.post('/api/control/human-requests/:requestRef/respond', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const requestRef = (req.params as { requestRef: string }).requestRef;
    const found = ctx.controlStore.getHumanRequest(sub, requestRef);
    if (!found.ok) return sendResult(reply, found);
    const existing = found.value;
    if (existing.state === 'open') {
      if (existing.revision !== integer(body.expectedRevision)) return reply.code(409).send({ error: 'request-revision-changed' });
      try {
        await auditFn(ctx)(ctx.repoRoot, {
          action: 'control-human-response-authorize', owner: sub, target: requestRef,
          riskTier: existing.kind === 'approval' || existing.kind === 'review' || existing.kind === 'governance-refusal' ? 'T3' : 'T2',
          result: `authorized:${string(body.decision)}`,
          detail: { requestRef, runRef: existing.runRef, requestRevision: existing.revision, decision: string(body.decision) },
        }, { runGit: ctx.opsGit, now: ctx.now });
      } catch {
        return reply.code(500).send({ error: 'human-response-audit-required' });
      }
    }
    const responded = ctx.controlStore.respondHumanRequest(sub, requestRef, {
      expectedRevision: integer(body.expectedRevision),
      decision: string(body.decision) as 'responded' | 'approved' | 'rejected' | 'changes-requested',
      idempotencyKey: string(body.idempotencyKey),
      response: body.response == null ? null : string(body.response),
    });
    if (!responded.ok) return sendResult(reply, responded);
    if (!responded.replayed) {
      ctx.controlStore.appendEvent(sub, responded.value.runRef, {
        kind: 'governance', source: 'human', stageRef: responded.value.stageRef,
        status: responded.value.response?.decision === 'approved' || responded.value.response?.decision === 'responded' ? 'success' : 'waiting',
        summary: `Human Request ${responded.value.response?.decision ?? 'resolved'} at revision ${responded.value.revision}`,
      });
    }
    return sendResult(reply, responded);
  });

  scope.get('/api/control/retention/inventory', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    return sub ? reply.send({ inventory: ctx.controlStore.inventory(sub) }) : reply.code(401).send({ error: 'unauthenticated' });
  });

  scope.post('/api/control/retention/dry-run', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRefs = record(req.body).runRefs;
    return sendResult(reply, ctx.controlStore.dryRunQuarantine(sub, Array.isArray(runRefs) ? runRefs.filter((item): item is string => typeof item === 'string') : []));
  });

  scope.post('/api/control/retention/quarantine', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const runRefs = Array.isArray(body.runRefs) ? body.runRefs.filter((item): item is string => typeof item === 'string') : [];
    const expectedPlanHash = string(body.expectedPlanHash);
    const planned = ctx.controlStore.dryRunQuarantine(sub, runRefs);
    if (!planned.ok) return sendResult(reply, planned);
    if (planned.value.planHash !== expectedPlanHash) {
      return reply.code(409).send({ error: 'conflict', detail: 'quarantine plan changed; review a fresh dry-run' });
    }
    if (planned.value.items.some((item) => !item.eligible)) {
      return reply.code(400).send({ error: 'ineligible', detail: 'only quiescent settled run bundles can be quarantined' });
    }
    try {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'control-retention-quarantine-authorize', owner: sub, target: runRefs.join(','), riskTier: 'T2',
        result: `authorized:${expectedPlanHash}`,
        detail: { runRefs, planHash: expectedPlanHash, itemCount: planned.value.items.length },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'quarantine-audit-required' });
    }
    const quarantined = ctx.controlStore.quarantineRuns(sub, runRefs, expectedPlanHash);
    return sendResult(reply, quarantined);
  });

  scope.post('/api/control/retention/restore', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = string(record(req.body).runRef);
    if (!ctx.controlStore.inventory(sub).quarantinedRuns.some((run) => run.runRef === runRef)) {
      return reply.code(404).send({ error: 'not-found', detail: 'quarantined run was not found' });
    }
    try {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'control-retention-restore-authorize', owner: sub, target: runRef, riskTier: 'T2',
        result: `authorized:${runRef}`,
        detail: { runRef },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'restore-audit-required' });
    }
    const restored = ctx.controlStore.restoreRun(sub, runRef);
    return sendResult(reply, restored);
  });
}
