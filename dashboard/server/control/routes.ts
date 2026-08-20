import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import { auditFn, namingFor, type SurfaceContext } from '../http/context.ts';
import { visibleAssistantText } from '../composer/publicTimeline.ts';
import { boundSummary } from './claudeWorkerAdapter.ts';
import { defaultGitRunner, prepareCoordination } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { setCardRouting } from '../write/cardRouting.ts';
import { activateManagedRootCards, workflowCardId } from '../write/workflowRun.ts';
import { defaultPreambleRunner } from '../write/preambleGate.ts';
import {
  createProposalRevision as protocolRevision,
  diffPlanProposals,
  parseProposalFromAssistant,
  validatePlanProposal,
  validateServerCompiledPlanProposal,
  type PlanProposal,
} from './proposal.ts';
import { compileApprovedProposal } from './compiler.ts';
import { loadExecutionProfiles, loadPolicyEnvironment, loadRuntimeSkillRegistry } from './environment.ts';
import type { ControlResult, HumanRequest, JsonObject, ProposalDecision, Run, RunDetail, RunDetailDto } from './types.ts';
import {
  AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  OPERATOR_SUBJECT,
  exactAuthorized20260801ProposalRevision,
  type ReadScope,
  type RunActivationInput,
  type RunActivationPhase,
} from './store.ts';
import {
  AuthorizedFailedRunPublishedUncommittedError,
  reconcileAuthorized20260801FailedRun,
} from './authorizedFailedRunReconciliation.ts';
import { isOperatorUnlockSource } from './activation.ts';
import type { ActivatedExecution, ExecutionUnlockSource } from './activation.ts';
import { MAX_OPERATOR_MESSAGE_CHARS } from './agentSessionChains.ts';
import { withControlDeadline } from './runTransactions.ts';
import { reconcileCanonicalPublication } from './publication.ts';
import { classifyActionRisk, evaluateExecutionPolicy } from './policy.ts';
import { acceptsBoundary, defaultWorkers, executeApprovedLaunch, statusOf, type LaunchOutcome } from './launch.ts';
import type { EntityDisplay } from '../naming.ts';
import { askForHumanRequest, type HumanRequestAsk } from './humanRequestAsk.ts';
import { projectRunState, runLifecycleKind, type RunLifecycleKind } from './runLifecycle.ts';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1;
}

function sendResult<T>(reply: FastifyReply, result: ControlResult<T>, success = 200) {
  return result.ok ? reply.code(success).send({ ok: true, value: result.value, replayed: result.replayed ?? false })
    : reply.code(statusOf(result)).send({ error: result.reason, detail: result.detail });
}

function subject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

/**
 * The scope this request resolves to — the ONE place cross-subject reach is decided (rulings,
 * 2026-08-11).
 *
 * This daemon serves exactly one human, who owns the whole machine; but a run is owned by whichever
 * subject created it, and only the runs launched by hand through the SPA carry the operator's. Every
 * run the queue bridge or the executor launches is owned by `dashboard-engine` (`activation.ts`), so an
 * own-subject-only read hid them from the runs list, from the Workflows graph, and from run detail —
 * unreachable, not merely unlabelled.
 *
 * The first ruling widened READS only. That left the Inbox listing human gates on engine-owned runs
 * which rendered answerable and then 404'd on submit, and left operator message / steer / stop /
 * archive unreachable on exactly the headless runs those controls exist for. Daniel's follow-up
 * ruling: the verified OPERATOR session carries FULL MUTATION AUTHORITY across every subject's runs.
 *
 * So a verified operator session reads AND drives the operator-facing mutations across every subject.
 * Nothing else does: every other subject keeps exact own-subject scoping on both. The widening derives
 * from the verified session subject alone — no header, query param or body field can select it — and
 * the engine, executor and queue-bridge call paths never pass a scope, so they stay own-subject.
 *
 * A widened mutation never moves ownership (the store files every record it writes under the RUN's own
 * subject) and never launders the actor (`respondedBy` and the audit row's `owner` both name the
 * operator). See {@link ReadScope}.
 */
function readScope(req: FastifyRequest): ReadScope {
  return subject(req) === OPERATOR_SUBJECT ? 'all-subjects' : 'own-subject';
}

/**
 * The `sourceComposerRef` that `server/workflows/routes.ts` stamps on every revision it creates from a
 * workflow definition; such a revision carries that definition's id in `sourceTurnId`.
 */
const WORKFLOW_COMPOSER_REF = 'workflow-registry';

/**
 * `proposalRef -> workflow-definition id`, for runs born from the workflow registry.
 *
 * This join used to be re-derived in the BROWSER, which forced every surface listing runs to also fetch
 * the whole revision list just to answer "which workflow does this run belong to". The revisions are
 * already in the store here, so the grouping key is stamped at the DTO-build site instead.
 *
 * Built at the SAME `scope` as the runs it labels: a run read under `'all-subjects'` whose revision was
 * looked up under the caller's own subject would come back with `workflowRef: null` and silently drop
 * out of the Workflows graph — the exact symptom this index exists to prevent.
 */
function workflowRefIndex(ctx: SurfaceContext, sub: string, scope: ReadScope): Map<string, string> {
  const byProposal = new Map<string, string>();
  for (const revision of ctx.controlStore.listProposalRevisionsForComposer(sub, WORKFLOW_COMPOSER_REF, scope)) {
    if (revision.sourceTurnId) byProposal.set(revision.proposalRef, revision.sourceTurnId);
  }
  return byProposal;
}

/**
 * Display-identity embedding for the run DTOs. The canonical `runRef` is untouched and still on the
 * wire — these fields exist so the run list, run detail, and Inbox never have to print it as the
 * primary text an operator reads. `workflowRef` is the grouping key that files a run under its
 * definition; null means the run is ad-hoc (launched from a Composer proposal, not the registry).
 */
function runDisplay<T extends { runRef: string; title: string; proposalRef: string }>(
  ctx: SurfaceContext,
  run: T,
  workflows: Map<string, string>,
): T & EntityDisplay & { workflowRef: string | null } {
  return {
    ...run,
    ...namingFor(ctx).displayFor('run', run.runRef, run.title),
    workflowRef: workflows.get(run.proposalRef) ?? null,
  };
}

function runDto<T extends Run>(run: T): Omit<T, 'lifecycle'> & { state: RunLifecycleKind } {
  const { lifecycle, ...value } = run;
  return { ...value, state: projectRunState(lifecycle) };
}

export function authorizedFailedRunReconciliationWireBody(
  outcome: Awaited<ReturnType<typeof reconcileAuthorized20260801FailedRun>>,
) {
  return {
    ok: true,
    value: { ...outcome.result, run: runDto(outcome.result.run) },
    replayed: outcome.replayed,
    canonicalCommit: outcome.canonicalCommit,
  };
}

/**
 * A Human Request has no identity of its own in the naming registry: the operator reads it as "this
 * RUN needs you", and every surface that lists one renders the owning run beside the request's own
 * `title`. So the two display fields on a request describe its OWNING RUN (kind `'run'`, keyed by
 * `request.runRef`) — never the request.
 *
 * The same build attaches the plain-language `ask` (see `humanRequestAsk.ts`) and demotes the machine's
 * own words to `technicalDetail`. Both are derived HERE, at the one DTO-build site, so no surface can
 * put a traceback in front of the operator as the thing they are being asked.
 */
function humanRequestDisplay(
  ctx: SurfaceContext,
  request: HumanRequest,
  runTitle: string,
): HumanRequest & EntityDisplay & HumanRequestAsk {
  const display = namingFor(ctx).displayFor('run', request.runRef, runTitle);
  return { ...request, ...display, ...askForHumanRequest(request, display.displayName) };
}

/** The `/api/control/runs/:runRef` DTO: display identity plus lossless, auditable iteration state. */
function runDetailDto(ctx: SurfaceContext, sub: string, detail: RunDetail, scope: ReadScope): RunDetailDto {
  const requestByRef = new Map(detail.iterationRequests.map((request) => [request.requestRef, request]));
  return {
    ...detail,
    run: runDisplay(ctx, runDto(detail.run), workflowRefIndex(ctx, sub, scope)),
    humanRequests: detail.humanRequests.map((request) => humanRequestDisplay(ctx, request, detail.run.title)),
    iterationLoops: detail.iterationLoops.map((loop) => {
      const residue = loop.unresolvedResidue;
      if (!residue?.attemptedRequestRef) return loop;
      const attemptedRequest = requestByRef.get(residue.attemptedRequestRef);
      return {
        ...loop,
        unresolvedResidue: {
          ...residue,
          ...(attemptedRequest ? { attemptedRequestCycle: attemptedRequest.cycle } : {}),
        },
      };
    }),
  };
}

/** The latch posture every execution-touching response carries, so the UI never has to guess. */
function executionPosture(ctx: SurfaceContext): {
  state: 'locked' | 'unlocked' | 'injected';
  source: ExecutionUnlockSource | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
  unlockRoute?: string;
} {
  const snapshot = ctx.executionLatch?.snapshot();
  if (!snapshot) {
    // No latch: an explicitly injected executor (tests / future direct wiring). Reported honestly rather
    // than as "unlocked", because nothing here can lock it.
    return { state: 'injected', source: null, unlockedAt: null, unlockedBy: null };
  }
  return {
    ...snapshot,
    ...(snapshot.state === 'locked' ? { unlockRoute: '/api/control/execution/unlock' } : {}),
  };
}

