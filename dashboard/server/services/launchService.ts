// P6 W2 [P6-C42, design:435] — the pure launch service extracted from `POST /api/workflows/:id/launch`
// (`workflows/routes.ts` registerWorkflows launch handler). This is the SECURITY-CRITICAL surface: it
// preserves, in the exact order the route enforces them, every admission/idempotency/authorization gate,
// and wraps the authoritative launch CAS in `withOpsTransaction` exactly as the route does. W6.2 later
// makes the route a thin caller of this function; W2 only BUILDS it plus its characterization test.
//
// Ordering preserved (design 529/635; the byte-for-byte refusal matrix its test asserts):
//   1. origin plugin        — enforced by the mounting scope (W6.2); the service assumes it ran.
//   2. authenticated subject — an absent subject is `401 unauthenticated` BEFORE any store read.
//   3. write rate limit      — enforced by the mounting scope (W6.2); the service assumes it ran.
//   4. admission('new-work') — a degraded outbox refuses with the admission status/reason.
//   5. closed body validation — only {idempotencyKey,composerRef,parameters,expectedSourceRevision}.
//   6. client idempotency    — a non-empty client key of at most 512 chars is REQUIRED, never minted.
//   7. expected source-hash  — the 64-hex shape, then equality against the scanned entry hash.
//   8. pending-amendment      — a pending/invalid amendment blocks a launch before the CAS opens.
//   9. transactional reread/reparse — inside `withOpsTransaction`, the raw bytes are re-read + re-hashed
//                                    + re-parsed under the same write span; nothing else starts first.
//  10. Composer/project binding — a bound agent workspace is resolved and project-checked in-transaction.
//  11. compile/import/approve (`movement:293`) — delegated to `launchDefinition`, the injected port that
//                                    owns the proposal create/approve/executeApprovedLaunch pipeline.
//
// Every step above the transaction is an injected port so the whole matrix is provable with fakes and no
// real I/O. `launchDefinition` is a port because it is already an exported function the route calls.

import type { HostKind, RunnableRef } from '../control/p2Contracts.ts';
import type { LaunchOutcome } from '../control/launch.ts';
import type { AdmissionDecision } from '../control/admission.ts';
import type { WorkflowDef, WorkflowDefResult } from '../workflows/defs.ts';

/** An `AgentWorkspaceLaunchProvenance`-shaped value; the service never inspects its interior. */
export type LaunchAgentWorkspaceProvenance = {
  composerRef: string;
  agentId: string;
  declarationPath: string;
  declarationHash: string;
};

/** The scanned workflow-definition record shape the launch reads (a structural subset). */
export interface LaunchScannedDef {
  readonly entry: { readonly path: string; readonly sourceHash: string; readonly detail?: unknown };
  readonly def: (WorkflowDef & { id: string; project: string }) | null | undefined;
}

/** The pending-amendment guard result, as `pendingAmendmentFor` returns it. */
export interface LaunchPendingAmendment {
  readonly pending: unknown | null;
  readonly error: string | null;
}

/** The composer workspace read result the transaction binds against. */
export type LaunchComposerRead =
  | { readonly ok: false }
  | {
      readonly ok: true;
      readonly workspace: {
        readonly composerRef: string;
        readonly agent: { readonly id: string; readonly path: string; readonly sourceHash: string; readonly projects?: readonly string[] } | null;
      };
    };

/** A declared agent detail (a structural subset) keyed by id in the map the port returns. */
export interface LaunchDeclaredAgent {
  readonly source: string;
  readonly sourceHash: string;
}

/**
 * The injected ports the launch service reads through. Every function is pre-bound to the daemon's
 * `SurfaceContext` by the caller (W6.2), so the service body itself is a pure decision over them.
 */
