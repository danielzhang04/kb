/**
 * Browser-only client for the managed execution control plane.
 *
 * DTOs are intentionally duplicated at this boundary. Importing server modules into the SPA would
 * make Node-only implementation details part of the browser graph and could accidentally widen the
 * public protocol. Governed mutations always carry an exact hash/version and an idempotency key.
 */
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { performAssertion, realWebAuthnBrowser } from '../lib/webauthnClient';
import type { WebAuthnBrowserLike } from '../lib/webauthnClient';

export type FetchLike = typeof fetch;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ProposalDecision = 'approved' | 'rejected' | 'changes-requested';
export type HumanRequestDecision = 'responded' | 'approved' | 'rejected' | 'changes-requested';

export interface ProposalRoutingDto {
  runtime: string;
  model: string;
}

/** Immutable compiler-resolved logical identity. This is provenance, never a queue-card owner. */
export interface ResolvedAgentAssignmentDto {
  agentId: string;
  declarationPath: string;
  declarationHash: string;
  profileId: string;
  runtime: string;
  model: string;
}

export interface AgentWorkspaceLaunchProvenanceDto {
  composerRef: string;
  agentId: string;
  declarationPath: string;
  declarationHash: string;
}

export interface ProposalScopeDto {
  read: string[];
  write: string[];
}

export interface ProposalStageDto {
  id: string;
  title: string;
  action: string;
  target: string;
  workOrder: string;
  riskTier: 'T1' | 'T2' | 'T3';
  dependsOn: string[];
  worker: ProposalRoutingDto;
  requiredSkills: string[];
  scope: ProposalScopeDto;
  artifacts: Array<{ id: string; path: string; description: string }>;
  checkpoints: Array<{ id: string; label: string }>;
  humanGates: Array<{
    id: string;
    kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
    prompt: string;
  }>;
  /** Present only for an immutable compiler-resolved logical assignment. */
  assignment?: ResolvedAgentAssignmentDto;
}

export interface PlanProposalDto {
  schema: 'kb.plan-proposal/v1';
  proposalId: string;
  project: string;
  title: string;
  summary: string;
  manager: ProposalRoutingDto & { requiredSkills: string[]; assignment?: ResolvedAgentAssignmentDto };
  scope: ProposalScopeDto;
  governanceRefs: string[];
  stages: ProposalStageDto[];
}

export interface ProposalDiffDto {
  schema: 'kb.plan-proposal-diff/v1';
  fromContentHash: string | null;
  toContentHash: string;
  changed: boolean;
  changes: Array<{ path: string; before: JsonValue | undefined; after: JsonValue | undefined }>;
}

export interface ProposalRevisionDto {
  proposalRef: string;
  revision: number;
  contentHash: string;
  previousContentHash: string | null;
  createdAt: string;
  /**
   * PROVENANCE — who authored this revision. Both fields have always been on the wire (the proposals
   * route sends the store records verbatim) and both were silently dropped by the normalizers below.
   * That drop is exactly why a workflow launch returned an inert `runRef` with nothing to link back to.
   *
   * `sourceComposerRef` is `'workflow-registry'` for a workflow-launched revision (stamped by
   * `server/workflows/routes.ts`), and `sourceTurnId` is then the WORKFLOW DEFINITION ID. That pair is
   * the authoritative workflow → runs join key — see `entityLinks.ts`. Re-dropping either field
   * silently unlinks the two entities, so `entityLinks.test.ts` asserts they survive normalization.
   */
  sourceComposerRef: string;
  sourceTurnId: string;
  proposal: PlanProposalDto;
  /** Present on a freshly imported/created revision. A reloaded revision remains reviewable by hash. */
  diff: ProposalDiffDto | null;
  approval: {
    revision: number;
    decision: ProposalDecision;
    decidedAt: string;
  } | null;
}

export type ProposalRevisionMetadataDto = Omit<ProposalRevisionDto, 'proposal' | 'diff'>;

export interface LaunchProposalResultDto {
  runRef: string;
  waitingHuman?: boolean;
  cards?: Array<{ stageId: string; cardId: string; cardPath: string }>;
}

