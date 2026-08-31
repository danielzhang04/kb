// P6 W2 — characterization of `GET /api/health`'s extracted service, focused on the two NEW failure-only
// integrity rows [P6-C64, P6-C76, P6-C80] and the byte-for-byte ETag/304. Every port is a fake.

import { describe, expect, it } from 'vitest';
import {
  composeHealthResponse, hostMapRow, nodeProxyRow, readHealth, type HealthServicePort,
} from './healthService.ts';
import type { HealthResponse } from '../health/service.ts';

function baseResponse(): HealthResponse {
  return {
    sections: [
      { id: 'fleet', label: 'Fleet', rows: [{ kind: 'fleet', key: 'agent:a', label: 'A', value: { status: 'idle', role: null, working: false, lastActive: null }, observedAt: 'T', source: 'fleet' }] },
      { id: 'stop', label: 'STOP', rows: [] },
      { id: 'daemon-machine', label: 'Daemon and machine', rows: [] },
      { id: 'mcp', label: 'MCP', rows: [] },
      { id: 'usage', label: 'Usage', rows: [] },
    ],
  } as unknown as HealthResponse;
}

function port(over: Partial<HealthServicePort> = {}): HealthServicePort {
  return {
    compose: async () => ({ response: baseResponse(), scheduleCollectionRevision: 4 }),
    nodeProxyLiveness: () => ({ reachable: true }),
    hostMapValidation: () => ({ valid: true, mapPath: '/etc/kb-dashboard/host-nodes.json' }),
    nowIso: () => '2026-08-25T00:00:00.000Z',
    ...over,
  };
}

function fleetRows(r: HealthResponse) {
  return r.sections.find((s) => s.id === 'fleet')!.rows;
}

describe('healthService node-proxy + host-map integrity rows', () => {
  it('emits NO node-proxy or host-map row when both probes are healthy', async () => {
    const { response, addedRows } = await composeHealthResponse(port());
    expect(addedRows).toEqual([]);
    expect(fleetRows(response).some((row) => (row as { source?: string }).source === 'node-proxy')).toBe(false);
    expect(fleetRows(response).some((row) => (row as { source?: string }).source === 'host-map')).toBe(false);
  });

  it('emits exactly the node-proxy row when the shim/hop is unreachable, and does not fail the section', async () => {
    const { response, addedRows } = await composeHealthResponse(port({ nodeProxyLiveness: () => ({ reachable: false }) }));
    expect(addedRows).toEqual([nodeProxyRow('2026-08-25T00:00:00.000Z')]);
    const rows = fleetRows(response);
    const row = rows.find((r) => (r as { source?: string }).source === 'node-proxy');
    expect(row).toEqual({
      kind: 'integrity', key: 'node-proxy:kb-node-proxy', label: 'Node proxy',
      value: { status: 'error', code: 'node-proxy-unreachable', owner: 'kb-node-proxy' },
      observedAt: '2026-08-25T00:00:00.000Z', source: 'node-proxy',
    });
    // The original fleet agent row is still present — the section is composed, not replaced/failed.
    expect(rows.some((r) => (r as { kind: string }).kind === 'fleet')).toBe(true);
  });

  it('emits exactly the host-map row on a malformed map, owner = the map file basename', async () => {
    const { response, addedRows } = await composeHealthResponse(port({ hostMapValidation: () => ({ valid: false, mapPath: '/etc/kb-dashboard/host-nodes.json' }) }));
    expect(addedRows).toEqual([hostMapRow('2026-08-25T00:00:00.000Z', '/etc/kb-dashboard/host-nodes.json')]);
    const row = fleetRows(response).find((r) => (r as { source?: string }).source === 'host-map');
    expect(row).toEqual({
      kind: 'integrity', key: 'host-map:host-nodes.json', label: 'Host map',
      value: { status: 'error', code: 'host-map-invalid', owner: 'host-nodes.json' },
      observedAt: '2026-08-25T00:00:00.000Z', source: 'host-map',
    });
  });

  it('fires the node-proxy and host-map rows INDEPENDENTLY of each other', async () => {
    const onlyMap = await composeHealthResponse(port({ hostMapValidation: () => ({ valid: false, mapPath: '/etc/kb-dashboard/host-nodes.json' }) }));
    expect(onlyMap.addedRows.map((r) => r.source)).toEqual(['host-map']);
    const both = await composeHealthResponse(port({ nodeProxyLiveness: () => ({ reachable: false }), hostMapValidation: () => ({ valid: false, mapPath: '/etc/kb-dashboard/host-nodes.json' }) }));
    expect(both.addedRows.map((r) => r.source)).toEqual(['node-proxy', 'host-map']);
    const neither = await composeHealthResponse(port());
    expect(neither.addedRows).toEqual([]);
  });

  it('leaves every non-fleet section byte-for-byte unchanged', async () => {
    const { response } = await composeHealthResponse(port({ nodeProxyLiveness: () => ({ reachable: false }) }));
    const base = baseResponse();
    for (const id of ['stop', 'daemon-machine', 'mcp', 'usage']) {
      expect(response.sections.find((s) => s.id === id)).toEqual(base.sections.find((s) => s.id === id));
    }
  });

  it('applies the health ETag and 304, and the ETag changes when a failure row appears', async () => {
    const healthy = await readHealth(port(), undefined);
    expect(healthy.status).toBe(200);
    expect(healthy.etag).toMatch(/^"health:[a-f0-9]{64}"$/);
    const notModified = await readHealth(port(), healthy.etag);
    expect(notModified).toEqual({ status: 304, etag: healthy.etag });
    const degraded = await readHealth(port({ nodeProxyLiveness: () => ({ reachable: false }) }), undefined);
    expect(degraded.etag).not.toBe(healthy.etag); // the new row is part of the hashed sections
  });
});