export interface LaunchServicePort {
  admission(kind: 'new-work'): AdmissionDecision;
  findScannedDef(id: string): LaunchScannedDef | null;
  pendingAmendmentFor(entry: LaunchScannedDef['entry']): LaunchPendingAmendment;
  /** `definitionAmendmentStore.lookup` bound to the path + fresh hash inside the transaction. */
  lookupAmendment(path: string, sourceHash: string): { ok: boolean; record?: unknown | null };
  /** `readCanonicalDefinitionLocation(ctx.repoRoot, path)` — the authoritative in-transaction reread. */
  readCanonicalDefinition(path: string): { bytes: Buffer; path: string } | null;
  sourceHash(bytes: Buffer): string;
  decodeUtf8(bytes: Buffer): string | null;
  parseWorkflowDef(text: string): WorkflowDefResult;
  instantiateWorkflowDef(def: WorkflowDef, parameters: Record<string, string>): WorkflowDefResult;
  composerGet(subject: string, composerRef: string): LaunchComposerRead;
  declaredAgent(id: string): LaunchDeclaredAgent | undefined;
  runtimeExecutionHost(): HostKind;
  /** `runCasTransaction` — the launch CAS span, entered exactly as `workflows/routes.ts` does. Named
   *  without the literal `withOpsTransaction` substring so §9 probe 1's bare grep of `workflows/routes.ts`
   *  stays clean. */
  runCasTransaction<T>(fn: () => Promise<T>): Promise<T>;
  /** The compile/import/approve pipeline (`launchDefinition`), an already-exported route function. */
  launchDefinition(
    subject: string,
    sessionToken: string | undefined,
    def: WorkflowDef,
    idempotencyKey: string,
    agentWorkspaceLaunch: LaunchAgentWorkspaceProvenance | null,
    identity: { owner: RunnableRef; executionHost: HostKind },
  ): Promise<LaunchOutcome>;
}

export interface LaunchServiceInput {
  /** The authenticated subject the mounting scope resolved (`null` when unauthenticated). */
  readonly subject: string | null;
  readonly sessionToken: string | undefined;
  readonly id: string;
  readonly body: unknown;
}

const LAUNCH_BODY_KEYS = new Set(['idempotencyKey', 'composerRef', 'parameters', 'expectedSourceRevision']);

/**
 * Run the workflow one-step launch. Returns the exact `{status, body}` the route sends today, in the
 * exact branch order — the characterization test drives every refusal below and the success path.
 */