export type RunState =
  | 'planned' | 'recovering' | 'running' | 'waiting-human' | 'stopping'
  | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type StageState = 'blocked' | 'ready' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type AttemptState = 'queued' | 'starting' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type ManagedSessionState = 'pending' | 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'interrupted';

export interface RunDto {
  runRef: string;
  predecessorRunRef: string | null;
  title: string;
  proposalRef: string;
  proposalRevision: number;
  proposalHash: string;
  publicationState: 'pending' | 'waiting-human' | 'publishing' | 'published' | 'reconcile-required';
  state: RunState;
  version: number;
  managerSessionRef: string;
  managerGeneration: number;
  /** Immutable logical-manager provenance, or null for a legacy/unassigned run. */
  managerAssignment: ResolvedAgentAssignmentDto | null;
  agentWorkspaceLaunch?: AgentWorkspaceLaunchProvenanceDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunMetadataDto extends RunDto {
  stageCount: number;
  attemptCount: number;
  sessionCount: number;
  openHumanRequestCount: number;
  eventCount: number;
}

export interface StageDto {
  stageRef: string;
  runRef: string;
  stageId: string;
  title: string;
  dependsOn: string[];
  canonicalCardRef: string | null;
  state: StageState;
  version: number;
  currentAttemptRef: string | null;
  /** Immutable logical-worker provenance, or null for a legacy/unassigned stage. */
  assignment: ResolvedAgentAssignmentDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptDto {
  attemptRef: string;
  runRef: string;
  stageRef: string;
  generation: number;
  predecessorAttemptRef: string | null;
  runtime: string;
  model: string;
  state: AttemptState;
  version: number;
  managedSessionRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSessionDto {
  sessionRef: string;
  runRef: string;
  stageRef: string | null;
  attemptRef: string | null;
  role: 'manager' | 'worker';
  generation: number;
  predecessorSessionRef: string | null;
  runtime: string;
  model: string;
  state: ManagedSessionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HumanRequestDto {
  requestRef: string;
  runRef: string;
  stageRef: string | null;
  kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
  revision: number;
  state: 'open' | 'resolved';
  title: string;
  prompt: string;
  response: {
    requestRevision: number;
    decision: HumanRequestDecision;
    response: string | null;
    respondedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** Enough review lineage for clients to recognize a reserved completion-gate request. */
export interface ReviewLoopDto {
  reviewLoopRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  state: 'awaiting-subject' | 'checking' | 'rework-queued' | 'failed' | 'parked' | 'awaiting-gate' | 'passed';
  version: number;
}

export interface ReviewReceiptDto {
  reviewReceiptRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  state: 'passed' | 'awaiting-completion-gate' | 'failed' | 'parked';
  completionRequestRef: string | null;
  interventionRequestRef: string | null;
  version: number;
}

export interface RunDetailDto {
  run: RunDto;
  stages: StageDto[];
  attempts: AttemptDto[];
  sessions: ManagedSessionDto[];
  humanRequests: HumanRequestDto[];
  reviewLoops: ReviewLoopDto[];
  reviewReceipts: ReviewReceiptDto[];
}

/**
 * A run-roster agent's canvas-facing state (FYT gated-pipeline, Task 5), mirroring
 * `server/control/rosterSessions.ts#RosterAgentState` — duplicated at this boundary like every other
 * DTO here, never imported at runtime (that module reaches `node:crypto`/`node:fs`).
 */
export interface RosterAgentStateDto {
  agentId: string;
  /** The live pty session id (attachable at `/api/pty?session=<id>`), or null when not spawned. */
  sessionId: string | null;
  status: 'active' | 'waiting' | 'blocked' | 'idle';
  /** One line, e.g. `image-gen batch 2/4`. */
  activity: string;
  /** Agent ids this agent is waiting on (status `waiting`), or gate ids blocking it (status `blocked`). */
  waitingOn: string[];
}

/** `getRun`'s actual response shape: the run detail plus the roster projection the canvas reads. Kept
 *  as an EXTENSION of {@link RunDetailDto}, never a fork, so every existing `getRun` caller (which reads
 *  only the fields on `RunDetailDto`) keeps compiling and running unchanged. */
export interface RunDetailWithRosterDto extends RunDetailDto {
  roster: RosterAgentStateDto[];
}

export interface OperationalEventDto {
  cursor: number;
  runRef: string;
  kind: 'message' | 'command' | 'tool' | 'file' | 'diff' | 'checkpoint' | 'lifecycle' | 'session-link' | 'governance';
  source: 'system' | 'manager' | 'worker' | 'human';
  stageRef: string | null;
  attemptRef: string | null;
  sessionRef: string | null;
  status: 'pending' | 'running' | 'success' | 'failure' | 'stopped' | 'interrupted' | 'waiting' | null;
  summary: string | null;
  command: string | null;
  toolName: string | null;
  path: string | null;
  diff: string | null;
  checkpoint: string | null;
  createdAt: string;
}

export interface StorageInventoryItemDto {
  runRef: string;
  title: string;
  state: RunState;
  updatedAt: string;
  eventCount: number;
  estimatedBytes: number;
  quarantinedAt: string | null;
}

export interface StorageInventoryDto {
  activeRuns: StorageInventoryItemDto[];
  quarantinedRuns: StorageInventoryItemDto[];
  proposalRevisionCount: number;
  nextEventCursor: number;
  estimatedBytes: number;
}

export interface QuarantinePlanDto {
  planHash: string;
  createdAt: string;
  items: Array<StorageInventoryItemDto & { eligible: boolean }>;
  estimatedBytes: number;
}

export class ControlApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    /** Stable server error discriminator; unlike `reason`, this never prefers human-readable detail. */
    readonly code: string = reason,
  ) {
    super(reason ? `control request refused: ${status} (${reason})` : `control request refused: ${status}`);
  }
}

export interface ExecutionPostureDto {
  state: 'locked' | 'unlocked' | 'injected';
  source: 'passkey' | 'env-override' | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
  unlockRoute?: string;
}

export function parseExecutionPosture(value: unknown): ExecutionPostureDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const allowed = new Set(['state', 'source', 'unlockedAt', 'unlockedBy', 'unlockRoute']);
  if (Object.keys(item).some((key) => !allowed.has(key))) return null;
  if (item.state !== 'locked' && item.state !== 'unlocked' && item.state !== 'injected') return null;
  if (item.state === 'locked') {
    if (item.source !== null || item.unlockedAt !== null || item.unlockedBy !== null) return null;
    if (item.unlockRoute !== undefined && item.unlockRoute !== '/api/control/execution/unlock') return null;
    return {
      state: 'locked', source: null, unlockedAt: null, unlockedBy: null,
      ...(item.unlockRoute === '/api/control/execution/unlock' ? { unlockRoute: item.unlockRoute } : {}),
    };
  }
  if (item.state === 'injected') {
    // This is the server's no-latch posture: execution was injected directly and has no unlock event.
    if (item.source !== null || item.unlockedAt !== null || item.unlockedBy !== null || item.unlockRoute !== undefined) {
      return null;
    }
    return { state: 'injected', source: null, unlockedAt: null, unlockedBy: null };
  }
  if (item.source !== 'passkey' && item.source !== 'env-override') return null;
  if (typeof item.unlockedAt !== 'string') return null;
  const unlockedAtMs = Date.parse(item.unlockedAt);
  if (!Number.isFinite(unlockedAtMs) || new Date(unlockedAtMs).toISOString() !== item.unlockedAt) return null;
  if (typeof item.unlockedBy !== 'string' || item.unlockedBy.trim().length === 0) return null;
  if (item.unlockRoute !== undefined) return null;
  return {
    state: 'unlocked', source: item.source, unlockedAt: item.unlockedAt, unlockedBy: item.unlockedBy,
  };
}

/** Read the daemon execution latch. A dashboard login is necessary, but never implies this is unlocked. */
export async function getExecutionPosture(token: string, fetchImpl?: FetchLike): Promise<ExecutionPostureDto> {
  const body = await read<{ execution?: unknown }>('/api/control/execution', token, fetchImpl);
  const posture = parseExecutionPosture(body.execution);
  if (!posture) throw new Error('execution state response was invalid');
  return posture;
}

export interface UnlockExecutionDeps {
  fetchImpl?: FetchLike;
  browser?: WebAuthnBrowserLike;
}

/**
 * Run the dedicated execution-unlock ceremony. This intentionally does not call `signIn`: the server
 * challenge is purpose-bound to `kb.execution-unlock`, and the existing bearer only authenticates who
 * is asking. A 200 response is accepted only when the server confirms a passkey-sourced unlock.
 */
export async function unlockExecution(token: string, deps: UnlockExecutionDeps = {}): Promise<ExecutionPostureDto> {
  const optionsBody = await write<{ ceremonyId?: unknown; options?: unknown }>(
    '/api/control/execution/unlock/options', {}, token, deps.fetchImpl,
  );
  if (
    typeof optionsBody.ceremonyId !== 'string'
    || optionsBody.ceremonyId.trim().length === 0
    || !optionsBody.options
    || typeof optionsBody.options !== 'object'
    || Array.isArray(optionsBody.options)
    || Object.keys(optionsBody.options).length === 0
  ) {
    throw new Error('execution unlock options response was invalid');
  }
  const response = await performAssertion(
    optionsBody.options as PublicKeyCredentialRequestOptionsJSON,
    deps.browser ?? realWebAuthnBrowser,
  );
  const unlockedBody = await request<{ ok?: unknown; execution?: unknown }>(
    '/api/control/execution/unlock',
    { method: 'POST', body: JSON.stringify({ ceremonyId: optionsBody.ceremonyId, response }) },
    { token, fetchImpl: deps.fetchImpl, preserveSessionOnAuthFailure: isExecutionAssertionRefusal },
  );
  const posture = parseExecutionPosture(unlockedBody.execution);
  if (unlockedBody.ok !== true || posture?.state !== 'unlocked' || posture.source !== 'passkey') {
    throw new Error('execution unlock response was not passkey-authorized');
  }
  return posture;
}

/** Stable operator copy for the explicit execution ceremony; raw server details never reach the panel. */
export function executionUnlockErrorMessage(error: unknown): string {
  const detail = error && typeof error === 'object'
    ? [
        'name' in error && typeof error.name === 'string' ? error.name : '',
        'message' in error && typeof error.message === 'string' ? error.message : '',
      ].filter(Boolean).join(': ')
    : '';
  if (/cancel|abort|notallowederror/i.test(detail)) {
    return 'Execution unlock was cancelled. Execution remains locked.';
  }
  if (/not supported|webauthn.+unavailable/i.test(detail)) {
    return 'This browser cannot use the execution passkey. Open this dashboard in a WebAuthn-capable browser.';
  }
  if (/not passkey-authorized|response was invalid|options response was invalid/i.test(detail)) {
    return 'The server did not confirm a passkey-authorized unlock. Execution remains locked.';
  }
  if (/401|credential|unauthenticated/i.test(detail)) {
    return 'The execution passkey was refused. Use the enrolled passkey and try again.';
  }
  if (/503|unconfigured/i.test(detail)) {
    return 'Execution passkeys are not configured on this dashboard server.';
  }
  return 'Execution unlock failed. Execution remains locked; retry or check the dashboard server logs.';
}

interface RequestOptions {
  token?: string;
  fetchImpl?: FetchLike;
  /** Exact protocol classifier for a second-factor refusal that is not a bearer failure. */
  preserveSessionOnAuthFailure?: (status: number, body: Record<string, unknown>) => boolean;
}

/**
 * The unlock handler and the bearer pre-handler both use HTTP 401. Preserve a valid bearer only for
 * the stable assertion-refusal envelopes emitted after the pre-handler has passed. Everything
 * else, including `expired`, `bad-signature`, `malformed`, and `missing session token`, flows through
 * the shared session invalidator. Deliberately exact: arbitrary verifier prose never grants an
 * exception to invalidation.
 */
function isExecutionAssertionRefusal(status: number, body: Record<string, unknown>): boolean {
  if (status !== 401 || body.error !== 'unauthenticated' || typeof body.reason !== 'string') return false;
  return body.reason === 'no registered credential for this assertion'
    || body.reason === 'assertion failed'
    || body.reason === 'assertion not verified';
}

async function request<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const response = await fetchImpl(path, { ...init, headers });
  // Only a 401 needs a preserved body for the shared invalidator. Successful and unrelated refusal
  // responses are consumed once and never cloned (some fetch shims intentionally cannot clone them).
  let authFailureResponse: Response | null = null;
  if (response.status === 401) {
    try {
      authFailureResponse = typeof response.clone === 'function' ? response.clone() : response;
    } catch {
      // A broken fetch shim must not replace the endpoint's real 401 with a clone exception.
    }
  }
  const body = await response.json().catch(() => ({})) as T & { reason?: unknown; detail?: unknown; error?: unknown };
  const bodyRecord = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const preserveSession = options.preserveSessionOnAuthFailure?.(response.status, bodyRecord) === true;
  if (!preserveSession && authFailureResponse) {
    await invalidateSessionOnGovernedAuthFailure(authFailureResponse);
  }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : '';
    const reason = [body.detail, body.reason, body.error].find((value): value is string => typeof value === 'string') ?? '';
    throw new ControlApiError(response.status, reason, code);
  }
  return body;
}

const read = <T>(path: string, token: string, fetchImpl?: FetchLike): Promise<T> => request<T>(path, { method: 'GET' }, { token, fetchImpl });
const write = <T>(path: string, body: unknown, token: string, fetchImpl?: FetchLike): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) }, { token, fetchImpl });
const segment = (value: string): string => encodeURIComponent(value);

