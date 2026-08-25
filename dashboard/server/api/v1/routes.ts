/**
 * P6 W6.1 §5 [P6-C20, P6-C33, P6-C40, P6-C46, P6-C51, P6-C52] — `/api/v1` registration as THREE scopes,
 * separated from operator traffic by PEER UID, never by path.
 *
 *   1. `registerV1OperatorReadRoutes`     — v1 reads, mounted INSIDE the existing read scope (index.ts).
 *   2. `registerV1OperatorMutationRoutes` — v1 operator mutations, mounted INSIDE the write surface's
 *                                           authenticated scope (http/surface.ts).
 *   3. `registerV1NodeRoutes`             — the four `design:456-459` node routes VERBATIM (no
 *                                           `/api/v1/node/**` prefix, no alias), in a SIBLING scope inside
 *                                           the same outer origin+rate scope as `registerPaidActionRoute`
 *                                           (the shipped session-less-sibling precedent), with
 *                                           `requireNodeIdentity` in place of `requireSession`.
 *
 * The whole safety argument is the peer uid, so it is enforced in preHandlers the listener cannot bypass:
 *   - the node scope refuses ANY peer other than `DASHBOARD_NODE_PROXY_UID` → `403 node-route-only`
 *     (including a well-formed operator session that reached a node path);
 *   - the two operator scopes refuse THAT uid → `403 operator-route-only` — asserted on a sample operator
 *     route under `/api/v1/runs/**`, the very prefix two node routes (`renew`, `reports`) also live under,
 *     which is the proof no `tailscale serve` path rule could have separated them.
 *
 * `meta` fields not meaningful to a kind are ABSENT (never null); a `412` body carries the current ETag or
 * watermark and nothing else. The node scope's rate hook is its OWN guard pair (`ctx.nodeReadRateGuard`,
 * `ctx.nodeRateGuard`), never the operator pair, and its `onRequest` installs `request.raw.setTimeout(
 * 35_000)` per request — the per-route long-poll lever Fastify's server-level `requestTimeout` has no
 * plugin form of, so `index.ts:184` stays untouched.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SurfaceContext } from '../../http/context.ts';
import { surfaceRateLimitHook } from '../../http/middleware.ts';
import { originPlugin } from '../../security/origin.ts';
import { verifiedSession } from '../../http/middleware.ts';
import { isNodeProxyPeer, requireNodeIdentity, type NodeRequestLike } from '../../auth/nodeIdentity.ts';
import type { ClaimClock, LeaseStorePort } from '../../placement/leaseService.ts';
import { claimLease, renewLease } from '../../placement/leaseService.ts';
import type { ReportStorePort } from '../../placement/reportService.ts';
import { submitReport } from '../../placement/reportService.ts';
import { decodeHostAdvertisement, type HostAdvertisement, type HostKind } from '../../placement/contracts.ts';
import type { LaunchServicePort, LaunchServiceInput } from '../../services/launchService.ts';
import { launchService } from '../../services/launchService.ts';
import type { EntityListPort, AgentDetailPort, WorkflowDetailPort, SubmitBuilderPort } from '../../services/entityService.ts';
import { readEntityList, readAgentDetail, readWorkflowDetail, createAgent, updateAgent, createWorkflow, updateWorkflowBuilder } from '../../services/entityService.ts';
import type { RunReadPort } from '../../services/runReadService.ts';
import { listRuns, replayRunEvents, respondHumanRequestRoute, type RespondPort } from '../../services/runReadService.ts';
import type { ScheduleServicePort } from '../../services/scheduleService.ts';
import { listSchedules, createSchedule, setScheduleArmed, deleteSchedule } from '../../services/scheduleService.ts';
import type { InboxServicePort } from '../../services/inboxService.ts';
import { readInboxRoute } from '../../services/inboxService.ts';
import type { HealthServicePort } from '../../services/healthService.ts';
import { readHealth } from '../../services/healthService.ts';
import type { ServiceReply } from '../../services/scheduleService.ts';
import { ContractDecodeError } from '../../write/durableManifest.ts';
import {
  decodeClaimRequest,
  hostVersion,
  runEtag,
  type RunEtag,
} from './contracts.ts';
import { isIdempotencyKey } from './idempotency.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { v1Error, v1Success } from './envelope.ts';

const LONG_POLL_TIMEOUT_MS = 35_000;

/** The CAS store for `PUT /api/v1/hosts/:hostId`: read the current advertisement version, upsert under an
 *  `If-Match` / `If-None-Match:*` CAS. `expectedVersion === undefined` is a first advertisement. */
export interface AdvertiseStorePort {
  currentVersion(hostId: HostKind): Promise<number | undefined>;
  upsert(
    hostId: HostKind,
    advertisement: HostAdvertisement,
    expectedVersion: number | undefined,
  ): Promise<{ readonly ok: true; readonly version: number } | { readonly ok: false; readonly current: number }>;
}

