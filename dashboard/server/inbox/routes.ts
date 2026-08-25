// P4 W6.1: the `/api/inbox` route cut over ATOMICALLY to the closed PR + escalation + source-health
// contract of section 3.3. No compatibility union or adapter remains — the older `{items}` escalation
// shape is gone. The route:
//   - reads open PRs through the PINNED literal `gh pr list` (`resolvers.ts#readOpenPullRequests`),
//     behind the GLOBAL one-subprocess-per-30s budget of `sourceCache.ts` [P4-C34];
//   - reads escalation subjects from the Plane-A card snapshot (`project.ts#projectEscalationSubjects`);
//   - composes the two INDEPENDENTLY (`project.ts#projectP4Inbox`), so a failed source keeps its own
//     last-good items and its own source state and never empties the other half;
//   - honours `?refresh=pr|escalation` (any other value 400) by invalidating only the named source.
// It has NO next-fire, run-gate, read, snooze, resolve, archive, retention, deployment, or asset control.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import {
  assertCoordinationRoot, resolveRepositoryPin, RepositoryPinError,
  type GitRemoteReader, type RepositoryPin,
} from '../runtime/repoPin.ts';
import { runTrackedProcess } from '../write/asyncGit.ts';
import { indexRepo, type PlaneAIndex } from '../planeA/indexer.ts';
import { ContractDecodeError, sha256Hex } from '../write/durableManifest.ts';
import { readInboxRoute } from '../services/inboxService.ts';
import type { SourceState } from './contracts.ts';
import {
  projectEscalationSubjects, projectP5Inbox,
  type P5InboxResponse, type P5InboxSourceKind,
} from './project.ts';
import { readOpenPullRequests, type SubprocessPort } from './resolvers.ts';
import {
  getInboxSourceCache, type EscalationRead, type InboxSourceCache, type PrReader,
} from './sourceCache.ts';
import {
  projectDeploymentSubjects,
  type CommitAncestryPort, type DeploymentEscalationItem,
  type DeploymentsReaderPort, type LivePtySessionsPort, type LiveReleasePort,
} from './deploymentSubjects.ts';
import type { DeploymentInboxItem } from './deploymentContracts.ts';
import {
  projectAssetPullSubjects,
  type AssetPullInboxItem, type AssetPullIntentsReaderPort,
} from './assetPullSubjects.ts';
import {
  parseDeploymentRef, parseDeploymentRevision, isDeployReadyRevision,
  deployReadyRevision,
} from './deploymentContracts.ts';
import type { DeployReadyPort, DeployReadyCandidate, DeployT3Decision } from '../deploy/contracts.ts';
import { createDeployReadyReader } from '../deploy/deployReady.ts';
import { DeploymentService, DeploymentServiceError } from '../deploy/deploymentService.ts';
import { AssetPullService, AssetPullServiceError } from '../deploy/assetPullService.ts';
import { closePtysAndContinue, type CloseAndContinuePorts } from '../deploy/quiescence.ts';
import type { ActivationReaderPort } from '../home/project.ts';
import { createHash } from 'node:crypto';

/** The ports the route reads through; every side effect is injectable so tests reach no real `gh`/tree. */
export interface InboxRoutePorts {
  /** The composition-time repository pin, or `null` when the coordination remote cannot be pinned — in
   *  which case the PR source degrades to a `failed` row and the escalation half is unaffected. */
  readonly pin: () => RepositoryPin | null;
  readonly runGh: SubprocessPort;
  readonly cache: InboxSourceCache;
  /** ISO clock stamped onto verified reads. */
  readonly now: () => string;
  /** Plane-A snapshot reader; defaults to the real `indexRepo`. */
  readonly indexRepo?: (repoRoot: string) => PlaneAIndex;

  // --- P5 W6.1: the two new Inbox arms. Each is a PURE projection over injected read-only ports; NO
  //     source spawns a subprocess, so neither draws on the global `gh` budget [P5-C31, P5-C48]. ---
  /** Stored Deployment reader (the control-plane document). */
  readonly deployments: DeploymentsReaderPort;
  /** Live PTY registry snapshot for a Deployment's `blockingPtyIds` at projection time. */
  readonly livePtySessions: LivePtySessionsPort;
  /** The W1 deploy-ready candidate reader — the ONLY candidate source [P5-C42]. */
  readonly deployReady: DeployReadyPort;
  /** The live release SHA, read from the shared activation port (never a checkout). Async so the sync
   *  projector's `LiveReleasePort` can be built from the (async) activation read each projection pass. */
  readonly resolveLiveSha: () => string | null | Promise<string | null>;
  /** Strict-descendant test for the deploy-ready gate (design 371). */
  readonly ancestry: CommitAncestryPort;
  /** Asset-pull intent reader (the control-plane document). */
  readonly assetPullIntents: AssetPullIntentsReaderPort;
  /** The per-source 30s recompute budget for the two new sources (server-wide). */
  readonly p5Budget: P5SourceBudget;
  /** Monotonic ms clock for the 30s budget window. */
  readonly nowMs: () => number;
}

