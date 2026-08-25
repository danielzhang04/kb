/**
 * P6 W6.3 — the two-daemon integration fixture [P6-C21, P6-C46, P6-C53, P6-C70].
 *
 * One machine, two daemon PROCESSES on loopback HTTPS, an injected fixture node map, synthetic
 * Gmail/browser connectors advertised only by the Desktop process, and a VM-only agent the Desktop can
 * never claim. It follows the `p3FixtureLifecycle.ts` contract — start both children, poll BOTH `/readyz`
 * to a bounded deadline, run the command after `--`, and in `finally` await both `close()` before
 * force-killing only its own children after the shutdown deadline.
 *
 * It has three modes:
 *   --daemon --role vm|desktop --port N [--vm-origin O]  — serve ONE fixture daemon (a bounded HTTPS
 *       harness mounting the REAL v1 node routes + the real operator-route-only peer guard, plus, on the
 *       Desktop role, `placement/desktopReadProxy.ts` BY NAME). The store is in-memory per process.
 *   --attack <id> ...                                    — run ONE in-process attack probe and write its
 *       artifact JSON; exit non-zero on a failed assertion (§9).
 *   (lifecycle, has `--`)                                — spawn two `--daemon` children, poll both
 *       `/readyz`, run the client after `--`, tear both down.
 *
 * The peer-uid topology [P6-C46] is simulated with TWO listeners' worth of peer uids over one loopback
 * socket: a request's `x-sim-peer-uid` header selects which listener it "arrived on", the daemon stamps
 * the socket 4-tuple for that uid, and the injected `/proc/net/tcp` table maps it back — so the REAL
 * `isNodeProxyPeer`/`requireNodeIdentity` peer proof runs end to end and is never faked, exactly as the
 * W6.1 `_nodeHarness` does one layer down.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SurfaceContext } from '../http/context.ts';
import { makeNodeRateGuard, makeNodeReadRateGuard } from '../http/context.ts';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { decodeHostNodeMap, type HostNodeMap } from '../auth/hostNodeMapContracts.ts';
import type { HostNodeMapLoad } from '../auth/hostNodeMap.ts';
import { registerV1NodeRoutes, operatorRouteOnlyGuard, type V1SurfaceDeps } from '../api/v1/routes.ts';
import { registerStatic } from '../static/routes.ts';
import { healthResponseFixture } from '../health/__fixtures__/health.ts';
import { p2Home, P2_ATTENTION } from './p2BrowserFixtureData.ts';
import {
  type HostAdvertisement, type HostKind, type PlacementLease, type CapabilityRequirement,
  decodeHostAdvertisement, isAdvertisementFresh, ADVERTISEMENT_FRESHNESS_MS, LEASE_TTL_MS,
} from '../placement/contracts.ts';
import { capabilityHash, match } from '../placement/normalize.ts';
import type { CandidateRun, LeaseStorePort } from '../placement/leaseService.ts';
import type { ReportStorePort, RunTerminalState, OpenHumanRequestInput } from '../placement/reportService.ts';
import type { AdvertiseStorePort } from '../api/v1/routes.ts';
import { createDesktopClient, type DesktopClientTransport } from '../placement/desktopClient.ts';
import { forwardDesktopReadProxy } from '../placement/desktopReadProxy.ts';
import { v1Success, v1Error } from '../api/v1/envelope.ts';
import { decodeCursor, encodeCursor } from '../api/v1/cursor.ts';
import {
  createLoopbackTlsMaterial, publishLoopbackCertificate, readLoopbackCertificate, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';

// -------------------------------------------------------------------------------------------------
// Constants + fixture identities.
// -------------------------------------------------------------------------------------------------
export const NODE_PROXY_UID = 1001;
export const OPERATOR_UID = 0;
export const STRANGER_UID = 4242;
export const SIM_PEER_UID_HEADER = 'x-sim-peer-uid';
const DASH_PORT = 4317;
export const FIXTURE_SESSION: SessionConfig = { secret: Buffer.alloc(32, 7), ttlMs: 3_600_000 };
export const operatorBearer = (): string => `Bearer ${mintSession('operator', FIXTURE_SESSION).token}`;
/** The signed opaque list-cursor key for the fixture VM's `GET /api/v1/runs` [P6-C41] — the SAME
 *  `decodeCursor`/`encodeCursor` codec production uses, over a fixture-local watermark (§9 stale-cursor). */
const RUN_LIST_CURSOR_SECRET = Buffer.alloc(32, 9);

export const DEFAULT_NODE_MAP_PATH = fileURLToPath(new URL('./p6HostNodes.fixture.json', import.meta.url));

export function loadFixtureMap(path: string = DEFAULT_NODE_MAP_PATH): HostNodeMap {
  return decodeHostNodeMap(JSON.parse(readFileSync(path, 'utf8')));
}

// A `/proc/net/tcp` table mapping a set of simulated peer uids to distinct loopback 4-tuples. The daemon
// stamps a request's socket to the tuple for its `x-sim-peer-uid`; `findPeerUid` reads it back.
function hex(port: number): string { return port.toString(16).toUpperCase().padStart(4, '0'); }
function peerPortFor(uid: number): number { return 0x9000 + (uid % 0x0f00); }
export function combinedProcTable(uids: readonly number[]): string {
  const header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
  let n = 6;
  const rows: string[] = [];
  for (const uid of uids) {
    const peer = peerPortFor(uid);
    // local socket (owned by a placeholder 999) and the PEER socket (owned by `uid`).
    rows.push(`   ${n}: 0100007F:${hex(DASH_PORT)} 0100007F:${hex(peer)} 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1`);
    rows.push(`   ${n + 1}: 0100007F:${hex(peer)} 0100007F:${hex(DASH_PORT)} 01 00000000:00000000 00:00000000 00000000   ${uid}        0 2 1 0 20 4 30 10 -1`);
    n += 2;
  }
  return `${header}${rows.join('\n')}\n`;
}
const SIM_UIDS = [OPERATOR_UID, NODE_PROXY_UID, STRANGER_UID];
const SIM_TABLE = combinedProcTable(SIM_UIDS);

/** Derive a canonical capability requirement from an advertisement — used to hash what a host can serve. */
export function requirementFromAdvertisement(adv: HostAdvertisement): CapabilityRequirement {
  const clis: Array<'claude' | 'codex'> = [];
  if (adv.clis.claude === 'ready') clis.push('claude');
  if (adv.clis.codex === 'ready') clis.push('codex');
  return {
    connectors: adv.connectors.map((c) => ({ server: c.server, tools: [...c.tools] })),
    skills: [...adv.skills], filesystemRoots: [...adv.filesystemRoots], pty: adv.pty, gpu: adv.gpu, clis,
  };
}

// -------------------------------------------------------------------------------------------------
// The in-memory placement store (advertise + lease + report ports over one run model).
// -------------------------------------------------------------------------------------------------
export interface FixtureRun {
  runRef: string;
  host: HostKind;
  requirement: CapabilityRequirement;
  capabilityHash: string;
  events: Array<{ kind: string; payload: Record<string, unknown>; sequence: number }>;
  gates: Array<{ requestRef: string; kind: string; title: string; resolved: boolean }>;
  terminalOutcome: RunTerminalState['terminalOutcome'];
  completedAt: string | null;
  createdAt: string;
}

export class InMemoryPlacementStore implements AdvertiseStorePort, LeaseStorePort, ReportStorePort {
  private readonly advertisements = new Map<HostKind, { adv: HostAdvertisement; version: number }>();
  private readonly leases = new Map<string, PlacementLease>();
  readonly runs = new Map<string, FixtureRun>();
  private gateSeq = 0;
  now: () => number = () => Date.now();