/** A run-read view for `GET /api/v1/runs/:runRef` (the shared-prefix operator route). */
export type ReadRunResult =
  | { readonly ok: true; readonly version: number; readonly data: unknown }
  | { readonly ok: false; readonly status: number };

/**
 * The injectable ports the v1 surface is thin over. Production binds each to the extracted W2 service /
 * placement store adapter; route tests inject recording fakes exactly as every other governed route does.
 */
export interface V1SurfaceDeps {
  // --- node ports ---
  readonly leaseStore?: LeaseStorePort;
  readonly reportStore?: ReportStorePort;
  readonly advertiseStore?: AdvertiseStorePort;
  readonly claimClock?: ClaimClock;
  /** The daemon version stamped into an accepted advertisement (display/diagnostics only). */
  readonly daemonVersion?: string;
  /** Injected `/proc/net/tcp{,6}` tables for the peer-uid proof; production reads the real ones. */
  readonly readTables?: () => readonly string[];
  readonly now?: () => Date;
  // --- operator ports ---
  readonly readRun?: (subject: string, runRef: string) => ReadRunResult;
  readonly launchPort?: LaunchServicePort;
  // agents (§6): list/detail reads + builder create/update mutations
  readonly agentListPort?: EntityListPort;
  readonly agentDetailPort?: AgentDetailPort;
  readonly submitAgent?: SubmitBuilderPort;
  readonly agentDeclarationFor?: (id: string) => unknown | undefined;
  readonly agentFirstProject?: () => string | undefined;
  // workflows (§6): list/detail reads + builder create/update
  readonly workflowListPort?: EntityListPort;
  readonly workflowDetailPort?: WorkflowDetailPort;
  readonly submitWorkflow?: SubmitBuilderPort;
  readonly workflowExists?: (id: string) => boolean;
  readonly workflowScannedFor?: (id: string) => { def: unknown | null; entry: { project: string } } | null;
  // runs list + events + human-response
  readonly runReadPort?: RunReadPort;
  readonly runListWatermark?: () => string;
  readonly cursorSecret?: Buffer;
  readonly respondPort?: RespondPort;
  // schedules / inbox / health
  readonly schedulePort?: ScheduleServicePort;
  readonly inboxPort?: InboxServicePort;
  readonly healthPort?: HealthServicePort;
  // deployments + asset-pulls (T3 arm reuses the shipped ceremony vocabulary — ceremonyId+assertion)
  readonly deploymentPort?: DeploymentActionPort;
  readonly assetPullPort?: AssetPullActionPort;
}

/** The injected deployment-action port: read-only inspect + the T3-gated transitions. The route enforces
 *  the fail-closed T3 ceremony (403 ceremony-unavailable without an assertion) BEFORE calling this. */
export interface DeploymentActionPort {
  inspect(ref: string): ServiceReply;
  transition(ref: string, action: 'confirm' | 'deploy' | 'abort' | 'acknowledge' | 'close-ptys-and-continue', body: unknown): Promise<ServiceReply>;
}

/** The injected asset-pull port: read-only inspect + the pull/retry transitions. */
export interface AssetPullActionPort {
  inspect(intentRef: string): ServiceReply;
  transition(intentRef: string, action: 'pull' | 'retry', body: unknown): Promise<ServiceReply>;
}