/** The four source kinds `?refresh=` accepts; `400` on any other value [P5-C31]. */
const P5_REFRESH_SOURCES: readonly P5InboxSourceKind[] = ['deployment', 'assetPull', 'pr', 'escalation'];
export function decodeP5InboxRefreshParam(value: unknown): P5InboxSourceKind | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && (P5_REFRESH_SOURCES as readonly string[]).includes(value)) {
    return value as P5InboxSourceKind;
  }
  throw new ContractDecodeError('refresh', 'deployment | assetPull | pr | escalation');
}

/** One stable clock reference so repeated `createInboxRoutePorts` calls share the ONE process cache
 *  singleton (`getInboxSourceCache` compares its `now` option by reference). */
const wallClockNow = (): number => Date.now();

/** The production `gh` subprocess port: a 15-second READ (`gh pr list`), never a write. A non-zero exit
 *  or a rejection is a source failure the resolver turns into a closed error code — never raw stderr. */
export function createGhSubprocessPort(repoRoot: string): SubprocessPort {
  return async (request) => {
    try {
      const stdout = await runTrackedProcess(request.command, request.argv, repoRoot, 'pr list', {
        timeoutMs: request.timeoutMs,
      });
      return { ok: true, stdout };
    } catch (error: unknown) {
      const timedOut = error instanceof Error && / timed out /.test(error.message);
      return { ok: false, stdout: '', ...(timedOut ? { timedOut: true } : {}) };
    }
  };
}

/** The escalation source is store-driven; its revision is the hash of its item id/revision pairs. */
function escalationRead(ports: InboxRoutePorts, repoRoot: string): EscalationRead {
  const index = (ports.indexRepo ?? indexRepo)(repoRoot);
  const items = projectEscalationSubjects(index);
  const revision = createHash('sha256')
    .update(items.map((item) => `${item.id}\u0000${item.revision}`).join(''), 'utf8')
    .digest('hex');
  return { items, state: { status: 'verified', revision, verifiedAt: ports.now() } };
}

// ---------------------------------------------------------------------------------------------------
// P5 W6.1: the two new sources carry P4's SourceState VERBATIM behind the SAME per-source budget shape —
// one recomputation per source per 30 s server-wide, returning the cached projection with `stale: true`
// inside the window [P5-C48]. Both recomputes are PURE (no subprocess), so the budget exists only to
// keep the source honest about age and to satisfy `?refresh=<source>` — it never draws `gh` budget.
// ---------------------------------------------------------------------------------------------------

export const P5_SOURCE_BUDGET_MS = 30_000;

interface P5SourceRecompute<T> { readonly items: readonly T[]; readonly ok: boolean; }
interface P5SourceRead<T> { readonly items: readonly T[]; readonly state: SourceState; }

interface P5SourceSlot {
  lastAt: number | null;
  items: readonly unknown[];
  state: SourceState;
  invalidated: boolean;
}
const P5_NO_DATA: SourceState = { status: 'failed', errorCode: 'unavailable', stale: false };
function emptySlot(): P5SourceSlot { return { lastAt: null, items: [], state: P5_NO_DATA, invalidated: false }; }

/** Process-wide 30 s budget for the two pure sources, mirroring `sourceCache`'s module-level discipline. */
export class P5SourceBudget {
  private readonly slots: Record<'deployment' | 'assetPull', P5SourceSlot> = {
    deployment: emptySlot(), assetPull: emptySlot(),
  };
  private readonly budgetMs: number;
  constructor(budgetMs: number = P5_SOURCE_BUDGET_MS) { this.budgetMs = budgetMs; }

  invalidate(source: 'deployment' | 'assetPull'): void { this.slots[source].invalidated = true; }