interface RawProposalRevision {
  proposalRef: string;
  sourceComposerRef: string;
  sourceTurnId: string;
  revision: number;
  hash: string;
  previousHash: string | null;
  title: string;
  createdAt: string;
  snapshot: PlanProposalDto;
  approval: ProposalRevisionDto['approval'];
}

interface RawProposalMetadata extends Omit<RawProposalRevision, 'snapshot'> {}

function normalizedRevision(value: RawProposalRevision, diff: ProposalDiffDto | null = null): ProposalRevisionDto {
  return {
    proposalRef: value.proposalRef,
    revision: value.revision,
    contentHash: value.hash,
    previousContentHash: value.previousHash,
    createdAt: value.createdAt,
    sourceComposerRef: value.sourceComposerRef,
    sourceTurnId: value.sourceTurnId,
    proposal: value.snapshot,
    diff,
    approval: value.approval,
  };
}

function normalizedMetadata(value: RawProposalMetadata): ProposalRevisionMetadataDto {
  return {
    proposalRef: value.proposalRef,
    revision: value.revision,
    contentHash: value.hash,
    previousContentHash: value.previousHash,
    createdAt: value.createdAt,
    // The join key. `listProposalRevisions` is the ONLY way the browser learns which workflow
    // definition produced a run, so dropping these here (as this function did) severed the link.
    sourceComposerRef: value.sourceComposerRef,
    sourceTurnId: value.sourceTurnId,
    approval: value.approval,
  };
}