/** The distinct launch-time refusal a locked daemon returns, so the UI can raise an unlock prompt. */
function executionLockedRefusal(ctx: SurfaceContext): { error: string; detail: string; execution: ReturnType<typeof executionPosture> } | null {
  if (!ctx.executionLatch || ctx.executionLatch.snapshot().state !== 'locked') return null;
  return {
    error: 'execution-locked',
    detail: 'execution is locked; unlock it with your passkey before launching a run',
    execution: executionPosture(ctx),
  };
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

/** Exact operator grant + in-place wiring identity required by the one authorized historical repair.
 *  Accepts EITHER operator auth mode (passkey or tailnet), never a headless env-override arm. */
function authorizedLegacyRecoveryExecution(ctx: SurfaceContext, sub: string): ActivatedExecution | null {
  const latch = ctx.executionLatch;
  const snapshot = latch?.snapshot();
  const current = latch?.current() ?? null;
  if (!latch || !current || snapshot?.state !== 'unlocked' || !isOperatorUnlockSource(snapshot.source)
    || snapshot.unlockedBy !== sub || ctx.controlBroker !== current.controlBroker
    || ctx.runAutomatic !== current.runAutomatic || ctx.cancelAutomatic !== current.cancelAutomatic
    || ctx.containManagerStart !== current.containManagerStart
    || ctx.verifyCanonicalResult !== current.verifyCanonicalResult) return null;
  return current;
}

/** The one settlement needs an active passkey grant and proves the captured wiring is inert for this run. */
export type AuthorizedFailedRunReconciliationGrant = {
  latch: NonNullable<SurfaceContext['executionLatch']>;
  wiring: ActivatedExecution;
  unlockedAt: string;
};

export function authorizedFailedRunReconciliationGrant(
  ctx: SurfaceContext,
  sub: string,
  expected?: AuthorizedFailedRunReconciliationGrant,
): AuthorizedFailedRunReconciliationGrant | null {
  const latch = ctx.executionLatch;
  if (!latch || (expected && latch !== expected.latch)) return null;
  const snapshot = latch.snapshot();
  const wiring = latch.current();
  if (!wiring || ctx.controlBroker !== wiring.controlBroker
    || ctx.runAutomatic !== wiring.runAutomatic || ctx.cancelAutomatic !== wiring.cancelAutomatic
    || ctx.containManagerStart !== wiring.containManagerStart
    || ctx.verifyCanonicalResult !== wiring.verifyCanonicalResult) return null;
  const hasLiveRun = [
    AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF,
    ...AUTHORIZED_20260801_FAILED_RUN_STAGES.map((stage) => stage.sessionRef),
  ].some((sessionRef) => wiring.controlBroker.isRunning(sessionRef));
  if (snapshot.state !== 'unlocked' || !isOperatorUnlockSource(snapshot.source)
    || snapshot.unlockedBy !== sub || !snapshot.unlockedAt || hasLiveRun
    || (expected && (snapshot.unlockedAt !== expected.unlockedAt || wiring !== expected.wiring))) return null;
  return { latch, wiring, unlockedAt: snapshot.unlockedAt };
}

/**
 * A failure AFTER the settlement became durable on origin/ops is NOT a refusal: the cards and the
 * audit row are published and only the control-plane record is outstanding, which the operator fixes
 * by re-invoking. Reporting that as 'refused' states the opposite of what happened, so it carries its
 * own stable code. Details stay generic: refusal prose never leaks an internal proof's wording.
 */
export function authorizedFailedRunReconciliationRefusal(error: unknown): { error: string; detail: string } {
  return error instanceof AuthorizedFailedRunPublishedUncommittedError
    ? {
        error: 'authorized-failed-run-reconciliation-published-uncommitted',
        detail: 'the settlement is published on origin/ops but its control-plane record is not final; re-invoke to finalize it',
      }
    : {
        error: 'authorized-failed-run-reconciliation-refused',
        detail: 'a required reconciliation safety proof did not hold',
      };
}

class CompletedRootProvenanceError extends Error {}

class ActivationPreparationError extends Error {
  readonly statusCode: 409 | 500;
  readonly body: { error: string; detail?: string };

  constructor(statusCode: 409 | 500, body: { error: string; detail?: string }) {
    super(body.error);
    this.statusCode = statusCode;
    this.body = body;
  }
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

  /**
   * The SINGLE-revision read, widened (ruling 3). Run detail polls it to build the steering CHECKPOINT
   * pick-list from the approved plan; on an engine-owned run it answered `not-found` and the UI degraded
   * silently to a free-text checkpoint box — the operator steering a headless run had to type a
   * checkpoint id from memory, with a typo indistinguishable from a real one.
   *
   * Deliberately NOT widened alongside it: the proposals LIST above (bridge-imported revisions are not
   * the operator's to enumerate — adoption safety) and the composer import / revision / decision routes
   * below (Composer authoring state stays the authoring subject's).
   */
  scope.get('/api/control/proposals/:proposalRef/revisions/:revision', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { proposalRef, revision } = req.params as { proposalRef: string; revision: string };
    return sendResult(reply, ctx.controlStore.getProposalRevision(sub, proposalRef, Number(revision), readScope(req)));
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
      const prior = validateServerCompiledPlanProposal(stored.value.snapshot, registry);
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

  /**
   * Launch / Retry an approved revision.
   *
   * Ruling 3 reaches this route (2026-08-11 audit): the revision is resolved under the caller's READ
   * SCOPE, so a verified operator can launch or retry a revision the queue bridge imported, and the
   * launch then executes AS THE REVISION'S OWNER. Before this, RunDetail's "Run it again" on a failed
   * engine run and the pre-publication resume branch both 404'd inside the very first revision lookup.
   * "Run it again" is now delivered; the pre-publication resume branch stays a dead end BY DESIGN —
   * it 409s `run-already-exists-for-revision` (naming the run already on screen) instead of minting
   * a duplicate engine-owned run for the same revision.
   *
   * Ownership never moves: the successor run, its stages, attempts, sessions, boundaries and events are
   * all the owner's, and the executor is handed the owner. The operator is the ACTOR — audited as the
   * `control-run-launch` row's `owner`, beside `detail.runOwnerSubject`. The operator's launch identity
   * is namespaced inside {@link executeApprovedLaunch} so it cannot collide with the owner's own launch
   * operations in either direction.
   */
  scope.post('/api/control/proposals/:proposalRef/revisions/:revision/launch', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const admission = ctx.admission('new-work');
    if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
    const { proposalRef, revision } = req.params as { proposalRef: string; revision: string };
    const body = record(req.body);
    const stored = ctx.controlStore.getProposalRevision(sub, proposalRef, Number(revision), readScope(req));
    if (!stored.ok) return sendResult(reply, stored);
    if (stored.value.hash !== string(body.expectedHash)) return reply.code(409).send({ error: 'revision-mismatch' });
    if (stored.value.approval?.decision !== 'approved') return reply.code(409).send({ error: 'not-approved' });
    // The single canonical launch body (one ops transaction: reconcile, compile, publish cards +
    // audit, activate) lives in control/launch.ts. Every launch surface calls it; nothing forks it.
    const outcome = await executeApprovedLaunch(ctx, stored.value.ownerSubject, {
      proposalRef,
      revision: Number(revision),
      storedHash: stored.value.hash,
      snapshot: stored.value.snapshot,
      sessionToken: verifiedSession(req)?.token,
      actorSubject: sub,
      idempotencyKey: string(body.idempotencyKey),
      predecessorRunRef: body.predecessorRunRef == null ? null : string(body.predecessorRunRef),
      expectedPredecessorVersion: integer(body.expectedPredecessorVersion),
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  // ── EXECUTION UNLOCK LATCH ─────────────────────────────────────────────────────────────────────────
  // The daemon boots LOCKED: no broker, no engine, no worker processes. Construction is authorized by the
  // operator's WebAuthn-minted SESSION BEARER — the same one governing every other consequential control
  // action — verified by the scope's `requireSession` preHandler before this handler runs.
  //
  // This route used to run a SECOND, purpose-bound WebAuthn ceremony of its own. That was removed
  // deliberately: the platform's binding requirement is ONE dashboard unlock for the whole platform, and
  // the second biometric prompt made an operator who had already signed in unlock twice to arm the
  // executor. Nothing else was relaxed — origin guard, session verification, and the T3 audit row all
  // still gate this route, and the audit still happens BEFORE anything is constructed. The latch records
  // `source: 'passkey'` truthfully: the authorization chain still roots in a passkey assertion, just the
  // sign-in one. Arming stays an EXPLICIT act — signing in never unlocks execution on its own; the
  // operator must still call this route. Lock remains the fail-safe direction and is unchanged.
  scope.get('/api/control/execution', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send({ execution: executionPosture(ctx) });
  });

  scope.post('/api/control/execution/unlock', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const admission = ctx.admission('new-work');
    if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
    const latch = ctx.executionLatch;
    if (!latch) return reply.code(409).send({ error: 'execution-latch-unavailable' });
    // Audit BEFORE constructing anything: an unlock that cannot be recorded does not happen.
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-execution-unlock-authorize', owner: sub, target: 'execution', riskTier: 'T3',
        result: 'authorized:unlock', detail: { method: 'session-bearer' },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'execution-unlock-audit-required' });
    }
    const unlocked = latch.unlock({ subject: sub });
    if (!unlocked.ok) return reply.code(409).send({ error: 'execution-unlock-failed', detail: unlocked.reason });
    return reply.send({ ok: true, execution: executionPosture(ctx) });
  });

  scope.post('/api/control/execution/lock', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const latch = ctx.executionLatch;
    if (!latch) return reply.code(409).send({ error: 'execution-latch-unavailable' });
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-execution-lock-authorize', owner: sub, target: 'execution', riskTier: 'T2',
        result: 'authorized:lock', detail: { previous: latch.snapshot().state },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'execution-lock-audit-required' });
    }
    latch.lock({ subject: sub });
    return reply.send({ ok: true, execution: executionPosture(ctx) });
  });

  // One Daniel-authorized repair for one already-published, provably-never-started FYT run. This route
  // only reclassifies the exact poisoned boundary. It cannot respond, activate, publish, or execute.
  scope.post('/api/control/recovery/2026-07-31/execution-lock', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const input = {
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      expectedRequestRevision: integer(body.expectedRequestRevision),
      idempotencyKey: string(body.idempotencyKey),
    };
    if (input.expectedRunVersion !== 4 || input.expectedManagerGeneration !== 1 || input.expectedRequestRevision !== 1) {
      return reply.code(409).send({ error: 'legacy-recovery-cas-mismatch' });
    }
    // The run-control lock is keyed by the CALLER here, not by a resolved owner, and that is only safe
    // because this route is own-subject: every store call below reads and writes as `sub`, so `sub` IS
    // the owner. If this frozen route is ever scope-widened, the lock must key by the resolved owner
    // first — otherwise a cross-subject caller would serialise against its own subject and race the
    // owner's activation.
    return ctx.runControlTransactions.run(sub, AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF, async () => {
      const preflight = ctx.controlStore.preflightAuthorized20260731ExecutionLock(sub, input);
      if (!preflight.ok) return sendResult(reply, preflight);
      if (preflight.value.disposition === 'replay') {
        return reply.send({ ok: true, value: preflight.value.result, replayed: true });
      }
      const beforeAudit = authorizedLegacyRecoveryExecution(ctx, sub);
      if (!beforeAudit) return reply.code(409).send({ error: 'legacy-recovery-execution-not-passkey-bound' });
      try {
        await auditFn(ctx)(ctx.repoRoot, {
          action: 'control-legacy-execution-lock-reclassify-authorize',
          owner: sub,
          target: AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
          riskTier: 'T3',
          result: 'authorized:governance-refusal-to-intervention',
          detail: {
            runRef: AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
            requestRef: AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
            expectedRunVersion: input.expectedRunVersion,
            expectedManagerGeneration: input.expectedManagerGeneration,
            expectedRequestRevision: input.expectedRequestRevision,
          },
        }, { runGit: ctx.opsGit, now: ctx.now });
      } catch {
        return reply.code(500).send({ error: 'legacy-recovery-audit-required' });
      }
      const afterAudit = authorizedLegacyRecoveryExecution(ctx, sub);
      if (!afterAudit || afterAudit !== beforeAudit) {
        return reply.code(409).send({ error: 'legacy-recovery-execution-changed-after-audit' });
      }
      const rechecked = ctx.controlStore.preflightAuthorized20260731ExecutionLock(sub, input);
      if (!rechecked.ok) return sendResult(reply, rechecked);
      if (rechecked.value.disposition === 'replay') {
        return reply.send({ ok: true, value: rechecked.value.result, replayed: true });
      }
      return sendResult(reply, ctx.controlStore.recoverAuthorized20260731ExecutionLock(sub, input));
    });
  });

  // Daniel-authorized, exact terminal settlement for the one failed FYT thin-slice predecessor.  This
  // route has no run parameter and no body-controlled target: it cannot be repurposed as Retry, launch,
  // spend, generation, integration, or publication.
  scope.post('/api/control/recovery/2026-08-01/failed-run-reconciliation', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    if (!hasExactKeys(body, [
      'expectedRunVersion', 'expectedManagerGeneration', 'expectedRequestRevision', 'expectedNextEventCursor',
      'expectedProposalHash', 'idempotencyKey',
    ])) return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-cas-mismatch' });
    const input = {
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      expectedRequestRevision: integer(body.expectedRequestRevision),
      expectedNextEventCursor: integer(body.expectedNextEventCursor),
      expectedProposalHash: string(body.expectedProposalHash),
      idempotencyKey: string(body.idempotencyKey),
    };
    if (input.expectedRunVersion !== 7 || input.expectedManagerGeneration !== 1 || input.expectedRequestRevision !== 2
      || input.expectedNextEventCursor !== 6 || input.expectedProposalHash !== AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
      || input.idempotencyKey !== AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY) {
      return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-cas-mismatch' });
    }
    // Caller-keyed lock, same invariant as the 2026-07-31 route above: own-subject route ⇒ `sub` IS the
    // owner of this run. A scope widening here must resolve the owner and key the lock by it.
    return ctx.runControlTransactions.run(sub, AUTHORIZED_20260801_FAILED_RUN_REF, async () =>
      withOpsTransaction(async () => {
        const grant = authorizedFailedRunReconciliationGrant(ctx, sub);
        if (!grant) {
          return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-not-passkey-bound' });
        }
        const stored = ctx.controlStore.getProposalRevision(sub, AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF, 1);
        if (!stored.ok || !exactAuthorized20260801ProposalRevision(stored.value)) {
          return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-proposal-binding-lost' });
        }
        const proposal = validateServerCompiledPlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
        if (!proposal.ok) return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-proposal-invalid', detail: proposal.detail });
        const compiled = compileApprovedProposal(proposal.value, stored.value.hash, stored.value.hash, {
          policy: loadPolicyEnvironment(ctx.repoRoot, proposal.value.project, proposal.value.governanceRefs),
          defaultWorkers: defaultWorkers(ctx.repoRoot),
        });
        if (!compiled.ok || !compiled.value.workflow) {
          return reply.code(409).send({ error: 'authorized-failed-run-reconciliation-workflow-invalid', detail: compiled.ok ? 'workflow is unavailable' : compiled.detail });
        }
        try {
          const outcome = await reconcileAuthorized20260801FailedRun({
            repoRoot: ctx.repoRoot,
            stateRoot: ctx.stateRoot,
            subject: sub,
            input,
            proposalSnapshot: stored.value.snapshot,
            workflow: compiled.value.workflow,
            artifactPaths: proposal.value.stages.flatMap((stage) => stage.artifacts.map((artifact) => artifact.path)),
            store: ctx.controlStore,
            // This is re-run around every filesystem/git boundary by the core.  It binds the same
            // passkey grant (including its latch and in-place wiring identity).  It only reads the
            // fixed run's broker/roster liveness; it never creates, steers, stops, or otherwise drives it.
            assertAuthorized: () => {
              if (!authorizedFailedRunReconciliationGrant(ctx, sub, grant)) {
                throw new Error('authorized reconciliation passkey latch changed');
              }
            },
            runGit: ctx.opsGit ?? defaultGitRunner,
            runPy: ctx.runPy,
            publication: ctx.coordinationPublication,
            outboxRoot: ctx.outboxRoot,
          });
          return reply.send(authorizedFailedRunReconciliationWireBody(outcome));
        } catch (error) {
          // The HTTP reply stays generic (proof wording never crosses the surface), but the operator
          // running the daemon owns its console — without this line a refusal is undiagnosable.
          console.error('[authorized-failed-run-reconciliation] refused:', error instanceof Error ? error.message : error);
          return reply.code(409).send(authorizedFailedRunReconciliationRefusal(error));
        }
      }));
  });

  scope.get('/api/control/runs', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const scope = readScope(req);
    // One revision walk for the whole list, not one per run.
    const workflows = workflowRefIndex(ctx, sub, scope);
    // An archived run is one the operator explicitly dismissed. It stays fully readable by ref and is
    // still listable on request, but it is out of the DEFAULT projection every surface renders —
    // otherwise "archive" would mean nothing and dead runs would keep haunting every list.
    const includeArchived = string((req.query as { includeArchived?: unknown }).includeArchived) === '1';
    const runs = ctx.controlStore.listRuns(sub, scope)
      .filter((run) => includeArchived || runLifecycleKind(run.lifecycle) !== 'archived');
    return reply.send({ runs: runs.map((run) => runDisplay(ctx, runDto(run), workflows)) });
  });

  scope.get('/api/control/runs/:runRef', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const scope = readScope(req);
    const detail = ctx.controlStore.getRun(sub, runRef, scope);
    if (!detail.ok) return sendResult(reply, detail);
    return reply.send({
      ok: true,
      value: runDetailDto(ctx, sub, detail.value, scope),
      replayed: detail.replayed ?? false,
      execution: executionPosture(ctx),
    });
  });

  scope.get('/api/control/runs/:runRef/attempts/:attemptRef/io', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { runRef, attemptRef } = req.params as { runRef: string; attemptRef: string };
    const detail = ctx.controlStore.getRun(sub, runRef, readScope(req));
    if (!detail.ok) return sendResult(reply, detail);
    if (!detail.value.attempts.some((attempt) => attempt.attemptRef === attemptRef)) {
      return reply.code(404).send({ error: 'attempt-not-found' });
    }
    const attemptIo = ctx.executionLatch?.current()?.attemptIo;
    if (!attemptIo) return reply.code(409).send({ error: 'attempt-io-unavailable' });
    const query = req.query as { after?: string; limit?: string };
    const candidateAfter = Number(query.after ?? 0);
    const after = Number.isFinite(candidateAfter) ? Math.max(0, Math.floor(candidateAfter)) : 0;
    const candidateLimit = Number(query.limit ?? 500);
    const limit = Number.isFinite(candidateLimit) ? Math.min(2_000, Math.max(1, Math.floor(candidateLimit))) : 500;
    return reply.send({ entries: attemptIo.read(attemptRef, after, limit) });
  });

  scope.get('/api/control/runs/:runRef/events', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const query = req.query as { after?: string; limit?: string };
    return sendResult(reply, ctx.controlStore.listEvents(
      sub, (req.params as { runRef: string }).runRef, Number(query.after ?? 0), Number(query.limit ?? 200), readScope(req),
    ));
  });

  /**
   * Per-stage runtime/model routing (RunDetail's routing controls).
   *
   * Ruling 3: the run is resolved under the caller's READ SCOPE and everything after that — the
   * authorization re-read, the approved-revision binding, the successor attempt projection, the
   * reconciliation intervention and the timeline event — executes AS THE RUN'S OWNER. A bridge-launched
   * run's records all live under `dashboard-engine`, and reading them as the operator answered
   * `not-found` before the canonical card was ever touched. The actor is recorded by the canonical
   * `card-routing` audit row that `setCardRouting` writes from the verified session.
   */
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

    // Resolved once, up front, so the owner is available to the idempotent-replay branch below as well
    // as to `authorize`. A caller with no reach over this run stops here, before any canonical write.
    const owned = ctx.controlStore.getRun(sub, runRef, readScope(req));
    if (!owned.ok) return sendResult(reply, owned);
    const owner = owned.value.ownerSubject;

    const authorize = () => {
      const detail = ctx.controlStore.getRun(owner, runRef);
      if (!detail.ok) return { ok: false as const, status: 404, error: 'not-found', detail: detail.detail };
      const stage = detail.value.stages.find((candidate) => candidate.stageRef === stageRef);
      if (!stage) return { ok: false as const, status: 404, error: 'not-found', detail: 'stage was not found' };
      // Assignment provenance is immutable at every lifecycle surface. Refuse before any canonical
      // card write/audit, even if a stale caller has otherwise-valid CAS versions.
      if (stage.assignment !== null) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'immutable' as const,
          detail: 'assigned stage routing is immutable; create a successor run with a new approved assignment',
        };
      }
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
      if (detail.value.run.publicationState !== 'published'
        || ['stopping', 'succeeded', 'failed', 'stopped'].includes(runLifecycleKind(detail.value.run.lifecycle))) {
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
        owner, detail.value.run.proposalRef, detail.value.run.proposalRevision,
      );
      if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
        return { ok: false as const, status: 409, error: 'approved-proposal-binding-lost', detail: 'approved proposal binding was lost' };
      }
      const parsed = validateServerCompiledPlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
      if (!parsed.ok) return { ok: false as const, status: 409, error: 'stored-proposal-invalid', detail: parsed.detail };
      const proposalStage = parsed.value.stages.find((candidate) => candidate.id === stage.stageId);
      if (!proposalStage) return { ok: false as const, status: 409, error: 'proposal-binding-lost', detail: 'proposal stage was not found' };
      if (proposalStage.assignment) {
        return {
          ok: false as const, status: 409, error: 'reroute-refused', disposition: 'immutable' as const,
          detail: 'assigned stage routing is immutable; create a successor run with a new approved assignment',
        };
      }
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
        const replay = ctx.controlStore.rerouteStage(owner, stageRef, {
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
    // Attribution BEFORE the canonical write, like every other cross-subject mutation on this surface.
    // The `card-routing` row `setCardRouting` writes names the card, not the run or its owner, so on an
    // engine-owned run nothing recorded WHO rerouted WHOSE run. `owner` is the actor; `runOwnerSubject`
    // is whose run it is.
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-run-reroute-authorize', owner: sub, target: stageRef, riskTier: 'T2',
        result: `authorized:${runtime}:${model}`,
        detail: {
          runRef, runOwnerSubject: owner, stageRef, cardId: initial.cardId, runtime, model,
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'reroute-audit-required' });
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
      publication: ctx.coordinationPublication,
      outboxRoot: ctx.outboxRoot,
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
    const projected = ctx.controlStore.rerouteStage(owner, stageRef, {
      expectedStageVersion,
      expectedAttemptRef,
      expectedAttemptVersion,
      runtime,
      model,
      idempotencyKey,
    });
    if (!projected.ok) {
      ctx.controlStore.createHumanRequest(owner, runRef, {
        stageRef,
        kind: 'intervention',
        title: `reroute:reconcile:${stageRef}`,
        prompt: `Canonical card routing changed to ${runtime}/${model}, but the managed successor projection failed: ${projected.detail}`,
      });
      return reply.code(409).send({ error: 'reroute-projection-reconciliation-required', detail: projected.detail });
    }
    ctx.controlStore.appendEvent(owner, runRef, {
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
    try { await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner, ctx.coordinationPublication, ctx.outboxRoot); }
    catch { return reply.code(409).send({ error: 'canonical-reconciliation-failed' }); }
    const parsed = validateServerCompiledPlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
    if (!parsed.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: parsed.detail });
    const reconciled = await reconcileCanonicalPublication({
      repoRoot: ctx.repoRoot, runRef, proposal: parsed.value, defaultWorkers: defaultWorkers(ctx.repoRoot),
      runGit: ctx.opsGit ?? defaultGitRunner,
    });
    if (!reconciled.ok) return reply.code(409).send({ error: reconciled.reason, detail: reconciled.detail });
    try {
      await auditFn(ctx)(ctx.repoRoot, {
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
      if (runLifecycleKind(projected.value.run.lifecycle) === 'waiting-human'
        && !projected.value.humanRequests.some((request) => request.state === 'open')) {
        ctx.controlStore.createHumanRequest(sub, runRef, {
          kind: 'intervention', title: 'Canonical publication reconciled; runtime release required',
          prompt: 'The committed cards were recovered exactly. Review and release the inactive automatic runtime separately.',
        });
      }
      const detail = ctx.controlStore.getRun(sub, runRef);
      if (!detail.ok) return sendResult(reply, detail);
      return reply.send({
        ok: true,
        value: runDetailDto(ctx, sub, detail.value, 'own-subject'),
        replayed: detail.replayed ?? false,
      });
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
    const runScope = readScope(req);
    const detail = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!detail.ok) return sendResult(reply, detail);
    if (!ctx.controlBroker?.isRunning(detail.value.run.managerSessionRef)) {
      return reply.code(409).send({ error: 'manager-not-running' });
    }
    const committed = ctx.controlStore.recordManagerCommand(sub, runRef, {
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      idempotencyKey: string(body.idempotencyKey),
      kind: 'message', message: string(body.message),
    }, runScope);
    if (!committed.ok) return sendResult(reply, committed);
    if (!ctx.controlBroker.queueInstruction(
      detail.value.run.managerSessionRef, string(body.message), string(body.idempotencyKey),
    )) {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Manager message delivery needs reconciliation',
        prompt: 'The operator message committed durably, but the live Manager could not accept its checkpoint queue.',
      }, runScope);
      return reply.code(409).send({ error: 'manager-message-reconciliation-required', value: committed.value.event });
    }
    return reply.send({ ok: true, value: committed.value.event, replayed: committed.replayed ?? false });
  });

  /** Deliver to a live Claude worker when possible; otherwise persist inert text for its next turn. */
  scope.post('/api/control/runs/:runRef/agents/:agentId/messages', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const { runRef, agentId } = req.params as { runRef: string; agentId: string };
    const runScope = readScope(req);
    const detail = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!detail.ok) return sendResult(reply, detail);
    const stageOfAssignment = detail.value.stages.find((stage) => stage.assignment?.agentId === agentId);
    const assignment = stageOfAssignment?.assignment;
    if (!assignment) return reply.code(404).send({ error: 'agent-not-found' });
    const message = string(record(req.body).message).trim();
    if (!message || message.length > MAX_OPERATOR_MESSAGE_CHARS || message.includes('\0')) {
      return reply.code(400).send({ error: 'invalid-agent-message' });
    }
    const delivery = ctx.executionLatch?.current()?.agentMessages;
    if (!delivery) return reply.code(409).send({ error: 'agent-message-delivery-unavailable' });
    try {
      const delivered = await delivery.deliver({
        runRef, agentId, runtime: assignment.runtime, message,
      });
      try {
        const appended = ctx.controlStore.appendEvent(sub, runRef, {
          kind: 'message', source: 'human', stageRef: stageOfAssignment.stageRef, status: null,
          summary: boundSummary(`operator → ${agentId} (${delivered}): ${message}`),
        }, runScope);
        if (!appended.ok) {
          try {
            await auditFn(ctx)(ctx.repoRoot, {
              action: 'control-agent-message-audit-dropped', owner: sub, target: runRef, riskTier: 'T1',
              result: `dropped:${appended.reason}`,
              detail: { runRef, agentId, stageRef: stageOfAssignment.stageRef, reason: appended.reason },
            }, { runGit: ctx.opsGit, now: ctx.now });
          } catch {
            // The delivery already succeeded; a secondary audit must not change the operator response.
          }
        }
      } catch {
        // The delivery already succeeded; audit persistence must not change the operator response.
      }
      return reply.code(202).send({ delivery: delivered });
    } catch {
      return reply.code(409).send({ error: 'agent-message-delivery-unavailable' });
    }
  });

  scope.post('/api/control/runs/:runRef/manager/steer', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const runScope = readScope(req);
    const detail = ctx.controlStore.getRun(sub, runRef, runScope);
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
    }, runScope);
    if (!committed.ok) return sendResult(reply, committed);
    if (!ctx.controlBroker.queueInstructionAtCheckpoint(
      detail.value.run.managerSessionRef, checkpoint, instruction, string(body.idempotencyKey),
    )) {
      ctx.controlStore.createHumanRequest(sub, runRef, {
        kind: 'intervention', title: 'Manager steering needs reconciliation',
        prompt: 'The checkpoint-bound instruction committed durably, but the live Manager could not accept its queue.',
      }, runScope);
      return reply.code(409).send({ error: 'manager-steering-reconciliation-required', value: committed.value.event });
    }
    return reply.send({ ok: true, value: committed.value.event, replayed: committed.replayed ?? false });
  });

  scope.post('/api/control/runs/:runRef/manager/stop', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const runScope = readScope(req);
    // The per-run lock is keyed by the RUN (its owner + ref), never by the caller: a cross-subject
    // operator control and the engine's own operations on the same run must take the SAME lock, or the
    // stop-vs-activation exclusion this lock exists for silently disappears on exactly the headless runs
    // it matters most for. Own-subject callers are unaffected — owner and caller are the same string.
    const owned = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!owned.ok) return sendResult(reply, owned);
    return ctx.runControlTransactions.run(owned.value.ownerSubject, runRef, async () => {
    const detail = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!detail.ok) return sendResult(reply, detail);
    if (!ctx.cancelAutomatic) {
      const locked = executionLockedRefusal(ctx);
      return reply.code(409).send(locked ?? { error: 'automatic-stop-not-activated' });
    }
    if (detail.value.run.version !== integer(body.expectedRunVersion)
      || detail.value.run.managerGeneration !== integer(body.expectedManagerGeneration)) {
      return reply.code(409).send({ error: 'run-state-changed' });
    }
    try {
      // The cancellation is executed AS THE RUN'S OWNER, not as the caller. The executor walks the
      // run's whole record tree (intent, every session, attempt and stage) with one subject, and every
      // one of those store writes is own-subject by design — the engine is not being widened here. The
      // operator's authority is what got us past the session gate above and past the scoped read; who
      // asked is recorded in the cancellation reason on the run's own timeline. Ownership is immutable,
      // so this resolves to `sub` verbatim for a run the caller owns.
      const outcome = await ctx.cancelAutomatic({
        subject: detail.value.ownerSubject, runRef, idempotencyKey: string(body.idempotencyKey), reason: 'operator requested stop',
      });
      return reply.send({ ok: true, value: outcome, replayed: outcome.replayed });
    } catch (error) {
      return reply.code(409).send({
        error: 'automatic-stop-reconciliation-required',
        detail: error instanceof Error ? error.message : 'the executor could not confirm Manager and Worker cancellation',
      });
    }
    });
  });

  /**
   * spec §3b — dismiss a dead run.
   *
   * Session-gated and T3-audited like every other governed run write: the audit row lands BEFORE the
   * mutation and a failure to write it refuses the request, so no run is ever dismissed off the record.
   * `reason` is the operator's own words and is carried into that row — it is what makes a bulk
   * clean-up (the stale thin-slice validation runs) auditable one run at a time, which is also why
   * there is deliberately no bulk endpoint.
   *
   * Idempotency is the store's: the same `idempotencyKey` replays, a reused key with a different reason
   * is a conflict. A replay re-audits nothing.
   */
  scope.post('/api/control/runs/:runRef/archive', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const idempotencyKey = string(body.idempotencyKey);
    const reason = body.reason == null ? null : string(body.reason);
    if (!idempotencyKey || idempotencyKey.length > 512 || (body.reason != null && typeof body.reason !== 'string')) {
      return reply.code(400).send({ error: 'invalid-archive', detail: 'idempotencyKey is required and reason must be text' });
    }
    const runScope = readScope(req);
    // Keyed by the RUN's owner, like every other lifecycle control here — see the stop route.
    const owned = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!owned.ok) return sendResult(reply, owned);
    return ctx.runControlTransactions.run(owned.value.ownerSubject, runRef, async () => {
      const detail = ctx.controlStore.getRun(sub, runRef, runScope);
      if (!detail.ok) return sendResult(reply, detail);
      if (runLifecycleKind(detail.value.run.lifecycle) !== 'archived') {
        try {
          await auditFn(ctx)(ctx.repoRoot, {
            // `owner` is the ACTOR — the operator session that authorized this — while `runOwnerSubject`
            // below names the subject whose run it is. On a cross-subject archive the two differ, and
            // the row is what makes that attributable.
            action: 'control-run-archive-authorize', owner: sub, target: runRef, riskTier: 'T3',
            result: `authorized:${idempotencyKey}`,
            detail: {
              runRef,
              runOwnerSubject: detail.value.ownerSubject,
              runVersion: detail.value.run.version,
              runState: runLifecycleKind(detail.value.run.lifecycle),
              openHumanRequestCount: detail.value.humanRequests.filter((request) => request.state === 'open').length,
              reason,
            },
          }, { runGit: ctx.opsGit, now: ctx.now });
        } catch {
          return reply.code(500).send({ error: 'run-archive-audit-required' });
        }
      }
      const archived = ctx.controlStore.archiveRun(sub, runRef, { idempotencyKey, reason }, runScope);
      if (!archived.ok) return sendResult(reply, archived);
      if (!archived.replayed) {
        ctx.controlStore.appendEvent(sub, runRef, {
          kind: 'governance', source: 'human', status: 'stopped',
          summary: reason
            ? `Run archived by the operator: ${reason}`
            : 'Run archived by the operator',
        }, runScope);
      }
      return sendResult(reply, {
        ...archived,
        value: { ...archived.value, run: runDto(archived.value.run) },
      });
    });
  });

  scope.post('/api/control/runs/:runRef/manager/successor', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    const runScope = readScope(req);
    // Keyed by the RUN's owner, like every other lifecycle control here — see the stop route.
    const owned = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!owned.ok) return sendResult(reply, owned);
    return ctx.runControlTransactions.run(owned.value.ownerSubject, runRef, async () => {
    // Ruling 3, same as `/activate`: the operator resolves the run across subjects, and everything the
    // successor needs (the run record, its approved proposal revision, the new Manager session, the
    // executor call) is then read and written as the RUN'S OWNER — a bridge-launched run's records all
    // live under `dashboard-engine`, and reading them as the operator answered `not-found`.
    const detail = ctx.controlStore.getRun(sub, runRef, runScope);
    if (!detail.ok) return sendResult(reply, detail);
    const owner = detail.value.ownerSubject;
    const activeActivation = ctx.controlStore.hasActiveRunActivation(owner, runRef);
    if (!activeActivation.ok) return sendResult(reply, activeActivation);
    const acceptedResume = detail.value.run.publicationState === 'published'
      && runLifecycleKind(detail.value.run.lifecycle) === 'waiting-human'
      && detail.value.humanRequests.length > 0
      && detail.value.humanRequests.every((request) => acceptsBoundary(request));
    if (activeActivation.value || acceptedResume) {
      return reply.code(409).send({ error: 'activation-resume-required' });
    }
    const runtime = string(body.runtime);
    const model = string(body.model);
    const profile = loadExecutionProfiles(ctx.repoRoot).find((candidate) =>
      candidate.role === 'manager' && candidate.runtime === runtime && candidate.model === model,
    );
    if (!profile) return reply.code(400).send({ error: 'manager-profile-refused' });
    const stored = ctx.controlStore.getProposalRevision(
      owner, detail.value.run.proposalRef, detail.value.run.proposalRevision,
    );
    if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
      return reply.code(409).send({ error: 'approved-proposal-binding-lost' });
    }
    const proposal = validateServerCompiledPlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
    if (!proposal.ok) return reply.code(409).send({ error: 'stored-proposal-invalid', detail: proposal.detail });
    if (proposal.value.manager.assignment
      && (runtime !== proposal.value.manager.assignment.runtime || model !== proposal.value.manager.assignment.model)) {
      return reply.code(409).send({
        error: 'manager-successor-routing-immutable',
        detail: 'manager successor routing must match immutable manager assignment provenance',
      });
    }
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        // `owner` is the ACTOR (the operator session); `runOwnerSubject` names whose run it is.
        action: 'control-manager-successor-authorize', owner: sub, target: runRef, riskTier: 'T2',
        result: `authorized:generation:${integer(body.expectedManagerGeneration) + 1}`,
        detail: {
          runRef, runOwnerSubject: owner,
          proposalHash: stored.value.hash, expectedManagerGeneration: integer(body.expectedManagerGeneration),
          runtime, model, profileId: profile.id,
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'manager-successor-audit-required' });
    }
    const successor = ctx.controlStore.createManagerSuccessor(owner, runRef, {
      expectedManagerGeneration: integer(body.expectedManagerGeneration),
      runtime, model, idempotencyKey: string(body.idempotencyKey),
    });
    if (!successor.ok) return sendResult(reply, successor);
    if (!ctx.controlBroker || !ctx.runAutomatic) {
      return reply.code(202).send({ ok: true, value: successor.value, replayed: successor.replayed ?? false, activationGated: true });
    }
    void ctx.runAutomatic({ subject: owner, runRef, proposal: proposal.value }).catch((error: unknown) => {
      ctx.controlStore.createHumanRequest(owner, runRef, {
        kind: 'intervention', title: 'Manager successor needs intervention',
        prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
      });
    });
    return reply.code(202).send({ ok: true, value: successor.value, replayed: successor.replayed ?? false, starting: true });
    });
  });

  /**
   * The operator's manual Resume. Thin by design: the activation itself is
   * {@link activateRunUnderOwner}, which the automatic post-gate resume calls too, so the manual and
   * automatic paths cannot drift.
   *
   * Ruling 3 reaches this route as well (2026-08-11 incident): the run is resolved under the caller's
   * READ SCOPE, so a verified operator can activate a run owned by another subject, while the
   * activation machinery underneath executes as the RUN'S OWNER. Before this, a bridge-launched
   * (`dashboard-engine`-owned) run refused the operator's Resume click as `not-found` inside the very
   * first receipt lookup — no receipt written, nothing on the timeline to explain it.
   */
  scope.post('/api/control/runs/:runRef/activate', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = (req.params as { runRef: string }).runRef;
    const body = record(req.body);
    if (!string(body.idempotencyKey)) return reply.code(400).send({ error: 'idempotency-key-required' });
    const owned = ctx.controlStore.getRun(sub, runRef, readScope(req));
    if (!owned.ok) return sendResult(reply, owned);
    const outcome = await activateRunUnderOwner(ctx, {
      actorSubject: sub,
      ownerSubject: owned.value.ownerSubject,
      runRef,
      activation: {
        expectedRunVersion: integer(body.expectedRunVersion),
        expectedManagerGeneration: integer(body.expectedManagerGeneration),
        idempotencyKey: string(body.idempotencyKey),
      },
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  scope.post('/api/control/human-requests/:requestRef/respond', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const requestRef = (req.params as { requestRef: string }).requestRef;
    const runScope = readScope(req);
    const found = ctx.controlStore.getHumanRequest(sub, requestRef, runScope);
    if (!found.ok) return sendResult(reply, found);
    const existing = found.value;
    // Specialized iteration gates have lineage and exact-artifact CAS requirements. Completion and
    // iteration-park requests cannot fall through; a minted intervention remains a generic request.
    const requestRun = ctx.controlStore.getRun(sub, existing.runRef, runScope);
    if (!requestRun.ok) return sendResult(reply, requestRun);
    const genericIterationGate = existing.kind !== 'intervention' && (existing.gateKind === 'iteration-park'
      || requestRun.value.iterationLoops?.some((loop) =>
        loop.completionGateRef === requestRef || loop.interventionRef === requestRef));
    if (genericIterationGate) {
      return reply.code(409).send({
        error: 'iteration-gate-reserved', gateKind: existing.gateKind ?? 'completion',
        resolveUrl: `/api/control/iteration-gates/${requestRef}/resolve`,
      });
    }
    if (existing.state === 'open') {
      if (existing.revision !== integer(body.expectedRevision)) return reply.code(409).send({ error: 'request-revision-changed' });
      try {
        await auditFn(ctx)(ctx.repoRoot, {
          // `owner` is the ACTOR (the operator session); `runOwnerSubject` names whose run it is. The
          // two differ on a cross-subject answer, and this row is the durable attribution for it.
          action: 'control-human-response-authorize', owner: sub, target: requestRef,
          riskTier: existing.kind === 'approval' || existing.kind === 'review' || existing.kind === 'governance-refusal' ? 'T3' : 'T2',
          result: `authorized:${string(body.decision)}`,
          detail: {
            requestRef, runRef: existing.runRef, runOwnerSubject: requestRun.value.ownerSubject,
            requestRevision: existing.revision, decision: string(body.decision),
          },
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
    }, runScope);
    if (!responded.ok) return sendResult(reply, responded);
    if (!responded.replayed) {
      ctx.controlStore.appendEvent(sub, responded.value.runRef, {
        kind: 'governance', source: 'human', stageRef: responded.value.stageRef,
        status: responded.value.response?.decision === 'approved' || responded.value.response?.decision === 'responded' ? 'success' : 'waiting',
        summary: `Human Request ${responded.value.response?.decision ?? 'resolved'} at revision ${responded.value.revision}`,
      }, runScope);
      // Answering the LAST open boundary resumes the run — see resumeRunAfterBoundaryAccepted. Only a
      // fresh decision kicks; a replayed re-submit records nothing new and must start nothing.
      resumeRunAfterBoundaryAccepted(ctx, {
        actorSubject: sub, runRef: responded.value.runRef, answeredTitle: responded.value.title, scope: runScope,
      });
    }
    // Unit-B's spend-grant mint marker used to live here. Unit D moved it to STAGE LAUNCH (see
    // execution.ts `provisionSpendGrant` + spendGrantProvision.ts): the token FILE must exist inside the
    // attempt worktree before the worker spawns, but that worktree is created AFTER this gate approval, and
    // `mint` returns the raw token only once — so minting here would strand the token with nowhere to
    // write it. This route now records the approval exactly as before; the engine mints the grant and writes
    // `.kb/spend-grant.json` when it prepares the worktree for a spending stage whose gate is recorded
    // approved (re-verified against these same resolved human requests).
    return sendResult(reply, responded);
  });

  const resolveIterationGateRoute = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const requestRef = (req.params as { requestRef: string }).requestRef;
    const runScope = readScope(req);
    const request = ctx.controlStore.getHumanRequest(sub, requestRef, runScope);
    if (!request.ok) return sendResult(reply, request);
    const run = ctx.controlStore.getRun(sub, request.value.runRef, runScope);
    if (!run.ok) return sendResult(reply, run);
    const loops = run.value.iterationLoops.filter((loop) =>
      loop.completionGateRef === requestRef || loop.interventionRef === requestRef);
    if (loops.length !== 1) {
      return reply.code(409).send({ error: 'iteration-gate-linkage-ambiguous' });
    }
    const loop = loops[0];
    const gateKind = request.value.gateKind ?? null;
    const parkGate = gateKind === 'iteration-park';
    const receipt = parkGate && loop.parkReason === 'no-progress'
      ? null
      : loop.lastReceiptRef === undefined ? null
        : run.value.iterationReceipts.find((candidate) => candidate.receiptRef === loop.lastReceiptRef) ?? null;
    if (parkGate && !['exhausted', 'no-progress', 'parked'].includes(loop.parkReason ?? '')) {
      return reply.code(409).send({ error: 'iteration-gate-reason-mismatch' });
    }
    if ((!parkGate && (request.value.kind !== 'approval' || receipt === null))
      || (parkGate && loop.state === 'awaiting-park-gate' && loop.parkReason === 'no-progress'
        && receipt === null && !loop.unresolvedResidue?.attemptedRequestRef)) {
      return reply.code(409).send({ error: 'iteration-gate-linkage-ambiguous' });
    }
    const decision = string(body.decision) as 'approved' | 'declined' | 'rejected' | 'changes-requested';
    if (parkGate && !['approved', 'declined'].includes(decision)) {
      return reply.code(400).send({ error: 'invalid-iteration-park-decision', detail: 'Approve or decline; more work requires a separate relaunch.' });
    }
    if (!parkGate && !['approved', 'rejected', 'changes-requested'].includes(decision)) {
      return reply.code(400).send({ error: 'invalid-iteration-completion-decision' });
    }
    const replay = request.value.state === 'resolved' && request.value.response !== null;
    const expectedLoopVersion = replay ? loop.version - 1 : loop.version;
    const exposedReceiptVersion = receipt?.version ?? null;
    const expectedReceiptVersion = exposedReceiptVersion === null ? null
      : replay ? exposedReceiptVersion - 1 : exposedReceiptVersion;
    const suppliedGenerationRefs = Array.isArray(body.expectedGenerationRefs)
      && body.expectedGenerationRefs.every((value) => typeof value === 'string')
      ? body.expectedGenerationRefs as string[] : null;
    const expectedGateKind = body.expectedGateKind;
    const expectedParkReason = body.expectedParkReason;
    const expectedGateRef = string(body.expectedGateRef);
    const suppliedLoopVersion = integer(body.expectedLoopVersion);
    // Receipt version is exposed read-only for audit. This adapter derives the receipt CAS from that
    // authoritative read while the caller binds the gate, reason, loop version, and exact generation set.
    const suppliedReceiptVersion = expectedReceiptVersion;
    const expectedGenerations = suppliedGenerationRefs;
    const exactGenerationSet = expectedGenerations !== null
      && expectedGenerations.length === loop.activeGenerationRefs.length
      && expectedGenerations.every((value, index) => value === loop.activeGenerationRefs[index]);
    if (expectedGateRef !== requestRef || expectedGateKind !== gateKind || expectedParkReason !== (loop.parkReason ?? null)
      || integer(body.expectedRequestRevision) !== request.value.revision || suppliedLoopVersion !== expectedLoopVersion
      || suppliedReceiptVersion !== expectedReceiptVersion || !exactGenerationSet) {
      return reply.code(409).send({ error: 'iteration-gate-cas-mismatch', detail: 'The displayed gate or artifact set changed; reload before deciding.' });
    }
    if (request.value.state === 'open') {
      try {
        await auditFn(ctx)(ctx.repoRoot, {
          action: 'control-iteration-gate-authorize', owner: sub, target: requestRef, riskTier: 'T3',
          result: `authorized:${decision}`,
          detail: {
            requestRef, runRef: request.value.runRef, runOwnerSubject: run.value.ownerSubject,
            requestRevision: request.value.revision, gateKind, parkReason: loop.parkReason ?? null,
            iterationLoopRef: loop.iterationLoopRef, loopVersion: expectedLoopVersion,
            receiptRef: receipt?.receiptRef ?? null, receiptVersion: expectedReceiptVersion,
            generationRefs: [...loop.activeGenerationRefs], decision,
          },
        }, { runGit: ctx.opsGit, now: ctx.now });
      } catch {
        return reply.code(500).send({ error: 'iteration-gate-audit-required' });
      }
    }
    const resolved = ctx.controlStore.resolveIterationGate(sub, requestRef, {
      expectedRequestRevision: request.value.revision,
      expectedReceiptVersion,
      expectedLoopVersion,
      decision,
      operationKey: string(body.idempotencyKey),
      response: body.response == null ? null : string(body.response),
    }, runScope);
    if (!resolved.ok) return sendResult(reply, resolved);
    if (!resolved.replayed) {
      ctx.controlStore.appendEvent(run.value.ownerSubject, request.value.runRef, {
        kind: 'governance', source: 'human', stageRef: request.value.stageRef,
        status: decision === 'approved' ? 'success' : 'waiting',
        summary: parkGate
          ? `Iteration park gate ${decision}; separate relaunch is the only continuation path`
          : `Iteration completion gate ${decision}; participant scheduling remains stopped`,
      }, runScope);
    }
    let failedRun: Run | null = null;
    if (parkGate && resolved.value.loop.state === 'declined') {
      const currentRun = ctx.controlStore.getRun(sub, request.value.runRef, runScope);
      if (!currentRun.ok) return sendResult(reply, currentRun);
      if (runLifecycleKind(currentRun.value.run.lifecycle) === 'failed') failedRun = currentRun.value.run;
      else {
        const failed = ctx.controlStore.transitionRun(currentRun.value.ownerSubject, request.value.runRef, currentRun.value.run.version, 'failed');
        if (!failed.ok) return sendResult(reply, failed);
        failedRun = failed.value;
      }
    } else if (decision === 'approved' && !resolved.replayed) {
      resumeRunAfterBoundaryAccepted(ctx, {
        actorSubject: sub, runRef: request.value.runRef, answeredTitle: request.value.title, scope: runScope,
      });
    }
    const value = failedRun ? { ...resolved.value, run: runDto(failedRun) } : resolved.value;
    if (parkGate) {
      return reply.send({ ok: true, value, replayed: resolved.replayed ?? false,
        continuation: { kind: 'separate-relaunch', detail: 'Further work requires a separate operator relaunch with new run lineage.' } });
    }
    return reply.send({ ok: true, value, replayed: resolved.replayed ?? false });
  };

  scope.post('/api/control/iteration-gates/:requestRef/resolve', { preHandler }, async (req, reply) =>
    resolveIterationGateRoute(req, reply));

  // ── RETENTION ──────────────────────────────────────────────────────────────────────────────────────
  // All four routes carry the operator's scope (ruling 3). RunDetail's "Stored data" → "Review archiving"
  // drives dry-run + quarantine, and on an engine-owned run both answered `not-found` — the operator
  // could see a headless run's storage cost everywhere except where it could be reclaimed. `inventory`
  // and `restore` have no live SPA caller today and are widened WITH them on purpose: a half-widened
  // retention surface (plan across subjects, restore only your own) is a worse trap than the original.
  //
  // The store keys every record it moves by the RUN's OWN subject, so quarantine and restore never
  // relabel a bundle as the operator's; the T2 audit rows name the operator as the actor beside the
  // owning subject of each bundle.

  scope.get('/api/control/retention/inventory', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    return sub ? reply.send({ inventory: ctx.controlStore.inventory(sub, readScope(req)) }) : reply.code(401).send({ error: 'unauthenticated' });
  });

  scope.post('/api/control/retention/dry-run', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRefs = record(req.body).runRefs;
    return sendResult(reply, ctx.controlStore.dryRunQuarantine(
      sub, Array.isArray(runRefs) ? runRefs.filter((item): item is string => typeof item === 'string') : [], readScope(req),
    ));
  });

  scope.post('/api/control/retention/quarantine', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    const runRefs = Array.isArray(body.runRefs) ? body.runRefs.filter((item): item is string => typeof item === 'string') : [];
    const expectedPlanHash = string(body.expectedPlanHash);
    const runScope = readScope(req);
    const planned = ctx.controlStore.dryRunQuarantine(sub, runRefs, runScope);
    if (!planned.ok) return sendResult(reply, planned);
    if (planned.value.planHash !== expectedPlanHash) {
      return reply.code(409).send({ error: 'conflict', detail: 'quarantine plan changed; review a fresh dry-run' });
    }
    if (planned.value.items.some((item) => !item.eligible)) {
      return reply.code(400).send({ error: 'ineligible', detail: 'only quiescent settled run bundles can be quarantined' });
    }
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        // `owner` is the ACTOR; `runOwnerSubjects` names whose bundles are being moved (they differ on a
        // cross-subject quarantine), ordered like the plan's own items.
        action: 'control-retention-quarantine-authorize', owner: sub, target: runRefs.join(','), riskTier: 'T2',
        result: `authorized:${expectedPlanHash}`,
        detail: {
          runRefs, planHash: expectedPlanHash, itemCount: planned.value.items.length,
          runOwnerSubjects: planned.value.items.map((item) => item.ownerSubject),
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'quarantine-audit-required' });
    }
    const quarantined = ctx.controlStore.quarantineRuns(sub, runRefs, expectedPlanHash, runScope);
    return sendResult(reply, quarantined);
  });

  scope.post('/api/control/retention/restore', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const runRef = string(record(req.body).runRef);
    const runScope = readScope(req);
    const bundle = ctx.controlStore.inventory(sub, runScope).quarantinedRuns.find((run) => run.runRef === runRef);
    if (!bundle) {
      return reply.code(404).send({ error: 'not-found', detail: 'quarantined run was not found' });
    }
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        // `owner` is the ACTOR; `runOwnerSubject` names whose bundle is coming back. Restore returns it
        // to that same subject — a cross-subject restore never adopts the run.
        action: 'control-retention-restore-authorize', owner: sub, target: runRef, riskTier: 'T2',
        result: `authorized:${runRef}`,
        detail: { runRef, runOwnerSubject: bundle.ownerSubject },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'restore-audit-required' });
    }
    const restored = ctx.controlStore.restoreRun(sub, runRef, runScope);
    if (!restored.ok) return sendResult(reply, restored);
    return sendResult(reply, { ...restored, value: runDto(restored.value) });
  });
}