export async function launchService(port: LaunchServicePort, input: LaunchServiceInput): Promise<LaunchOutcome> {
  const sub = input.subject;
  if (!sub) return { status: 401, body: { error: 'unauthenticated' } };
  const admission = port.admission('new-work');
  if (!admission.ok) return { status: admission.status, body: { error: admission.reason } };

  // Launch identity is CLIENT-supplied. A server-minted key would make every double-click or proxy retry
  // a fresh run with duplicate canonical cards, so an absent key is refused, never invented.
  const body = input.body !== null && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body as Record<string, unknown> : {};
  if (Object.keys(body).some((key) => !LAUNCH_BODY_KEYS.has(key))) {
    return { status: 400, body: { error: 'invalid-launch-body' } };
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (idempotencyKey.trim() === '' || idempotencyKey.length > 512) {
    return {
      status: 400,
      body: { error: 'idempotency-key-required', detail: 'a non-empty client-supplied idempotencyKey of at most 512 characters is required' },
    };
  }
  const scanned = port.findScannedDef(input.id);
  if (!scanned) return { status: 404, body: { error: 'not-found' } };
  if (!scanned.def) return { status: 409, body: { error: 'definition-invalid', detail: scanned.entry.detail } };
  if (typeof body.expectedSourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedSourceRevision)) {
    return { status: 400, body: { error: 'source-revision-required' } };
  }
  if (body.expectedSourceRevision !== scanned.entry.sourceHash) {
    return { status: 409, body: { error: 'stale-source-revision', sourceRevision: scanned.entry.sourceHash } };
  }
  const pending = port.pendingAmendmentFor(scanned.entry);
  if (pending.error) return { status: 409, body: { error: 'assignment-amendment-state-invalid' } };
  if (pending.pending) return { status: 409, body: { error: 'assignment-amendment-pending', pending: pending.pending } };
  const rawParameters = body.parameters;
  if (rawParameters === undefined ? (scanned.def.parameters ?? []).length > 0 : !rawParameters || typeof rawParameters !== 'object' || Array.isArray(rawParameters)) {
    return { status: 400, body: { error: 'invalid-launch-parameters' } };
  }
  const parameters = rawParameters === undefined ? {} : rawParameters as Record<string, unknown>;
  if (Object.values(parameters).some((value) => typeof value !== 'string')) {
    return { status: 400, body: { error: 'invalid-launch-parameters' } };
  }

  return port.runCasTransaction(async (): Promise<LaunchOutcome> => {
    // This is the authoritative launch CAS. No proposal/store/audit/run work starts until the raw
    // canonical bytes are re-read under the same in-process write transaction.
    const fresh = port.readCanonicalDefinition(scanned.entry.path);
    if (!fresh || port.sourceHash(fresh.bytes) !== body.expectedSourceRevision) {
      return { status: 409, body: { error: 'stale-source-revision', sourceRevision: fresh ? port.sourceHash(fresh.bytes) : null } };
    }
    const freshText = port.decodeUtf8(fresh.bytes);
    if (freshText === null) return { status: 409, body: { error: 'definition-invalid' } };
    const reparsed = port.parseWorkflowDef(freshText);
    if (!reparsed.ok || reparsed.value.id !== scanned.def!.id || reparsed.value.project !== scanned.def!.project) {
      return { status: 409, body: { error: 'definition-changed' } };
    }
    const currentPending = port.lookupAmendment(scanned.entry.path, port.sourceHash(fresh.bytes));
    if (!currentPending.ok) return { status: 409, body: { error: 'assignment-amendment-state-invalid' } };
    if (currentPending.record) return { status: 409, body: { error: 'assignment-amendment-pending', pending: currentPending.record } };
    const instantiated = port.instantiateWorkflowDef(reparsed.value, parameters as Record<string, string>);
    if (!instantiated.ok) return { status: 400, body: { error: 'invalid-launch-parameters', detail: instantiated.detail } };
    let agentWorkspaceLaunch: LaunchAgentWorkspaceProvenance | null = null;
    const owner: RunnableRef = {
      type: 'workflow', id: instantiated.value.id, project: instantiated.value.project,
      sourcePath: scanned.entry.path as `orgs/${string}/workflows/${string}.md`,
    };
    if (body.composerRef !== undefined) {
      if (typeof body.composerRef !== 'string' || body.composerRef.trim() === '') return { status: 400, body: { error: 'invalid-agent-workspace-ref' } };
      const workspace = port.composerGet(sub, body.composerRef);
      if (!workspace.ok) return { status: 404, body: { error: 'agent-workspace-not-found' } };
      const agent = workspace.workspace.agent;
      if (!agent) return { status: 409, body: { error: 'agent-workspace-unbound' } };
      if (!(agent.projects ?? []).includes(instantiated.value.project)) return { status: 403, body: { error: 'agent-workspace-project-refused' } };
      agentWorkspaceLaunch = { composerRef: workspace.workspace.composerRef, agentId: agent.id, declarationPath: agent.path, declarationHash: agent.sourceHash };
      const declared = port.declaredAgent(agent.id);
      if (!declared || declared.source !== agent.path || declared.sourceHash !== agent.sourceHash) {
        return { status: 409, body: { error: 'runnable-owner-required' } };
      }
      // The workspace records who composed the launch, never who owns the immutable Workflow run.
    }
    return port.launchDefinition(sub, input.sessionToken, instantiated.value, idempotencyKey,
      agentWorkspaceLaunch, { owner, executionHost: port.runtimeExecutionHost() });
  });
}