function nowIso(ctx: SurfaceContext): string {
  return (ctx.v1?.now ?? ctx.now ?? (() => new Date()))().toISOString();
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Send a v1 error envelope with the mapped status; `meta` carries only the current ETag/watermark. */
function sendError(
  reply: FastifyReply, status: number, code: string, message: string, retryable: boolean,
  opts: { currentEtag?: string; currentWatermark?: string } = {},
): void {
  reply.code(status).send(v1Error(code, message, retryable, opts));
}

// --------------------------------------------------------------------------------------------------
// Scope 3: the four node routes — a sibling scope, peer-uid separated, its own rate guard + long-poll.
// --------------------------------------------------------------------------------------------------

type ResolveNodeResult =
  | { readonly ok: true; readonly host: HostKind; readonly nodeId: string }
  | { readonly ok: false; readonly status: number; readonly code: string };

/** The map-derived host for a node request, or a rendered refusal. Peer-uid `node-route-only` is checked
 *  by the scope preHandler BEFORE this runs; here we only resolve the map identity. */
function resolveNode(req: FastifyRequest, ctx: SurfaceContext, hostId?: string): ResolveNodeResult {
  const loadMap = ctx.loadHostNodeMap;
  const nodeProxyUid = ctx.nodeProxyUid;
  if (loadMap === undefined || nodeProxyUid === undefined) {
    return { ok: false, status: 503, code: 'node-attribution-unavailable' };
  }
  const result = requireNodeIdentity(req as unknown as NodeRequestLike, {
    nodeProxyUid,
    loadMap,
    hostId,
    readTables: ctx.v1?.readTables,
  });
  if (result.ok) return { ok: true, host: result.host, nodeId: result.nodeId };
  // Peer failures are pre-empted by the scope's node-route-only guard; map/id failures render here.
  const codeByReason: Record<typeof result.reason, string> = {
    'untrusted-peer': 'node-route-only',
    'host-map-unavailable': 'host-map-unavailable',
    'node-unknown': 'node-unknown',
    'node-revoked': 'node-revoked',
    'wrong-host': 'wrong-host',
  };
  return { ok: false, status: result.status, code: codeByReason[result.reason] };
}

/**
 * The node scope. Mounted as a SIBLING inside the write surface's OUTER origin+rate scope (beside
 * `registerPaidActionRoute`), so it inherits the same `originPlugin` — but it installs its OWN rate hook
 * (`ctx.nodeReadRateGuard`/`ctx.nodeRateGuard`) and its OWN 35-s per-request long-poll timeout, and
 * `requireNodeIdentity` stands in for `requireSession`. Registers NOTHING when the node uid or map loader
 * is absent (fail-closed).
 */
export function registerV1NodeRoutes(outer: FastifyInstance, ctx: SurfaceContext): void {
  if (ctx.nodeProxyUid === undefined || ctx.loadHostNodeMap === undefined) return;
  const nodeReadGuard = ctx.nodeReadRateGuard;
  const nodeWriteGuard = ctx.nodeRateGuard;
  if (nodeReadGuard === undefined || nodeWriteGuard === undefined) return;
  const nodeProxyUid = ctx.nodeProxyUid;

  outer.register(async (scope) => {
    // Same OUTER origin guard as the operator scopes (a test asserts all three carry the same originPlugin).
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    // The node scope's OWN rate-guard pair — never the operator pair [P6-C33].
    scope.addHook('onRequest', surfaceRateLimitHook(nodeReadGuard, nodeWriteGuard));
    // Per-request long-poll budget [P6-C51]: the per-route lever Fastify's server-level requestTimeout has
    // no plugin form of, so index.ts:184's factory option stays untouched.
    scope.addHook('onRequest', async (req: FastifyRequest) => {
      // Production `req.raw` is a real `http.IncomingMessage` with `setTimeout`; guarded so a mock request
      // (light-my-request under test) without it is a no-op rather than a throw.
      const raw = req.raw as unknown as { setTimeout?: (ms: number) => void };
      if (typeof raw.setTimeout === 'function') raw.setTimeout(LONG_POLL_TIMEOUT_MS);
    });
    // Topology preHandler [P6-C46]: ANY peer other than the node proxy → 403 node-route-only, evaluated
    // before any subject and before the map is even read.
    scope.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!isNodeProxyPeer(req as unknown as NodeRequestLike, nodeProxyUid, { readTables: ctx.v1?.readTables })) {
        sendError(reply, 403, 'node-route-only', 'this route is reachable only through the node proxy', false);
      }
    });

    // PUT /api/v1/hosts/:hostId — advertise. CAS on host:<hostId>:<version>. No Idempotency-Key [P6-C69].
    scope.put('/api/v1/hosts/:hostId', async (req, reply) => {
      const hostIdParam = (req.params as { hostId: string }).hostId;
      const node = resolveNode(req, ctx, hostIdParam);
      if (!node.ok) return renderNodeRefusal(reply, node);
      const store = ctx.v1?.advertiseStore;
      if (store === undefined) return sendError(reply, 503, 'node-attribution-unavailable', 'advertisement store unavailable', true);
      let advertisement: HostAdvertisement;
      // The body is the advertisement MINUS hostId; the host id comes ONLY from the map (§6). Build the
      // decode candidate by assigning the map-derived host last, so a client-supplied hostId cannot enter.
      const candidate: Record<string, unknown> = { ...((req.body ?? {}) as Record<string, unknown>) };
      candidate.hostId = node.host;
      try {
        advertisement = decodeHostAdvertisement(candidate);
      } catch (err) {
        if (err instanceof ContractDecodeError) return sendError(reply, 413, 'advertisement-too-large', err.message, false);
        throw err;
      }
      const current = await store.currentVersion(node.host);
      const precondition = evaluateHostPrecondition(req, node.host, current);
      if (!precondition.ok) {
        return sendError(reply, precondition.status, precondition.code, precondition.message, false,
          precondition.currentEtag ? { currentEtag: precondition.currentEtag } : {});
      }
      const written = await store.upsert(node.host, advertisement, current);
      if (!written.ok) {
        return sendError(reply, 412, 'etag-mismatch', 'advertisement version changed', false,
          { currentEtag: hostVersion(node.host, written.current) });
      }
      // `advertisement` already carries the map-derived `hostId` (set on the decode candidate above).
      reply.code(200).send(v1Success('host', advertisement, {
        etag: hostVersion(node.host, written.version),
      }));
    });

    // POST /api/v1/hosts/:hostId/leases/claim — long-poll claim. No Idempotency-Key (server-chosen run).
    scope.post('/api/v1/hosts/:hostId/leases/claim', async (req, reply) => {
      const hostIdParam = (req.params as { hostId: string }).hostId;
      const node = resolveNode(req, ctx, hostIdParam);
      if (!node.ok) return renderNodeRefusal(reply, node);
      const store = ctx.v1?.leaseStore;
      const clock = ctx.v1?.claimClock;
      if (store === undefined || clock === undefined) return sendError(reply, 503, 'node-attribution-unavailable', 'lease store unavailable', true);
      let waitMs: number;
      try {
        waitMs = decodeClaimRequest(req.body).waitMs;
      } catch (err) {
        if (err instanceof ContractDecodeError) return sendError(reply, 400, 'unknown-key', err.message, false);
        throw err;
      }
      const outcome = await claimLease(store, { hostId: node.host, waitMs }, clock);
      if (!outcome.ok) return reply.code(204).send();
      reply.code(200).send(v1Success('lease', { runRef: outcome.lease.runRef, lease: outcome.lease }, {
        etag: leaseEtag(outcome.lease.runRef, outcome.lease.revision),
      }));
    });

    // POST /api/v1/runs/:runRef/leases/renew — shares /api/v1/runs/** with the operator read. CAS'd on
    // expectedLeaseRevision, so NO Idempotency-Key [P6-C69].
    scope.post('/api/v1/runs/:runRef/leases/renew', async (req, reply) => {
      const runRef = (req.params as { runRef: string }).runRef;
      const node = resolveNode(req, ctx);
      if (!node.ok) return renderNodeRefusal(reply, node);
      const store = ctx.v1?.leaseStore;
      if (store === undefined) return sendError(reply, 503, 'node-attribution-unavailable', 'lease store unavailable', true);
      const body = req.body as Record<string, unknown>;
      const expected = body?.expectedLeaseRevision;
      if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
        return sendError(reply, 400, 'unknown-key', 'expectedLeaseRevision integer >= 1 required', false);
      }
      const outcome = await renewLease(store, { runRef, hostId: node.host, expectedLeaseRevision: expected }, nowIso(ctx));
      if (!outcome.ok) return sendError(reply, outcome.status, outcome.code, outcome.code, outcome.status >= 500);
      reply.code(200).send(v1Success('lease', { runRef, lease: outcome.lease }, {
        etag: leaseEtag(runRef, outcome.lease.revision),
      }));
    });

    // POST /api/v1/runs/:runRef/reports — append-only. Sequence-pinned, so NO Idempotency-Key [P6-C69];
    // can never respond to or resolve a human gate (the report decoder's exact-key wall).
    scope.post('/api/v1/runs/:runRef/reports', async (req, reply) => {
      const runRef = (req.params as { runRef: string }).runRef;
      const node = resolveNode(req, ctx);
      if (!node.ok) return renderNodeRefusal(reply, node);
      const store = ctx.v1?.reportStore;
      if (store === undefined) return sendError(reply, 503, 'node-attribution-unavailable', 'report store unavailable', true);
      const outcome = await submitReport(store, { runRef, hostId: node.host, body: req.body, nowIso: nowIso(ctx) });
      if (!outcome.ok) {
        return sendError(reply, outcome.status, outcome.code, outcome.code, false);
      }
      reply.code(200).send(v1Success('report', outcome.requestRef ? { runRef, requestRef: outcome.requestRef } : { runRef }, {}));
    });
  });
}