/** The `{ status, body }` a failed store result serialises to (matches {@link sendResult}). */
function activationFailure(result: Extract<ControlResult<unknown>, { ok: false }>): LaunchOutcome {
  return { status: statusOf(result), body: { error: result.reason, detail: result.detail } };
}

/** The executor is armed only when the whole activation wiring is present; anything less fails closed. */
function executorArmed(ctx: SurfaceContext): boolean {
  return !!(ctx.controlBroker && ctx.runAutomatic && ctx.containManagerStart);
}

/**
 * The ONE run-activation implementation. Both the operator's manual Resume
 * (`POST /api/control/runs/:runRef/activate`) and the automatic resume that fires when a human answer
 * clears a run's LAST boundary ({@link resumeRunAfterBoundaryAccepted}) call this, so the two can never
 * drift: same receipt/idempotency flow, same canonical root activation, same audit row, same durable
 * Manager-start acknowledgement, same containment when startup cannot be confirmed.
 *
 * Two subjects, deliberately:
 * - `actorSubject` is WHO authorized it — the audit row's `owner`, and nothing else.
 * - `ownerSubject` is WHOSE RUN it is: the per-run serialization key (every lifecycle control locks the
 *   RUN, never the caller, so a cross-subject operator activation and the engine's own operations on
 *   that run cannot interleave), every store read/write here, and the executor call. Exactly
 *   like `cancelAutomatic` on the stop route. A bridge-launched run is owned by `dashboard-engine`, and
 *   its activation receipts, approved proposal revision, stages and cards all live under that subject —
 *   resolving them as the operator is precisely what made the live Resume click die as `not-found`
 *   before any receipt existed. Ownership never moves; the caller's authority was already settled by the
 *   route's scoped read, and the audit row names both parties.
 */
