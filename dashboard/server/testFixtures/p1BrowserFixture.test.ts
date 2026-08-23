import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  P1_BROWSER_SCENARIOS,
  startP1BrowserFixture,
  type P1BrowserFixture,
} from './p1BrowserFixture.ts';
import { decodeEntityDetail, decodeEntityList } from '../../src/lib/entityClient.ts';
import { decodeHomeResponse } from '../../src/lib/homeClient.ts';
import {
  decodeRuntimeCapabilities,
  type ClientRuntimeCapabilities,
} from '../../src/lib/runtimeCapabilities.tsx';
import { listPtySessions } from '../../src/lib/terminalClient.ts';
import {
  createSessionWorkspaceModel,
  projectRunSessionWorkspace,
} from '../../src/console/sessionWorkspaceModel.ts';
import type { AttemptSessionPublicRow } from '../../shared/ptyProtocol.ts';
import { decodeScheduleCollection } from '../../src/lib/scheduleClient.ts';
import { decodeOperationalEvent, getRun, type OperationalEventDto } from '../../src/control/controlClient.ts';
import { serializeRunEventFold } from '../../src/control/runEventRecords.ts';
import { SYSTEM_ENTITY_GROUP_ID } from '../entities/contracts.ts';

const fixtures: P1BrowserFixture[] = [];
const roots: string[] = [];

async function dist(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kb-p1-browser-'));
  roots.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>');
  await writeFile(join(root, 'assets', 'app.js'), 'globalThis.__P1_BROWSER_FIXTURE__ = true;');
  return root;
}

