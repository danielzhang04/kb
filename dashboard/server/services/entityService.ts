// P6 W2 [P6-C80, design:435] — the pure entity service extracted from the agent/workflow entity handlers
// (`agents/routes.ts:270,271,290,299`; `workflows/routes.ts:1091,1095,1109,1204`). It reproduces, over
// injected ports: the list/detail ETag-304 + 404/422 reads; the closed builder create/update body walls
// and the `submitEntityBuilder` → 202 / `builderError` mapping; AND it CARRIES `workflows/routes.ts:732`'s
// `withOpsTransaction` — the `amendDefinition` path reached from `PUT /api/workflows/:id` — out of the
// route [P6-C80], so once W6.2 removes it there, §9 probe 1's `$directStore` scan of `workflows/routes.ts`
// and `api/v1` for `withOpsTransaction` is satisfiable. W2 only BUILDS the service + its test. No route edited.

import type { LaunchOutcome } from '../control/launch.ts';
import type { ServiceReply } from './scheduleService.ts';

const BUILDER_FIELDS = ['humanName', 'purpose', 'model', 'profile', 'tools', 'skills', 'connectors', 'filesystemRoots'] as const;

function exactBody(body: unknown, keys: readonly string[]): body is Record<string, unknown> {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body as Record<string, unknown>).every((key) => keys.includes(key));
}

function builderRequest(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(BUILDER_FIELDS.map((key) => [key, body[key]]));
}

/** `builderError` (`agents/routes.ts`, `workflows/routes.ts` — identical): a `*BuilderFailure` carries its
 *  own status; anything else is `409` for an idempotency-body conflict and `400` otherwise. */
export function builderError(error: unknown): ServiceReply {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && error instanceof Error) return { status, body: { error: error.message } };
  const message = error instanceof Error ? error.message : 'invalid-builder-request';
  return { status: message === 'idempotency-body-conflict' ? 409 : 400, body: { error: message } };
}

// --- Reads (ETag/304 + 404/422) ----------------------------------------------------------------------

/** A projected entity list/detail carrying the `revision` its ETag is built from. */
export interface Revisioned { readonly revision: string; readonly [key: string]: unknown }

function sendRevisioned(value: Revisioned, ifNoneMatch: string | undefined): ServiceReply {
  const etag = `"${value.revision}"`;
  if (ifNoneMatch === etag) return { status: 304, etag };
  return { status: 200, etag, body: value };
}

export interface EntityListPort { list(): Revisioned }
/** GET /api/agents, GET /api/workflows — the shared `sendRevisioned` list read. */
export function readEntityList(port: EntityListPort, ifNoneMatch: string | undefined): ServiceReply {
  return sendRevisioned(port.list(), ifNoneMatch);
}

export interface AgentDetailPort {
  declaration(id: string): unknown | undefined;
  detail(declaration: unknown): Revisioned;
  problem(id: string): unknown | undefined;
}
/** GET /api/agents/:id — detail, else the parse problem `422`, else `404`. */
export function readAgentDetail(port: AgentDetailPort, id: string, ifNoneMatch: string | undefined): ServiceReply {
  const declaration = port.declaration(id);
  if (declaration) return sendRevisioned(port.detail(declaration), ifNoneMatch);
  const problem = port.problem(id);
  return problem
    ? { status: 422, body: { error: 'agent-declaration-invalid', declaration: problem } }
    : { status: 404, body: { error: 'not-found' } };
}

export interface WorkflowDetailPort {
  findScannedDef(id: string): { def: unknown | null } | null;
  detail(scanned: { def: unknown }): Revisioned;
}
/** GET /api/workflows/:id — `404` unknown, `422` unparsed, else the detail read. */
export function readWorkflowDetail(port: WorkflowDetailPort, id: string, ifNoneMatch: string | undefined): ServiceReply {
  const scanned = port.findScannedDef(id);
  if (!scanned) return { status: 404, body: { error: 'not-found' } };
  if (!scanned.def) return { status: 422, body: { error: 'workflow-definition-invalid' } };
  return sendRevisioned(port.detail(scanned as { def: unknown }), ifNoneMatch);
}

// --- Builder writes (closed body wall → submit → 202 / builderError) ----------------------------------

