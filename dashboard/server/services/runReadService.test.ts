// P6 W2 — characterization of the control run-read handlers + the respond gate handler, over injected
// ports: the 401 gate, the archived-default projection, the ControlResult not-ok mapping, the numeric
// event-cursor wall, the events ETag/304, and the respond body wall.

import { describe, expect, it, vi } from 'vitest';
import {
  getRunDetail, listRuns, replayRunEvents, respondHumanRequestRoute,
  type RespondPort, type RunReadPort,
} from './runReadService.ts';

function readPort(over: Partial<RunReadPort> = {}): RunReadPort {
  return {
    listRuns: () => [{ runRef: 'r1', lifecycle: 'running' }, { runRef: 'r2', lifecycle: 'archived' }],
    getRun: () => ({ ok: true, value: { runRef: 'r1' }, replayed: false }),
    statusOf: () => 404,
    lifecycleKind: (run) => (run as { lifecycle: string }).lifecycle,
    workflowRefIndex: () => new Map(),
    runDto: (run) => run as { runRef: string; title: string; proposalRef: string },
    runDisplay: (dto) => ({ display: (dto as { runRef: string }).runRef }),
    runDetailDto: (_sub, detail) => ({ detail }),
    executionPosture: () => ({ host: 'vm' }),
    replayEvents: async () => ({ revision: 'events:9', entries: [] }),
    ...over,
  };
}

describe('runReadService reads', () => {
  it('refuses 401 on the list, detail, events, and respond handlers when unauthenticated', async () => {
    expect(listRuns(readPort(), null, {})).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(getRunDetail(readPort(), null, 'r1')).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(await replayRunEvents(readPort(), null, 'r1', {}, undefined)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(await respondHumanRequestRoute({ respond: vi.fn() } as unknown as RespondPort, null, 'q1', {}, 'o')).toEqual({ status: 401, body: { error: 'unauthenticated' } });
  });

  it('lists runs with archived hidden by default and shown on includeArchived=1', () => {
    const hidden = listRuns(readPort(), 'operator', {});
    expect(hidden.body).toEqual({ runs: [{ display: 'r1' }] });
    const shown = listRuns(readPort(), 'operator', { includeArchived: '1' });
    expect(shown.body).toEqual({ runs: [{ display: 'r1' }, { display: 'r2' }] });
  });

  it('returns run detail with execution posture on ok', () => {
    const out = getRunDetail(readPort(), 'operator', 'r1');
    expect(out).toEqual({ status: 200, body: { ok: true, value: { detail: { runRef: 'r1' } }, replayed: false, execution: { host: 'vm' } } });
  });

  it('maps a not-ok run detail through statusOf', () => {
    const out = getRunDetail(readPort({ getRun: () => ({ ok: false, reason: 'run-not-found', detail: 'x' }), statusOf: () => 404 }), 'operator', 'zzz');
    expect(out).toEqual({ status: 404, body: { error: 'run-not-found', detail: 'x' } });
  });

  it('events: 404 when the run is unauthorized/absent, before any cursor parse', async () => {
    const replayEvents = vi.fn();
    const out = await replayRunEvents(readPort({ getRun: () => ({ ok: false, reason: 'run-not-found' }), replayEvents }), 'operator', 'r1', {}, undefined);
    expect(out).toEqual({ status: 404 });
    expect(replayEvents).not.toHaveBeenCalled();
  });

  it('events: 400 invalid-event-cursor on a bad after/limit', async () => {
    const bad = await replayRunEvents(readPort(), 'operator', 'r1', { after: 'x' }, undefined);
    expect(bad).toEqual({ status: 400, body: { error: 'invalid-event-cursor' } });
    const overLimit = await replayRunEvents(readPort(), 'operator', 'r1', { limit: '999' }, undefined);
    expect(overLimit).toEqual({ status: 400, body: { error: 'invalid-event-cursor' } });
  });

  it('events: 200 page with ETag, and 304 when it matches', async () => {
    const ok = await replayRunEvents(readPort(), 'operator', 'r1', {}, undefined);
    expect(ok).toEqual({ status: 200, etag: '"events:9"', body: { revision: 'events:9', entries: [] } });
    const notModified = await replayRunEvents(readPort(), 'operator', 'r1', {}, '"events:9"');
    expect(notModified).toEqual({ status: 304, etag: '"events:9"' });
  });
});

describe('runReadService respond gate', () => {
  const goodBody = { decision: 'approved', expectedRevision: 2, idempotencyKey: 'k' };
  function respondPort(result: unknown): RespondPort {
    return { respond: vi.fn(async () => result) } as unknown as RespondPort;
  }

  it('refuses 400 invalid-human-response on a bad decision/revision/key', async () => {
    const port = respondPort({ ok: true, status: 200, value: {}, replayed: false });
    expect((await respondHumanRequestRoute(port, 'operator', 'q1', { decision: 'nope', expectedRevision: 2, idempotencyKey: 'k' }, 'o')).status).toBe(400);
    expect((await respondHumanRequestRoute(port, 'operator', 'q1', { decision: 'approved', expectedRevision: 0, idempotencyKey: 'k' }, 'o')).body).toEqual({ error: 'invalid-human-response' });
    expect((await respondHumanRequestRoute(port, 'operator', 'q1', { decision: 'approved', expectedRevision: 2, idempotencyKey: '' }, 'o')).status).toBe(400);
    expect(port.respond).not.toHaveBeenCalled();
  });

  it('passes a valid response to the gate service and returns ok', async () => {
    const port = respondPort({ ok: true, status: 200, value: { resolved: true }, replayed: false });
    const out = await respondHumanRequestRoute(port, 'operator', 'q1', goodBody, 'https://x');
    expect(out).toEqual({ status: 200, body: { ok: true, value: { resolved: true }, replayed: false } });
  });

  it('maps a not-ok gate result, using not-found for 404 and passing gateKind/resolveUrl', async () => {
    const notFound = await respondHumanRequestRoute(respondPort({ ok: false, status: 404, error: 'x' }), 'operator', 'q1', goodBody, 'o');
    expect(notFound).toEqual({ status: 404, body: { error: 'not-found' } });
    const conflict = await respondHumanRequestRoute(respondPort({ ok: false, status: 409, error: 'expected-revision-mismatch', gateKind: 'approval', resolveUrl: '/x' }), 'operator', 'q1', goodBody, 'o');
    expect(conflict).toEqual({ status: 409, body: { error: 'expected-revision-mismatch', gateKind: 'approval', resolveUrl: '/x' } });
  });
});