async function activateRunUnderOwner(ctx: SurfaceContext, input: {
  actorSubject: string;
  ownerSubject: string;
  runRef: string;
  activation: RunActivationInput;
}): Promise<LaunchOutcome> {
  const { actorSubject, ownerSubject, runRef } = input;
  const activationInput = input.activation;
  // Exact completed retries are read-only and remain replayable even if the runtime gate was
  // turned off after the original dispatch. Pending receipts still require a live dispatcher.
  const persistedReceipt = ctx.controlStore.getRunActivationReceipt(ownerSubject, runRef, activationInput);
  if (!persistedReceipt.ok) return activationFailure(persistedReceipt);
  if (persistedReceipt.value?.phase === 'dispatched') {
    return { status: 200, body: { ok: true, value: runDto(persistedReceipt.value.run), replayed: true } };
  }
  if (persistedReceipt.value?.phase === 'failed') {
    return { status: 409, body: { error: 'activation-failed' } };
  }
  if (!ctx.controlBroker || !ctx.runAutomatic || !ctx.containManagerStart) {
    // A locked daemon gets its OWN refusal, which the UI turns into an unlock prompt; anything else
    // (an injected-but-incomplete executor) keeps the original not-activated answer.
    const locked = executionLockedRefusal(ctx);
    return { status: 409, body: locked ?? { error: 'automatic-runtime-not-activated' } };
  }
  // Captured before the span closure: the gate above proved it non-null, but control-flow narrowing
  // does not cross the closure boundary.
  const runAutomatic = ctx.runAutomatic;
  const containManagerStart = ctx.containManagerStart;
  if (!runAutomatic || !containManagerStart) {
    return { status: 409, body: { error: 'automatic-runtime-not-activated' } };
  }
  // Per-run serialization excludes stop/successor controls without holding the fleet-wide Git lock
  // during runtime startup. The nested ops transaction covers only audit and canonical root mutation.
  return ctx.runControlTransactions.run(ownerSubject, runRef, async (): Promise<LaunchOutcome> => {
    const receipt = ctx.controlStore.getRunActivationReceipt(ownerSubject, runRef, activationInput);
    if (!receipt.ok) return activationFailure(receipt);
    if (receipt.value?.phase === 'dispatched') {
      return { status: 200, body: { ok: true, value: runDto(receipt.value.run), replayed: true } };
    }
    if (receipt.value?.phase === 'failed') return { status: 409, body: { error: 'activation-failed' } };
    const detail = ctx.controlStore.getRun(ownerSubject, runRef);
    if (!detail.ok) return activationFailure(detail);
    const pendingReplay = receipt.value?.phase === 'claimed' || receipt.value?.phase === 'roots-activated';
    if ((!pendingReplay && detail.value.run.version !== activationInput.expectedRunVersion)
      || detail.value.run.managerGeneration !== activationInput.expectedManagerGeneration
      || detail.value.run.publicationState !== 'published'
      || (pendingReplay
        ? !['waiting-human', 'recovering'].includes(runLifecycleKind(detail.value.run.lifecycle))
        : runLifecycleKind(detail.value.run.lifecycle) !== 'waiting-human')) {
      return { status: 409, body: { error: 'activation-state-changed' } };
    }
    if (detail.value.humanRequests.length === 0
      || detail.value.humanRequests.some((request) => !acceptsBoundary(request))) {
      return { status: 409, body: { error: 'human-boundary-unresolved' } };
    }
    const stored = ctx.controlStore.getProposalRevision(
      ownerSubject, detail.value.run.proposalRef, detail.value.run.proposalRevision,
    );
    if (!stored.ok || stored.value.hash !== detail.value.run.proposalHash || stored.value.approval?.decision !== 'approved') {
      return { status: 409, body: { error: 'approved-proposal-binding-lost' } };
    }
    let proposalForDispatch: PlanProposal | null = null;
    const preparationFailure = await withOpsTransaction(async (): Promise<LaunchOutcome | null> => {
    try {
      await prepareCoordination(ctx.repoRoot, ctx.opsGit ?? defaultGitRunner, ctx.coordinationPublication, ctx.outboxRoot);
    } catch {
      return { status: 409, body: { error: 'canonical-reconciliation-failed' } };
    }
    const registry = loadRuntimeSkillRegistry(ctx.repoRoot);
    const proposal = validateServerCompiledPlanProposal(stored.value.snapshot, registry);
    if (!proposal.ok) return { status: 409, body: { error: 'stored-proposal-invalid', detail: proposal.detail } };
    const compiled = compileApprovedProposal(proposal.value, stored.value.hash, stored.value.hash, {
      policy: loadPolicyEnvironment(ctx.repoRoot, proposal.value.project, proposal.value.governanceRefs),
      defaultWorkers: defaultWorkers(ctx.repoRoot),
    });
    if (!compiled.ok) return { status: 409, body: { error: compiled.reason, detail: compiled.detail } };
    const rootStageIds = new Set(proposal.value.stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id));
    const rootStages = detail.value.stages.filter((stage) => rootStageIds.has(stage.stageId));
    const rootCards = rootStages
      .map((stage) => stage.canonicalCardRef)
      .filter((cardRef): cardRef is string => typeof cardRef === 'string' && cardRef.length > 0);
    if (rootCards.length !== rootStageIds.size || new Set(rootCards).size !== rootCards.length) {
      return { status: 409, body: { error: 'managed-root-card-binding-lost' } };
    }
    const rootByCard = new Map(rootStages.map((stage) => [stage.canonicalCardRef, stage]));
    let claimed = receipt.value ?? null;
    /**
     * The PURE half of activation authorization: read current state, compare, throw. No audit row, no
     * preamble, no claim. Safe to run any number of times, which is what makes it the re-proof the
     * publication runs after every reconciling pull — a run that loses two push races calls it three
     * times for one act, and anything side-effecting here would emit three T3 authorize rows and take
     * the claim three times.
     *
     * `exactPending` is recomputed on EVERY call rather than captured once: after `claimRunActivation`
     * below the run is `claimed`, so a later re-proof must judge it by the pending-phase rules (the
     * version has moved and `recovering` is legal) instead of failing on the pre-claim expectations.
     */
    const assertCurrentState = (): void => {
      const exactPending = claimed?.phase === 'claimed' || claimed?.phase === 'roots-activated';
      const current = ctx.controlStore.getRun(ownerSubject, runRef);
      if (!current.ok
        || (!exactPending && current.value.run.version !== activationInput.expectedRunVersion)
        || current.value.run.managerGeneration !== activationInput.expectedManagerGeneration
        || current.value.run.publicationState !== 'published'
        || (exactPending
          ? !['waiting-human', 'recovering'].includes(runLifecycleKind(current.value.run.lifecycle))
          : runLifecycleKind(current.value.run.lifecycle) !== 'waiting-human')
        || current.value.humanRequests.length === 0
        || current.value.humanRequests.some((request) => !acceptsBoundary(request))) {
        throw new Error('run activation state changed before canonical root activation');
      }
    };
    const currentPolicyMatches = (): boolean => {
      const currentProposal = validateServerCompiledPlanProposal(stored.value.snapshot, loadRuntimeSkillRegistry(ctx.repoRoot));
      const currentCompiled = currentProposal.ok
        ? compileApprovedProposal(currentProposal.value, stored.value.hash, stored.value.hash, {
            policy: loadPolicyEnvironment(ctx.repoRoot, currentProposal.value.project, currentProposal.value.governanceRefs),
            defaultWorkers: defaultWorkers(ctx.repoRoot),
          })
        : null;
      return !!currentCompiled?.ok
        && JSON.stringify(currentCompiled.value.stagePolicies) === JSON.stringify(compiled.value.stagePolicies);
    };
    const reassertActivationAuthorization = (): void => {
      assertCurrentState();
      if (!currentPolicyMatches()) {
        throw new ActivationPreparationError(409, { error: 'activation-policy-changed' });
      }
    };
    try {
      await (ctx.activateManagedRoots ?? activateManagedRootCards)({
        repoRoot: ctx.repoRoot, runRef, cardRefs: rootCards, runPy: ctx.runPy,
        runGit: ctx.opsGit ?? defaultGitRunner,
        publication: ctx.coordinationPublication,
        outboxRoot: ctx.outboxRoot,
        verifyCompletedRoots: async ({ cardRefs }) => {
          if (!ctx.verifyCanonicalResult) throw new CompletedRootProvenanceError('canonical result verifier is unavailable');
          for (const cardRef of cardRefs) {
            const stage = rootByCard.get(cardRef);
            let verified = false;
            try {
              verified = !!stage && stage.currentGeneration === 1 && workflowCardId(runRef, stage.stageId) === cardRef
                && await ctx.verifyCanonicalResult({ subject: ownerSubject, runRef, stageId: stage.stageId });
            } catch {
              throw new CompletedRootProvenanceError('completed managed root provenance is not canonical');
            }
            if (!verified) {
              throw new CompletedRootProvenanceError('completed managed root provenance is not canonical');
            }
          }
        },
        reassertAfterReconcile: reassertActivationAuthorization,
        authorizeAfterPrepare: async () => {
          reassertActivationAuthorization();
          try {
            await auditFn(ctx)(ctx.repoRoot, {
              // `owner` is the ACTOR that authorized this activation — the operator session on a
              // cross-subject Resume — while `runOwnerSubject` names the subject the activation itself
              // executes as. The row is what makes the two attributable when they differ.
              action: 'control-run-activate-authorize', owner: actorSubject, target: runRef, riskTier: 'T3',
              result: `authorized:${runRef}:${stored.value.hash}`,
              detail: {
                runRef, runOwnerSubject: ownerSubject, proposalHash: stored.value.hash,
                managerGeneration: detail.value.run.managerGeneration,
              },
            }, { runGit: ctx.opsGit, now: ctx.now });
          } catch {
            throw new ActivationPreparationError(500, { error: 'activation-audit-reconciliation-required' });
          }
          const postAuditPreamble = (ctx.runPreamble ?? defaultPreambleRunner)(ctx.repoRoot);
          if (postAuditPreamble.exitCode !== 0 || !postAuditPreamble.stdout.includes('PREAMBLE OK')) {
            throw new ActivationPreparationError(409, { error: 'post-audit-preamble-refused' });
          }
          reassertActivationAuthorization();
          const claim = ctx.controlStore.claimRunActivation(ownerSubject, runRef, activationInput);
          if (!claim.ok) throw new Error(claim.detail);
          claimed = claim.value;
        },
      });
    } catch (error) {
      if (error instanceof CompletedRootProvenanceError) {
        return { status: 409, body: { error: 'completed-root-provenance-refused' } };
      }
      if (error instanceof ActivationPreparationError) {
        return { status: error.statusCode, body: error.body };
      }
      if (claimed) ctx.controlStore.failRunActivation(ownerSubject, runRef, activationInput);
      return {
        status: 409,
        body: { error: 'canonical-activation-failed', detail: error instanceof Error ? error.message : String(error) },
      };
    }
    if (!claimed) return { status: 409, body: { error: 'activation-claim-missing' } };
    const rootsActivated = ctx.controlStore.advanceRunActivation(ownerSubject, runRef, activationInput, 'roots-activated');
    if (!rootsActivated.ok) {
      ctx.controlStore.failRunActivation(ownerSubject, runRef, activationInput);
      return activationFailure(rootsActivated);
    }
    proposalForDispatch = proposal.value;
    return null;
    });
    if (preparationFailure) return preparationFailure;
    if (!proposalForDispatch) return { status: 409, body: { error: 'activation-preparation-missing' } };
    let acknowledgeDispatch!: (receipt: { run: Run; phase: RunActivationPhase }) => void;
    let rejectDispatch!: (error: Error) => void;
    let dispatchAcknowledged = false;
    const dispatchAcknowledgement = new Promise<{
      run: Run;
      phase: RunActivationPhase;
    }>((resolve, reject) => {
      acknowledgeDispatch = resolve;
      rejectDispatch = reject;
    });
    let execution: Promise<unknown>;
    try {
      execution = runAutomatic({
        subject: ownerSubject,
        runRef,
        proposal: proposalForDispatch,
        onManagerStarted: () => {
          const dispatched = ctx.controlStore.advanceRunActivation(ownerSubject, runRef, activationInput, 'dispatched');
          if (!dispatched.ok) throw new Error(dispatched.detail);
          dispatchAcknowledged = true;
          acknowledgeDispatch(dispatched.value);
        },
      });
    } catch (error) {
      ctx.controlStore.failRunActivation(ownerSubject, runRef, activationInput);
      return {
        status: 409,
        body: {
          error: 'automatic-dispatch-failed',
          detail: error instanceof Error ? error.message : 'automatic execution adapter failed',
        },
      };
    }
    void execution.then(
      () => {
        if (!dispatchAcknowledged) rejectDispatch(new Error('automatic execution returned before durable Manager startup'));
      },
      (error: unknown) => rejectDispatch(error instanceof Error ? error : new Error('automatic execution adapter failed')),
    );
    let dispatched: { run: Run; phase: RunActivationPhase };
    try {
      dispatched = await withControlDeadline(
        dispatchAcknowledgement,
        ctx.managerStartAckTimeoutMs,
        `Manager startup was not durably acknowledged within ${ctx.managerStartAckTimeoutMs}ms`,
      );
    } catch (error) {
      // Close the outbox first. A Manager-start callback arriving while cancellation is in flight
      // must observe `failed` and can never turn a timeout response into a later dispatched replay.
      ctx.controlStore.failRunActivation(ownerSubject, runRef, activationInput);
      try {
        await withControlDeadline(
          containManagerStart({
            subject: ownerSubject,
            runRef,
            idempotencyKey: `activation-contain:${activationInput.idempotencyKey}`,
          }),
          ctx.managerStartAckTimeoutMs,
          `Manager startup cancellation was not acknowledged within ${ctx.managerStartAckTimeoutMs}ms`,
        );
      } catch {
        // The durable run/receipt containment below remains mandatory even if process cancellation
        // cannot be confirmed.
      }
      const intervention = ctx.controlStore.createHumanRequest(ownerSubject, runRef, {
        kind: 'intervention',
        title: 'Activation dispatch needs reconciliation',
        prompt: error instanceof Error ? error.message : 'durable Manager startup acknowledgement failed',
      });
      if (!intervention.ok) {
        const current = ctx.controlStore.getRun(ownerSubject, runRef);
        if (current.ok && ['recovering', 'running', 'waiting-human']
          .includes(runLifecycleKind(current.value.run.lifecycle))) {
          ctx.controlStore.transitionRun(ownerSubject, runRef, current.value.run.version, 'interrupted');
        }
      }
      return {
        status: 409,
        body: {
          error: 'automatic-dispatch-failed',
          detail: error instanceof Error ? error.message : 'automatic execution adapter failed',
        },
      };
    }
    void execution.catch((error: unknown) => {
      const intervention = ctx.controlStore.createHumanRequest(ownerSubject, runRef, {
        kind: 'intervention', title: 'Automatic execution needs intervention',
        prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
      });
      const current = ctx.controlStore.getRun(ownerSubject, runRef);
      if (current.ok && ['recovering', 'running'].includes(runLifecycleKind(current.value.run.lifecycle))) {
        ctx.controlStore.transitionRun(
          ownerSubject,
          runRef,
          current.value.run.version,
          intervention.ok ? 'waiting-human' : 'interrupted',
        );
      }
    });
    return { status: 202, body: { ok: true, value: runDto(dispatched.run), starting: true } };
  });
}