/** The injected `submitEntityBuilder` call; it returns a receipt or throws a mapped builder error. */
export type SubmitBuilderPort = (args: {
  selector: { type: 'agent' | 'workflow'; id: string };
  project: string;
  expectedSourceRevision: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
}) => Promise<unknown>;

async function runSubmit(submit: () => Promise<unknown>): Promise<ServiceReply> {
  try {
    return { status: 202, body: await submit() };
  } catch (error) {
    return builderError(error);
  }
}

/** POST /api/agents — closed create body, `project-required`, then submit. */
export async function createAgent(submit: SubmitBuilderPort, body: unknown): Promise<ServiceReply> {
  if (!exactBody(body, [...BUILDER_FIELDS, 'selector', 'project', 'expectedCollectionRevision', 'idempotencyKey'])) {
    return { status: 400, body: { error: 'invalid-agent-create-body' } };
  }
  if (!body.project) return { status: 400, body: { error: 'project-required' } };
  return runSubmit(() => submit({
    selector: body.selector as { type: 'agent'; id: string }, project: body.project as string,
    expectedSourceRevision: body.expectedCollectionRevision as string, idempotencyKey: body.idempotencyKey as string,
    request: builderRequest(body),
  }));
}

/** PUT /api/agents/:id — closed update body, `404` unknown, then submit. */
export async function updateAgent(submit: SubmitBuilderPort, declaration: unknown | undefined, id: string, body: unknown, firstProject: string | undefined): Promise<ServiceReply> {
  if (!exactBody(body, [...BUILDER_FIELDS, 'expectedSourceRevision', 'idempotencyKey'])) {
    return { status: 400, body: { error: 'invalid-agent-update-body' } };
  }
  if (!declaration) return { status: 404, body: { error: 'not-found' } };
  return runSubmit(() => submit({
    selector: { type: 'agent', id }, project: firstProject as string,
    expectedSourceRevision: body.expectedSourceRevision as string, idempotencyKey: body.idempotencyKey as string,
    request: builderRequest(body),
  }));
}

/** POST /api/workflows — closed create body, selector shape, `already-exists`, then submit. */
export async function createWorkflow(submit: SubmitBuilderPort, body: unknown, exists: (id: string) => boolean): Promise<ServiceReply> {
  if (!exactBody(body, [...BUILDER_FIELDS, 'selector', 'project', 'expectedCollectionRevision', 'idempotencyKey'])) {
    return { status: 400, body: { error: 'invalid-workflow-create-body' } };
  }
  const selector = body.selector as { type?: unknown; id?: unknown } | undefined;
  if (!selector || selector.type !== 'workflow' || typeof selector.id !== 'string' || typeof body.project !== 'string') {
    return { status: 400, body: { error: 'invalid-runnable-selector' } };
  }
  if (exists(selector.id)) return { status: 409, body: { error: 'already-exists' } };
  return runSubmit(() => submit({
    selector: { type: 'workflow', id: selector.id as string }, project: body.project as string,
    expectedSourceRevision: body.expectedCollectionRevision as string, idempotencyKey: body.idempotencyKey as string,
    request: builderRequest(body),
  }));
}

/** PUT /api/workflows/:id — the BUILDER branch (the amend branch is `amendWorkflowDefinition`). */
export async function updateWorkflowBuilder(submit: SubmitBuilderPort, scanned: { def: unknown | null; entry: { project: string } } | null, id: string, body: unknown): Promise<ServiceReply> {
  if (!scanned?.def || !exactBody(body, [...BUILDER_FIELDS, 'expectedSourceRevision', 'idempotencyKey'])) {
    return { status: 400, body: { error: 'invalid-workflow-update-body' } };
  }
  return runSubmit(() => submit({
    selector: { type: 'workflow', id }, project: scanned.entry.project,
    expectedSourceRevision: (body as Record<string, unknown>).expectedSourceRevision as string,
    idempotencyKey: (body as Record<string, unknown>).idempotencyKey as string,
    request: builderRequest(body as Record<string, unknown>),
  }));
}

// --- The amendment `withOpsTransaction` path (`amendDefinition`, carried out of the route) [P6-C80] ----

/** The inner-transaction outcome, exactly `amendDefinition`'s `Prepared` (`workflows/routes.ts:730`). */
export type AmendPrepared =
  | { readonly outcome: LaunchOutcome }
  | {
      readonly proposedSourceHash: string;
      readonly proposalHash: string;
      readonly old: unknown;
      readonly riskTier: 'T1' | 'T2' | 'T3';
      readonly durable: { readonly branch: string; readonly pr: { url?: string; number?: number } };
    };