/** The `host:<hostId>:<version>` If-Match precondition on PUT hosts — a foreign-domain ETag (a Run ETag,
 *  a list watermark) can never equal it, so it is a `412`, proving the six domains are non-interchangeable
 *  on the wire [W6.1 checkpoint bullet 4]. A first advertisement uses `If-None-Match:*` and no version. */
function evaluateHostPrecondition(
  req: FastifyRequest, host: HostKind, current: number | undefined,
): { ok: true } | { ok: false; status: number; code: string; message: string; currentEtag?: string } {
  const ifNoneMatch = headerValue(req, 'if-none-match');
  const ifMatch = headerValue(req, 'if-match');
  if (current === undefined) {
    // First advertisement: If-None-Match:* is required; an If-Match here is stale by definition.
    if (ifNoneMatch === '*') return { ok: true };
    if (ifMatch !== undefined) return { ok: false, status: 412, code: 'etag-mismatch', message: 'no advertisement exists yet' };
    return { ok: false, status: 428, code: 'precondition-required', message: 'If-None-Match:* required on first advertisement' };
  }
  const expected = hostVersion(host, current);
  if (ifMatch === undefined) return { ok: false, status: 428, code: 'precondition-required', message: 'If-Match required', currentEtag: expected };
  if (ifMatch !== expected) return { ok: false, status: 412, code: 'etag-mismatch', message: 'advertisement version changed', currentEtag: expected };
  return { ok: true };
}

function leaseEtag(runRef: string, revision: number): string {
  return `lease:${runRef}:${revision}`;
}