  read<T>(
    source: 'deployment' | 'assetPull',
    nowMs: number,
    verifiedAt: () => string,
    recompute: () => P5SourceRecompute<T>,
  ): P5SourceRead<T> {
    const slot = this.slots[source];
    const inWindow = slot.lastAt !== null && nowMs - slot.lastAt < this.budgetMs && !slot.invalidated;
    if (inWindow && slot.state.status === 'verified') {
      return { items: slot.items as readonly T[], state: { ...slot.state, stale: true } };
    }
    const result = recompute();
    slot.lastAt = nowMs;
    slot.invalidated = false;
    if (result.ok) {
      const revision = sha256Hex(result.items
        .map((i) => `${(i as { id: string }).id} ${(i as { revision: string }).revision}`).join(''));
      slot.items = result.items;
      slot.state = { status: 'verified', revision, verifiedAt: verifiedAt() };
    } else if (slot.items.length > 0) {
      slot.state = { status: 'failed', errorCode: 'unavailable', stale: true };
    } else {
      slot.items = [];
      slot.state = { status: 'failed', errorCode: 'unavailable', stale: false };
    }
    return { items: slot.items as readonly T[], state: slot.state };
  }
}

let p5BudgetSingleton: P5SourceBudget | null = null;
export function getP5SourceBudget(): P5SourceBudget {
  if (p5BudgetSingleton === null) p5BudgetSingleton = new P5SourceBudget();
  return p5BudgetSingleton;
}
export function resetP5SourceBudgetForTests(): void { p5BudgetSingleton = null; }

function computeDeploymentSource(
  ports: InboxRoutePorts, now: Date, liveSha: string | null,
): P5SourceRecompute<DeploymentInboxItem | DeploymentEscalationItem> {
  const liveRelease: LiveReleasePort = { liveSha: () => liveSha };
  const result = projectDeploymentSubjects({
    deployments: ports.deployments,
    pty: ports.livePtySessions,
    deployReady: ports.deployReady,
    liveRelease,
    ancestry: ports.ancestry,
    now,
  });
  return { items: [...result.items, ...result.escalations], ok: result.state.status === 'ok' };
}

function computeAssetPullSource(ports: InboxRoutePorts): P5SourceRecompute<AssetPullInboxItem> {
  const result = projectAssetPullSubjects(ports.assetPullIntents);
  return { items: result.items, ok: result.state.status === 'ok' };
}

/** Compose one Inbox response from the FOUR independently-read sources. Shared by the route and the
 *  Home inbox count so both observe the same last-good projection and the same source budgets [P5-C31]. */
export async function readInbox(ports: InboxRoutePorts, repoRoot: string): Promise<P5InboxResponse> {
  const prReader: PrReader = async () => {
    const pin = ports.pin();
    // No pinnable coordination remote: the PR source is unavailable, but the other sources still read
    // (`sourceCache` keeps any last-good PR items and marks the state stale). Never a false empty Inbox.
    if (pin === null) return { items: [], state: { status: 'failed', errorCode: 'unavailable', stale: false } };
    return readOpenPullRequests(pin, ports.runGh, ports.now);
  };
  const pr = await ports.cache.readPr(prReader);
  ports.cache.putEscalation(escalationRead(ports, repoRoot));
  const escalation = ports.cache.peekEscalation();
  const now = new Date(ports.now());
  const nowMs = ports.nowMs();
  const liveSha = await ports.resolveLiveSha();
  const deployment = ports.p5Budget.read('deployment', nowMs, ports.now, () => computeDeploymentSource(ports, now, liveSha));
  const assetPull = ports.p5Budget.read('assetPull', nowMs, ports.now, () => computeAssetPullSource(ports));
  return projectP5Inbox({
    pr: { items: pr.items, state: pr.state },
    escalation: { items: escalation.items, state: escalation.state },
    deployment,
    assetPull,
  });
}

/**
 * Build the production route ports. The two composition-time checks the older M1 code coupled are now
 * SPLIT (boss ruling refining M1), because they guard different things:
 *   - `assertCoordinationRoot(ctx.repoRoot)` STAYS eager fail-closed [P4-C39]: it is a real filesystem
 *     invariant (absolute path, `queue/` present); a wrong `DASHBOARD_REPO_ROOT` must surface at boot.
 *   - `resolveRepositoryPin(...)` DEGRADES: a legitimate kb deployment (the WSL oracle, local dev, an
 *     air-gapped VM) has a non-GitHub `origin`, and the whole dashboard must still BOOT. So a
 *     missing/ambiguous/non-GitHub/unparseable remote is caught here and the PR source resolves to
 *     `unavailable` at runtime (`pin()` returns `null` → the `readInbox` PR arm reports it) instead of
 *     throwing out of `buildApp`. The GitHub pin is a prerequisite for the Inbox PR SOURCE only, not for
 *     the dashboard. The safety property of P4-C35 is preserved a different way: `prHref` still THROWS if
 *     ever asked to build a URL without a valid pin, so no bad PR URL is ever produced — there is simply
 *     no PR source. Only a non-`RepositoryPinError` (unexpected) still propagates.
 * `readRemote` is injectable only so the suite can drive the parser without a real checkout.
 */