  scheduleRun(input: { runRef: string; host: HostKind; requirement: CapabilityRequirement; createdAt?: string }): FixtureRun {
    const run: FixtureRun = {
      runRef: input.runRef, host: input.host, requirement: input.requirement,
      capabilityHash: capabilityHash(input.requirement), events: [], gates: [],
      terminalOutcome: null, completedAt: null, createdAt: input.createdAt ?? new Date(this.now()).toISOString(),
    };
    this.runs.set(run.runRef, run);
    return run;
  }

  // --- AdvertiseStorePort ---
  async currentVersion(hostId: HostKind): Promise<number | undefined> {
    return this.advertisements.get(hostId)?.version;
  }
  async upsert(hostId: HostKind, advertisement: HostAdvertisement, expectedVersion: number | undefined) {
    const current = this.advertisements.get(hostId);
    if ((current?.version) !== expectedVersion) return { ok: false as const, current: current?.version ?? 0 };
    const version = (current?.version ?? 0) + 1;
    this.advertisements.set(hostId, { adv: advertisement, version });
    return { ok: true as const, version };
  }
  advertisementFresh(hostId: HostKind, nowIso: string): boolean {
    const entry = this.advertisements.get(hostId);
    return entry !== undefined && isAdvertisementFresh(entry.adv.reportedAt, Date.parse(nowIso));
  }

  // --- LeaseStorePort ---
  async releaseExpiredLeases(nowIso: string): Promise<readonly string[]> {
    const released: string[] = [];
    for (const [runRef, lease] of this.leases) {
      if (Date.parse(lease.expiresAt) <= Date.parse(nowIso)) { this.leases.delete(runRef); released.push(runRef); }
    }
    return released;
  }
  async selectCandidate(hostId: HostKind, nowIso: string): Promise<CandidateRun | undefined> {
    const entry = this.advertisements.get(hostId);
    if (entry === undefined || !isAdvertisementFresh(entry.adv.reportedAt, Date.parse(nowIso))) return undefined;
    const eligible = [...this.runs.values()]
      .filter((run) => run.host === hostId && run.terminalOutcome === null && !this.leases.has(run.runRef))
      .filter((run) => match(run.requirement, entry.adv))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const run = eligible[0];
    return run ? { runRef: run.runRef, capabilityHash: run.capabilityHash } : undefined;
  }
  async createLease(runRef: string, hostId: HostKind, capabilityHashValue: string, nowIso: string): Promise<PlacementLease | undefined> {
    if (this.leases.has(runRef)) return undefined; // CAS: a lease already exists (another claim won).
    const lease: PlacementLease = {
      runRef, hostId, capabilityHash: capabilityHashValue, revision: 1,
      expiresAt: new Date(Date.parse(nowIso) + LEASE_TTL_MS).toISOString(),
      lastReportSequence: this.runs.get(runRef)?.events.at(-1)?.sequence ?? 0,
    };
    this.leases.set(runRef, lease);
    return lease;
  }
  async getLease(runRef: string): Promise<PlacementLease | undefined> { return this.leases.get(runRef); }
  async renewLease(runRef: string, expectedLeaseRevision: number, nowIso: string): Promise<PlacementLease | undefined> {
    const lease = this.leases.get(runRef);
    if (!lease || lease.revision !== expectedLeaseRevision) return undefined;
    const renewed: PlacementLease = { ...lease, revision: lease.revision + 1, expiresAt: new Date(Date.parse(nowIso) + LEASE_TTL_MS).toISOString() };
    this.leases.set(runRef, renewed);
    return renewed;
  }
  async currentAdvertisedCapabilityHash(hostId: HostKind): Promise<string | undefined> {
    const entry = this.advertisements.get(hostId);
    if (entry === undefined) return undefined;
    return capabilityHash(requirementFromAdvertisement(entry.adv));
  }

  // --- ReportStorePort ---
  async getRunTerminalState(runRef: string): Promise<RunTerminalState> {
    const run = this.runs.get(runRef);
    return { terminalOutcome: run?.terminalOutcome ?? null, completedAt: run?.completedAt ?? null };
  }
  async appendReportEvent(runRef: string, kind: string, payload: Record<string, unknown>, sequence: number): Promise<void> {
    this.runs.get(runRef)?.events.push({ kind, payload, sequence });
  }
  async bumpLeaseSequence(runRef: string, sequence: number): Promise<void> {
    const lease = this.leases.get(runRef);
    if (lease) this.leases.set(runRef, { ...lease, lastReportSequence: sequence });
  }
  async markTerminal(runRef: string, outcome: 'ok' | 'failed', completedAt: string): Promise<void> {
    const run = this.runs.get(runRef);
    if (run) { run.terminalOutcome = outcome; run.completedAt = completedAt; }
  }
  async openHumanRequest(input: OpenHumanRequestInput): Promise<{ readonly requestRef: string }> {
    this.gateSeq += 1;
    const requestRef = `req-${this.gateSeq}`;
    this.runs.get(input.runRef)?.gates.push({ requestRef, kind: input.kind, title: input.title, resolved: false });
    return { requestRef };
  }
  /** Operator-only resolve — deliberately NOT part of any port a report can reach [§3.6]. */
  resolveGate(runRef: string, requestRef: string): boolean {
    const gate = this.runs.get(runRef)?.gates.find((g) => g.requestRef === requestRef);
    if (!gate) return false;
    gate.resolved = true;
    return true;
  }
}

// -------------------------------------------------------------------------------------------------
// The fixture daemon: mounts the real node routes + the operator-route-only peer guard, plus, on the
// Desktop role, the read proxy BY NAME. `/readyz` is public. Never registered by production.
// -------------------------------------------------------------------------------------------------
export type DaemonRole = 'vm' | 'desktop';

export interface FixtureDaemonOptions {
  role: DaemonRole;
  store: InMemoryPlacementStore;
  map?: HostNodeMap;
  /** For the Desktop role: the VM origin its read proxy forwards to (`https://127.0.0.1:<vmPort>`). */
  vmOrigin?: string;
  /** Force the WhoIs shim state for the forged-proxy split [P6-C70]: 'up' | 'shim-down'. */
  shimState?: 'up' | 'shim-down';
  /** Extra Host/Origin authorities the node scope's origin guard admits, beyond the fixed dashboard
   *  origin. `startFixtureDaemon` sets this to the daemon's ACTUAL listening origin so a real client's
   *  `Host: 127.0.0.1:<realPort>` header is admitted; the in-process `app.inject` path leaves it unset and
   *  keeps only the fixed 4317 origin (its injected requests carry `host: 127.0.0.1:4317`). */
  extraAllowedOrigins?: readonly string[];
  now?: () => Date;
}

