import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
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
import { CONTENT_TYPES, safeStaticFile, startLoopbackHttpServer } from './staticHttpServer.ts';

export const P1_BROWSER_SCENARIOS = [
  'inbox-populated',
  'inbox-empty',
  'inbox-error-after-success',
  'events-reconnect-unknown',
  'health-reader-error',
  'p6-placement-chip',
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

/* ------------------------------------------------------------------------------------------------ *
 * P6 W6.3 — the `p6-placement-chip` scenario (plan §8 line 468). Reuses the P2 boot-route SHAPES
 * (EntitySummary/EntityDetail/ControlRunDto, all decoder-checked in `src/lib/entityClient.ts` and
 * `src/control/controlClient.ts`) but never the P2 singleton data, so this scenario stays independent
 * of `p2BrowserFixtureData.ts` and cannot drift a P2 checkpoint. It serves exactly what the §8
 * "Bounded browser fixture" proof row needs: a VM-placed run and a Desktop-placed run whose RunDetail
 * chip reads the persisted `executionHost` (`src/views/RunDetail.tsx:333`), and a third workflow whose
 * launch always refuses `409 no-complete-placement` with no Run ever created — `POST
 * /api/workflows/:id/launch` has no other fixture handler anywhere in this file, so this scenario adds
 * the one route the real `server/workflows/routes.ts` exposes for it.
 * ------------------------------------------------------------------------------------------------ */
const P6_CHIP_NOW = '2026-08-25T12:00:00.000Z';
type P6ChipHost = 'vm' | 'desktop';

function p6ChipWorkflowRef(id: string): { type: 'workflow'; id: string; project: 'kb-ops'; sourcePath: `orgs/kb-ops/workflows/${string}.md` } {
  return { type: 'workflow', id, project: 'kb-ops', sourcePath: `orgs/kb-ops/workflows/${id}.md` };
}

function p6ChipRunRow(runRef: string, owner: ReturnType<typeof p6ChipWorkflowRef>): Record<string, unknown> {
  return {
    runRef, title: 'Placement chip run', owner, lifecycle: 'succeeded', outcome: 'ok',
    createdAt: P6_CHIP_NOW, completedAt: P6_CHIP_NOW, streamKind: 'transcript',
    elapsedMs: 60_000, toolsCalled: 1, lastLine: 'Run complete.', gateBadge: null,
  };
}

/** `EntityCard`'s accessible name comes from `humanizeEntityId(ref.id)`, never `humanName` — this is
 *  cosmetic text only, kept distinct per id so nothing reads as a copy-paste of another entity. */
const P6_CHIP_HUMAN_NAME: Readonly<Record<string, string>> = {
  'placement-chip-vm': 'Placement Chip VM fixture',
  'placement-chip-desktop': 'Placement Chip Desktop fixture',
  'placement-chip-refused': 'Placement Chip Refused fixture',
};

function p6ChipEntityDetail(id: string, host: P6ChipHost, activeRuns: Record<string, unknown>[]): Record<string, unknown> {
  const ref = p6ChipWorkflowRef(id);
  const summary = {
    ref, humanName: P6_CHIP_HUMAN_NAME[id] ?? id, status: 'idle',
    modelLabel: 'varies', temporalLabel: activeRuns.length > 0 ? 'ran just now' : 'Never run · no schedule',
    host, gatedRunCount: 0, activeRuns, latestRun: null, nextSchedule: null,
  };
  return {
    revision: `fixture-p6-chip-${id}-1`,
    summary,
    brief: {
      purpose: `Operate ${summary.humanName}.`, doingNow: 'Idle.', recentRuns: activeRuns, outputs: [],
      pendingGates: 0, schedule: null, autonomyTier: 'T1',
    },
    details: {
      sourcePath: ref.sourcePath, sourceRevision: '4'.repeat(64), tools: [], declaredCeiling: 'T1',
      replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: [], lineage: [], grades: [], ids: [id],
      workflow: { stepDag: { nodes: [], edges: [] }, parameters: [], runGraph: null },
    },
  };
}

function p6ChipRunDetail(runRef: string, workflowId: string, executionHost: P6ChipHost): Record<string, unknown> {
  const owner = p6ChipWorkflowRef(workflowId);
  return {
    ok: true,
    value: {
      streamKind: 'transcript',
      run: {
        runRef, predecessorRunRef: null, title: 'Placement chip run', displayName: 'Placement Chip Run', shortRef: 1,
        workflowRef: workflowId, proposalRef: `proposal-${runRef}`, proposalRevision: 1, proposalHash: '5'.repeat(64),
        publicationState: 'published', state: 'succeeded', version: 1, managerSessionRef: 'session-manager',
        managerGeneration: 1, managerAssignment: null, owner, executionHost, terminalOutcome: 'ok',
        completedAt: P6_CHIP_NOW, archivedFrom: null, createdAt: P6_CHIP_NOW, updatedAt: P6_CHIP_NOW,
      },
      ownerSubject: 'operator',
      stages: [], attempts: [], sessions: [], humanRequests: [],
      stageGenerations: [], generationSupersessions: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
      sessionId: null, attemptSessions: [], outputs: [],
    },
  };
}

const P6_CHIP_VM_RUN_REF = 'run-p6-chip-vm';
const P6_CHIP_DESKTOP_RUN_REF = 'run-p6-chip-desktop';
const P6_CHIP_WORKFLOW_IDS = {
  vm: 'placement-chip-vm', desktop: 'placement-chip-desktop', refused: 'placement-chip-refused',
} as const;

const P6_CHIP_WORKFLOW_DETAILS: Readonly<Record<string, Record<string, unknown>>> = {
  [P6_CHIP_WORKFLOW_IDS.vm]: p6ChipEntityDetail(
    P6_CHIP_WORKFLOW_IDS.vm, 'vm', [p6ChipRunRow(P6_CHIP_VM_RUN_REF, p6ChipWorkflowRef(P6_CHIP_WORKFLOW_IDS.vm))],
  ),
  [P6_CHIP_WORKFLOW_IDS.desktop]: p6ChipEntityDetail(
    P6_CHIP_WORKFLOW_IDS.desktop, 'desktop',
    [p6ChipRunRow(P6_CHIP_DESKTOP_RUN_REF, p6ChipWorkflowRef(P6_CHIP_WORKFLOW_IDS.desktop))],
  ),
  [P6_CHIP_WORKFLOW_IDS.refused]: p6ChipEntityDetail(P6_CHIP_WORKFLOW_IDS.refused, 'vm', []),
};

const P6_CHIP_WORKFLOW_LIST = {
  revision: 'fixture-p6-chip-workflows-1',
  groups: [{
    id: 'kb-ops', label: 'kb-ops', collapsed: false,
    items: Object.values(P6_CHIP_WORKFLOW_DETAILS).map((detail) => (detail as { summary: unknown }).summary),
  }],
  items: Object.values(P6_CHIP_WORKFLOW_DETAILS).map((detail) => (detail as { summary: unknown }).summary),
};

const P6_CHIP_RUN_DETAILS: Readonly<Record<string, Record<string, unknown>>> = {
  [P6_CHIP_VM_RUN_REF]: p6ChipRunDetail(P6_CHIP_VM_RUN_REF, P6_CHIP_WORKFLOW_IDS.vm, 'vm'),
  [P6_CHIP_DESKTOP_RUN_REF]: p6ChipRunDetail(P6_CHIP_DESKTOP_RUN_REF, P6_CHIP_WORKFLOW_IDS.desktop, 'desktop'),
};

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
  // The P2, P3, and placement-chip scenarios drive their own surfaces; the inbox is background for them.
  const inboxScenario: InboxFixtureScenario =
    isP2BrowserScenario(options.scenario) || isP3BrowserScenario(options.scenario)
      || options.scenario === 'p6-placement-chip'
      ? 'inbox-empty'
      : options.scenario === 'health-reader-error' ? 'inbox-populated' : options.scenario;
  const inboxData = inboxFixtureData(inboxScenario);
  const pendingInbox = new Set<() => void>();
  const streams = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();
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

    if (options.scenario === 'p6-placement-chip') {
      if (request.method === 'GET' && url.pathname === '/api/home') return json(reply, 200, p2Home(false));
      if (request.method === 'GET' && url.pathname === '/api/attention') {
        return json(reply, 200, { revision: 'f'.repeat(64), pairs: [], agents: {}, workflows: {} });
      }
      if (request.method === 'GET' && url.pathname === '/api/agents') {
        return json(reply, 200, { revision: 'fixture-p6-chip-agents-1', groups: [], items: [] });
      }
      if (request.method === 'GET' && url.pathname === '/api/workflows') return json(reply, 200, P6_CHIP_WORKFLOW_LIST);
      const workflowDetail = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
      if (request.method === 'GET' && workflowDetail) {
        const detail = P6_CHIP_WORKFLOW_DETAILS[decodeURIComponent(workflowDetail[1])];
        return detail ? json(reply, 200, detail) : json(reply, 404, { error: 'not-found' });
      }
      // The one route no other scenario in this file serves: `server/workflows/routes.ts`'s launch
      // endpoint. `placement-chip-refused` always fails `select()` (P6-C49's placement result), so this
      // mirrors the real handler's early refusal — `409 no-complete-placement` BEFORE any Run row is
      // created (plan §3.2) — with no store, no compile/import/approve, and no queued row ever appearing.
      const workflowLaunch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/launch$/);
      if (request.method === 'POST' && workflowLaunch) {
        return decodeURIComponent(workflowLaunch[1]) === P6_CHIP_WORKFLOW_IDS.refused
          ? json(reply, 409, { error: 'no-complete-placement' })
          : json(reply, 404, { error: 'not-found' });
      }
      const runDetail = url.pathname.match(/^\/api\/control\/runs\/([^/]+)$/);
      if (request.method === 'GET' && runDetail) {
        const detail = P6_CHIP_RUN_DETAILS[decodeURIComponent(runDetail[1])];
        return detail ? json(reply, 200, detail) : json(reply, 404, { error: 'not-found' });
      }
      const runEvents = url.pathname.match(/^\/api\/control\/runs\/([^/]+)\/events$/);
      if (request.method === 'GET' && runEvents) {
        return decodeURIComponent(runEvents[1]) in P6_CHIP_RUN_DETAILS
          ? json(reply, 200, { revision: 'e'.repeat(64), items: [], nextCursor: null })
          : json(reply, 404, { error: 'not-found' });
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

  // Publish the PUBLIC certificate so the lifecycle probe and the browser/smoke clients can pin it —
  // handled inside `startLoopbackHttpServer` for both the initial publish and the close-time revoke.
  const loopback = await startLoopbackHttpServer({ host: '127.0.0.1', port, https: options.https }, handler);

  return {
    address: loopback.address,
    origin: loopback.origin,
    state,
    certificate: loopback.certificate,
    contextUrls: { a: `${loopback.origin}/fixture/context-a`, b: `${loopback.origin}/fixture/context-b` },
    releaseInbox(): void {
      releasePendingInbox();
    },
    close(): Promise<void> {
      return loopback.close(() => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        releasePendingInbox();
        for (const stream of streams) stream.destroy();
        streams.clear();
      });
    },
  };
}