export interface InboxRoutePortsOptions {
  readRemote?: GitRemoteReader;
  runGh?: SubprocessPort;
  /** The shared activation port (`http/context.ts` builds ONE) — the deploy-ready gate reads its live
   *  SHA through it, never a checkout. Absent ⇒ no live SHA ⇒ no deploy-ready subject. */
  activation?: ActivationReaderPort;
  /** Test seams for the deploy-ready gate; production uses the VM release reader and empty defaults. */
  deployReady?: DeployReadyPort;
  livePtySessions?: LivePtySessionsPort;
  ancestry?: CommitAncestryPort;
  deployments?: DeploymentsReaderPort;
  assetPullIntents?: AssetPullIntentsReaderPort;
  p5Budget?: P5SourceBudget;
  nowMs?: () => number;
}

export function createInboxRoutePorts(ctx: SurfaceContext, opts: InboxRoutePortsOptions = {}): InboxRoutePorts {
  assertCoordinationRoot(ctx.repoRoot);
  let resolved: RepositoryPin | null;
  try {
    resolved = resolveRepositoryPin(ctx.repoRoot, opts.readRemote);
  } catch (error: unknown) {
    if (!(error instanceof RepositoryPinError)) throw error;
    // The coordination remote cannot be pinned to a GitHub repo: degrade the PR source to `unavailable`
    // and let the dashboard boot. `prHref` guards the URL side, so no bad PR URL can be produced.
    resolved = null;
  }
  const activation = opts.activation;
  return {
    pin: () => resolved,
    runGh: opts.runGh ?? createGhSubprocessPort(ctx.repoRoot),
    cache: getInboxSourceCache({ now: wallClockNow }),
    now: () => (ctx.now?.() ?? new Date()).toISOString(),
    deployments: opts.deployments ?? ctx.controlStore,
    // A registry-wide live-session enumeration is not exposed by `SessionRegistryPort`; production uses
    // the empty set (Close-PTYs-and-continue never surfaces without injected live ids) and tests inject.
    livePtySessions: opts.livePtySessions ?? { liveSessionIds: () => [] },
    deployReady: opts.deployReady ?? createDeployReadyReader(),
    // The deploy-ready gate reads its live SHA from the shared activation port each pass; a failed read
    // degrades to `null` (no deploy-ready subject), never a checkout read [P5-C42].
    resolveLiveSha: async () => {
      if (!activation) return null;
      try { return (await activation.readActivation()).sha; } catch { return null; }
    },
    ancestry: opts.ancestry ?? { isStrictDescendant: () => false },
    assetPullIntents: opts.assetPullIntents ?? ctx.controlStore,
    p5Budget: opts.p5Budget ?? getP5SourceBudget(),
    nowMs: opts.nowMs ?? wallClockNow,
  };
}

/** P6 W6.2 [design:435]: `GET /api/inbox` is now a THIN caller of `services/inboxService.ts#readInboxRoute`
 *  — the refresh-param decode, the per-source invalidation, and the `readInbox` composition are all the
 *  service's, reached only through this bound port. No byte of the request/response contract changed. */
function inboxServicePort(ctx: SurfaceContext, ports: InboxRoutePorts) {
  return {
    invalidatePr: () => ports.cache.invalidatePr(),
    invalidateBudget: (source: 'deployment' | 'assetPull') => ports.p5Budget.invalidate(source),
    readInbox: () => readInbox(ports, ctx.repoRoot),
  };
}

export function registerInboxRoutes(scope: FastifyInstance, ctx: SurfaceContext, ports: InboxRoutePorts): void {
  scope.get('/api/inbox', { preHandler: requireSession(ctx.sessionConfig) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown> | undefined;
    const result = await readInboxRoute(inboxServicePort(ctx, ports), query?.['refresh']);
    return reply.code(result.status).send(result.body);
  });
}

