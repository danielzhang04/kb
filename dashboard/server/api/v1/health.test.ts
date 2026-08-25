// P6 W6.1 §6 — GET /api/v1/health over services/healthService.ts. kind:'health'; the aggregate watermark
// is never a mutation precondition. Serves the FAILURE-ONLY node-proxy / host-map integrity rows into the
// fleet section [P6-C64, P6-C76, P6-C80].
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, HOST, operatorBearer } from './_nodeHarness.ts';
import type { HealthServicePort } from '../../services/healthService.ts';
import type { HealthResponse } from '../../health/service.ts';

function emptyResponse(): HealthResponse {
  return {
    sections: [
      { id: 'fleet', label: 'Fleet', rows: [] },
      { id: 'stop', label: 'STOP', rows: [] },
      { id: 'daemon-machine', label: 'Daemon and machine', rows: [] },
      { id: 'mcp', label: 'MCP', rows: [] },
      { id: 'usage', label: 'Usage', rows: [] },
    ],
  } as unknown as HealthResponse;
}

function port(over: Partial<HealthServicePort> = {}): HealthServicePort {
  return {
    async compose() { return { response: emptyResponse(), scheduleCollectionRevision: 3 }; },
    nodeProxyLiveness: () => ({ reachable: true }),
    hostMapValidation: () => ({ valid: true, mapPath: '/etc/kb-dashboard/host-nodes.json' }),
    nowIso: () => '2026-08-25T00:00:00.000Z',
    ...over,
  };
}

function fleetRows(body: string): unknown[] {
  return JSON.parse(body).data.sections.find((s: { id: string }) => s.id === 'fleet').rows;
}

describe('GET /api/v1/health', () => {
  it('200 kind:health with a watermark, and NO integrity failure rows when healthy', async () => {
    const res = await operatorApp(opCtx({ healthPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/health', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('health');
    expect(typeof body.meta.watermark).toBe('string');
    expect(fleetRows(res.body)).toHaveLength(0);
  });

  it('appends a failure-only node-proxy integrity row when the hop is unreachable', async () => {
    const res = await operatorApp(opCtx({ healthPort: port({ nodeProxyLiveness: () => ({ reachable: false }) }) }), 'reads').inject({ method: 'GET', url: '/api/v1/health', headers: { host: HOST, authorization: operatorBearer() } });
    const rows = fleetRows(res.body) as Array<{ label: string; value: { code: string } }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Node proxy');
    expect(rows[0].value.code).toBe('node-proxy-unreachable');
  });

  it('appends a host-map integrity row when the map is invalid', async () => {
    const res = await operatorApp(opCtx({ healthPort: port({ hostMapValidation: () => ({ valid: false, mapPath: '/etc/kb-dashboard/host-nodes.json' }) }) }), 'reads').inject({ method: 'GET', url: '/api/v1/health', headers: { host: HOST, authorization: operatorBearer() } });
    const rows = fleetRows(res.body) as Array<{ label: string; value: { code: string; owner: string } }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].value.code).toBe('host-map-invalid');
    expect(rows[0].value.owner).toBe('host-nodes.json');
  });

  it('304 when If-None-Match matches the aggregate ETag', async () => {
    const app = operatorApp(opCtx({ healthPort: port() }), 'reads');
    const first = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: HOST, authorization: operatorBearer() } });
    const etag = first.headers.etag as string;
    const second = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: HOST, authorization: operatorBearer(), 'if-none-match': etag } });
    expect(second.statusCode).toBe(304);
  });
});