/**
 * The two titles an activation refusal parks a run under: the dispatch-failure ask minted inside
 * {@link activateRunUnderOwner} and the auto-resume ask minted by `park()` below.
 *
 * These strings are a DURABLE IDENTITY, not a description — both the mint guard and the
 * do-not-re-fire guard match on them, so renaming one reopens the intervention storm they prevent.
 */
const ACTIVATION_PARK_TITLES = new Set<string>([
  'Activation dispatch needs reconciliation',
  'Automatic resume needs intervention',
]);

/**
 * Answering a gate IS the operator's go.
 *
 * A run parked in `waiting-human` sits there until something drives it again. Recording the answer used
 * to be the whole of it, so the operator had to find a SECOND control (Resume) and click it — ceremony,
 * and on 2026-08-11 a bridge-launched run simply sat there until he went looking for that button. So the
 * respond and completion-gate routes call this immediately after a decision is durably recorded.
 *
 * The decision to kick is computed SYNCHRONOUSLY from post-response state (the HTTP answer never waits
 * on the runtime), and it is deliberately narrow:
 * - the executor must be armed. A locked daemon must never auto-start work; the manual Resume stays the
 *   fallback and is the control that raises the unlock prompt.
 * - the run must still be published and parked in `waiting-human`.
 * - EVERY boundary must now be accepted. A second open gate, or a `rejected` / `changes-requested`
 *   decision (which leaves its own request unaccepted, and mints an intervention on the review path),
 *   fails this predicate — which is why neither needs a special case here.
 *
 * The kick itself is exactly the manual Resume ({@link activateRunUnderOwner}) — same receipts, same
 * audit, same executor call under the run's owner — and a refusal is reported the way every other
 * automatic-execution failure is: as an intervention Human Request on the run, so the operator sees WHY
 * their answer did not resume it instead of watching a silent park. That intervention is minted only
 * while the run is still parked, so a refusal caused by the run having already moved on adds nothing.
 */
