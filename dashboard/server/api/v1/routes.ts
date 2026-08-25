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
import { ContractDecodeError } from '../../write/durableManifest.ts';
import {
  decodeClaimRequest,
  hostVersion,
  runEtag,
  type RunEtag,
} from './contracts.ts';
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

export function registerV1OperatorReadRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.addHook('preHandler', operatorRouteOnlyGuard(ctx));

  // GET /api/v1/runs/:runRef — kind:'run', meta.etag = run:<runRef>:<version>. This is the SAMPLE operator
  // route under /api/v1/runs/**, the shared prefix that proves the peer-uid split (operator-route-only).
  scope.get('/api/v1/runs/:runRef', async (req, reply) => {
    const subject = operatorSubject(req);
    if (subject === null) return sendError(reply, 401, 'unauthenticated', 'operator session required', false);
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
