/**
 * D15 — workflow DEFINITION registry routes.
 *
 *   GET  /api/workflows           — list org workflow definitions with validation status (read-only, pre-auth)
 *   GET  /api/workflows/:id       — one definition + its compiled proposal preview + content hash (read-only)
 *   POST /api/workflows/:id/launch — governed convenience: compile → import → approve → launch through the
 *                                    EXISTING control-plane machinery.
 *
 * The two GETs are pure reads registered on the app like `registerRegistry`. The launch route is a
 * governed WRITE: it is registered in its OWN child scope guarded by the same origin → rate-limit →
 * session chain the write surface uses (surface.ts is not edited; this mirrors the PTY route's pattern).
 *
 * The launch handler drives the SAME internal functions `control/routes.ts` uses — it re-imports the
 * proposal/compiler/launch helpers and calls the flow through `ctx.controlStore`; it re-implements
 * nothing. With no execution engine injected (production state), the run publishes canonical cards and
 * then stalls at the existing activation gate (`activationGated: true`), exactly like a manual proposal
 * launch does today.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { requireSession, verifiedSession, writeRateLimitHook } from '../http/middleware.ts';
import { originPlugin } from '../security/origin.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { launchWorkflowRun, type WorkflowRunStageRequest } from '../write/workflowRun.ts';
import { loadPolicy } from '../routing/policy.ts';
import {
  loadPolicyEnvironment,
  loadRuntimeSkillRegistry,
  workflowProfileIds,
} from '../control/environment.ts';
import {
  proposalContentHash,
  validatePlanProposal,
  type PlanProposal,
} from '../control/proposal.ts';
import { compileApprovedProposal } from '../control/compiler.ts';
import type { JsonObject } from '../control/types.ts';
import { parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';

interface WorkflowStagePreview {
  id: string;
  action: string;
  target: string;
  riskTier: 'T1' | 'T2' | 'T3';
}

interface WorkflowDefEntry {
  /** URL id: the definition's own id when it parses, else a stable path-derived fallback. */
  ref: string;
  project: string;
  path: string;
  valid: boolean;
  title: string | null;
  profile: string | null;
  stageCount: number;
  riskTier: 'T1' | 'T2' | 'T3' | null;
  /** Per-stage preview (action → target, tier) for a compiled-preview list; empty for invalid defs. */
  stages: WorkflowStagePreview[];
  detail: string | null;
}

const ORGS_DIR = 'orgs';
const WORKFLOWS_SUBDIR = 'workflows';

function highestTier(def: WorkflowDef): 'T1' | 'T2' | 'T3' {
  const rank = { T1: 1, T2: 2, T3: 3 } as const;
  return def.stages.reduce<'T1' | 'T2' | 'T3'>((max, stage) => (rank[stage.riskTier] > rank[max] ? stage.riskTier : max), 'T1');
}

/** The default worker owner registered for each runtime — the inverse of routes.ts's local helper. */
function defaultWorkers(repoRoot: string): Record<string, string> {
  return Object.fromEntries(Object.entries(loadPolicy(repoRoot).runtimes ?? {})
    .filter((entry): entry is [string, { default_worker: string }] =>
      typeof entry[1].default_worker === 'string' && entry[1].default_worker.length > 0)
    .map(([runtime, spec]) => [runtime, spec.default_worker]));
}

interface ScannedDef {
  entry: WorkflowDefEntry;
  def: WorkflowDef | null;
}