function ctxFor(store: InMemoryPlacementStore, map: HostNodeMap, opts: FixtureDaemonOptions): SurfaceContext {
  const loadMap: () => HostNodeMapLoad = () => ({ ok: true, map });
  // A dead WhoIs shim leaves the map loadable and the peer proof intact, but the dashboard cannot attribute
  // the node to a live placement port — the `503 node-attribution-unavailable` branch [P6-C61, P6-C70].
  const shimDown = opts.shimState === 'shim-down';
  const v1: V1SurfaceDeps = {
    ...(shimDown ? {} : { advertiseStore: store, leaseStore: store, reportStore: store }),
    claimClock: { now: () => (opts.now ?? (() => new Date()))().getTime(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    readTables: () => [SIM_TABLE],
    now: opts.now ?? (() => new Date()),
  };
  return {
    allowedOrigins: [`http://127.0.0.1:${DASH_PORT}`, 'https://127.0.0.1', ...(opts.extraAllowedOrigins ?? [])],
    sessionConfig: FIXTURE_SESSION,
    nodeProxyUid: NODE_PROXY_UID,
    loadHostNodeMap: loadMap,
    nodeRateGuard: makeNodeRateGuard(),
    nodeReadRateGuard: makeNodeReadRateGuard(),
    now: opts.now ?? (() => new Date()),
    v1,
  } as unknown as SurfaceContext;
}

/** Stamp the request socket to the 4-tuple for its `x-sim-peer-uid` (default operator uid 0). */
function stampPeerHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    const raw = req.headers[SIM_PEER_UID_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const uid = value === undefined ? OPERATOR_UID : Number.parseInt(value, 10);
    // Shadow the (read-only on a real TLSSocket) 4-tuple getters with own-properties on the socket
    // instance, so the REAL peer-resolution code (nodeIdentity/peerUid) transparently reads the SIMULATED
    // tuple. On the injected fake socket these are plain writable props, so defineProperty works there too;
    // this is the peer-uid SIMULATION and must stamp exactly the tuple the SIM /proc/net/tcp table maps.
    const s = req.socket as unknown as object;
    const stamp = (prop: string, val: string | number): void => {
      Object.defineProperty(s, prop, { value: val, writable: true, enumerable: true, configurable: true });
    };
    stamp('remoteAddress', '127.0.0.1'); stamp('localAddress', '127.0.0.1');
    stamp('localPort', DASH_PORT); stamp('remotePort', peerPortFor(Number.isInteger(uid) ? uid : -1));
  });
}

/** The daemon hosts no PTY — the closed unavailable capability, matching `p5FixtureServer.ts`. */
const BOOT_RUNTIME_CAPABILITIES = {
  pty: false as const,
  diagnostic: { reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-25T00:00:00.000Z' },
  localTranscripts: false,
};

/** A minimal, decoder-valid empty Inbox envelope (`src/lib/inboxClient.ts#decode` requires the exact-key
 *  four-source shape — no legacy two-source shape survives it). */
const BOOT_INBOX = {
  items: [] as unknown[],
  revision: 'e'.repeat(64),
  sources: {
    pr: { status: 'verified', revision: 'e'.repeat(64), verifiedAt: '2026-08-25T00:00:00.000Z' },
    escalation: { status: 'verified', revision: 'e'.repeat(64), verifiedAt: '2026-08-25T00:00:00.000Z' },
    deployment: { status: 'verified', revision: 'e'.repeat(64), verifiedAt: '2026-08-25T00:00:00.000Z' },
    assetPull: { status: 'verified', revision: 'e'.repeat(64), verifiedAt: '2026-08-25T00:00:00.000Z' },
  },
};

/**
 * The §8 two-daemon browser matrix [P6-C21] navigates a real Edge at each daemon's origin and asserts a
 * RENDERED app shell with 0 console errors. Before this, the fixture served ONLY `/api/v1` + node routes,
 * so `GET /` 404'd and no cell could ever reach the app. This registers the built SPA (`registerStatic`,
 * same production module `server/static/routes.ts#registerStatic` uses) plus every boot route the shell
 * fetches on load (`p5FixtureServer.ts`'s proven W6.5 boot-route set) — `/api/auth/context`,
 * `/api/runtime/capabilities`, `/api/home`, `/api/attention`, plus `/api/inbox`/`/api/health` (the
 * route-specific views) and `/events` SSE so no navigation 404s either. Registered on BOTH roles: each
 * daemon process is its own dashboard instance with its own local UI, exactly as `startFixtureDaemon`'s
 * per-role composition already gives each role its own port/origin.
 */
function registerShellAndBootRoutes(app: FastifyInstance): void {
  app.get('/api/auth/context', async () => ({ mode: 'tailnet' }));
  app.get('/api/runtime/capabilities', async () => BOOT_RUNTIME_CAPABILITIES);
  app.get('/api/home', async () => p2Home(false));
  app.get('/api/attention', async () => P2_ATTENTION);
  app.get('/api/inbox', async () => BOOT_INBOX);
  app.get('/api/health', async () => healthResponseFixture);
  app.get('/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const close = (): void => { if (!reply.raw.writableEnded) reply.raw.end(); };
    req.raw.on('close', close);
    req.raw.on('error', close);
  });
  // The built SPA shell (index.html + hashed assets), with the same GET-fallback-to-index.html behavior
  // production serves — registered last so it never shadows the explicit routes above or the node/operator
  // routes registered elsewhere in `composeDaemon`.
  registerStatic(app);
}

export function buildFixtureDaemon(opts: FixtureDaemonOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  composeDaemon(app, opts);
  return app;
}

/** A DesktopClient transport that makes a REAL HTTPS call to the VM operator read routes, carrying the
 *  operator bearer and the operator sim-peer-uid so the VM's operatorRouteOnlyGuard admits it. */