// ===================================================================================================
// P5 W6.1 — the SIX deployment endpoints + the TWO asset-pull endpoints (§3.1, §3.7) [P5-C21, P5-C47,
// P5-C58]. Every endpoint is session-gated, requires an idempotency key, and parses `:ref` /
// `expectedRevision` with the per-endpoint CLOSED parser, refusing `400 invalid-ref` / `400
// invalid-revision` BEFORE any store read, ceremony verification, or helper call. The FOUR T3 endpoints
// (`deploy`, `confirm`, `abort`, `close-ptys-and-continue`) additionally require a ceremony and refuse
// `403 ceremony-unavailable` without one; and BEFORE any ceremony work the crossed-verb `409`s fire
// (`confirm-required` / `deploy-required` / `revision-changed`). There is NO `decline` endpoint [P5-C49].
// The actual verifier + helper transport are wired by W6.3; here they are injected ports so the gates,
// parsers, and pre-ceremony `409`s are all provable in isolation.
// ===================================================================================================

const ASSET_PULL_INTENT_REF = /^assetpull-[0-9a-f]{32}$/;

/** A refusal the ceremony gate produces before any write. */
export type CeremonyRefusal =
  | { readonly status: 403; readonly code: 'ceremony-unavailable' | 'ceremony-invalid' | 'ceremony-expired' };

export interface DeployCeremonyInput {
  readonly decision: DeployT3Decision;
  readonly subject: 'deployment' | 'pty-quiescence';
  readonly ref: string;
  readonly revision: string;
  readonly digest: string;
  /** The client-supplied WebAuthn assertion; the server recomputes the preimage and never trusts it. */
  readonly assertion: unknown;
}

/** The T3 ceremony gate. `available()` is the reachability gate of §3.3/§3.4 (auth mode + ≥1 provisioned
 *  credential); `verify()` is the shipped-verifier deploy path W6.3 wires. A missing/failed verify fails
 *  closed. */
export interface DeployCeremonyGate {
  available(): boolean;
  verify(input: DeployCeremonyInput): CeremonyRefusal | null;
}

/** The record-write + helper executors. W6.3 wires the real helper transport; W6.1 tests inject fakes.
 *  Each may throw a `DeploymentServiceError` / `AssetPullServiceError` the route maps to a status. */
export interface InboxActionExecutors {
  readonly deploymentService: DeploymentService;
  /** The `deploy` helper invocation after a create (W6.3 transport). Default no-op (never reached in
   *  production, since the ceremony gate refuses first without a provisioned credential). */
  readonly helperDeploy?: (candidate: DeployReadyCandidate, previousCommit: string, idempotencyKey: string) => Promise<void> | void;
  /** The `deployment:<n>` confirm arm CAS `waiting-confirmation → requested`. P5 ships no writer that
   *  can produce `waiting-confirmation`, so the default refuses `409 conflict`; W6.3 may wire the CAS. */
  readonly confirmExisting?: (deploymentRef: string, expectedRevision: number, idempotencyKey: string) => void;
  readonly assetPullService: AssetPullService;
  readonly helperPull?: (intentRef: string, idempotencyKey: string) => Promise<void> | void;
}

export interface InboxActionPorts {
  readonly executors: InboxActionExecutors;
  readonly ceremony: DeployCeremonyGate;
  readonly deployReady: DeployReadyPort;
  readonly resolveLiveSha: () => string | null | Promise<string | null>;
  readonly quiescence: Omit<CloseAndContinuePorts, 'store'> & { store: CloseAndContinuePorts['store'] };
  /** Attribution subject for the non-T3 acknowledge. */
  readonly operatorSubject: string;
}

function idempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapServiceError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DeploymentServiceError || error instanceof AssetPullServiceError) {
    return reply.code(error.status).send({ error: error.code });
  }
  throw error;
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