/** Scan `orgs/<project>/workflows/*.md`, parsing each definition and recording its validation status. */
function scanWorkflowDefs(repoRoot: string): ScannedDef[] {
  const orgsRoot = join(repoRoot, ORGS_DIR);
  if (!existsSync(orgsRoot)) return [];
  const knownProfiles = workflowProfileIds();
  const scanned: ScannedDef[] = [];
  for (const project of readdirSync(orgsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = join(orgsRoot, project.name, WORKFLOWS_SUBDIR);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const relPath = `${ORGS_DIR}/${project.name}/${WORKFLOWS_SUBDIR}/${name}`;
      const basename = name.replace(/\.md$/, '');
      let text: string;
      try {
        text = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const parsed = parseWorkflowDef(text, { knownProfiles });
      if (parsed.ok) {
        scanned.push({
          def: parsed.value,
          entry: {
            ref: parsed.value.id,
            project: parsed.value.project,
            path: relPath,
            valid: true,
            title: parsed.value.title,
            profile: parsed.value.profile,
            stageCount: parsed.value.stages.length,
            riskTier: highestTier(parsed.value),
            stages: parsed.value.stages.map((stage) => ({
              id: stage.id, action: stage.action, target: stage.target, riskTier: stage.riskTier,
            })),
            detail: null,
          },
        });
      } else {
        scanned.push({
          def: null,
          entry: {
            ref: `${project.name}~${basename}`,
            project: project.name,
            path: relPath,
            valid: false,
            title: null,
            profile: null,
            stageCount: 0,
            riskTier: null,
            stages: [],
            detail: parsed.detail,
          },
        });
      }
    }
  }
  scanned.sort((a, b) => a.entry.ref.localeCompare(b.entry.ref));
  return scanned;
}

function findScannedDef(repoRoot: string, ref: string): ScannedDef | undefined {
  return scanWorkflowDefs(repoRoot).find((candidate) => candidate.entry.ref === ref);
}

function subject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

interface LaunchResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Compile → import → approve → launch a valid definition, driving the same control-plane functions the
 * manual proposal launch route uses. Fresh idempotency identity per call (each launch is a new run).
 */
async function launchDefinition(ctx: SurfaceContext, sub: string, sessionToken: string | undefined, def: WorkflowDef): Promise<LaunchResult> {
  // The convenience one-step launch is only for the un-activated (deliberate-inactivity) daemon — the
  // exact production state. If an execution engine is ever injected, the manual proposal → activate path
  // owns release; refuse here rather than strand a run behind a bypassed activation gate.
  if (ctx.controlBroker && ctx.runAutomatic) {
    return { status: 409, body: { error: 'workflow-launch-requires-manual-activation', detail: 'automatic execution is activated; launch via the proposal → approve → activate path' } };
  }

  const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
  const compiled = compileWorkflowDef(def, { registry });
  if (!compiled.ok) return { status: 400, body: { error: compiled.reason, detail: compiled.detail } };
  const validation = validatePlanProposal(compiled.value as unknown, registry);
  if (!validation.ok) return { status: 500, body: { error: 'compiled-proposal-invalid', detail: validation.detail } };
  const proposal = validation.value;

  // Import as a fresh proposal revision (opaque source refs — this proposal came from the registry).
  const created = ctx.controlStore.createProposalRevision(sub, {
    sourceComposerRef: 'workflow-registry',
    sourceTurnId: def.id,
    title: proposal.title,
    snapshot: proposal as unknown as JsonObject,
  });
  if (!created.ok) return { status: 400, body: { error: created.reason, detail: created.detail } };
  const proposalRef = created.value.proposalRef;
  const revision = created.value.revision;
  const proposalHash = created.value.hash;
  const idempotencyKey = randomUUID();

  // Approve: audit the authorization, then record the decision (mirrors the decision route).
  try {
    const decisionRisk = proposal.stages.some((stage) => stage.riskTier === 'T3') ? 'T3'
      : proposal.stages.some((stage) => stage.riskTier === 'T2') ? 'T2' : 'T1';
    await auditFn(ctx)(ctx.repoRoot, {
      action: 'workflow-proposal-decision-authorize', owner: sub, target: proposalRef,
      riskTier: decisionRisk, result: `authorized:approved:${proposalHash}`,
      detail: { proposalRef, revision, proposalHash, source: `workflow:${def.id}` },
    }, { runGit: ctx.opsGit, now: ctx.now });
  } catch {
    return { status: 500, body: { error: 'decision-audit-required' } };
  }
  const decided = ctx.controlStore.decideProposal(sub, proposalRef, revision, {
    expectedHash: proposalHash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${idempotencyKey}:decision`,
  });
  if (!decided.ok) return { status: 409, body: { error: decided.reason, detail: decided.detail } };

  // Launch: one ops transaction — reconcile, compile, publish cards + audit, stall at the activation gate.
  return withOpsTransaction(async (): Promise<LaunchResult> => {
    try {
      await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner);
    } catch {
      return { status: 409, body: { error: 'canonical-reconciliation-failed' } };
    }
    const parsed = validatePlanProposal(created.value.snapshot, registry);
    if (!parsed.ok) return { status: 409, body: { error: 'stored-proposal-invalid', detail: parsed.detail } };
    const plan = compileApprovedProposal(parsed.value, proposalHash, proposalHash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, parsed.value.project, parsed.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!plan.ok) return { status: 400, body: { error: plan.reason, detail: plan.detail } };

    const runCreated = ctx.controlStore.createRun(sub, {
      title: parsed.value.title,
      proposalRef,
      proposalRevision: revision,
      expectedProposalHash: proposalHash,
      managerRuntime: parsed.value.manager.runtime,
      managerModel: parsed.value.manager.model,
      idempotencyKey: `${idempotencyKey}:run`,
      stages: parsed.value.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: [...stage.dependsOn] })),
    });
    if (!runCreated.ok) return { status: 409, body: { error: runCreated.reason, detail: runCreated.detail } };
    const runRef = runCreated.value.run.runRef;

    // Any governance-refusal / human gate stalls the run before publication (mirrors the launch route).
    const waitingPolicies = plan.value.stagePolicies.filter((item) => item.decision.disposition === 'waiting-human');
    if (plan.value.humanGates.length > 0 || waitingPolicies.length > 0) {
      const requests = [
        ...waitingPolicies.map((pending) => ({
          stageRef: runCreated.value.stages.find((item) => item.stageId === pending.stageId)?.stageRef ?? null,
          kind: 'governance-refusal' as const,
          title: `Governance review: ${pending.stageId}`,
          prompt: pending.decision.reason,
        })),
        ...plan.value.humanGates.map((pending) => ({
          stageRef: runCreated.value.stages.find((item) => item.stageId === pending.stageId)?.stageRef ?? null,
          kind: pending.gate.kind,
          title: pending.gate.id,
          prompt: pending.gate.prompt,
        })),
      ];
      const requested = ctx.controlStore.createHumanRequests(sub, runRef, { idempotencyKey: `${idempotencyKey}:gates`, requests });
      if (!requested.ok) return { status: 409, body: { error: requested.reason, detail: requested.detail } };
      const pub = ctx.controlStore.transitionPublication(sub, runRef, runCreated.value.run.version, 'waiting-human');
      if (!pub.ok) return { status: 409, body: { error: pub.reason, detail: pub.detail } };
      const waiting = ctx.controlStore.transitionRun(sub, runRef, pub.value.version, 'waiting-human');
      if (!waiting.ok) return { status: 409, body: { error: waiting.reason, detail: waiting.detail } };
      return { status: 202, body: { ok: true, runRef, waitingHuman: true, activationGated: true } };
    }

    if (!plan.value.workflow) {
      return { status: 409, body: { error: 't3-approval-release-not-implemented', runRef } };
    }
    const workflow = plan.value.workflow;
    const publishing = ctx.controlStore.transitionPublication(sub, runRef, runCreated.value.run.version, 'publishing');
    if (!publishing.ok) return { status: 409, body: { error: publishing.reason, detail: publishing.detail } };

    const outcome = await launchWorkflowRun(workflow, { token: sessionToken, config: ctx.sessionConfig }, {
      repoRoot: ctx.repoRoot,
      runPreamble: ctx.runPreamble,
      runPy: ctx.runPy,
      makeRunId: () => runRef,
      publishBlocked: true,
      stageRouting: (stage: WorkflowRunStageRequest) => {
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
        action: 'workflow-run-launch', owner: sub, target: parsed.value.project, riskTier,
        result: `launched:${runRef}:${proposalHash}`,
        detail: { proposalRef, proposalRevision: revision, proposalHash, source: `workflow:${def.id}` },
      }, ctx.now);
      const [first, ...rest] = outcome.cards.map((card) => card.cardPath);
      await commitPreparedCoordination(ctx.repoRoot, first, {
        runGit: ctx.opsGit ?? defaultGitRunner,
        alsoStage: [...rest, AUDIT_REL_PATH],
        message: `chore(queue): launch workflow run ${runRef}`,
        maxRetryPushes: 0,
      });
      for (const card of outcome.cards) {
        const stage = runCreated.value.stages.find((candidate) => candidate.stageId === card.stageId);
        const proposalStage = parsed.value.stages.find((candidate) => candidate.id === card.stageId);
        if (!stage || !proposalStage) throw new Error(`run projection missing stage '${card.stageId}'`);
        const linked = ctx.controlStore.linkStageCard(sub, stage.stageRef, stage.version, card.cardId);
        if (!linked.ok) throw new Error(linked.detail);
        const attempt = ctx.controlStore.createAttempt(sub, stage.stageRef, {
          expectedStageVersion: linked.value.version, runtime: proposalStage.worker.runtime, model: proposalStage.worker.model,
        });
        if (!attempt.ok) throw new Error(attempt.detail);
        const session = ctx.controlStore.createWorkerSession(sub, attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
        if (!session.ok) throw new Error(session.detail);
      }
      const published = ctx.controlStore.transitionPublication(sub, runRef, publishing.value.version, 'published');
      if (!published.ok) throw new Error(published.detail);

      // No Broker / automatic executor injected: publication is complete and the run stalls at the
      // existing runtime-activation gate, identical to today's manual proposal launch.
      const waiting = ctx.controlStore.transitionRun(sub, runRef, published.value.version, 'waiting-human');
      if (!waiting.ok) throw new Error(waiting.detail);
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'governance-refusal', title: 'Automatic execution activation is gated',
        prompt: 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.',
      });
      ctx.controlStore.appendEvent(sub, runRef, {
        kind: 'governance', source: 'system', status: 'waiting', summary: 'workflow run published; runtime activation remains gated',
      });
      return { status: 202, body: { ok: true, runRef, cards: outcome.cards, waitingHuman: true, activationGated: true } };
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

/** A compiled-preview projection for the detail route (never exposes engine internals). */
function compiledPreview(repoRoot: string, def: WorkflowDef): { proposalId: string; contentHash: string; proposal: PlanProposal } | { error: string; detail: string } {
  const registry = loadRuntimeSkillRegistry(repoRoot);
  const compiled = compileWorkflowDef(def, { registry });
  if (!compiled.ok) return { error: compiled.reason, detail: compiled.detail };
  return { proposalId: compiled.value.proposalId, contentHash: proposalContentHash(compiled.value), proposal: compiled.value };
}

/** Register the workflow-definition registry routes + the governed one-step launch route. */
export function registerWorkflows(app: FastifyInstance, ctx: SurfaceContext): void {
  const repoRoot = ctx.repoRoot;

  // Read-only, pre-auth (like registerRegistry).
  app.get('/api/workflows', async () => ({ items: scanWorkflowDefs(repoRoot).map((scanned) => scanned.entry) }));

  app.get('/api/workflows/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const scanned = findScannedDef(repoRoot, id);
    if (!scanned) return reply.code(404).send({ error: 'not-found' });
    if (!scanned.def) return reply.send({ entry: scanned.entry, definition: null, compiled: null });
    const preview = compiledPreview(repoRoot, scanned.def);
    return reply.send({
      entry: scanned.entry,
      definition: scanned.def,
      compiled: 'error' in preview ? { ok: false, error: preview.error, detail: preview.detail } : {
        ok: true, proposalId: preview.proposalId, contentHash: preview.contentHash, stages: preview.proposal.stages,
      },
    });
  });

  // Governed WRITE: its own origin → rate-limit → session child scope (mirrors the PTY route in index.ts;
  // surface.ts is intentionally not edited).
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));
    const preHandler = requireSession(ctx.sessionConfig);
    scope.post('/api/workflows/:id/launch', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const sub = subject(req);
      if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
      const { id } = req.params as { id: string };
      const scanned = findScannedDef(repoRoot, id);
      if (!scanned) return reply.code(404).send({ error: 'not-found' });
      if (!scanned.def) return reply.code(409).send({ error: 'definition-invalid', detail: scanned.entry.detail });
      const result = await launchDefinition(ctx, sub, verifiedSession(req)?.token, scanned.def);
      return reply.code(result.status).send(result.body);
    });
  });
}