function makeVmTransport(vmOrigin: string): DesktopClientTransport {
  const port = Number(new URL(vmOrigin).port);
  return {
    async send(request) {
      const ca = readLoopbackCertificate(port);
      const { request: httpsRequest } = await import('node:https');
      const target = new URL(request.url);
      return await new Promise((resolveSend, rejectSend) => {
        const call = httpsRequest({
          host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`,
          method: request.method,
          headers: { ...request.headers, authorization: operatorBearer(), [SIM_PEER_UID_HEADER]: String(OPERATOR_UID) },
          ...(ca ? { ca } : {}),
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolveSend({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])),
            body: Buffer.concat(chunks).toString('utf8'),
          }));
        });
        call.on('error', rejectSend);
        if (request.body !== undefined) call.write(request.body);
        call.end();
      });
    },
  };
}

function sendRunRead(store: InMemoryPlacementStore, params: { runRef: string }, reply: import('fastify').FastifyReply): void {
  const run = store.runs.get(params.runRef);
  if (!run) { reply.code(404).send(v1Error('not-found', 'run not found', false)); return; }
  reply.code(200).send(v1Success('run', { runRef: run.runRef, host: run.host, terminalOutcome: run.terminalOutcome }, { etag: `run:${run.runRef}:${run.events.length}` }));
}
function sendRunEvents(store: InMemoryPlacementStore, params: { runRef: string }, reply: import('fastify').FastifyReply): void {
  const run = store.runs.get(params.runRef);
  if (!run) { reply.code(404).send(v1Error('not-found', 'run not found', false)); return; }
  reply.code(200).send(v1Success('run-events', { runRef: run.runRef, events: run.events }, { watermark: `events:${run.events.length}` }));
}
function sendRunGates(store: InMemoryPlacementStore, params: { runRef: string }, reply: import('fastify').FastifyReply): void {
  const run = store.runs.get(params.runRef);
  if (!run) { reply.code(404).send(v1Error('not-found', 'run not found', false)); return; }
  reply.code(200).send(v1Success('run-gates', { runRef: run.runRef, gates: run.gates }, { watermark: `gates:${run.gates.length}` }));
}

// -------------------------------------------------------------------------------------------------
// Serve one fixture daemon over loopback HTTPS.
// -------------------------------------------------------------------------------------------------
export interface RunningDaemon { app: FastifyInstance; origin: string; port: number; close(): Promise<void>; }

export async function startFixtureDaemon(opts: FixtureDaemonOptions & { port: number; https?: boolean }): Promise<RunningDaemon> {
  const tls = opts.https === false ? null : await createLoopbackTlsMaterial();
  // The `https` option yields a differently-parameterised Fastify server generic; the fixture only ever
  // treats it as a plain FastifyInstance (inject/listen/close/register), so normalise the type here.
  const app = (tls === null
    ? Fastify({ logger: false })
    : Fastify({ logger: false, https: { cert: tls.cert, key: tls.key } })) as unknown as FastifyInstance;
  // Rebuild the daemon routes onto this (possibly TLS) instance by delegating to buildFixtureDaemon's body:
  // simplest is to compose directly here by registering the built app as a plugin is not possible, so we
  // reuse buildFixtureDaemon to get an app and copy is not feasible — instead build directly on `app`.
  // Admit the daemon's ACTUAL listening origin in the node scope's origin guard — a real client's
  // `Host: 127.0.0.1:<port>` header must match the allowlist (the in-process inject path uses the fixed
  // 4317 origin instead). `opts.port` is the concrete CLI port; the composed routes are registered before
  // `listen`, so the allowlist is built from it here.
  const realHost = `127.0.0.1:${opts.port}`;
  composeDaemon(app, {
    ...opts,
    extraAllowedOrigins: [
      `http://${realHost}`, `https://${realHost}`, ...(opts.extraAllowedOrigins ?? []),
    ],
  });
  await app.listen({ host: '127.0.0.1', port: opts.port });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${port}`;
  if (tls !== null) publishLoopbackCertificate(port, tls.cert);
  return {
    app, origin, port,
    async close() { if (tls !== null) revokeLoopbackCertificate(port); await app.close(); },
  };
}

/** Compose the daemon routes onto a pre-created Fastify instance (so it can carry TLS). Mirrors
 *  {@link buildFixtureDaemon} exactly; the two share one body. */
function composeDaemon(app: FastifyInstance, opts: FixtureDaemonOptions): void {
  const map = opts.map ?? loadFixtureMap();
  const ctx = ctxFor(opts.store, map, opts);
  stampPeerHook(app);
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({ ok: true, role: opts.role }));
  registerShellAndBootRoutes(app);
  if (opts.role === 'vm') {
    registerV1NodeRoutes(app, ctx);
    app.register(async (scope) => {
      scope.addHook('preHandler', operatorRouteOnlyGuard(ctx));
      // GET /api/v1/runs — kind:'run-list' over the REAL signed opaque cursor codec [P6-C41]: the
      // watermark is the fixture store's run count, so scheduling a run advances it and stales any
      // cursor minted before (§9 stale-cursor).
      scope.get('/api/v1/runs', async (req, reply) => {
        const query = req.query as Record<string, unknown>;
        const watermark = String(opts.store.runs.size);
        let lastKey = '';
        if (typeof query.cursor === 'string') {
          const decoded = decodeCursor(query.cursor, RUN_LIST_CURSOR_SECRET, watermark);
          if (!decoded.ok) return reply.code(decoded.status).send(v1Error(decoded.code, decoded.code, decoded.retryable));
          if (decoded.payload.kind !== 'run-list') return reply.code(400).send(v1Error('cursor-malformed', 'cursor kind mismatch', false));
          lastKey = decoded.payload.lastKey;
        }
        const nextCursor = encodeCursor({ kind: 'run-list', watermark, filterHash: '', lastKey }, RUN_LIST_CURSOR_SECRET);
        reply.code(200).send(v1Success('run-list', { runs: [...opts.store.runs.keys()] }, { watermark, nextCursor }));
      });
      scope.get('/api/v1/runs/:runRef', async (req, reply) => sendRunRead(opts.store, req.params as { runRef: string }, reply));
      scope.get('/api/v1/runs/:runRef/events', async (req, reply) => sendRunEvents(opts.store, req.params as { runRef: string }, reply));
      scope.get('/api/v1/runs/:runRef/gates', async (req, reply) => sendRunGates(opts.store, req.params as { runRef: string }, reply));
      scope.post('/fixture/schedule-run', async (req, reply) => {
        const body = (req.body ?? {}) as { runRef?: string; host?: HostKind; requirement?: CapabilityRequirement };
        if (typeof body.runRef !== 'string' || (body.host !== 'vm' && body.host !== 'desktop') || body.requirement === undefined) {
          return reply.code(400).send(v1Error('bad-fixture-seed', 'runRef/host/requirement required', false));
        }
        opts.store.scheduleRun({ runRef: body.runRef, host: body.host, requirement: body.requirement });
        reply.code(201).send(v1Success('fixture-run', { runRef: body.runRef, host: body.host }, {}));
      });
      scope.post('/fixture/advertise-seed', async (req, reply) => {
        const body = (req.body ?? {}) as { advertisement?: unknown };
        try {
          const adv = decodeHostAdvertisement(body.advertisement);
          const current = await opts.store.currentVersion(adv.hostId);
          await opts.store.upsert(adv.hostId, adv, current);
          reply.code(200).send(v1Success('fixture-advertise', { hostId: adv.hostId }, {}));
        } catch (err) {
          reply.code(400).send(v1Error('bad-advertisement', err instanceof Error ? err.message : 'invalid', false));
        }
      });
    });
  }
  if (opts.role === 'desktop' && opts.vmOrigin !== undefined) {
    const client = createDesktopClient(`${opts.vmOrigin}/api/v1`, makeVmTransport(opts.vmOrigin));
    for (const suffix of ['events', 'gates'] as const) {
      app.get(`/api/v1/runs/:runRef/${suffix}`, async (req, reply) => {
        const runRef = (req.params as { runRef: string }).runRef;
        const forwarded = await forwardDesktopReadProxy(client, 'GET', `/api/v1/runs/${runRef}/${suffix}`);
        reply.code(forwarded.status);
        for (const [k, v] of Object.entries(forwarded.headers)) reply.header(k, v);
        reply.send(forwarded.body);
      });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// The two-daemon lifecycle wrapper (mirrors p3FixtureLifecycle for TWO children).
// -------------------------------------------------------------------------------------------------
export interface LifecycleChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}
export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;
export type ReadyProbe = (origin: string) => Promise<boolean>;

export interface TwoDaemonLifecycleOptions {
  vmCommand: readonly string[];
  desktopCommand: readonly string[];
  clientCommand: readonly string[];
  vmOrigin: string;
  desktopOrigin: string;
  readyTimeoutMs: number;
  shutdownTimeoutMs: number;
  readyIntervalMs?: number;
  spawn?: LifecycleSpawn;
  probe?: ReadyProbe;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onInterrupt?: (handler: () => void) => () => void;
  log?: (line: string) => void;
}

export type TwoDaemonOutcome =
  | { ok: true; exitCode: number; forcedKill: boolean }
  | { ok: false; reason: 'daemon-failed' | 'ready-timeout' | 'interrupted'; exitCode: number; forcedKill: boolean };

function defaultSpawn(command: string, args: readonly string[]): LifecycleChild {
  return spawn(command, [...args], { stdio: 'inherit', shell: false }) as unknown as LifecycleChild;
}
async function defaultReadyProbe(origin: string): Promise<boolean> {
  try {
    const port = Number(new URL(origin).port);
    const secure = origin.startsWith('https');
    const ca = secure ? readLoopbackCertificate(port) : null;
    if (secure && ca === null) return false;
    const mod = secure ? await import('node:https') : await import('node:http');
    return await new Promise<boolean>((resolveProbe) => {
      const req = mod.request(`${origin}/readyz`, { method: 'GET', ...(ca ? { ca } : {}) }, (res) => {
        res.resume();
        resolveProbe((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      });
      req.on('error', () => resolveProbe(false));
      req.end();
    });
  } catch { return false; }
}
function defaultOnInterrupt(handler: () => void): () => void {
  const wrapped = (): void => handler();
  process.once('SIGINT', wrapped); process.once('SIGTERM', wrapped);
  return () => { process.off('SIGINT', wrapped); process.off('SIGTERM', wrapped); };
}
function waitForExit(child: LifecycleChild): Promise<number> {
  return new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code ?? 1));
    child.once('error', () => resolveExit(1));
  });
}

/** Run the two-daemon lifecycle: start both, poll BOTH /readyz, run the client, then tear both down. */
export async function runTwoDaemonLifecycle(options: TwoDaemonLifecycleOptions): Promise<TwoDaemonOutcome> {
  const spawnChild = options.spawn ?? defaultSpawn;
  const probe = options.probe ?? defaultReadyProbe;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
  const now = options.now ?? Date.now;
  const registerInterrupt = options.onInterrupt ?? defaultOnInterrupt;
  const log = options.log ?? (() => {});
  const readyInterval = options.readyIntervalMs ?? 150;

  const [vmBin, ...vmArgs] = options.vmCommand;
  const [deskBin, ...deskArgs] = options.desktopCommand;
  const [clientBin, ...clientArgs] = options.clientCommand;
  if (vmBin === undefined || deskBin === undefined || clientBin === undefined) throw new Error('p6TwoDaemonFixture: empty command');

  let interrupted = false;
  const children: Array<{ child: LifecycleChild; exit: Promise<number>; alive: boolean }> = [];
  const startChild = (bin: string, args: readonly string[]) => {
    const child = spawnChild(bin, args);
    const rec = { child, exit: waitForExit(child), alive: true };
    void rec.exit.then(() => { rec.alive = false; });
    children.push(rec);
    return rec;
  };
  const vm = startChild(vmBin, vmArgs);
  const desktop = startChild(deskBin, deskArgs);
  const release = registerInterrupt(() => { interrupted = true; });

  let outcome: TwoDaemonOutcome | null = null;
  try {
    const readyBy = now() + options.readyTimeoutMs;
    for (const [rec, origin] of [[vm, options.vmOrigin], [desktop, options.desktopOrigin]] as const) {
      let ready = false;
      while (!ready) {
        if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
        if (!rec.alive) { log(`daemon exited before ready: ${origin}`); outcome = { ok: false, reason: 'daemon-failed', exitCode: 1, forcedKill: false }; return outcome; }
        ready = await probe(origin);
        if (ready) break;
        if (now() >= readyBy) { log(`daemon did not answer /readyz within ${options.readyTimeoutMs} ms: ${origin}`); outcome = { ok: false, reason: 'ready-timeout', exitCode: 1, forcedKill: false }; return outcome; }
        await sleep(readyInterval);
      }
    }
    if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
    const client = startChild(clientBin, clientArgs);
    const clientCode = await client.exit;
    if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
    outcome = { ok: true, exitCode: clientCode, forcedKill: false };
    return outcome;
  } finally {
    release();
    // Tear down ONLY the two daemon children (the client, index 2, has already exited on the happy path;
    // on an early return it may still be running, so include every started child).
    for (const rec of [vm, desktop]) {
      if (!rec.alive) continue;
      rec.child.kill('SIGTERM');
      const settled = await Promise.race([rec.exit.then(() => true), sleep(options.shutdownTimeoutMs).then(() => false)]);
      if (!settled) {
        log(`daemon did not stop within ${options.shutdownTimeoutMs} ms; force-killing pid ${rec.child.pid ?? -1}`);
        rec.child.kill('SIGKILL');
        if (outcome !== null) outcome.forcedKill = true;
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// The 21 in-process attack probes (§9). Each drives the REAL routes over `app.inject` with a simulated
// peer uid, and returns a pass/fail with a one-line assertion string. `--assert-isolated` is the default:
// every probe asserts the attack is refused before any state changes it should not.
// -------------------------------------------------------------------------------------------------
export const ATTACK_IDS = [
  'missing-auth', 'forged-proxy-header', 'forged-node-id', 'revoked-node-id', 'wrong-host-object',
  'operator-calls-daemon-route', 'host-attempts-human-response', 'wrong-kind-etag', 'stale-cursor',
  'changed-idempotency-replay', 'out-of-order-report', 'duplicate-completion', 'out-of-order-gate',
  'expired-lease', 'lease-theft', 'false-capability', 'stale-advertisement', 'split-brain',
  'oversized-unknown-input', 'node-flood', 'capability-loss',
] as const;
export type AttackId = (typeof ATTACK_IDS)[number];
export interface AttackProbeResult { passed: boolean; assertion: string; }

const DESKTOP_REQUIREMENT: CapabilityRequirement = {
  connectors: [{ server: 'browser', tools: ['screenshot'] }, { server: 'gmail', tools: ['search'] }],
  skills: [], filesystemRoots: [], pty: false, gpu: false, clis: ['claude'],
};
function desktopAdvertisement(now: string, connectors = DESKTOP_REQUIREMENT.connectors): HostAdvertisement {
  return {
    hostId: 'desktop', daemonVersion: 'desktop-1.0.0', reportedAt: now,
    connectors: connectors.map((c) => ({ server: c.server, tools: [...c.tools] })),
    skills: [], filesystemRoots: [], pty: false, gpu: false, clis: { claude: 'ready', codex: 'missing' },
  };
}
function nodeHeaders(nodeId: string, uid = NODE_PROXY_UID): Record<string, string> {
  return { host: `127.0.0.1:${DASH_PORT}`, 'tailscale-node-id': nodeId, [SIM_PEER_UID_HEADER]: String(uid), 'content-type': 'application/json' };
}
function opHeaders(uid = OPERATOR_UID): Record<string, string> {
  return { host: `127.0.0.1:${DASH_PORT}`, authorization: operatorBearer(), [SIM_PEER_UID_HEADER]: String(uid), 'content-type': 'application/json' };
}

/** Build a VM daemon + store seeded with a fresh desktop advertisement and one desktop-assigned run.
 *  The returned `clock` is mutable so a probe can advance the daemon's and store's shared clock. */
async function seededVm(start = new Date('2026-08-25T00:00:00.000Z')): Promise<{ app: FastifyInstance; store: InMemoryPlacementStore; clock: { current: Date }; }> {
  const clock = { current: start };
  const store = new InMemoryPlacementStore();
  store.now = () => clock.current.getTime();
  store.scheduleRun({ runRef: 'run-desk-1', host: 'desktop', requirement: DESKTOP_REQUIREMENT, createdAt: start.toISOString() });
  const app = buildFixtureDaemon({ role: 'vm', store, now: () => clock.current });
  await app.ready();
  await store.upsert('desktop', desktopAdvertisement(start.toISOString()), undefined);
  return { app, store, clock };
}

export async function runAttackProbe(caseId: string): Promise<AttackProbeResult> {
  const now = new Date('2026-08-25T00:00:00.000Z');
  const nowIso = now.toISOString();
  const pass = (assertion: string): AttackProbeResult => ({ passed: true, assertion });
  const fail = (assertion: string): AttackProbeResult => ({ passed: false, assertion });

  switch (caseId as AttackId) {
    case 'missing-auth': {
      const { app } = await seededVm(now);
      // No operator subject and no node header on a node route: peer uid 0 (operator) hits node-route-only.
      const r = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { host: `127.0.0.1:${DASH_PORT}`, [SIM_PEER_UID_HEADER]: String(OPERATOR_UID), 'content-type': 'application/json' }, payload: {} });
      await app.close();
      return r.statusCode === 403 && r.json().error.code === 'node-route-only' ? pass('operator peer on a node route is 403 node-route-only') : fail(`expected 403 node-route-only, got ${r.statusCode}`);
    }
    case 'forged-proxy-header': {
      // (a) dead proxy: the simulated 8444 listener answers 502 itself; no dashboard 503, 443 stays 200.
      const dead502 = simulateDeadProxyListener();
      const { app: up } = await seededVm(now);
      const r443 = await up.inject({ method: 'GET', url: '/readyz', headers: { host: `127.0.0.1:${DASH_PORT}` } });
      await up.close();
      // (b) dead shim: dashboard emits 503 node-attribution-unavailable.
      const store = new InMemoryPlacementStore(); store.now = () => now.getTime();
      const shimDown = buildFixtureDaemon({ role: 'vm', store, now: () => now, shimState: 'shim-down' });
      await shimDown.ready();
      const rShim = await shimDown.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: nodeHeaders('nodeDESK9'), payload: {} });
      await shimDown.close();
      const okA = dead502.status === 502 && !dead502.dashboardEmitted503 && r443.statusCode === 200;
      const okB = rShim.statusCode === 503 && rShim.json().error.code === 'node-attribution-unavailable';
      return okA && okB ? pass('dead proxy = 502 from listener, no dashboard 503, 443 = 200; dead shim = 503 node-attribution-unavailable') : fail(`step(a) ok=${okA} step(b) ok=${okB} (shim ${rShim.statusCode})`);
    }
    case 'forged-node-id': {
      const { app } = await seededVm(now);
      const r = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: nodeHeaders('strangerNODE'), payload: {} });
      await app.close();
      const body = JSON.stringify(r.json());
      return r.statusCode === 403 && !body.includes('nodeVM01') && !body.includes('nodeDESK9') ? pass('unknown node id is 403 and names no map contents') : fail(`got ${r.statusCode} ${body}`);
    }
    case 'revoked-node-id': {
      const { app } = await seededVm(now);
      const r = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/leases/renew', headers: nodeHeaders('oldNODE7'), payload: { expectedLeaseRevision: 1 } });
      await app.close();
      return r.statusCode === 403 && r.json().error.code === 'node-revoked' ? pass('a revoked node id is 403 node-revoked') : fail(`expected 403 node-revoked, got ${r.statusCode}`);
    }
    case 'wrong-host-object': {
      const { app } = await seededVm(now);
      // Desktop node advertising as vm: :hostId=vm disagrees with the map-derived desktop → 403 wrong-host.
      const r = await app.inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: nodeHeaders('nodeDESK9'), payload: {} });
      await app.close();
      return r.statusCode === 403 && r.json().error.code === 'wrong-host' ? pass('desktop node advertising as vm is 403 wrong-host') : fail(`expected 403 wrong-host, got ${r.statusCode}`);
    }
    case 'operator-calls-daemon-route': {
      const { app } = await seededVm(now);
      // An operator peer (uid 0) on a node route → node-route-only; the proxy uid on an operator route →
      // operator-route-only, INCLUDING on the shared /api/v1/runs/:runRef prefix.
      const rNode = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: opHeaders(OPERATOR_UID), payload: { waitMs: 0 } });
      const rShared = await app.inject({ method: 'GET', url: '/api/v1/runs/run-desk-1', headers: { host: `127.0.0.1:${DASH_PORT}`, authorization: operatorBearer(), [SIM_PEER_UID_HEADER]: String(NODE_PROXY_UID) } });
      await app.close();
      const okNode = rNode.statusCode === 403 && rNode.json().error.code === 'node-route-only';
      const okShared = rShared.statusCode === 403 && rShared.json().error.code === 'operator-route-only';
      return okNode && okShared ? pass('operator peer on node route = 403 node-route-only; proxy uid on shared operator prefix = 403 operator-route-only') : fail(`node ${rNode.statusCode} shared ${rShared.statusCode}`);
    }
    case 'host-attempts-human-response': {
      const { app, store } = await seededVm(now);
      await claimForDesktop(app, store);
      // A report payload carrying a decision/assertion field fails the exact-key wall 400 before any write.
      const r = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { decision: 'approve', assertion: 'x' } } });
      await app.close();
      return r.statusCode === 400 ? pass('a report carrying a decision/assertion field is 400 before any store write') : fail(`expected 400, got ${r.statusCode}`);
    }
    case 'wrong-kind-etag': {
      const { app } = await seededVm(now);
      // A Run-ETag string presented as the host If-Match is a foreign domain → 412, never silent success.
      await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeDESK9'), 'if-none-match': '*' }, payload: advertiseBody() });
      const r = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeDESK9'), 'if-match': 'run:run-desk-1:3' }, payload: advertiseBody() });
      await app.close();
      return r.statusCode === 412 ? pass('a foreign-domain (Run) ETag on the host precondition is 412') : fail(`expected 412, got ${r.statusCode}`);
    }
    case 'stale-cursor': {
      const { app, store } = await seededVm(now);
      // Mint a real nextCursor off the operator run-list read, then advance the run-list watermark
      // (schedule a new run) so the pinned cursor is now stale, and replay it.
      const first = await app.inject({ method: 'GET', url: '/api/v1/runs', headers: opHeaders(OPERATOR_UID) });
      const cursor = (first.json() as { meta: { nextCursor: string } }).meta.nextCursor;
      store.scheduleRun({ runRef: 'run-desk-2', host: 'desktop', requirement: DESKTOP_REQUIREMENT, createdAt: nowIso });
      const replay = await app.inject({ method: 'GET', url: `/api/v1/runs?cursor=${encodeURIComponent(cursor)}`, headers: opHeaders(OPERATOR_UID) });
      await app.close();
      return replay.statusCode === 409 && replay.json().error.code === 'cursor-stale' ? pass('a cursor whose watermark moved is 409 cursor-stale') : fail(`expected 409 cursor-stale, got ${replay.statusCode}`);
    }
    case 'changed-idempotency-replay': {
      const { app, store } = await seededVm(now);
      // The three node routes are accepted with NO Idempotency-Key; a replayed advertise is a no-op by CAS.
      const first = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeDESK9'), 'if-match': hostEtag(1) }, payload: advertiseBody() });
      const v1 = await store.currentVersion('desktop');
      const replay = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeDESK9'), 'if-match': hostEtag(1) }, payload: advertiseBody() });
      await app.close();
      // First advances the version (accepted, no key). Replay with the SAME stale If-Match is a 412 by CAS,
      // never a duplicate write, and never asked for a key.
      return first.statusCode === 200 && replay.statusCode === 412 && (v1 ?? 0) === 2 ? pass('advertise needs no Idempotency-Key; a replay is a no-op/412 by CAS, not by key') : fail(`first ${first.statusCode} replay ${replay.statusCode} v=${v1}`);
    }
    case 'out-of-order-report': {
      const { app, store } = await seededVm(now);
      await claimForDesktop(app, store);
      const r = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 5, kind: 'event', payload: {} } });
      await app.close();
      return r.statusCode === 409 && r.json().error.code === 'report-out-of-order' ? pass('sequence != last+1 is 409 report-out-of-order with no state change') : fail(`expected 409 report-out-of-order, got ${r.statusCode}`);
    }
    case 'duplicate-completion': {
      const { app, store } = await seededVm(now);
      await claimForDesktop(app, store);
      await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'completed', payload: {} } });
      const before = await store.getRunTerminalState('run-desk-1');
      const dup = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 2, kind: 'completed', payload: {} } });
      const after = await store.getRunTerminalState('run-desk-1');
      await app.close();
      return dup.statusCode === 409 && dup.json().error.code === 'run-already-terminal' && before.completedAt === after.completedAt ? pass('a second completed is 409 run-already-terminal and terminalOutcome is unchanged') : fail(`expected 409 run-already-terminal, got ${dup.statusCode}`);
    }
    case 'out-of-order-gate': {
      const { app, store } = await seededVm(now);
      await claimForDesktop(app, store);
      await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'failed', payload: {} } });
      const gateAfterTerminal = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/reports', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1, sequence: 2, kind: 'gate-opened', payload: {} } });
      await app.close();
      return gateAfterTerminal.statusCode === 409 && gateAfterTerminal.json().error.code === 'run-already-terminal' ? pass('a gate-opened report after the run is terminal is refused') : fail(`expected 409, got ${gateAfterTerminal.statusCode}`);
    }
    case 'expired-lease': {
      const { app, store, clock } = await seededVm(now);
      await claimForDesktop(app, store);
      // Move the shared clock past the lease TTL: a renew is 409 lease-expired, and the run is reclaimable
      // exactly once across the reclaim passes.
      const later = new Date(now.getTime() + LEASE_TTL_MS + 1000);
      clock.current = later;
      const renew = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/leases/renew', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1 } });
      const released1 = await store.releaseExpiredLeases(later.toISOString());
      const released2 = await store.releaseExpiredLeases(later.toISOString());
      await app.close();
      return renew.statusCode === 409 && renew.json().error.code === 'lease-expired' && released1.length + released2.length === 1 ? pass('renew past expiry is 409 lease-expired; the lease is released exactly once across reclaim passes') : fail(`renew ${renew.statusCode}, released ${released1.length}+${released2.length}`);
    }
    case 'lease-theft': {
      const { app, store } = await seededVm(now);
      // A VM-held lease renewed under the desktop node identity is 403 wrong-host even with a good revision.
      store.scheduleRun({ runRef: 'run-vm-1', host: 'vm', requirement: { connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [] }, createdAt: now.toISOString() });
      await store.upsert('vm', { hostId: 'vm', daemonVersion: 'vm-1.0.0', reportedAt: nowIso, connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: { claude: 'ready', codex: 'ready' } }, undefined);
      await store.createLease('run-vm-1', 'vm', capabilityHash({ connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [] }), nowIso);
      const r = await app.inject({ method: 'POST', url: '/api/v1/runs/run-vm-1/leases/renew', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1 } });
      await app.close();
      return r.statusCode === 403 && r.json().error.code === 'wrong-host' ? pass('renewing a VM-held lease under the desktop node is 403 wrong-host') : fail(`expected 403 wrong-host, got ${r.statusCode}`);
    }
    case 'false-capability': {
      const { app, store } = await seededVm(now);
      // A run requiring a capability the desktop advertisement cannot serve is never a claim candidate.
      store.scheduleRun({ runRef: 'run-gpu', host: 'desktop', requirement: { connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: true, clis: [] }, createdAt: '2026-08-24T00:00:00.000Z' });
      const claim = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } });
      await app.close();
      const claimed = claim.statusCode === 200 ? (claim.json().data.runRef as string) : null;
      return claimed !== 'run-gpu' ? pass('a run whose requirement the advertisement cannot serve is never claimed') : fail('the gpu run was claimed against a non-gpu advertisement');
    }
    case 'stale-advertisement': {
      const { app } = await seededVm(now);
      // Advance the clock past the freshness window without re-advertising: no candidate, 204 on claim.
      const later = new Date(now.getTime() + ADVERTISEMENT_FRESHNESS_MS + 1000);
      const claim = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: { ...nodeHeaders('nodeDESK9') }, payload: { waitMs: 0 } });
      // The claim above used the seeded (fresh) advertisement; a second daemon with a stale clock proves the
      // stale case deterministically.
      const store2 = new InMemoryPlacementStore(); store2.now = () => later.getTime();
      store2.scheduleRun({ runRef: 'run-desk-1', host: 'desktop', requirement: DESKTOP_REQUIREMENT, createdAt: now.toISOString() });
      await store2.upsert('desktop', desktopAdvertisement(now.toISOString()), undefined);
      const app2 = buildFixtureDaemon({ role: 'vm', store: store2, now: () => later });
      await app2.ready();
      const staleClaim = await app2.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } });
      await app.close(); await app2.close();
      return claim.statusCode === 200 && staleClaim.statusCode === 204 ? pass('a fresh advertisement is claimable; one past the 90s freshness window yields 204 (no candidate)') : fail(`fresh ${claim.statusCode} stale ${staleClaim.statusCode}`);
    }
    case 'split-brain': {
      const { app, store } = await seededVm(now);
      // Two concurrent claims for the same run: exactly one lease row, one winner.
      const [a, b] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } }),
        app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } }),
      ]);
      const lease = await store.getLease('run-desk-1');
      await app.close();
      const winners = [a, b].filter((r) => r.statusCode === 200).length;
      return winners === 1 && lease !== undefined && lease.revision === 1 ? pass('two concurrent claims produce exactly one lease row and one winner') : fail(`winners=${winners}`);
    }
    case 'oversized-unknown-input': {
      const { app } = await seededVm(now);
      // Unknown key in a claim body → 400 unknown-key before any store read.
      const unknown = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0, wat: 1 } });
      // Oversized advertisement (>64 connectors) → 413, not truncated.
      const tooMany = Array.from({ length: 65 }, (_, i) => ({ server: `srv${String(i).padStart(3, '0')}`, tools: [] }))
        .sort((x, y) => x.server.localeCompare(y.server));
      const oversized = await app.inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeDESK9'), 'if-none-match': '*' }, payload: { ...advertiseBody(), connectors: tooMany } });
      await app.close();
      return unknown.statusCode === 400 && oversized.statusCode === 413 ? pass('an unknown key is 400 before any store read; an over-bound advertisement is 413, not truncated') : fail(`unknown ${unknown.statusCode} oversized ${oversized.statusCode}`);
    }
    case 'node-flood': {
      const { app } = await seededVm(now);
      // Drive writes ABOVE the node scope's coarse budget (90/min): the flood is 429 for the node, and an
      // operator read on the daemon (its own separate bucket, unmetered in this fixture) is unaffected.
      const codes: number[] = [];
      for (let i = 0; i < 110; i += 1) {
        const r = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } });
        codes.push(r.statusCode);
      }
      const operator = await app.inject({ method: 'GET', url: '/api/v1/runs/run-desk-1', headers: opHeaders(OPERATOR_UID) });
      await app.close();
      const throttled = codes.filter((c) => c === 429).length;
      return throttled > 0 && operator.statusCode !== 429 ? pass('a node flooded above its budget gets 429 for that node only; the operator surface stays responsive') : fail(`throttled=${throttled} operator=${operator.statusCode}`);
    }
    case 'capability-loss': {
      const { app, store } = await seededVm(now);
      await claimForDesktop(app, store);
      // Re-advertise WITHOUT the gmail/browser connectors the live lease requires → next renew 409.
      await store.upsert('desktop', desktopAdvertisement(nowIso, []), await store.currentVersion('desktop'));
      const renew = await app.inject({ method: 'POST', url: '/api/v1/runs/run-desk-1/leases/renew', headers: nodeHeaders('nodeDESK9'), payload: { expectedLeaseRevision: 1 } });
      await app.close();
      return renew.statusCode === 409 && renew.json().error.code === 'capability-lost' ? pass('re-advertising without a required capability yields 409 capability-lost on renew') : fail(`expected 409 capability-lost, got ${renew.statusCode}`);
    }
    default:
      return fail(`unknown attack id: ${caseId}`);
  }
}

/** A simulated dead-proxy 8444 listener: `tailscale serve` answers its OWN 502 and nothing reaches the
 *  dashboard, so no dashboard 503 is emitted [P6-C70]. */
export function simulateDeadProxyListener(): { status: number; dashboardEmitted503: boolean } {
  return { status: 502, dashboardEmitted503: false };
}

function advertiseBody(): Record<string, unknown> {
  return { daemonVersion: 'desktop-1.0.0', reportedAt: '2026-08-25T00:00:00.000Z', connectors: DESKTOP_REQUIREMENT.connectors.map((c) => ({ server: c.server, tools: [...c.tools] })), skills: [], filesystemRoots: [], pty: false, gpu: false, clis: { claude: 'ready', codex: 'missing' } };
}
function hostEtag(version: number): string { return `host:desktop:${version}`; }
async function claimForDesktop(app: FastifyInstance, store: InMemoryPlacementStore): Promise<void> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/hosts/desktop/leases/claim', headers: nodeHeaders('nodeDESK9'), payload: { waitMs: 0 } });
  if (r.statusCode !== 200) throw new Error(`claimForDesktop failed: ${r.statusCode} ${r.body}`);
  void store;
}

// -------------------------------------------------------------------------------------------------
// CLI dispatch: --daemon | --attack | lifecycle.
// -------------------------------------------------------------------------------------------------
export interface DaemonCliArgs { role: DaemonRole; port: number; https: boolean; vmOrigin?: string; nodeMap?: string; nowIso: string; }

/** The deterministic fixture epoch. The two-daemon scenario driver seeds advertisements/runs stamped at
 *  this instant, so the CLI daemon runs its clock here (not real wall-clock time) — otherwise a midnight-
 *  stamped advertisement is already past the 90-s freshness window by the time a real claim arrives and
 *  every claim answers 204. The in-process (`buildFixtureDaemon`) attack/scenario tests already pin this
 *  same instant via an explicit `now`; this makes the real-socket CLI match them. Overridable per run. */
export const FIXTURE_CLOCK_ISO = '2026-08-25T00:00:00.000Z';

export function parseDaemonArgs(argv: readonly string[]): DaemonCliArgs {
  let role: DaemonRole | null = null;
  let port: number | null = null;
  let https = false;
  let vmOrigin: string | undefined;
  let nodeMap: string | undefined;
  let nowIso = FIXTURE_CLOCK_ISO;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]; const value = argv[i + 1];
    const need = (): string => { if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`); i += 1; return value; };
    switch (arg) {
      case '--daemon': break;
      case '--role': { const v = need(); if (v !== 'vm' && v !== 'desktop') throw new Error('--role must be vm|desktop'); role = v; break; }
      case '--port': port = Number.parseInt(need(), 10); break;
      case '--https': https = true; break;
      case '--vm-origin': vmOrigin = need(); break;
      case '--node-map': nodeMap = need(); break;
      case '--now-iso': { const v = need(); if (Number.isNaN(Date.parse(v))) throw new Error('--now-iso must be an ISO instant'); nowIso = v; break; }
      default: throw new Error(`p6TwoDaemonFixture daemon: unknown flag ${arg}`);
    }
  }
  if (role === null) throw new Error('--role is required');
  if (port === null || !Number.isInteger(port)) throw new Error('--port is required');
  return { role, port, https, vmOrigin, nodeMap, nowIso };
}