/** Register the eight action endpoints on the governed scope. */
export function registerInboxActionRoutes(scope: FastifyInstance, ctx: SurfaceContext, ports: InboxActionPorts): void {
  const guard = { preHandler: requireSession(ctx.sessionConfig) };
  const store = ctx.controlStore;

  // --- POST /api/inbox/deployment/:ref/deploy — T3, green entry verb, `deploy-ready:<sha>` only. -----
  scope.post('/api/inbox/deployment/:ref/deploy', guard, async (request, reply) => {
    return handleCandidateEntry(request, reply, ports, 'deploy');
  });

  // --- POST /api/inbox/deployment/:ref/confirm — T3, breaking entry verb OR the spec `deployment:<n>`
  //     arm (closed two-spelling union) [P5-C58]. ----------------------------------------------------
  scope.post('/api/inbox/deployment/:ref/confirm', guard, async (request, reply) => {
    const parsed = parseRef(reply, request);
    if (parsed === null) return reply;
    if (parsed.kind === 'deploy-ready') return handleCandidateEntry(request, reply, ports, 'confirm');
    // `deployment:<n>` arm: parse the revision, gate T3, CAS the (spec-only) waiting-confirmation record.
    const revision = parseDeploymentRevisionBody(reply, request);
    if (revision === null) return reply;
    const key = idempotencyKey(request);
    if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });
    const refusal = gateCeremony(ports, { decision: 'confirm', subject: 'deployment', ref: parsed.ref, revision: `deployment:${revision}`, digest: '', request });
    if (refusal) return reply.code(refusal.status).send({ error: refusal.code });
    try {
      (ports.executors.confirmExisting ?? defaultConfirmExisting)(parsed.ref, revision, key);
      return reply.code(200).send({ ok: true });
    } catch (error) { return mapServiceError(reply, error); }
  });

  // --- POST /api/inbox/deployment/:ref/abort — T3, `deployment:<n>` only. ----------------------------
  scope.post('/api/inbox/deployment/:ref/abort', guard, async (request, reply) => {
    const ref = parseStoredRef(reply, request);
    if (ref === null) return reply;
    const revision = parseDeploymentRevisionBody(reply, request);
    if (revision === null) return reply;
    const key = idempotencyKey(request);
    if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });
    const current = store.getDeployment(ref);
    if (!current.ok) return reply.code(404).send({ error: 'not-found' });
    const refusal = gateCeremony(ports, { decision: 'abort', subject: 'deployment', ref, revision: `deployment:${revision}`, digest: '', request });
    if (refusal) return reply.code(refusal.status).send({ error: refusal.code });
    try {
      const deployment = ports.executors.deploymentService.abort(ref, revision, current.value.state);
      return reply.code(200).send({ deployment });
    } catch (error) { return mapServiceError(reply, error); }
  });

  // --- POST /api/inbox/deployment/:ref/acknowledge — NOT T3, `deployment:<n>` only [P5-C21]. ---------
  scope.post('/api/inbox/deployment/:ref/acknowledge', guard, async (request, reply) => {
    const ref = parseStoredRef(reply, request);
    if (ref === null) return reply;
    const revision = parseDeploymentRevisionBody(reply, request);
    if (revision === null) return reply;
    const key = idempotencyKey(request);
    if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });
    const current = store.getDeployment(ref);
    if (!current.ok) return reply.code(404).send({ error: 'not-found' });
    const state = current.value.state;
    if (state !== 'succeeded' && state !== 'aborted' && state !== 'failed') {
      return reply.code(409).send({ error: 'not-terminal' });
    }
    try {
      const deployment = ports.executors.deploymentService.acknowledge(ref, revision, state, ports.operatorSubject);
      return reply.code(200).send({ deployment });
    } catch (error) { return mapServiceError(reply, error); }
  });

  // --- POST /api/inbox/deployment/:ref/close-ptys-and-continue — T3, digest pins the exact ids. ------
  scope.post('/api/inbox/deployment/:ref/close-ptys-and-continue', guard, async (request, reply) => {
    const ref = parseStoredRef(reply, request);
    if (ref === null) return reply;
    const revision = parseDeploymentRevisionBody(reply, request);
    if (revision === null) return reply;
    const key = idempotencyKey(request);
    if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });
    const body = bodyRecord(request);
    const rawIds = body['sessionIds'];
    if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id) => typeof id === 'string')) {
      return reply.code(400).send({ error: 'invalid-session-ids' });
    }
    const sessionIds = rawIds as string[];
    const digest = createHash('sha256').update([...sessionIds].sort().join('\u0000')).digest('hex');
    const refusal = gateCeremony(ports, { decision: 'close-ptys-and-continue', subject: 'pty-quiescence', ref, revision: `deployment:${revision}`, digest, request });
    if (refusal) return reply.code(refusal.status).send({ error: refusal.code });
    const result = await closePtysAndContinue(ports.quiescence, { deploymentRef: ref, expectedRevision: revision, sessionIds });
    if (!result.ok) {
      const status = result.refusal === 'pty-set-changed' || result.refusal === 'pty-not-confirmed' ? 409 : 409;
      return reply.code(status).send({ error: result.refusal });
    }
    return reply.code(200).send({ deployment: result.deployment, closed: result.closed });
  });

  // --- POST /api/inbox/asset-pull/:intentRef/(pull|retry) — NOT T3 [P5-C21]. -------------------------
  for (const verb of ['pull', 'retry'] as const) {
    scope.post(`/api/inbox/asset-pull/:intentRef/${verb}`, guard, async (request, reply) => {
      const params = request.params as { intentRef?: string };
      const intentRef = params.intentRef ?? '';
      if (!ASSET_PULL_INTENT_REF.test(intentRef)) return reply.code(400).send({ error: 'invalid-ref' });
      const key = idempotencyKey(request);
      if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });
      try {
        const dispatch = verb === 'pull'
          ? ports.executors.assetPullService.pull(intentRef)
          : ports.executors.assetPullService.retry(intentRef);
        // Pinned digest from the record, never from subject text; helper resends the same idempotency key.
        await ports.executors.helperPull?.(intentRef, dispatch.idempotencyKey);
        return reply.code(200).send({ intent: dispatch.intent, replayed: dispatch.replayed });
      } catch (error) { return mapServiceError(reply, error); }
    });
  }
}

