// P6 W6.1 §6 — GET /api/v1/runs/:runRef/events over services/runReadService.ts. Cursor replay + ETag/304;
// Accept: text/event-stream selects the same source, framed as SSE.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, HOST, operatorBearer } from './_nodeHarness.ts';
import type { RunReadPort } from '../../services/runReadService.ts';

function port(over: Partial<RunReadPort> = {}): RunReadPort {
  return {
    listRuns: () => [],
    getRun: (_s, runRef) => (runRef === 'run-1' ? { ok: true, value: {} } : { ok: false, reason: 'not-found' }),
    statusOf: () => 404,
    lifecycleKind: () => 'active',
    workflowRefIndex: () => new Map(),
    runDto: (r) => r as never,
    runDisplay: (d) => d,
    runDetailDto: () => ({}),
    executionPosture: () => ({}),
    async replayEvents() { return { revision: 'ev-rev-1', events: [{ seq: 1 }], nextCursor: 1 }; },
    ...over,
  };
}

describe('GET /api/v1/runs/:runRef/events', () => {
  it('200 kind:run-events with the replay page', async () => {
    const res = await operatorApp(opCtx({ runReadPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/runs/run-1/events', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('run-events');
    expect(body.data.events).toHaveLength(1);
  });

  it('304 on a matching If-None-Match', async () => {
    const res = await operatorApp(opCtx({ runReadPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/runs/run-1/events', headers: { host: HOST, authorization: operatorBearer(), 'if-none-match': '"ev-rev-1"' } });
    expect(res.statusCode).toBe(304);
  });

  it('404 for an unreadable run', async () => {
    const res = await operatorApp(opCtx({ runReadPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/runs/nope/events', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(404);
  });

  it('Accept: text/event-stream returns an SSE stream from the same source', async () => {
    const res = await operatorApp(opCtx({ runReadPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/runs/run-1/events', headers: { host: HOST, authorization: operatorBearer(), accept: 'text/event-stream' } });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: replay');
  });

  it('400 invalid-event-cursor on a bad ?after=', async () => {
    const res = await operatorApp(opCtx({ runReadPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/runs/run-1/events?after=-1', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(400);
  });
});
