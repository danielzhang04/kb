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
import { decodeScheduleCollection } from '../../src/lib/scheduleClient.ts';
import { decodeOperationalEvent } from '../../src/control/controlClient.ts';

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
    expect(await (await fetch(`${populated.origin}/api/runtime/capabilities`)).json()).toEqual({ pty: false, localTranscripts: false });

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
    expect(agents.groups.map((group) => group.id)).toEqual(['atlas-prep', 'faceless-youtube', 'kb-ops', 'system']);
    const workflow = decodeEntityDetail(await (await fetch(`${entities.origin}/api/workflows/research-brief`)).json());
    expect(workflow.details.workflow?.stepDag.nodes.map((node) => node.stageRef)).toEqual(['research', 'write']);

    const lifecycle = await startP1BrowserFixture({ scenario: 'p2-run-lifecycle-step-filter' as never, distDir, port: 0 });
    fixtures.push(lifecycle);
    const allEvents = await (await fetch(`${lifecycle.origin}/api/control/runs/run-fixture/events?after=0&limit=250`)).json() as {
      items: Array<{ stageRef: string | null }>;
    };
    const researchEvents = await (await fetch(`${lifecycle.origin}/api/control/runs/run-fixture/events?after=0&limit=250&stageRef=research`)).json() as {
      items: Array<{ stageRef: string | null }>;
    };
    expect(allEvents.items.length).toBeGreaterThan(researchEvents.items.length);
    expect(researchEvents.items.every((event) => event.stageRef === 'research')).toBe(true);
    expect(allEvents.items.every((event) => decodeOperationalEvent(event) !== null)).toBe(true);

    const gates = await startP1BrowserFixture({ scenario: 'p2-gate-dedupe-t3' as never, distDir, port: 0 });
    fixtures.push(gates);
    const attention = await (await fetch(`${gates.origin}/api/attention`)).json() as { pairs: unknown[]; agents: Record<string, number> };
    expect(attention).toMatchObject({ agents: { 'fyt-checker': 1 } });
    expect(attention.pairs).toHaveLength(1);
    const ceremony = await fetch(`${gates.origin}/api/control/human-requests/request-t3/respond`, { method: 'POST' });
    expect(ceremony.status).toBe(403);
    expect(await ceremony.json()).toEqual({ error: 'ceremony-unavailable' });

    const stream = await startP1BrowserFixture({ scenario: 'p2-stream-reconnect-goldens' as never, distDir, port: 0 });
    fixtures.push(stream);
    const replay = await (await fetch(`${stream.origin}/api/control/runs/run-fixture/events?after=0&limit=250`)).json() as { items: unknown[] };
    expect(replay.items.length).toBeGreaterThan(2);
    const live = await fetch(`${stream.origin}/api/control/runs/run-fixture/events/stream?after=0`);
    expect(live.headers.get('content-type')).toContain('text/event-stream');
    await live.body?.cancel();

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
    expect((await fetch(`${actions.origin}/api/control/runs/run-fixture/manager/stop`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${actions.origin}/api/control/runs/run-fixture/manager/stop`, { method: 'POST' })).status).toBe(409);
  });

  it('keeps the retired repository DAG files deleted after the step-DAG fixture is consumable', () => {
    const oldDirectory = join(import.meta.dirname, '..', 'dag');
    for (const file of ['graph.ts', 'graph.test.ts', 'routes.ts', 'routes.test.ts']) {
      expect(existsSync(join(oldDirectory, file)), file).toBe(false);
    }
  });
});