function renderNodeRefusal(reply: FastifyReply, node: { readonly ok: false; readonly status: number; readonly code: string }): void {
  sendError(reply, node.status, node.code, node.code, node.status >= 500);
}

// --------------------------------------------------------------------------------------------------
// The operator-route-only guard, shared by the two operator scopes [P6-C46].
// --------------------------------------------------------------------------------------------------

/**
 * A `preHandler` the operator scopes install so a request arriving with the node-proxy uid is refused
 * `403 operator-route-only` — the mirror of the node scope's `node-route-only`. No-ops when the node uid
 * is unconfigured (every operator test), so it never changes existing operator-route behaviour.
 */
export function operatorRouteOnlyGuard(ctx: SurfaceContext) {
  return async function preHandlerOperatorRouteOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (ctx.nodeProxyUid === undefined) return;
    if (isNodeProxyPeer(req as unknown as NodeRequestLike, ctx.nodeProxyUid, { readTables: ctx.v1?.readTables })) {
      sendError(reply, 403, 'operator-route-only', 'this route is not reachable through the node proxy', false);
    }
  };
}

// --------------------------------------------------------------------------------------------------
// Scope 1: v1 operator reads (mounted inside the existing read scope).
// --------------------------------------------------------------------------------------------------

function operatorSubject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

function stripQuotes(etag: string | undefined): string | undefined {
  if (etag === undefined) return undefined;
  return etag.startsWith('"') && etag.endsWith('"') ? etag.slice(1, -1) : etag;
}

/**
 * Map a W2-service `ServiceReply` into the v1 envelope. `metaField` places the service ETag into
 * `meta.etag` (item kinds) or `meta.watermark` (list/aggregate kinds); a `304` keeps its ETag header and
 * no body; a 4xx/5xx becomes a `v1Error` whose code is the service body's `error`. `meta` fields not
 * meaningful to the kind are ABSENT, never null.
 */
function sendServiceReply(
  reply: FastifyReply, kind: string, sr: ServiceReply, metaField: 'etag' | 'watermark' | null,
): void {
  if (sr.status === 304) {
    if (sr.etag) reply.header('etag', sr.etag);
    reply.code(304).send();
    return;
  }
  if (sr.status >= 200 && sr.status < 300) {
    const opts: { etag?: string; watermark?: string } = {};
    const value = stripQuotes(sr.etag);
    if (metaField === 'etag' && value !== undefined) opts.etag = value;
    if (metaField === 'watermark' && value !== undefined) opts.watermark = value;
    // Also expose the raw (quoted) service ETag as the transport header, so a conditional GET can
    // round-trip it back as `If-None-Match` and get the service's own 304.
    if (sr.etag) reply.header('etag', sr.etag);
    reply.code(sr.status).send(v1Success(kind, sr.body, opts));
    return;
  }
  const body = (sr.body ?? {}) as Record<string, unknown>;
  const code = typeof body.error === 'string' ? body.error : 'error';
  reply.code(sr.status).send(v1Error(code, code, sr.status >= 500));
}

const ifNoneMatchOf = (req: FastifyRequest): string | undefined => headerValue(req, 'if-none-match');

/** §3.4 wire contract: every operator mutation carrying a body requires a well-formed `Idempotency-Key`
 *  header. An absent or off-grammar key is refused BEFORE any service call. The node CAS/seq-pinned routes
 *  are exempt and never reach this [P6-C69]. Returns the key, or renders the refusal and returns null. */
function requireIdempotencyKey(req: FastifyRequest, reply: FastifyReply): string | null {
  const key = headerValue(req, 'idempotency-key');
  if (!isIdempotencyKey(key)) {
    sendError(reply, 400, 'idempotency-key-required', 'a well-formed Idempotency-Key header is required', false);
    return null;
  }
  return key;
}

/** Resolve the operator subject or render `401 unauthenticated`. */
function requireOperator(req: FastifyRequest, reply: FastifyReply): string | null {
  const subject = operatorSubject(req);
  if (subject === null) {
    sendError(reply, 401, 'unauthenticated', 'operator session required', false);
    return null;
  }
  return subject;
}

