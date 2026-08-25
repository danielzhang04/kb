import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertApiV1Origin, createDesktopClient } from './desktopClient.ts';
import type { DesktopClientResponse, DesktopClientTransport } from './desktopClient.ts';

function okResponse(body: unknown, status = 200): DesktopClientResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

describe('assertApiV1Origin (P6-C29: the base URL cannot be a bare host)', () => {
  it('accepts an absolute origin ending exactly in /api/v1', () => {
    expect(assertApiV1Origin('https://vm.tailnet.example:443/api/v1')).toBe('https://vm.tailnet.example:443/api/v1');
  });
  it('rejects a bare host with no scheme and no path', () => {
    expect(() => assertApiV1Origin('vm.tailnet.example')).toThrow(RangeError);
  });
  it('rejects a scheme+host with no /api/v1 path at all', () => {
    expect(() => assertApiV1Origin('https://vm.tailnet.example:443')).toThrow(RangeError);
  });
  it('rejects a trailing slash past /api/v1', () => {
    expect(() => assertApiV1Origin('https://vm.tailnet.example/api/v1/')).toThrow(RangeError);
  });
  it('rejects a non-string origin', () => {
    expect(() => assertApiV1Origin(undefined)).toThrow(RangeError);
  });
  it('rejects a userinfo-bearing origin (host spoof via @) (W5b fix #3)', () => {
    expect(() => assertApiV1Origin('https://a@b/api/v1')).toThrow(RangeError);
  });
});

describe('createDesktopClient (§3.5 node routes, design:456-459 verbatim paths)', () => {
  function recordingTransport(response: DesktopClientResponse = okResponse({})) {
    const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
    const transport: DesktopClientTransport = {
      async send(request) {
        calls.push({ ...request, headers: { ...request.headers } });
        return response;
      },
    };
    return { transport, calls };
  }

  it('claim posts to /hosts/:hostId/leases/claim with only {waitMs}', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await client.claim('desktop', 25_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://vm.tailnet:443/api/v1/hosts/desktop/leases/claim');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ waitMs: 25_000 });
  });

  it('rejects a waitMs above the 25_000ms bound before any transport call', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await expect(client.claim('desktop', 25_001)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('renew posts to /runs/:runRef/leases/renew with only {expectedLeaseRevision}', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await client.renew('run-1', 3);
    expect(calls[0]!.url).toBe('https://vm.tailnet:443/api/v1/runs/run-1/leases/renew');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ expectedLeaseRevision: 3 });
  });

  it('report posts to /runs/:runRef/reports and never sends an Idempotency-Key header (exempt route)', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await client.report('run-1', { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} }, 'attempt-key-0123456789abcdef');
    expect(calls[0]!.url).toBe('https://vm.tailnet:443/api/v1/runs/run-1/reports');
    expect(Object.keys(calls[0]!.headers).map((h) => h.toLowerCase())).not.toContain('idempotency-key');
  });

  it('getRunEvents requests text/event-stream when asked and forwards a cursor verbatim', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await client.getRunEvents('run-1', { cursor: 'OPAQUE.CURSOR-tok_en', accept: 'event-stream' });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://vm.tailnet:443/api/v1/runs/run-1/events?cursor=OPAQUE.CURSOR-tok_en');
    expect(calls[0]!.headers.accept).toBe('text/event-stream');
  });

  it('getRunGates requests GET /runs/:runRef/gates', async () => {
    const { transport, calls } = recordingTransport();
    const client = createDesktopClient('https://vm.tailnet:443/api/v1', transport);
    await client.getRunGates('run-1');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://vm.tailnet:443/api/v1/runs/run-1/gates');
  });
});

describe('desktopClient.ts is the only outbound module under placement/ [P6-C29]', () => {
  it('no sibling placement/*.ts file references fetch/fetchImpl or holds its own transport', () => {
    const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'desktopClient.ts') continue;
      const text = readFileSync(`${dir}/${name}`, 'utf8');
      if (/\bfetch\(|\bfetchImpl\(/.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('desktopClient.ts source pins an /api/v1 origin (never a bare host)', () => {
    const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const text = readFileSync(`${dir}/desktopClient.ts`, 'utf8');
    expect(text).toMatch(/\/api\/v1/);
  });
});
