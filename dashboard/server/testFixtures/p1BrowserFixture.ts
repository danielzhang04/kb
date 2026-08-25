import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthResponseFixture } from '../health/__fixtures__/health.ts';
import type { HealthResponse } from '../health/service.ts';
import { inboxFixtureData, type InboxFixtureScenario } from '../inbox/fixture.ts';
import {
  isP2BrowserScenario,
  isP3BrowserScenario,
  P2_ATTENTION,
  P2_BROWSER_SCENARIOS,
  P2_SCHEDULE,
  P2_SCHEDULE_COLLECTION,
  P3_BROWSER_PRINCIPALS,
  P3_BROWSER_SCENARIOS,
  p2EntityDetail,
  p2EntityList,
  p2Home,
  p2RunDetail,
  p2RunEvents,
  p3AttemptSessions,
  p3ControlsSession,
  p3PtyCapability,
  p3SessionListing,
} from './p2BrowserFixtureData.ts';
import { BROWSER_SESSION_COOKIE_NAME, parseBrowserSessionCookie } from '../auth/browserSessionRef.ts';
import {
  createLoopbackTlsMaterial, publishLoopbackCertificate, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';

export const P1_BROWSER_SCENARIOS = [
  'inbox-populated',
  'inbox-empty',
  'inbox-error-after-success',
  'events-reconnect-unknown',
  'health-reader-error',
  ...P2_BROWSER_SCENARIOS,
  ...P3_BROWSER_SCENARIOS,
] as const;

export type P1BrowserScenario = (typeof P1_BROWSER_SCENARIOS)[number];

export interface P1BrowserFixtureState {
  inboxRequests: number;
  inboxInFlight: number;
  maxInboxInFlight: number;
  eventConnections: number;
  eventFrames: number;
  unknownEventFrames: number;
  runStopRequests: number;
}

export interface P1BrowserFixture {
  address: { host: '127.0.0.1'; port: number };
  origin: string;
  state: P1BrowserFixtureState;
  /** The PEM a client pins to reach an HTTPS fixture; null when serving plain HTTP. */
  certificate: string | null;
  /**
   * The two URLs the §8 controller-isolation matrix opens, each carrying the ref that context should
   * hold. Visiting one sets that context's `Secure` cookie and nothing else — there is no way to hand a
   * browser a ref other than by visiting its own URL.
   */
  contextUrls: { a: string; b: string };
  releaseInbox(): void;
  close(): Promise<void>;
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface P1BrowserFixtureOptions {
  scenario: P1BrowserScenario;
  distDir?: string;
  host?: string;
  port?: number;
  /** Serve TLS with a per-process self-signed loopback certificate (see `p3LoopbackTls.ts`). */
  https?: boolean;
}

/**
 * The fixture daemon hosts no PTY, so it publishes the closed unavailable capability with a fixed
 * `checkedAt` — the browser decoder refuses a bare boolean, and the fixture must not be the one
 * payload that still ships one.
 */
const FIXTURE_RUNTIME_CAPABILITIES = {
  pty: false as const,
  diagnostic: {
    reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-22T00:00:00.000Z',
  },
  localTranscripts: false,
};

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function isScenario(value: string): value is P1BrowserScenario {
  return P1_BROWSER_SCENARIOS.includes(value as P1BrowserScenario);
}

function json(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  reply.end(JSON.stringify(body));
}

function degradedHealth(): HealthResponse {
  const health = structuredClone(healthResponseFixture);
  health.sections[0].rows = [{
    kind: 'unavailable', key: 'error:fleet', label: 'Unavailable',
    value: { status: 'unavailable', reason: 'Reader unavailable' },
    observedAt: '2026-08-21T12:00:00.000Z', source: 'error',
  }];
  return health;
}

function safeStaticFile(distDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded === '/') decoded = '/index.html';
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.split('/').includes('..')) return null;
  const root = resolve(distDir);
  const target = resolve(root, decoded.slice(1));
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/** Start the bounded, read-only P1 browser harness. This module is never registered by production. */
export async function startP1BrowserFixture(options: P1BrowserFixtureOptions): Promise<P1BrowserFixture> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('P1 browser fixture must bind exactly 127.0.0.1');
  if (!isScenario(options.scenario as string)) throw new Error(`Unknown scenario: ${String(options.scenario)}`);
  const port = options.port ?? 4317;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${String(port)}`);
  const distDir = resolve(options.distDir ?? fileURLToPath(new URL('../../dist', import.meta.url)));
  if (!existsSync(resolve(distDir, 'index.html'))) throw new Error(`Built dashboard is missing at ${distDir}`);

  const state: P1BrowserFixtureState = {
    inboxRequests: 0,
    inboxInFlight: 0,
    maxInboxInFlight: 0,
    eventConnections: 0,
    eventFrames: 0,
    unknownEventFrames: 0,
    runStopRequests: 0,
  };
  // The P2 and P3 scenarios drive their own surfaces; the inbox is background for them.
  const inboxScenario: InboxFixtureScenario =
    isP2BrowserScenario(options.scenario) || isP3BrowserScenario(options.scenario)
      ? 'inbox-empty'
      : options.scenario === 'health-reader-error' ? 'inbox-populated' : options.scenario;
  const inboxData = inboxFixtureData(inboxScenario);
  const pendingInbox = new Set<() => void>();
  const streams = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;
  const schedules = [structuredClone(P2_SCHEDULE)] as Array<Record<string, any>>;
  let scheduleCollectionRevision = P2_SCHEDULE_COLLECTION.scheduleCollectionRevision;
  const scheduleReplays = new Map<string, Record<string, any>>();
  const detail = structuredClone(p2RunDetail(
    isP2BrowserScenario(options.scenario) ? options.scenario : 'p2-run-actions',
  )) as Record<string, any>;
  const runActionReplays = new Map<string, Record<string, any>>();
  let attached = true;
  let copied = false;
  if (options.scenario === 'p2-gate-dedupe-t3') {
    const ordinary = structuredClone(detail.value.humanRequests[0]);
    Object.assign(ordinary, {
      requestRef: 'request-ordinary', kind: 'input', title: 'Provide ordinary input',
      prompt: 'Provide the next bounded input.', ask: 'What should the run do next?',
    });
    detail.value.humanRequests.push(ordinary);
  }

  const later = (callback: () => void, delay: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  const releasePendingInbox = (): void => {
    for (const release of pendingInbox) release();
    pendingInbox.clear();
  };

  const p3Scenario = isP3BrowserScenario(options.scenario) ? options.scenario : null;
  const attemptSessions = p3AttemptSessions();
  let claimedAttemptRef: string | null = null;
  let runVersion = 3;

  const handler = async (request: IncomingMessage, reply: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    // The bounded lifecycle wrapper polls this before it starts any client. It is deliberately the
    // cheapest possible answer: a fixture that can route at all is ready.
    if (url.pathname === '/readyz') {
      reply.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      reply.end(JSON.stringify({ ok: true, scenario: options.scenario }));
      return;
    }

    if (p3Scenario) {
      const presented = parseBrowserSessionCookie(
        Array.isArray(request.headers.cookie) ? request.headers.cookie[0] : request.headers.cookie,
      );

      // Two entry points, one per browser context. Each sets ONLY its own ref, so the matrix cannot
      // accidentally give both tabs the same identity.
      const contextEntry = url.pathname.match(/^\/fixture\/context-(a|b)$/);
      if (request.method === 'GET' && contextEntry) {
        const ref = contextEntry[1] === 'a'
          ? P3_BROWSER_PRINCIPALS.a.browserSessionRef
          : P3_BROWSER_PRINCIPALS.b.browserSessionRef;
        reply.writeHead(302, {
          location: '/',
          'set-cookie': `${BROWSER_SESSION_COOKIE_NAME}=${ref}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
          'cache-control': 'no-store',
        });
        reply.end();
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/pty/sessions') {
        json(reply, 200, p3SessionListing(p3Scenario, presented));
        return;
      }
      const sessionPath = url.pathname.match(/^\/api\/pty\/sessions\/([^/]+)$/);
      if (request.method === 'DELETE' && sessionPath) {
        const sessionId = decodeURIComponent(sessionPath[1]);
        // A stranger gets 404, never 403: the refusal must not confirm that the session exists.
        json(reply, p3ControlsSession(sessionId, presented) ? 200 : 404,
          p3ControlsSession(sessionId, presented) ? { ok: true } : { error: 'not-found' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/control/runs/run-fixture/sessions') {
        json(reply, 200, {
          runVersion,
          sessions: attemptSessions.map((row) => ({
            ...row,
            controllerClaimed: row.attemptRef === claimedAttemptRef,
          })),
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/control/runs/run-fixture/claim') {
        const body = await requestJson(request);
        const live = attemptSessions.find((row) => row.liveControl);
        if (!live || body.sessionId !== live.sessionId) {
          json(reply, 404, { error: 'not-found' });
          return;
        }
        if (body.expectedRunVersion !== runVersion) {
          json(reply, 409, { error: 'stale-run-version' });
          return;
        }
        claimedAttemptRef = live.attemptRef;
        runVersion += 1;
        json(reply, 200, { revision: runVersion, sessionId: live.sessionId, replayed: false });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runtime/capabilities') {
        json(reply, 200, { ...p3PtyCapability(p3Scenario), localTranscripts: false });
        return;
      }

      // The §8 matrix boots the WHOLE app, not just the terminal, so the app shell's own boot fetches
      // have to be served here too. Without them every p3 cell logs two 404s and the "zero console
      // errors" row can never be honestly green. The payloads are the p2 ones: the shell is not what
      // the p3 scenarios vary, so the matrix wants a shell that renders rather than a bespoke one.
      if (request.method === 'GET' && url.pathname === '/api/attention') return json(reply, 200, P2_ATTENTION);
      if (request.method === 'GET' && url.pathname === '/api/home') return json(reply, 200, p2Home(false));
      // The run's attempt sessions live in the Workflows destination, which the operator reaches
      // through the workflow roster. There is no `run:` URL entity (see src/nav/stack.ts), so the
      // §8 run scenario navigates the roster and the roster has to be served.
      if (request.method === 'GET' && url.pathname === '/api/agents') return json(reply, 200, p2EntityList('agents'));
      if (request.method === 'GET' && url.pathname === '/api/workflows') return json(reply, 200, p2EntityList('workflows'));
      const p3Entity = url.pathname.match(/^\/api\/(agents|workflows)\/([^/]+)$/);
      if (request.method === 'GET' && p3Entity) {
        return json(reply, 200, p2EntityDetail(p3Entity[1] as 'agents' | 'workflows', decodeURIComponent(p3Entity[2])));
      }
    }

    if (isP2BrowserScenario(options.scenario)) {
      if (request.method === 'GET' && url.pathname === '/api/agents') return json(reply, 200, p2EntityList('agents'));
      if (request.method === 'GET' && url.pathname === '/api/workflows') return json(reply, 200, p2EntityList('workflows'));
      const entity = url.pathname.match(/^\/api\/(agents|workflows)\/([^/]+)$/);
      if (request.method === 'GET' && entity) {
        return json(reply, 200, p2EntityDetail(entity[1] as 'agents' | 'workflows', decodeURIComponent(entity[2])));
      }
      if (request.method === 'GET' && url.pathname === '/api/attention') return json(reply, 200, P2_ATTENTION);
      if (request.method === 'GET' && url.pathname === '/api/home') {
        return json(reply, 200, p2Home(options.scenario === 'p2-home-partial-failure'));
      }
      if (request.method === 'GET' && url.pathname === '/api/schedules') {
        return options.scenario === 'p2-schedule-load-error'
          ? json(reply, 503, { error: 'schedule-store-unavailable' })
          : json(reply, 200, { scheduleCollectionRevision, rows: schedules });
      }
      if (request.method === 'POST' && url.pathname === '/api/schedules') {
        const body = await requestJson(request);
        if (!body.cadence || typeof body.idempotencyKey !== 'string') {
          return json(reply, 400, { error: 'invalid-cadence' });
        }
        const replay = scheduleReplays.get(body.idempotencyKey);
        if (replay) return json(reply, 200, { ...replay, replayed: true });
        if (body.expectedCollectionRevision !== scheduleCollectionRevision) {
          return json(reply, 409, { error: 'stale-schedule-collection-revision' });
        }
        const created = {
          ...structuredClone(P2_SCHEDULE), id: 'b'.repeat(64), armed: false, version: 1,
          cadence: typeof body.cadence === 'object' && body.cadence !== null && 'words' in body.cadence
            ? { source: String(body.cadence.words), words: String(body.cadence.words) }
            : structuredClone(P2_SCHEDULE.cadence),
        };
        schedules.push(created);
        scheduleCollectionRevision += 1;
        const receipt = { schedule: created, collectionRevision: scheduleCollectionRevision, replayed: false };
        scheduleReplays.set(body.idempotencyKey, receipt);
        return json(reply, 200, receipt);
      }
      const scheduleAction = url.pathname.match(/^\/api\/schedules\/([^/]+)\/(arm|disarm)$/);
      if (request.method === 'POST' && scheduleAction) {
        const body = await requestJson(request);
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
        const replay = scheduleReplays.get(idempotencyKey);
        if (replay) return json(reply, 200, { ...replay, replayed: true });
        const row = schedules.find((candidate) => candidate.id === decodeURIComponent(scheduleAction[1]));
        if (!row || body.expectedVersion !== row.version || body.armed !== (scheduleAction[2] === 'arm')) {
          return json(reply, 409, { error: 'stale-schedule-version' });
        }
        row.armed = scheduleAction[2] === 'arm';
        row.version += 1;
        scheduleCollectionRevision += 1;
        const receipt = { schedule: structuredClone(row), collectionRevision: scheduleCollectionRevision, replayed: false };
        if (idempotencyKey) scheduleReplays.set(idempotencyKey, receipt);
        return json(reply, 200, receipt);
      }
      const scheduleDelete = url.pathname.match(/^\/api\/schedules\/([^/]+)$/);
      if (request.method === 'DELETE' && scheduleDelete) {
        const body = await requestJson(request);
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
        const replay = scheduleReplays.get(idempotencyKey);
        if (replay) return json(reply, 200, { ...replay, replayed: true });
        const id = decodeURIComponent(scheduleDelete[1]);
        const index = schedules.findIndex((candidate) => candidate.id === id);
        if (index < 0 || body.expectedVersion !== schedules[index].version) {
          return json(reply, 409, { error: 'stale-schedule-version' });
        }
        const [deleted] = schedules.splice(index, 1);
        scheduleCollectionRevision += 1;
        const receipt = {
          tombstone: { id, deletedAt: '2026-08-21T12:01:00.000Z', version: deleted.version + 1 },
          collectionRevision: scheduleCollectionRevision, replayed: false,
        };
        if (idempotencyKey) scheduleReplays.set(idempotencyKey, receipt);
        return json(reply, 200, receipt);
      }
      if (request.method === 'GET' && url.pathname === '/api/control/runs/run-fixture') {
        return json(reply, 200, detail);
      }
      if (request.method === 'POST' && url.pathname === '/api/control/human-requests/request-t3/respond') {
        return json(reply, 403, { error: 'ceremony-unavailable' });
      }
      // P5-C38 — a DISTINCT deployment T3 endpoint that refuses the SAME `ceremony-unavailable` code
      // without a ceremony. It is a separate route from the human-request one above; each answers on its
      // own path and neither affects the other, so the shared refusal code is proven to be two routes
      // rather than one. (The P1 human-request route and its test at :196 stay unchanged.)
      if (request.method === 'POST' && /^\/api\/inbox\/deployment\/[^/]+\/deploy$/.test(url.pathname)) {
        return json(reply, 403, { error: 'ceremony-unavailable' });
      }
      if (request.method === 'POST' && url.pathname === '/api/control/human-requests/request-ordinary/respond') {
        const body = await requestJson(request);
        const ordinary = detail.value.humanRequests.find((candidate: Record<string, unknown>) =>
          candidate.requestRef === 'request-ordinary');
        if (!ordinary) return json(reply, 404, { error: 'not-found' });
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
        const replay = runActionReplays.get(idempotencyKey);
        if (replay) return json(reply, 200, { ...replay, replayed: true });
        if (body.expectedRevision !== ordinary.revision) return json(reply, 409, { error: 'stale-request-revision' });
        ordinary.state = 'resolved';
        ordinary.revision += 1;
        ordinary.response = {
          requestRevision: body.expectedRevision, decision: body.decision,
          response: typeof body.response === 'string' ? body.response : null, respondedAt: '2026-08-21T12:02:00.000Z',
        };
        ordinary.updatedAt = '2026-08-21T12:02:00.000Z';
        detail.value.run.version += 1;
        const receipt = { ok: true, value: structuredClone(ordinary), replayed: false };
        if (idempotencyKey) runActionReplays.set(idempotencyKey, receipt);
        return json(reply, 200, receipt);
      }
      const runAction = url.pathname.match(/^\/api\/control\/runs\/run-fixture\/(?:manager\/)?(reattach|detach|copy|stop)$/);
      if (request.method === 'POST' && runAction) {
        const action = runAction[1];
        const body = await requestJson(request);
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
        const replay = runActionReplays.get(idempotencyKey);
        if (replay) return json(reply, 200, { ...replay, replayed: true });
        if (action === 'stop') state.runStopRequests += 1;
        if (detail.value.run.state === 'stopped'
          || (body.expectedRunVersion !== undefined && body.expectedRunVersion !== detail.value.run.version)) {
          return json(reply, 409, { error: 'stale-run-version' });
        }
        if (action === 'reattach') attached = true;
        if (action === 'detach') attached = false;
        if (action === 'copy') copied = true;
        detail.value.run.version += 1;
        if (action === 'stop') detail.value.run.state = 'stopped';
        const receipt = action === 'stop'
          ? { state: 'stopped', stoppedSessionRefs: [], interruptedSessionRefs: [], replayed: false }
          : { action, state: detail.value.run.state, attached, copied, version: detail.value.run.version, replayed: false };
        if (idempotencyKey) runActionReplays.set(idempotencyKey, receipt);
        return json(reply, 200, receipt);
      }
      if (request.method === 'GET' && url.pathname === '/api/control/runs/run-fixture/events/stream') {
        const headerCursor = Array.isArray(request.headers['last-event-id'])
          ? request.headers['last-event-id'][0] : request.headers['last-event-id'];
        const after = Math.max(Number(url.searchParams.get('after') ?? 0), Number(headerCursor ?? 0));
        const page = p2RunEvents(
          url.searchParams.get('stageRef'), Number.isSafeInteger(after) ? after : 0, 250,
          options.scenario === 'p2-stream-reconnect-goldens',
        );
        reply.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        for (const event of page.items) {
          reply.write(`id: ${event.cursor}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`);
        }
        reply.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/control/runs/run-fixture/events') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 250);
        return json(reply, 200, p2RunEvents(
          url.searchParams.get('stageRef'), Number.isSafeInteger(after) ? after : 0,
          Number.isSafeInteger(limit) && limit > 0 ? limit : 250,
          options.scenario === 'p2-stream-reconnect-goldens',
        ));
      }
    }

    if (request.method !== 'GET') return json(reply, 404, { error: 'not found' });

    if (url.pathname === '/api/auth/context') return json(reply, 200, { mode: 'tailnet' });
    if (url.pathname === '/api/runtime/capabilities') return json(reply, 200, FIXTURE_RUNTIME_CAPABILITIES);

    if (url.pathname === '/api/inbox') {
      state.inboxRequests += 1;
      state.inboxInFlight += 1;
      state.maxInboxInFlight = Math.max(state.maxInboxInFlight, state.inboxInFlight);
      let settled = false;
      const finish = (status: number, body: unknown): void => {
        if (settled) return;
        settled = true;
        state.inboxInFlight -= 1;
        json(reply, status, body);
      };
      reply.once('close', () => {
        if (!settled) {
          settled = true;
          state.inboxInFlight -= 1;
        }
      });
      if (options.scenario === 'events-reconnect-unknown' && state.inboxRequests === 1) {
        const response = inboxData.responses[0];
        pendingInbox.add(() => finish(response.status, response.body));
        return;
      }
      const response = inboxData.responses[Math.min(state.inboxRequests - 1, inboxData.responses.length - 1)]!;
      return finish(response.status, response.body);
    }

    if (url.pathname === '/api/health') {
      return json(reply, 200, options.scenario === 'health-reader-error' ? degradedHealth() : healthResponseFixture);
    }

    if (url.pathname === '/events') {
      state.eventConnections += 1;
      const connection = state.eventConnections;
      streams.add(reply);
      reply.once('close', () => streams.delete(reply));
      reply.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      reply.write(': connected\n\n');

      if (options.scenario === 'events-reconnect-unknown' && connection === 1) {
        for (const [index, frame] of inboxData.eventFrames.entries()) {
          later(() => {
            if (reply.destroyed) return;
            state.eventFrames += 1;
            reply.write(`event: planeA\ndata: ${frame}\n\n`);
          }, 5 * (index + 1));
        }
        later(releasePendingInbox, (5 * inboxData.eventFrames.length) + 750);
        later(() => {
          if (reply.destroyed) return;
          state.unknownEventFrames += 1;
          reply.write(`event: fixture-unknown\ndata: ${JSON.stringify({ channel: 'unknown', kind: 'must-not-render' })}\n\n`);
          reply.end();
        }, 40);
      } else if (options.scenario === 'events-reconnect-unknown') {
        state.unknownEventFrames += 1;
        reply.write(`event: fixture-unknown\ndata: ${JSON.stringify({ channel: 'unknown', kind: 'must-not-render' })}\n\n`);
      } else if (options.scenario === 'inbox-error-after-success') {
        later(() => {
          if (!reply.destroyed) reply.write(`event: planeA\ndata: ${JSON.stringify({ channel: 'planeA', kind: 'fixture-tick' })}\n\n`);
        }, 25);
      }
      return;
    }

    const file = safeStaticFile(distDir, url.pathname);
    if (file) {
      reply.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      reply.end(readFileSync(file));
      return;
    }
    return json(reply, 404, { error: 'not found' });
  };

  const wrapped = (request: IncomingMessage, reply: ServerResponse): void => {
    void handler(request, reply);
  };
  const tls = options.https === true ? await createLoopbackTlsMaterial() : null;
  const server = tls === null
    ? createServer(wrapped)
    : createSecureServer({ cert: tls.cert, key: tls.key }, wrapped);

  await new Promise<void>((resolveListen, rejectListen) => {
    const fail = (error: Error): void => rejectListen(error);
    server.once('error', fail);
    server.listen({ host, port }, () => {
      server.off('error', fail);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;

  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${address.port}`;
  // Publish the PUBLIC certificate so the lifecycle probe and the browser/smoke clients can pin it.
  if (tls !== null) publishLoopbackCertificate(address.port, tls.cert);

  return {
    address: { host: '127.0.0.1', port: address.port },
    origin,
    state,
    certificate: tls === null ? null : tls.cert,
    contextUrls: { a: `${origin}/fixture/context-a`, b: `${origin}/fixture/context-b` },
    releaseInbox(): void {
      releasePendingInbox();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (tls !== null) revokeLoopbackCertificate(address.port);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      releasePendingInbox();
      for (const stream of streams) stream.destroy();
      streams.clear();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

export function parseP1FixtureArgs(
  args: string[],
): { scenario: P1BrowserScenario; port: number; https: boolean } {
  let scenario: string | null = null;
  let port = 4317;
  let https = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--scenario' && value) {
      scenario = value;
      index += 1;
    } else if (arg === '--port' && value) {
      port = Number(value);
      index += 1;
    } else if (arg === '--https') {
      https = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${String(arg)}`);
    }
  }
  if (!scenario || !isScenario(scenario)) throw new Error(`Unknown scenario: ${String(scenario)}`);
  return { scenario, port, https };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startP1BrowserFixture(parseP1FixtureArgs(process.argv.slice(2)))
    .then((fixture) => {
      console.log(`[p1-browser-fixture] ${fixture.origin}`);
      console.log(`[p1-browser-fixture] context A ${fixture.contextUrls.a}`);
      console.log(`[p1-browser-fixture] context B ${fixture.contextUrls.b}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