export interface LifecycleCliArgs {
  vmPort: number; desktopPort: number; https: boolean; nodeMap: string;
  readyTimeoutMs: number; shutdownTimeoutMs: number; clientCommand: string[];
}

export function parseLifecycleArgs(argv: readonly string[]): LifecycleCliArgs {
  const separator = argv.indexOf('--');
  if (separator === -1) throw new Error('p6TwoDaemonFixture: missing `--` before the client command');
  const head = argv.slice(0, separator);
  const clientCommand = argv.slice(separator + 1);
  if (clientCommand.length === 0) throw new Error('p6TwoDaemonFixture: the client command is empty');
  let vmPort: number | null = null; let desktopPort: number | null = null; let https = false;
  let nodeMap = DEFAULT_NODE_MAP_PATH; let readyTimeoutMs = 10_000; let shutdownTimeoutMs = 5_000;
  for (let i = 0; i < head.length; i += 1) {
    const arg = head[i]; const value = head[i + 1];
    const need = (): string => { if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`); i += 1; return value; };
    switch (arg) {
      case '--vm-port': vmPort = Number.parseInt(need(), 10); break;
      case '--desktop-port': desktopPort = Number.parseInt(need(), 10); break;
      case '--https': https = true; break;
      case '--node-map': nodeMap = need(); break;
      case '--ready-timeout-ms': readyTimeoutMs = Number.parseInt(need(), 10); break;
      case '--shutdown-timeout-ms': shutdownTimeoutMs = Number.parseInt(need(), 10); break;
      default: throw new Error(`p6TwoDaemonFixture: unknown flag ${arg}`);
    }
  }
  if (vmPort === null || desktopPort === null) throw new Error('--vm-port and --desktop-port are required');
  return { vmPort, desktopPort, https, nodeMap, readyTimeoutMs, shutdownTimeoutMs, clientCommand: [...clientCommand] };
}

async function mainDaemon(args: DaemonCliArgs): Promise<void> {
  const clockMs = Date.parse(args.nowIso);
  const store = new InMemoryPlacementStore();
  // Pin BOTH the store clock and the daemon (ctx) clock to the fixture epoch so a scenario's midnight-
  // stamped advertisement is still inside the freshness window when a real claim arrives (see FIXTURE_CLOCK_ISO).
  store.now = () => clockMs;
  const map = args.nodeMap ? loadFixtureMap(args.nodeMap) : loadFixtureMap();
  const running = await startFixtureDaemon({
    role: args.role, store, map, port: args.port, https: args.https, now: () => new Date(clockMs),
    ...(args.vmOrigin ? { vmOrigin: args.vmOrigin } : {}),
  });
  process.stderr.write(`[p6-daemon:${args.role}] ${running.origin}\n`);
  const shutdown = (): void => { void running.close().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

async function mainAttack(caseId: string, artifactDir: string): Promise<void> {
  const result = await runAttackProbe(caseId);
  const dir = resolve(artifactDir);
  mkdirSync(dir, { recursive: true });
  const artifactPath = join(dir, `${caseId}.json`);
  writeFileSync(artifactPath, `${JSON.stringify({ id: caseId, passed: result.passed, assertion: result.assertion, artifactPath }, null, 2)}\n`);
  if (!result.passed) { process.stderr.write(`[p6-attack] FAILED ${caseId}: ${result.assertion}\n`); process.exitCode = 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  (async () => {
    if (argv.includes('--daemon')) {
      await mainDaemon(parseDaemonArgs(argv));
      return;
    }
    const attackIdx = argv.indexOf('--attack');
    if (attackIdx !== -1) {
      const caseId = argv[attackIdx + 1];
      const dirIdx = argv.indexOf('--artifact-dir');
      const artifactDir = dirIdx !== -1 ? argv[dirIdx + 1]! : '.artifacts/p6-attacks';
      if (caseId === undefined) throw new Error('--attack needs an id');
      await mainAttack(caseId, artifactDir);
      return;
    }
    // Lifecycle: spawn two --daemon children of THIS file, then the client after `--`.
    const parsed = parseLifecycleArgs(argv);
    const self = fileURLToPath(import.meta.url);
    const vmOrigin = `${parsed.https ? 'https' : 'http'}://127.0.0.1:${parsed.vmPort}`;
    const desktopOrigin = `${parsed.https ? 'https' : 'http'}://127.0.0.1:${parsed.desktopPort}`;
    const vmCommand = [process.execPath, self, '--daemon', '--role', 'vm', '--port', String(parsed.vmPort), '--node-map', parsed.nodeMap, ...(parsed.https ? ['--https'] : [])];
    const desktopCommand = [process.execPath, self, '--daemon', '--role', 'desktop', '--port', String(parsed.desktopPort), '--node-map', parsed.nodeMap, '--vm-origin', vmOrigin, ...(parsed.https ? ['--https'] : [])];
    const outcome = await runTwoDaemonLifecycle({
      vmCommand, desktopCommand, clientCommand: parsed.clientCommand, vmOrigin, desktopOrigin,
      readyTimeoutMs: parsed.readyTimeoutMs, shutdownTimeoutMs: parsed.shutdownTimeoutMs,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    process.exitCode = outcome.exitCode;
  })().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

// Keep `dirname`/`createHash` imports meaningful for downstream fixtures re-exporting from here.
export const _fixtureModuleDir = dirname(fileURLToPath(import.meta.url));
export function _hashId(...parts: string[]): string { return createHash('sha256').update(parts.join('\u0000')).digest('hex'); }