function resumeRunAfterBoundaryAccepted(ctx: SurfaceContext, input: {
  actorSubject: string;
  runRef: string;
  /** The title of the boundary just answered — see {@link ACTIVATION_PARK_TITLES}. */
  answeredTitle: string;
  scope: ReadScope;
}): void {
  const { actorSubject, runRef, scope } = input;
  if (!executorArmed(ctx)) return;
  // ANSWERING AN ACTIVATION PARK NEVER RE-FIRES THE ACTIVATION. Every refusal reachable before
  // `claimRunActivation` is deterministic and leaves no receipt and no version bump, so a retry driven
  // by the answer fails identically and mints the next park — one per answer, to
  // MAX_HUMAN_REQUESTS_PER_RUN, after which the run is parked forever with nothing left to answer. The
  // operator fixes the cause and uses the manual Resume, which is exactly this activation without the
  // self-feeding loop.
  if (ACTIVATION_PARK_TITLES.has(input.answeredTitle)) return;
  const detail = ctx.controlStore.getRun(actorSubject, runRef, scope);
  if (!detail.ok) return;
  const run = detail.value.run;
  if (runLifecycleKind(run.lifecycle) !== 'waiting-human' || run.publicationState !== 'published') return;
  if (detail.value.humanRequests.length === 0
    || detail.value.humanRequests.some((request) => !acceptsBoundary(request))) return;
  const ownerSubject = detail.value.ownerSubject;
  const activation: RunActivationInput = {
    expectedRunVersion: run.version,
    expectedManagerGeneration: run.managerGeneration,
    idempotencyKey: `auto-resume:${runRef}:${run.version}:${run.managerGeneration}:${run.proposalHash}`,
  };
  const park = (reason: string): void => {
    const current = ctx.controlStore.getRun(ownerSubject, runRef);
    if (!current.ok || runLifecycleKind(current.value.run.lifecycle) !== 'waiting-human') return;
    // At most ONE open activation park per run, whichever surface minted it: a dispatch failure already
    // files 'Activation dispatch needs reconciliation' inside `activateRunUnderOwner` and then returns
    // the refusal here, so without this one event produced two asks for the same thing.
    if (current.value.humanRequests.some((request) => request.state === 'open' && ACTIVATION_PARK_TITLES.has(request.title))) return;
    ctx.controlStore.createHumanRequest(ownerSubject, runRef, {
      kind: 'intervention',
      title: 'Automatic resume needs intervention',
      prompt: `The answered boundary cleared this run, but the automatic resume was refused: ${reason}`,
    });
  };
  // Fire-and-forget, exactly like the activate route's own `void runAutomatic(...)` handlers: the
  // operator's answer is already durable and its HTTP response must not wait on Manager startup.
  void activateRunUnderOwner(ctx, { actorSubject, ownerSubject, runRef, activation }).then(
    (outcome) => {
      if (outcome.status < 300) return;
      park(string(outcome.body.error) || 'automatic resume was refused');
    },
    (error: unknown) => park(error instanceof Error ? error.message : 'automatic execution adapter failed'),
  );
}