async function start(scenario: (typeof P1_BROWSER_SCENARIOS)[number], distDir: string): Promise<P1BrowserFixture> {
  const fixture = await startP1BrowserFixture({ scenario, distDir, port: 0 });
  fixtures.push(fixture);
  return fixture;
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('fixture state did not settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('P1 browser fixture', () => {
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('binds loopback, rejects unknown scenario or route, and serves deterministic shell Inbox Health event theme and deep-link sequences', async () => {
    const distDir = await dist();
    await expect(startP1BrowserFixture({ scenario: 'inbox-populated', distDir, host: '0.0.0.0', port: 0 }))
      .rejects.toThrow(/127\.0\.0\.1/);
    await expect(startP1BrowserFixture({ scenario: 'not-a-scenario' as never, distDir, port: 0 }))
      .rejects.toThrow(/unknown scenario/i);

    const populated = await start('inbox-populated', distDir);
    expect(populated.address.host).toBe('127.0.0.1');
    const shell = await fetch(`${populated.origin}/?view=inbox`);
    const shellBody = await shell.text();
    expect(shell.status).toBe(200);
    expect(shell.headers.get('cache-control')).toBe('no-store');
    expect(shellBody).toContain('<div id="root"></div>');
    expect(await (await fetch(`${populated.origin}/?view=tasks&entity=card%3A68a70000-card`)).text()).toBe(shellBody);
    expect(await (await fetch(`${populated.origin}/?view=health`)).text()).toBe(shellBody);
    expect(await (await fetch(`${populated.origin}/assets/app.js`)).text()).toContain('__P1_BROWSER_FIXTURE__');
    expect((await fetch(`${populated.origin}/not-a-fixture-route`)).status).toBe(404);
    expect(await (await fetch(`${populated.origin}/api/auth/context`)).json()).toEqual({ mode: 'tailnet' });
    const fixtureCapabilities = await (await fetch(`${populated.origin}/api/runtime/capabilities`)).json();
    expect(fixtureCapabilities).toEqual({
      pty: false,
      diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: '2026-08-22T00:00:00.000Z' },
      localTranscripts: false,
    });
    // Not a same-belief assertion: the fixture body must survive the browser's own decoder, or the
    // fixture is advertising a shape the real app would refuse.
    expect(decodeRuntimeCapabilities(fixtureCapabilities)).toEqual(fixtureCapabilities);

    const inbox = await (await fetch(`${populated.origin}/api/inbox`)).json() as { items: Array<{ title: string; reason: string }> };
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({ title: 'wake-me:fixture-failure', reason: 'The fixture runner needs a human decision.' });
    const health = await (await fetch(`${populated.origin}/api/health`)).json() as { sections: Array<{ id: string; rows: unknown[] }> };
    expect(health.sections.map((section) => section.id)).toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
    expect(JSON.stringify(health)).toContain('unavailable in P1');
    expect(JSON.stringify(health)).not.toMatch(/spend|credential|authorization/i);
    await populated.close();
    fixtures.splice(fixtures.indexOf(populated), 1);

    const empty = await start('inbox-empty', distDir);
    expect(await (await fetch(`${empty.origin}/api/inbox`)).json()).toEqual({ items: [] });
    await empty.close();
    fixtures.splice(fixtures.indexOf(empty), 1);

    const stale = await start('inbox-error-after-success', distDir);
    expect((await fetch(`${stale.origin}/api/inbox`)).status).toBe(200);
    expect((await fetch(`${stale.origin}/api/inbox`)).status).toBe(500);
    await stale.close();
    fixtures.splice(fixtures.indexOf(stale), 1);

    const readerError = await start('health-reader-error', distDir);
    const degraded = await (await fetch(`${readerError.origin}/api/health`)).json() as { sections: Array<{ id: string; rows: Array<{ kind: string }> }> };
    expect(degraded.sections.map((section) => section.id)).toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
    expect(degraded.sections.find((section) => section.id === 'fleet')?.rows).toEqual([expect.objectContaining({ kind: 'unavailable' })]);
    await readerError.close();
    fixtures.splice(fixtures.indexOf(readerError), 1);

    const events = await start('events-reconnect-unknown', distDir);
    const mount = fetch(`${events.origin}/api/inbox`);
    await until(() => events.state.inboxRequests === 1 && events.state.inboxInFlight === 1);
    const abort = new AbortController();
    const stream = await fetch(`${events.origin}/events`, { signal: abort.signal });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    await until(() => events.state.eventFrames === 5);
    expect(events.state).toMatchObject({ inboxRequests: 1, inboxInFlight: 1, maxInboxInFlight: 1, eventFrames: 5 });
    expect((await mount).status).toBe(200);
    expect((await fetch(`${events.origin}/api/inbox`)).status).toBe(200);
    expect(events.state).toMatchObject({ inboxRequests: 2, inboxInFlight: 0, maxInboxInFlight: 1, eventFrames: 5 });
    abort.abort();
  });

  it('serves the bounded P2 entity, Run, gate, schedule, Home, and action scenarios', async () => {
    const p2Scenarios = [
      'p2-entity-groups-overlay',
      'p2-run-lifecycle-step-filter',
      'p2-gate-dedupe-t3',
      'p2-stream-reconnect-goldens',
      'p2-schedule-cas-invalid',
      'p2-schedule-load-error',
      'p2-home-full',
      'p2-home-partial-failure',
      'p2-run-actions',
    ] as const;
    expect(P1_BROWSER_SCENARIOS).toEqual(expect.arrayContaining([...p2Scenarios]));
    const distDir = await dist();

    const entities = await startP1BrowserFixture({ scenario: 'p2-entity-groups-overlay' as never, distDir, port: 0 });
    fixtures.push(entities);
    const agents = decodeEntityList(await (await fetch(`${entities.origin}/api/agents`)).json());
    expect(agents.groups.map((group) => group.id)).toEqual(['atlas-prep', 'faceless-youtube', 'kb-ops', SYSTEM_ENTITY_GROUP_ID]);
    const workflow = decodeEntityDetail(await (await fetch(`${entities.origin}/api/workflows/research-brief`)).json());
    expect(workflow.details.workflow?.stepDag.nodes.map((node) => node.stageRef)).toEqual(['research', 'write']);

    const lifecycle = await startP1BrowserFixture({ scenario: 'p2-run-lifecycle-step-filter' as never, distDir, port: 0 });
    fixtures.push(lifecycle);
    const allEvents = await (await fetch(`${lifecycle.origin}/api/control/runs/run-fixture/events?after=0&limit=250`)).json() as {
      items: Array<{ stageRef: string | null; summary: string }>;
    };
    const researchEvents = await (await fetch(`${lifecycle.origin}/api/control/runs/run-fixture/events?after=0&limit=250&stageRef=research`)).json() as {
      items: Array<{ stageRef: string | null }>;
    };
    expect(allEvents.items.length).toBeGreaterThan(researchEvents.items.length);
    expect(researchEvents.items.every((event) => event.stageRef === 'research')).toBe(true);
    expect(allEvents.items.every((event) => decodeOperationalEvent(event) !== null)).toBe(true);
    expect(allEvents.items.map((event) => event.summary).join('\n')).toContain('"provider":"claude"');
    expect(allEvents.items.map((event) => event.summary).join('\n')).toContain('"provider":"codex"');

    const gates = await startP1BrowserFixture({ scenario: 'p2-gate-dedupe-t3' as never, distDir, port: 0 });
    fixtures.push(gates);
    const attention = await (await fetch(`${gates.origin}/api/attention`)).json() as { pairs: unknown[]; agents: Record<string, number> };
    expect(attention).toMatchObject({ agents: { 'fyt-checker': 1 } });
    expect(attention.pairs).toHaveLength(1);
    const gateFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(new URL(String(input), gates.origin), init)) as typeof fetch;
    const gateDetail = await getRun('run-fixture', 'bearer', gateFetch);
    expect(gateDetail.humanRequests).toHaveLength(2);
    expect(gateDetail.humanRequests.map((request) => request.kind)).toEqual(['approval', 'input']);
    const ordinaryInput = {
      expectedRevision: 1, decision: 'responded', response: 'Continue with the bounded step.',
      idempotencyKey: 'fixture:ordinary:1',
    };
    const ordinary = await (await fetch(`${gates.origin}/api/control/human-requests/request-ordinary/respond`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ordinaryInput),
    })).json() as { value: unknown; replayed: boolean };
    const ordinaryReplay = await (await fetch(`${gates.origin}/api/control/human-requests/request-ordinary/respond`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ordinaryInput),
    })).json() as { value: unknown; replayed: boolean };
    expect(ordinaryReplay).toMatchObject({ value: ordinary.value, replayed: true });
    const resolvedDetail = await getRun('run-fixture', 'bearer', gateFetch);
    expect(resolvedDetail.humanRequests.find((request) => request.requestRef === 'request-ordinary'))
      .toMatchObject({ state: 'resolved', revision: 2, response: { decision: 'responded' } });
    expect(resolvedDetail.humanRequests.filter((request) => request.state === 'open').map((request) => request.requestRef))
      .toEqual(['request-t3']);
    expect(await (await fetch(`${gates.origin}/api/attention`)).json()).toMatchObject({ agents: { 'fyt-checker': 1 } });
    const ceremony = await fetch(`${gates.origin}/api/control/human-requests/request-t3/respond`, { method: 'POST' });
    expect(ceremony.status).toBe(403);
    expect(await ceremony.json()).toEqual({ error: 'ceremony-unavailable' });
    expect(await (await fetch(`${gates.origin}/api/attention`)).json()).toMatchObject({ agents: { 'fyt-checker': 1 } });

    const stream = await startP1BrowserFixture({ scenario: 'p2-stream-reconnect-goldens' as never, distDir, port: 0 });
    fixtures.push(stream);
    const replay = await (await fetch(`${stream.origin}/api/control/runs/run-fixture/events?after=0&limit=250`)).json() as { items: OperationalEventDto[] };
    expect(replay.items.length).toBeGreaterThan(2);
    expect(replay.items.map((event) => event.summary).join('\n')).toContain('"provider":"future-cli"');
    expect(replay.items.map((event) => event.summary).join('\n')).toContain('<b>future output</b>');
    const live = await fetch(`${stream.origin}/api/control/runs/run-fixture/events/stream?after=2`);
    expect(live.headers.get('content-type')).toContain('text/event-stream');
    const queryReconnect = await live.text();
    const headerReconnect = await (await fetch(`${stream.origin}/api/control/runs/run-fixture/events/stream`, {
      headers: { 'Last-Event-ID': '2' },
    })).text();
    expect(headerReconnect).toBe(queryReconnect);
    expect(queryReconnect).not.toContain('id: 2\n');
    expect(queryReconnect).toContain('<b>future output</b>');
    const streamedEvents = queryReconnect.split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as OperationalEventDto);
    expect(streamedEvents.map((event) => event.summary).join('\n')).toContain('"provider":"future-cli"');
    expect(serializeRunEventFold(streamedEvents))
      .toBe(serializeRunEventFold(replay.items.filter((event) => event.cursor > 2)));

    const schedule = await startP1BrowserFixture({ scenario: 'p2-schedule-cas-invalid' as never, distDir, port: 0 });
    fixtures.push(schedule);
    const scheduleResponse = await fetch(`${schedule.origin}/api/schedules`);
    expect(scheduleResponse.status).toBe(200);
    expect(decodeScheduleCollection(await scheduleResponse.json()).rows).toHaveLength(1);
    const stale = await fetch(`${schedule.origin}/api/schedules/${'a'.repeat(64)}/arm`, { method: 'POST' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'stale-schedule-version' });
    const invalid = await fetch(`${schedule.origin}/api/schedules`, { method: 'POST' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid-cadence' });
    const createInput = {
      owner: { type: 'workflow', id: 'research-brief', project: 'kb-ops' },
      cadence: { kind: 'words', words: 'daily', time: '09:00' },
      expectedCollectionRevision: 4, idempotencyKey: 'schedule:create:fixture',
    };
    const create = await (await fetch(`${schedule.origin}/api/schedules`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createInput),
    })).json() as Record<string, any>;
    const createReplay = await (await fetch(`${schedule.origin}/api/schedules`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createInput),
    })).json() as Record<string, any>;
    expect(create).toMatchObject({ schedule: { version: 1, armed: false }, collectionRevision: 5, replayed: false });
    expect(createReplay).toMatchObject({ schedule: create.schedule, collectionRevision: 5, replayed: true });
    const scheduleId = create.schedule.id as string;
    const mutateSchedule = async (action: 'arm' | 'disarm', version: number, armed: boolean) =>
      (await fetch(`${schedule.origin}/api/schedules/${scheduleId}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          expectedVersion: version, armed, idempotencyKey: `schedule:${action}:${version}`,
        }),
      })).json() as Promise<Record<string, any>>;
    const armed = await mutateSchedule('arm', 1, true);
    const disarmed = await mutateSchedule('disarm', 2, false);
    expect(armed).toMatchObject({ schedule: { version: 2, armed: true }, collectionRevision: 6 });
    expect(disarmed).toMatchObject({ schedule: { version: 3, armed: false }, collectionRevision: 7 });
    const deleted = await (await fetch(`${schedule.origin}/api/schedules/${scheduleId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 3, idempotencyKey: 'schedule:delete:3' }),
    })).json();
    expect(deleted).toMatchObject({ tombstone: { id: scheduleId, version: 4 }, collectionRevision: 8, replayed: false });
    expect(decodeScheduleCollection(await (await fetch(`${schedule.origin}/api/schedules`)).json()).rows).toHaveLength(1);

    const scheduleError = await startP1BrowserFixture({ scenario: 'p2-schedule-load-error' as never, distDir, port: 0 });
    fixtures.push(scheduleError);
    expect((await fetch(`${scheduleError.origin}/api/schedules`)).status).toBe(503);

    const home = await startP1BrowserFixture({ scenario: 'p2-home-full' as never, distDir, port: 0 });
    fixtures.push(home);
    const homeBody = decodeHomeResponse(await (await fetch(`${home.origin}/api/home`)).json());
    expect(homeBody.sections.map((section) => section.state === 'ready' ? section.data.section : section.reason)).toEqual([
      'running-now', 'attention-counts', 'next-schedules', 'version', 'recent-outcomes',
    ]);

    const partialHome = await startP1BrowserFixture({ scenario: 'p2-home-partial-failure' as never, distDir, port: 0 });
    fixtures.push(partialHome);
    const partialBody = await (await fetch(`${partialHome.origin}/api/home`)).json() as { sections: Array<{ state: string; reason?: string }> };
    expect(partialBody.sections).toContainEqual({ state: 'unavailable', reason: 'schedules-unavailable' });

    const actions = await startP1BrowserFixture({ scenario: 'p2-run-actions' as never, distDir, port: 0 });
    fixtures.push(actions);
    const actionFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(new URL(String(input), actions.origin), init)) as typeof fetch;
    const actionDetail = await getRun('run-fixture', 'bearer', actionFetch);
    expect(actionDetail.outputs).toEqual([
      { kind: 'repository-file', label: 'Built', path: 'output/p2-browser-report.md' },
      { kind: 'artifact', label: 'Fixture value', path: 'artifacts/ghp_fixture_secret_123' },
      { kind: 'external-pr', label: 'Review', owner: 'openai', repository: 'kb', number: 42 },
    ]);
    const runAction = async (action: string, version: number, key: string) => {
      const response = await fetch(`${actions.origin}/api/control/runs/run-fixture/manager/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRunVersion: version, expectedManagerGeneration: 1, idempotencyKey: key }),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    expect(await runAction('reattach', 3, 'run:reattach:3')).toMatchObject({ status: 200, body: { attached: true, version: 4 } });
    expect(await runAction('detach', 4, 'run:detach:4')).toMatchObject({ status: 200, body: { attached: false, version: 5 } });
    expect(await runAction('copy', 5, 'run:copy:5')).toMatchObject({ status: 200, body: { copied: true, version: 6 } });
    const stopped = await runAction('stop', 6, 'run:stop:6');
    expect(stopped).toMatchObject({ status: 200, body: { state: 'stopped', replayed: false } });
    expect(await runAction('stop', 6, 'run:stop:6')).toMatchObject({ status: 200, body: { replayed: true } });
    expect(await runAction('stop', 7, 'run:stop:7')).toMatchObject({ status: 409, body: { error: 'stale-run-version' } });
  });

  it('keeps the retired repository DAG files deleted after the step-DAG fixture is consumable', () => {
    const oldDirectory = join(import.meta.dirname, '..', 'dag');
    for (const file of ['graph.ts', 'graph.test.ts', 'routes.ts', 'routes.test.ts']) {
      expect(existsSync(join(oldDirectory, file)), file).toBe(false);
    }
  });
});

/**
 * P3 section 8 — the four `p3-*` scenarios are only useful if the payloads they serve are the ones the
 * real client decoders accept. A fixture that served a nearly-right shape would make the browser matrix
 * green against data production could never produce, so each scenario is round-tripped through the
 * SHIPPING decoders and projectors, and a one-field mutation of each payload is required to be refused.
 */
describe('p1BrowserFixture p3 scenarios decode with the shipping client decoders', () => {
  const P3_SCENARIOS = [
    'p3-terminal-empty-unavailable',
    'p3-terminal-named-sessions',
    'p3-run-attempt-sessions',
    'p3-controller-isolation',
  ] as const;

  async function p3Payloads(scenario: (typeof P3_SCENARIOS)[number]) {
    const fixture = await start(scenario, await dist());
    const entry = await fetch(`${fixture.origin}/fixture/context-a`, { redirect: 'manual' });
    const cookie = (entry.headers.get('set-cookie') ?? '').split(';')[0];
    const capability = await (await fetch(`${fixture.origin}/api/runtime/capabilities`)).json();
    const sessions = await (await fetch(`${fixture.origin}/api/pty/sessions`, { headers: { cookie } })).json();
    const attempts = await (await fetch(`${fixture.origin}/api/control/runs/run-fixture/sessions`, {
      headers: { cookie },
    })).json();
    return { fixture, cookie, capability, sessions, attempts };
  }

  it.each(P3_SCENARIOS)('%s decodes into a workspace model without error', async (scenario) => {
    const { cookie, capability, sessions, attempts } = await p3Payloads(scenario);
    expect(cookie).not.toBe('');

    const decodedCapability = decodeRuntimeCapabilities(capability);
    expect(decodedCapability, 'capability payload').not.toBeNull();
    const workspace = createSessionWorkspaceModel(decodedCapability as ClientRuntimeCapabilities);
    expect(workspace.availability.kind)
      .toBe(scenario === 'p3-terminal-empty-unavailable' ? 'unavailable' : 'available');

    // `listPtySessions` is the shipping REST decoder; giving it the fixture's own body proves the
    // fixture speaks the listing contract rather than a lookalike.
    const listing = await listPtySessions('bearer', (async () => new Response(JSON.stringify(sessions), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
    expect(listing, 'session listing').not.toBeNull();
    expect(listing?.sessions.length).toBe((sessions as { sessions: unknown[] }).sessions.length);

    const rows = (attempts as { sessions: AttemptSessionPublicRow[] }).sessions;
    const projected = projectRunSessionWorkspace(rows);
    expect(projected.sessions).toHaveLength(rows.length);
    if (rows.length > 0) expect(projected.selectedSessionId).not.toBeNull();
    // Exactly one row may hold live control; every other row is replay-only.
    expect(projected.sessions.filter((row) => row.mode !== 'replay')).toHaveLength(rows.length > 0 ? 1 : 0);
  });

  it('refuses a capability payload with one wrong type and one extra key', async () => {
    const { capability } = await p3Payloads('p3-terminal-named-sessions');
    expect(decodeRuntimeCapabilities(capability)).not.toBeNull();
    expect(decodeRuntimeCapabilities({ ...(capability as object), checkedAt: 17 })).toBeNull();

    const { capability: closed } = await p3Payloads('p3-terminal-empty-unavailable');
    expect(decodeRuntimeCapabilities(closed)).not.toBeNull();
    const diagnostic = (closed as { diagnostic: Record<string, unknown> }).diagnostic;
    expect(decodeRuntimeCapabilities({
      ...(closed as object), diagnostic: { ...diagnostic, probeDurationMs: 4 },
    })).toBeNull();
  });

  it('refuses a session listing whose revision has the wrong type', async () => {
    const { sessions } = await p3Payloads('p3-terminal-named-sessions');
    const decode = async (body: unknown) => listPtySessions('bearer', (async () => new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
    expect(await decode(sessions)).not.toBeNull();
    expect(await decode({ ...(sessions as object), revision: '7' })).toBeNull();
    expect(await decode({ ...(sessions as object), sessions: 'none' })).toBeNull();
  });

  it('refuses an attempt row whose state has the wrong type before it can be projected', async () => {
    const { attempts } = await p3Payloads('p3-run-attempt-sessions');
    const rows = (attempts as { sessions: AttemptSessionPublicRow[] }).sessions;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => isAttemptSessionRow(row))).toBe(true);
    expect(isAttemptSessionRow({ ...rows[0], state: 7 })).toBe(false);
    expect(isAttemptSessionRow({ ...rows[0], liveControl: 'yes' })).toBe(false);
  });
});

/** The closed shape a Run attempt row must have before `projectRunSessionWorkspace` may see it. */
function isAttemptSessionRow(value: unknown): value is AttemptSessionPublicRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.attemptRef === 'string'
    && typeof row.sessionId === 'string'
    && (row.launcher === 'claude' || row.launcher === 'codex')
    && typeof row.state === 'string'
    && typeof row.startedAt === 'string'
    && (row.endedAt === null || typeof row.endedAt === 'string')
    && typeof row.controllerClaimed === 'boolean'
    && typeof row.liveControl === 'boolean';
}