export function registerV1OperatorReadRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.addHook('preHandler', operatorRouteOnlyGuard(ctx));

  // GET /api/v1/agents — kind:'agent-list', meta.watermark = the definitions-list revision.
  scope.get('/api/v1/agents', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.agentListPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'agent list unavailable', false);
    sendServiceReply(reply, 'agent-list', readEntityList(port, ifNoneMatchOf(req)), 'watermark');
  });

  // GET /api/v1/agents/:id — kind:'agent', meta.etag = <source hash>.
  scope.get('/api/v1/agents/:id', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.agentDetailPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'agent detail unavailable', false);
    sendServiceReply(reply, 'agent', readAgentDetail(port, (req.params as { id: string }).id, ifNoneMatchOf(req)), 'etag');
  });

  // GET /api/v1/workflows — kind:'workflow-list'.
  scope.get('/api/v1/workflows', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.workflowListPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'workflow list unavailable', false);
    sendServiceReply(reply, 'workflow-list', readEntityList(port, ifNoneMatchOf(req)), 'watermark');
  });

  // GET /api/v1/workflows/:id — kind:'workflow' (carries the stage graph).
  scope.get('/api/v1/workflows/:id', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.workflowDetailPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'workflow detail unavailable', false);
    sendServiceReply(reply, 'workflow', readWorkflowDetail(port, (req.params as { id: string }).id, ifNoneMatchOf(req)), 'etag');
  });

  // GET /api/v1/runs — kind:'run-list' with the signed opaque cursor [§3.4:209]; a moved watermark is
  // 409 cursor-stale, a hand-edited cursor 400 cursor-malformed [P6-C41].
  scope.get('/api/v1/runs', async (req, reply) => {
    const subject = requireOperator(req, reply);
    if (subject === null) return;
    const port = ctx.v1?.runReadPort;
    const secret = ctx.v1?.cursorSecret;
    const watermarkOf = ctx.v1?.runListWatermark;
    if (port === undefined || secret === undefined || watermarkOf === undefined) {
      return sendError(reply, 404, 'not-found', 'run list unavailable', false);
    }
    const watermark = watermarkOf();
    const query = req.query as Record<string, unknown>;
    let lastKey = '';
    if (typeof query.cursor === 'string') {
      const decoded = decodeCursor(query.cursor, secret, watermark);
      if (!decoded.ok) return sendError(reply, decoded.status, decoded.code, decoded.code, decoded.retryable);
      if (decoded.payload.kind !== 'run-list') return sendError(reply, 400, 'cursor-malformed', 'cursor kind mismatch', false);
      lastKey = decoded.payload.lastKey;
    }
    const sr = listRuns(port, subject, { includeArchived: query.includeArchived });
    if (sr.status !== 200) return sendServiceReply(reply, 'run-list', sr, null);
    const nextCursor = encodeCursor({ kind: 'run-list', watermark, filterHash: '', lastKey }, secret);
    reply.code(200).send(v1Success('run-list', sr.body, { watermark, nextCursor }));
  });

  // GET /api/v1/runs/:runRef — kind:'run', meta.etag = run:<runRef>:<version>. The SAMPLE operator route
  // under /api/v1/runs/**, the shared prefix that proves the peer-uid split (operator-route-only).
  scope.get('/api/v1/runs/:runRef', async (req, reply) => {
    const subject = requireOperator(req, reply);
    if (subject === null) return;
    const read = ctx.v1?.readRun;
    if (read === undefined) return sendError(reply, 404, 'not-found', 'run read unavailable', false);
    const runRef = (req.params as { runRef: string }).runRef;
    const result = read(subject, runRef);
    if (!result.ok) return sendError(reply, result.status, result.status === 404 ? 'not-found' : 'forbidden', 'run not readable', false);
    let etag: RunEtag;
    try {
      etag = runEtag(runRef, result.version);
    } catch (err) {
      if (err instanceof ContractDecodeError) return sendError(reply, 400, 'bad-run-ref', err.message, false);
      throw err;
    }
    reply.code(200).send(v1Success('run', result.data, { etag }));
  });

  // GET /api/v1/runs/:runRef/events — cursor replay; Accept: text/event-stream selects the same source.
  scope.get('/api/v1/runs/:runRef/events', async (req, reply) => {
    const subject = requireOperator(req, reply);
    if (subject === null) return;
    const port = ctx.v1?.runReadPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'run events unavailable', false);
    const runRef = (req.params as { runRef: string }).runRef;
    const query = req.query as Record<string, unknown>;
    const sr = await replayRunEvents(port, subject, runRef, query, ifNoneMatchOf(req));
    const accept = headerValue(req, 'accept') ?? '';
    if (sr.status === 200 && accept.includes('text/event-stream')) {
      // The SAME replay page, framed as SSE from the same source [§6]. Live fold-in remains the hub's job.
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-cache');
      reply.raw.write(`event: replay\ndata: ${JSON.stringify(sr.body)}\n\n`);
      reply.raw.end();
      return;
    }
    sendServiceReply(reply, 'run-events', sr, 'watermark');
  });

  // GET /api/v1/schedules — kind:'schedule-list', meta.watermark = schedules:<scheduleCollectionRevision>.
  scope.get('/api/v1/schedules', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.schedulePort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'schedule list unavailable', false);
    sendServiceReply(reply, 'schedule-list', await listSchedules(port, ifNoneMatchOf(req)), 'watermark');
  });

  // GET /api/v1/inbox — kind:'inbox'.
  scope.get('/api/v1/inbox', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.inboxPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'inbox unavailable', false);
    const sr = await readInboxRoute(port, (req.query as Record<string, unknown>).refresh);
    sendServiceReply(reply, 'inbox', sr, null);
  });

  // GET /api/v1/health — kind:'health'; the aggregate watermark is NEVER accepted for mutation.
  scope.get('/api/v1/health', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.healthPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'health unavailable', false);
    sendServiceReply(reply, 'health', await readHealth(port, ifNoneMatchOf(req)), 'watermark');
  });

  // GET /api/v1/deployments/:ref/inspect — read-only projection.
  scope.get('/api/v1/deployments/:ref/inspect', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.deploymentPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'deployment inspect unavailable', false);
    sendServiceReply(reply, 'deployment', port.inspect((req.params as { ref: string }).ref), 'etag');
  });

  // GET /api/v1/asset-pulls/:intentRef/inspect — read-only projection.
  scope.get('/api/v1/asset-pulls/:intentRef/inspect', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    const port = ctx.v1?.assetPullPort;
    if (port === undefined) return sendError(reply, 404, 'not-found', 'asset-pull inspect unavailable', false);
    sendServiceReply(reply, 'asset-pull', port.inspect((req.params as { intentRef: string }).intentRef), 'etag');
  });
}