export function parseP1FixtureArgs(
  args: string[],
): { scenario: P1BrowserScenario; port: number; https: boolean; clientCommand: string[] } {
  // A `--` separates this fixture's own flags from an optional client command it runs AFTER the fixture is
  // up and tears down after (the §8 browser matrix drives the runner this way) — matching how
  // p6TwoDaemonFixture / p5FixtureLifecycle split on `--`. Everything before `--` is the fixture's flags;
  // everything after is the verbatim client argv (never re-parsed, never shell-composed).
  const separator = args.indexOf('--');
  const own = separator === -1 ? args : args.slice(0, separator);
  const clientCommand = separator === -1 ? [] : args.slice(separator + 1);
  if (separator !== -1 && clientCommand.length === 0) throw new Error('a client command after `--` is required');
  let scenario: string | null = null;
  let port = 4317;
  let https = false;
  for (let index = 0; index < own.length; index += 1) {
    const arg = own[index];
    const value = own[index + 1];
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
  return { scenario, port, https, clientCommand };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = parseP1FixtureArgs(process.argv.slice(2));
  startP1BrowserFixture(parsed)
    .then(async (fixture) => {
      console.log(`[p1-browser-fixture] ${fixture.origin}`);
      console.log(`[p1-browser-fixture] context A ${fixture.contextUrls.a}`);
      console.log(`[p1-browser-fixture] context B ${fixture.contextUrls.b}`);
      if (parsed.clientCommand.length === 0) return;
      // Lifecycle mode: run the client after `--`, then tear the fixture down on its exit or on a signal —
      // the fixture is already listening (startP1BrowserFixture resolves only once bound), so no ready poll.
      const { spawn } = await import('node:child_process');
      const [bin, ...rest] = parsed.clientCommand;
      const child = spawn(bin!, rest, { stdio: 'inherit', shell: false });
      let settled = false;
      const teardown = async (code: number): Promise<void> => {
        if (settled) return;
        settled = true;
        await fixture.close();
        process.exit(code);
      };
      const onSignal = (): void => { child.kill('SIGTERM'); };
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      child.once('error', (error) => { console.error(error instanceof Error ? error.message : String(error)); void teardown(1); });
      child.once('exit', (code) => { void teardown(code ?? 1); });
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