function defaultConfirmExisting(): void {
  // P5 ships no writer that can produce `waiting-confirmation`; the spec arm is kept handled but a live
  // call finds no such record. Fail closed as a conflict rather than inventing a transition path.
  throw new DeploymentServiceError(409, 'conflict', 'no waiting-confirmation record exists to confirm');
}

interface ParsedRef { readonly kind: 'deploy-ready' | 'deployment'; readonly ref: string }
function parseRef(reply: FastifyReply, request: FastifyRequest): ParsedRef | null {
  const params = request.params as { ref?: string };
  try {
    return parseDeploymentRef(params.ref ?? '');
  } catch {
    void reply.code(400).send({ error: 'invalid-ref' });
    return null;
  }
}

/** For the three `deployment:<n>`-only endpoints: a `deploy-ready:` ref is refused `400 invalid-revision`. */
function parseStoredRef(reply: FastifyReply, request: FastifyRequest): string | null {
  const parsed = parseRef(reply, request);
  if (parsed === null) return null;
  if (parsed.kind !== 'deployment') {
    void reply.code(400).send({ error: 'invalid-revision' });
    return null;
  }
  return parsed.ref;
}

function parseDeploymentRevisionBody(reply: FastifyReply, request: FastifyRequest): number | null {
  const body = bodyRecord(request);
  const raw = body['expectedRevision'];
  try {
    return parseDeploymentRevision(typeof raw === 'string' ? raw : '');
  } catch {
    void reply.code(400).send({ error: 'invalid-revision' });
    return null;
  }
}

/** The green/breaking candidate entry (`deploy` or the `deploy-ready:` arm of `confirm`). Parses the
 *  `deploy-ready:` ref+revision, runs the crossed-verb `409`s and the stale-candidate `409` BEFORE any
 *  ceremony work, gates T3, then creates the record and invokes the helper [P5-C58]. */
async function handleCandidateEntry(
  request: FastifyRequest, reply: FastifyReply, ports: InboxActionPorts,
  verb: 'deploy' | 'confirm',
): Promise<FastifyReply> {
  const parsed = parseRef(reply, request);
  if (parsed === null) return reply;
  if (parsed.kind !== 'deploy-ready') return reply.code(400).send({ error: 'invalid-revision' });
  const targetSha = parsed.ref.slice('deploy-ready:'.length);
  const body = bodyRecord(request);
  const revision = body['expectedRevision'];
  if (typeof revision !== 'string' || !isDeployReadyRevision(revision)) {
    return reply.code(400).send({ error: 'invalid-revision' });
  }
  const key = idempotencyKey(request);
  if (key === null) return reply.code(400).send({ error: 'idempotency-key-required' });

  // Pre-ceremony `409`s: candidate turnover, then crossed verb/candidate agreement [P5-C58].
  const candidate = ports.deployReady.latestCandidate();
  const liveSha = await ports.resolveLiveSha();
  if (candidate === null || liveSha === null || candidate.sha !== targetSha
    || revision !== deployReadyRevision(candidate.sha, liveSha)) {
    return reply.code(409).send({ error: 'revision-changed' });
  }
  if (verb === 'deploy' && candidate.breaking) return reply.code(409).send({ error: 'confirm-required' });
  if (verb === 'confirm' && !candidate.breaking) return reply.code(409).send({ error: 'deploy-required' });

  // T3 ceremony (unavailable/invalid/expired). The digest pins the candidate's re-read attestation.
  const refusal = gateCeremony(ports, { decision: verb, subject: 'deployment', ref: parsed.ref, revision, digest: candidate.attestationDigest, request });
  if (refusal) return reply.code(refusal.status).send({ error: refusal.code });

  try {
    const created = verb === 'deploy'
      ? ports.executors.deploymentService.deploy(candidate, liveSha)
      : ports.executors.deploymentService.confirm(candidate, liveSha);
    await ports.executors.helperDeploy?.(candidate, liveSha, key);
    return reply.code(200).send({ deployment: created.deployment, replayed: created.replayed });
  } catch (error) { return mapServiceError(reply, error); }
}