// --------------------------------------------------------------------------------------------------
// Scope 2: v1 operator mutations (mounted inside the write surface's authenticated scope).
// --------------------------------------------------------------------------------------------------

export function registerV1OperatorMutationRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.addHook('preHandler', operatorRouteOnlyGuard(ctx));

  // POST /api/v1/runs — calls services/launchService.ts and NOTHING else [W6.1 checkpoint bullet 5]. The
  // parity suite asserts the same refusal/success matrix as POST /api/workflows/:id/launch, which is the
  // SAME `launchService` under the old route.
  scope.post('/api/v1/runs', async (req, reply) => {
    const subject = operatorSubject(req);
    const port = ctx.v1?.launchPort;
    if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'launch service unavailable', true);
    const session = verifiedSession(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workflowId = body.workflowId;
    if (typeof workflowId !== 'string' || workflowId.length === 0) {
      return sendError(reply, 400, 'unknown-key', 'workflowId required', false);
    }
    const { workflowId: _omit, ...launchBody } = body;
    const input: LaunchServiceInput = {
      subject, sessionToken: session?.token, id: workflowId, body: launchBody,
    };
    const outcome = await launchService(port, input);
    if (outcome.status >= 200 && outcome.status < 300) {
      reply.code(outcome.status).send(v1Success('run', outcome.body, {}));
      return;
    }
    const code = typeof outcome.body.error === 'string' ? outcome.body.error
      : typeof outcome.body.reason === 'string' ? outcome.body.reason : 'launch-refused';
    reply.code(outcome.status).send(v1Error(code, code, outcome.status >= 500));
  });

  // POST /api/v1/agents — builder create (Idempotency-Key required, body carries expectedCollectionRevision).
  scope.post('/api/v1/agents', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const submit = ctx.v1?.submitAgent;
    if (submit === undefined) return sendError(reply, 503, 'launch-unavailable', 'agent builder unavailable', true);
    sendServiceReply(reply, 'agent', await createAgent(submit, req.body), 'etag');
  });

  // PUT /api/v1/agents/:id — builder update (If-Match item ETag lives in body.expectedSourceRevision).
  scope.put('/api/v1/agents/:id', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const submit = ctx.v1?.submitAgent;
    if (submit === undefined) return sendError(reply, 503, 'launch-unavailable', 'agent builder unavailable', true);
    const id = (req.params as { id: string }).id;
    const declaration = ctx.v1?.agentDeclarationFor?.(id);
    const firstProject = ctx.v1?.agentFirstProject?.();
    sendServiceReply(reply, 'agent', await updateAgent(submit, declaration, id, req.body, firstProject), 'etag');
  });

  // POST /api/v1/workflows — builder create.
  scope.post('/api/v1/workflows', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const submit = ctx.v1?.submitWorkflow;
    const exists = ctx.v1?.workflowExists;
    if (submit === undefined || exists === undefined) return sendError(reply, 503, 'launch-unavailable', 'workflow builder unavailable', true);
    sendServiceReply(reply, 'workflow', await createWorkflow(submit, req.body, exists), 'etag');
  });

  // PUT /api/v1/workflows/:id — builder update branch (the amend branch is served by the same service).
  scope.put('/api/v1/workflows/:id', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const submit = ctx.v1?.submitWorkflow;
    if (submit === undefined) return sendError(reply, 503, 'launch-unavailable', 'workflow builder unavailable', true);
    const id = (req.params as { id: string }).id;
    const scanned = ctx.v1?.workflowScannedFor?.(id) ?? null;
    sendServiceReply(reply, 'workflow', await updateWorkflowBuilder(submit, scanned, id, req.body), 'etag');
  });

  // POST /api/v1/schedules — create; body carries the NUMERIC expectedCollectionRevision precondition
  // [§3.4:433]. A foreign-domain value (e.g. a Run ETag string) fails the numeric wall -> 400.
  scope.post('/api/v1/schedules', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const port = ctx.v1?.schedulePort;
    if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'schedule service unavailable', true);
    sendServiceReply(reply, 'schedule', await createSchedule(port, req.body), 'watermark');
  });

  // POST /api/v1/schedules/:id/arm and /disarm — closed armed body with expectedVersion precondition.
  for (const armed of [true, false] as const) {
    scope.post(`/api/v1/schedules/:id/${armed ? 'arm' : 'disarm'}`, async (req, reply) => {
      if (requireOperator(req, reply) === null) return;
      if (requireIdempotencyKey(req, reply) === null) return;
      const port = ctx.v1?.schedulePort;
      if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'schedule service unavailable', true);
      sendServiceReply(reply, 'schedule', await setScheduleArmed(port, (req.params as { id: string }).id, req.body, armed), 'etag');
    });
  }

  // DELETE /api/v1/schedules/:id — closed delete body with expectedVersion precondition.
  scope.delete('/api/v1/schedules/:id', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const port = ctx.v1?.schedulePort;
    if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'schedule service unavailable', true);
    sendServiceReply(reply, 'schedule', await deleteSchedule(port, (req.params as { id: string }).id, req.body), 'etag');
  });

  // POST /api/v1/runs/:runRef/human-requests/:requestRef/respond — operator human-response. A node/host
  // identity can never reach it: the operatorRouteOnlyGuard refuses the node-proxy peer 403
  // operator-route-only (the §3.6 host-response ban in practice — a host cannot respond).
  scope.post('/api/v1/runs/:runRef/human-requests/:requestRef/respond', async (req, reply) => {
    const subject = requireOperator(req, reply);
    if (subject === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const port = ctx.v1?.respondPort;
    if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'human-response unavailable', true);
    const requestRef = (req.params as { requestRef: string }).requestRef;
    const origin = headerValue(req, 'origin') ?? '';
    sendServiceReply(reply, 'human-response', await respondHumanRequestRoute(port, subject, requestRef, req.body, origin), null);
  });

  // Deployment T3 arm — confirm/deploy/abort/close-ptys are T3: fail-closed 403 ceremony-unavailable
  // WITHOUT a ceremony assertion (the shipped ceremony vocabulary: body.ceremonyId + body.assertion),
  // NO new ceremony vocabulary. acknowledge is a non-T3 operator transition.
  for (const action of ['confirm', 'deploy', 'abort', 'close-ptys-and-continue'] as const) {
    scope.post(`/api/v1/deployments/:ref/${action}`, async (req, reply) => {
      if (requireOperator(req, reply) === null) return;
      if (requireIdempotencyKey(req, reply) === null) return;
      const port = ctx.v1?.deploymentPort;
      if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'deployment service unavailable', true);
      if (!hasCeremonyAssertion(req.body)) return sendError(reply, 403, 'ceremony-unavailable', 'a passkey ceremony assertion is required for this T3 deployment action', false);
      sendServiceReply(reply, 'deployment', await port.transition((req.params as { ref: string }).ref, action, req.body), 'etag');
    });
  }
  scope.post('/api/v1/deployments/:ref/acknowledge', async (req, reply) => {
    if (requireOperator(req, reply) === null) return;
    if (requireIdempotencyKey(req, reply) === null) return;
    const port = ctx.v1?.deploymentPort;
    if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'deployment service unavailable', true);
    sendServiceReply(reply, 'deployment', await port.transition((req.params as { ref: string }).ref, 'acknowledge', req.body), 'etag');
  });

  // POST /api/v1/asset-pulls/:intentRef/(pull|retry).
  for (const action of ['pull', 'retry'] as const) {
    scope.post(`/api/v1/asset-pulls/:intentRef/${action}`, async (req, reply) => {
      if (requireOperator(req, reply) === null) return;
      if (requireIdempotencyKey(req, reply) === null) return;
      const port = ctx.v1?.assetPullPort;
      if (port === undefined) return sendError(reply, 503, 'launch-unavailable', 'asset-pull service unavailable', true);
      sendServiceReply(reply, 'asset-pull', await port.transition((req.params as { intentRef: string }).intentRef, action, req.body), 'etag');
    });
  }
}

/** True when the body carries the shipped passkey ceremony assertion pair — the SAME vocabulary the
 *  human-response route uses (`ceremonyId` + `assertion`); no new ceremony field is introduced [P5 reuse]. */
function hasCeremonyAssertion(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  return rec.ceremonyId != null && rec.assertion != null;
}

/** The single composition entry the checkpoint names. `where` selects which of the three scopes to mount,
 *  because each lands in a DIFFERENT parent scope (read scope / authenticated scope / node sibling). */
export function registerV1Routes(
  scope: FastifyInstance, ctx: SurfaceContext, where: 'reads' | 'operator-mutations' | 'node',
): void {
  if (where === 'reads') registerV1OperatorReadRoutes(scope, ctx);
  else if (where === 'operator-mutations') registerV1OperatorMutationRoutes(scope, ctx);
  else registerV1NodeRoutes(scope, ctx);
}