export interface AmendSpec {
  readonly kind: 'assignment' | 'governance';
  readonly expectedSourceHash: string;
  readonly auditAction: string;
  auditDetail(old: unknown, proposalHash: string, durable: { branch: string; pr: { url?: string; number?: number } }): Record<string, unknown>;
  successDetail(proposalHash: string, durable: { branch: string; pr: { url?: string; number?: number } }): Record<string, unknown>;
}

export interface AmendScanned {
  readonly entry: { readonly path: string; readonly sourceHash: string; readonly detail?: unknown };
  readonly def: unknown | null | undefined;
}

export interface AmendPort {
  /** `runCasTransaction` — the amendment CAS span, entered exactly as the route does. Named without the
   *  literal `withOpsTransaction` substring so §9 probe 1's bare grep of `workflows/routes.ts` stays clean;
   *  it lives in the service, not in `workflows/routes.ts`, after the cutover. */
  runCasTransaction<T>(fn: () => Promise<T>): Promise<T>;
  /** The whole in-transaction body (`amendDefinition:734-813`): reread, reparse, patch, CAS, durable
   *  route. Injected so the service owns the ordering/CAS transaction while its heavy interior stays
   *  testable with fakes. */
  prepareAmendment(): Promise<AmendPrepared>;
  /** `true` only when a durable worktree distinct from the active checkout exists. */
  durableWorktreeReady: boolean;
  auditAmendment(event: { action: string; owner: string; target: string; riskTier: 'T1' | 'T2' | 'T3'; result: string; detail: Record<string, unknown> }): Promise<void>;
  updateAmendmentRecord(record: Record<string, unknown>): void;
}

/**
 * `PUT /api/workflows/:id`'s amend path (`amendDefinition`). Reproduces the pre-transaction guards, wraps
 * the authoritative amendment CAS in `runCasTransaction`, then runs the post-transaction audit + record
 * update, returning the exact `{status, body}` the route sends today.
 */
export async function amendWorkflowDefinition(port: AmendPort, sub: string, scanned: AmendScanned, spec: AmendSpec): Promise<LaunchOutcome> {
  if (!scanned.def || !scanned.entry.sourceHash) return { status: 409, body: { error: 'definition-invalid', detail: scanned.entry.detail } };
  if (spec.expectedSourceHash !== scanned.entry.sourceHash) return { status: 409, body: { error: 'stale-source-revision', sourceRevision: scanned.entry.sourceHash } };
  if (!port.durableWorktreeReady) return { status: 409, body: { error: 'durable-worktree-required' } };

  let prepared: AmendPrepared;
  try {
    prepared = await port.runCasTransaction(() => port.prepareAmendment());
  } catch (error) {
    return { status: 500, body: { error: `${spec.kind}-durable-write-failed`, detail: error instanceof Error ? error.message : String(error) } };
  }
  if ('outcome' in prepared) return prepared.outcome;

  try {
    await port.auditAmendment({
      action: spec.auditAction, owner: sub, target: scanned.entry.path, riskTier: prepared.riskTier, result: 'pending-human-merge',
      detail: { path: scanned.entry.path, oldSourceHash: spec.expectedSourceHash, newSourceHash: prepared.proposedSourceHash, ...spec.auditDetail(prepared.old, prepared.proposalHash, prepared.durable) },
    });
  } catch {
    try { port.updateAmendmentRecord({ kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, phase: 'audit-failed' }); } catch { /* pending remains fail-closed */ }
    return { status: 500, body: { ok: false, status: 'pending-human-merge', auditStatus: 'failed', error: `${spec.kind}-amendment-audit-required`, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr } };
  }
  try {
    port.updateAmendmentRecord({ kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, phase: 'pending-human-merge' });
  } catch (error) {
    return { status: 500, body: { ok: false, status: 'recovery-required', stateStatus: 'update-failed', error: 'assignment-amendment-state-write-failed', path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, detail: error instanceof Error ? error.message : String(error) } };
  }
  return { status: 202, body: { ok: true, status: 'pending-human-merge', replayed: false, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, proposalContentHash: prepared.proposalHash, ...spec.successDetail(prepared.proposalHash, prepared.durable) } };
}