function gateCeremony(
  ports: InboxActionPorts,
  input: { decision: DeployT3Decision; subject: 'deployment' | 'pty-quiescence'; ref: string; revision: string; digest: string; request: FastifyRequest },
): CeremonyRefusal | null {
  if (!ports.ceremony.available()) return { status: 403, code: 'ceremony-unavailable' };
  const assertion = bodyRecord(input.request)['assertion'];
  return ports.ceremony.verify({
    decision: input.decision, subject: input.subject, ref: input.ref,
    revision: input.revision, digest: input.digest, assertion,
  });
}

/**
 * Build the production action ports over `SurfaceContext`. The ceremony gate's `available()` is the
 * §3.3/§3.4 reachability gate (auth mode `tailnet`|`win32-desktop` AND ≥1 provisioned credential); its
 * `verify()` is wired by W6.3 and, until then, fails closed (`ceremony-invalid`). Because `available()`
 * is `false` on the VM until a credential is provisioned, the T3 endpoints refuse `ceremony-unavailable`
 * and never reach the (W6.3-owned) helper transport.
 */
export function createInboxActionPorts(
  ctx: SurfaceContext,
  opts: {
    ceremony?: DeployCeremonyGate;
    executors?: Partial<InboxActionExecutors>;
    deployReady?: DeployReadyPort;
    activation?: ActivationReaderPort;
    livePtySessions?: { listLiveSessionIds(): Promise<readonly string[]> | readonly string[] };
    closeSessions?: CloseAndContinuePorts['closeSessions'];
    operatorSubject?: string;
    now?: () => Date;
  } = {},
): InboxActionPorts {
  const now = opts.now ?? ctx.now ?? (() => new Date());
  const deploymentService = opts.executors?.deploymentService ?? new DeploymentService({ store: ctx.controlStore, now });
  const assetPullService = opts.executors?.assetPullService ?? new AssetPullService({ store: ctx.controlStore, now });
  const activation = opts.activation;
  const ceremony: DeployCeremonyGate = opts.ceremony ?? {
    available: () => (ctx.authMode === 'tailnet' || ctx.authMode === 'win32-desktop') && ctx.credentials().length > 0,
    // W6.3 wires the shipped deploy verifier here; until then the gate fails closed once reachable.
    verify: () => ({ status: 403, code: 'ceremony-invalid' }),
  };
  const closeSessions: CloseAndContinuePorts['closeSessions'] = opts.closeSessions ?? ctx.closeDeploymentPtySessions
    ?? (() => { throw new Error('no deployment session closer wired'); });
  const livePtySessions = opts.livePtySessions ?? { listLiveSessionIds: () => [] };
  return {
    executors: {
      deploymentService,
      assetPullService,
      ...(opts.executors?.helperDeploy ? { helperDeploy: opts.executors.helperDeploy } : {}),
      ...(opts.executors?.confirmExisting ? { confirmExisting: opts.executors.confirmExisting } : {}),
      ...(opts.executors?.helperPull ? { helperPull: opts.executors.helperPull } : {}),
    },
    ceremony,
    deployReady: opts.deployReady ?? createDeployReadyReader(),
    resolveLiveSha: async () => {
      if (!activation) return null;
      try { return (await activation.readActivation()).sha; } catch { return null; }
    },
    quiescence: {
      store: ctx.controlStore as unknown as CloseAndContinuePorts['store'],
      liveSessions: livePtySessions,
      closeSessions,
      now: () => now().toISOString(),
    },
    operatorSubject: opts.operatorSubject ?? 'human-operator',
  };
}