export async function listProposalRevisions(
  composerRef: string | undefined,
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionMetadataDto[]> {
  const query = composerRef ? `?composerRef=${encodeURIComponent(composerRef)}` : '';
  const body = await read<{ proposals: RawProposalMetadata[] }>(`/api/control/proposals${query}`, token, fetchImpl);
  return body.proposals.map(normalizedMetadata);
}

export async function getProposalRevision(
  proposalRef: string,
  revision: number,
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  const body = await read<{ ok: true; value: RawProposalRevision }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions/${revision}`,
    token,
    fetchImpl,
  );
  return normalizedRevision(body.value);
}

export function importProposal(
  input: { composerRef: string; turnId: string; proposalRef?: string; expectedPreviousHash?: string | null },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision; diff: ProposalDiffDto }>('/api/control/proposals/import', input, token, fetchImpl)
    .then((body) => normalizedRevision(body.value, body.diff));
}

export function createProposalRevision(
  proposalRef: string,
  input: { expectedPreviousHash: string; proposal: PlanProposalDto },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision; diff: ProposalDiffDto }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions`, input, token, fetchImpl,
  ).then((body) => normalizedRevision(body.value, body.diff));
}

export function decideProposalRevision(
  proposalRef: string,
  revision: number,
  input: {
    expectedHash: string;
    expectedApprovalRevision: 0;
    decision: ProposalDecision;
    idempotencyKey: string;
    note?: string | null;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions/${revision}/decision`, input, token, fetchImpl,
  ).then((body) => normalizedRevision(body.value));
}

export function launchProposalRevision(
  proposalRef: string,
  revision: number,
  input: {
    expectedHash: string;
    idempotencyKey: string;
    predecessorRunRef?: string;
    expectedPredecessorVersion?: number;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<LaunchProposalResultDto> {
  return write(`/api/control/proposals/${segment(proposalRef)}/revisions/${revision}/launch`, input, token, fetchImpl);
}

export function acceptsHumanRequest(request: HumanRequestDto): boolean {
  if (request.state !== 'resolved' || !request.response || request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') {
    return request.response.decision === 'approved';
  }
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

export type ActivatableRun = Pick<RunDto, 'runRef' | 'version' | 'managerGeneration' | 'proposalHash'>;

/** Strictly resume one existing published run. This path cannot launch proposals or create successors. */
export function activateRun(
  run: ActivatableRun,
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; value: RunDto; replayed?: boolean; starting?: boolean }> {
  return write(`/api/control/runs/${segment(run.runRef)}/activate`, {
    expectedRunVersion: run.version,
    expectedManagerGeneration: run.managerGeneration,
    idempotencyKey: `activate:${run.runRef}:${run.version}:${run.proposalHash}:${run.managerGeneration}`,
  }, token, fetchImpl);
}

/** Re-enter the exact launch operation after accepted Human Requests have committed. */
export async function resumeRunAfterHumanResponse(
  runRef: string,
  token: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const detail = await getRun(runRef, token, fetchImpl);
  const accepted = detail.humanRequests.length > 0 && detail.humanRequests.every(acceptsHumanRequest);
  if (!accepted) return;
  if (detail.run.publicationState === 'waiting-human') {
    await launchProposalRevision(detail.run.proposalRef, detail.run.proposalRevision, {
      expectedHash: detail.run.proposalHash,
      idempotencyKey: `launch:${detail.run.proposalHash}`,
    }, token, fetchImpl);
  } else if (detail.run.publicationState === 'published' && detail.run.state === 'waiting-human') {
    try {
      await activateRun(detail.run, token, fetchImpl);
    } catch (error) {
      // The Human Request response is already durable. An intentionally inactive daemon runtime is
      // still a successful response flow; activation remains visibly gated on the refreshed run.
      if (error instanceof ControlApiError
        && (error.code === 'automatic-runtime-not-activated' || error.code === 'execution-locked')) return;
      throw error;
    }
  }
}

export async function listRuns(token: string, fetchImpl?: FetchLike): Promise<RunMetadataDto[]> {
  const body = await read<{ runs: RunMetadataDto[] }>('/api/control/runs', token, fetchImpl);
  return body.runs;
}

export async function getRun(runRef: string, token: string, fetchImpl?: FetchLike): Promise<RunDetailWithRosterDto> {
  const body = await read<{ ok: true; value: RunDetailDto; roster?: RosterAgentStateDto[] }>(
    `/api/control/runs/${segment(runRef)}`, token, fetchImpl,
  );
  // `roster` is absent whenever execution is locked or the run has no live roster (see
  // `server/control/routes.ts` — it always sends an array, but default to `[]` defensively).
  return { ...body.value, roster: Array.isArray(body.roster) ? body.roster : [] };
}

export async function listRunEvents(
  runRef: string,
  after: number,
  limit: number,
  token: string,
  fetchImpl?: FetchLike,
): Promise<OperationalEventDto[]> {
  const body = await read<{ ok: true; value: OperationalEventDto[] }>(
    `/api/control/runs/${segment(runRef)}/events?after=${after}&limit=${limit}`, token, fetchImpl,
  );
  return body.value;
}

export interface ManagerCasInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  idempotencyKey: string;
}

export interface CancellationOutcomeDto {
  state: RunDto['state'];
  stoppedSessionRefs: string[];
  interruptedSessionRefs: string[];
  replayed: boolean;
}

export function sendManagerMessage(
  runRef: string,
  input: ManagerCasInput & { message: string },
  token: string,
  fetchImpl?: FetchLike,
): Promise<OperationalEventDto> {
  return write<{ ok: true; value: OperationalEventDto }>(
    `/api/control/runs/${segment(runRef)}/manager/messages`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function stopManager(
  runRef: string,
  input: ManagerCasInput,
  token: string,
  fetchImpl?: FetchLike,
): Promise<CancellationOutcomeDto> {
  return write<{ ok: true; value: CancellationOutcomeDto }>(
    `/api/control/runs/${segment(runRef)}/manager/stop`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function createManagerSuccessor(
  runRef: string,
  input: {
    expectedManagerGeneration: number;
    runtime: string;
    model: string;
    idempotencyKey: string;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ManagedSessionDto> {
  return write<{ ok: true; value: ManagedSessionDto }>(
    `/api/control/runs/${segment(runRef)}/manager/successor`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export interface StageRerouteInput {
  expectedStageVersion: number;
  expectedAttemptRef: string;
  expectedAttemptVersion: number;
  runtime: string;
  model: string;
  idempotencyKey: string;
}

export function rerouteManagedStage(
  runRef: string,
  stageRef: string,
  input: StageRerouteInput,
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ stage: StageDto; attempt: AttemptDto; session: ManagedSessionDto }> {
  return write<{ ok: true; value: { stage: StageDto; attempt: AttemptDto; session: ManagedSessionDto } }>(
    `/api/control/runs/${segment(runRef)}/stages/${segment(stageRef)}/reroute`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function steerManagerAtCheckpoint(
  runRef: string,
  input: ManagerCasInput & { checkpoint: string; instruction: string },
  token: string,
  fetchImpl?: FetchLike,
): Promise<OperationalEventDto> {
  return write<{ ok: true; value: OperationalEventDto }>(
    `/api/control/runs/${segment(runRef)}/manager/steer`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function respondToHumanRequest(
  requestRef: string,
  input: {
    expectedRevision: number;
    decision: HumanRequestDecision;
    idempotencyKey: string;
    response?: string | null;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<HumanRequestDto> {
  return write<{ ok: true; value: HumanRequestDto }>(
    `/api/control/human-requests/${segment(requestRef)}/respond`, input, token, fetchImpl,
  ).then((body) => body.value);
}

/** Resolve a server-bound review completion gate; never use the generic request endpoint for it. */
export function resolveReviewCompletionGate(
  requestRef: string,
  input: {
    expectedRequestRevision: number;
    decision: Extract<HumanRequestDecision, 'approved' | 'rejected' | 'changes-requested'>;
    idempotencyKey: string;
    response?: string | null;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<HumanRequestDto> {
  return write<{ ok: true; value: { request: HumanRequestDto } }>(
    `/api/control/review-completion-gates/${segment(requestRef)}/resolve`, input, token, fetchImpl,
  ).then((body) => body.value.request);
}

export async function getRetentionInventory(token: string, fetchImpl?: FetchLike): Promise<StorageInventoryDto> {
  const body = await read<{ inventory: StorageInventoryDto }>('/api/control/retention/inventory', token, fetchImpl);
  return body.inventory;
}

export function dryRunQuarantine(runRefs: string[], token: string, fetchImpl?: FetchLike): Promise<QuarantinePlanDto> {
  return write<{ ok: true; value: QuarantinePlanDto }>('/api/control/retention/dry-run', { runRefs }, token, fetchImpl)
    .then((body) => body.value);
}

export function quarantineRuns(
  runRefs: string[],
  expectedPlanHash: string,
  token: string,
  fetchImpl?: FetchLike,
): Promise<StorageInventoryItemDto[]> {
  return write<{ ok: true; value: StorageInventoryItemDto[] }>(
    '/api/control/retention/quarantine', { runRefs, expectedPlanHash }, token, fetchImpl,
  ).then((body) => body.value);
}

export function restoreRun(runRef: string, token: string, fetchImpl?: FetchLike): Promise<RunMetadataDto> {
  return write<{ ok: true; value: RunMetadataDto }>('/api/control/retention/restore', { runRef }, token, fetchImpl)
    .then((body) => body.value);
}
