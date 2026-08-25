import { describe, expect, it } from 'vitest';
import { createDesktopClient } from './desktopClient.ts';
import type { DesktopClientResponse, DesktopClientTransport } from './desktopClient.ts';
import { evaluateProxyRequest, forwardDesktopReadProxy } from './desktopReadProxy.ts';

function throwingTransport(): DesktopClientTransport {
  return {
    async send() {
      throw new Error('desktopReadProxy: a disallowed request reached the transport — it must never leave the machine');
    },
  };
}

function recordingTransport(response: DesktopClientResponse) {
  const calls: Array<{ method: string; url: string }> = [];
  const transport: DesktopClientTransport = {
    async send(request) {
      calls.push({ method: request.method, url: request.url });
      return response;
    },
  };
  return { transport, calls };
}

describe('evaluateProxyRequest allowlist (P6-C53)', () => {
  it('allows GET /api/v1/runs/:runRef/events', () => {
    expect(evaluateProxyRequest('GET', '/api/v1/runs/run-1/events')).toEqual({ allow: true, route: 'run-events', runRef: 'run-1' });
  });

  it('allows GET /api/v1/runs/:runRef/gates', () => {
    expect(evaluateProxyRequest('GET', '/api/v1/runs/run-1/gates')).toEqual({ allow: true, route: 'run-gates', runRef: 'run-1' });
  });

  it('refuses the human-response route on any method', () => {
    expect(evaluateProxyRequest('POST', '/api/v1/runs/run-1/human-requests/req-1/respond')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('GET', '/api/v1/runs/run-1/human-requests/req-1/respond')).toEqual({ allow: false, status: 404 });
  });

  it('refuses a mutating method on an otherwise-allowed path', () => {
    expect(evaluateProxyRequest('POST', '/api/v1/runs/run-1/events')).toEqual({ allow: false, status: 405 });
    expect(evaluateProxyRequest('DELETE', '/api/v1/runs/run-1/gates')).toEqual({ allow: false, status: 405 });
    expect(evaluateProxyRequest('PUT', '/api/v1/runs/run-1/events')).toEqual({ allow: false, status: 405 });
  });

  it('refuses any VM-store write path outright', () => {
    expect(evaluateProxyRequest('PUT', '/api/v1/hosts/vm')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('POST', '/api/v1/hosts/vm/leases/claim')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('POST', '/api/v1/runs/run-1/leases/renew')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('POST', '/api/v1/runs/run-1/reports')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('POST', '/api/v1/schedules')).toEqual({ allow: false, status: 404 });
  });

  it('refuses an unrelated operator read path (not on the allowlist at all)', () => {
    expect(evaluateProxyRequest('GET', '/api/v1/runs/run-1')).toEqual({ allow: false, status: 404 });
    expect(evaluateProxyRequest('GET', '/api/v1/agents')).toEqual({ allow: false, status: 404 });
  });
});

describe('forwardDesktopReadProxy refuses BEFORE anything leaves the machine (P6-C53)', () => {
  it('never calls the transport for a disallowed method+path', async () => {
    const client = createDesktopClient('https://vm.example:443/api/v1', throwingTransport());
    const result = await forwardDesktopReadProxy(client, 'POST', '/api/v1/runs/run-1/human-requests/req-1/respond');
    expect(result.status).toBe(404);
  });

  it('never calls the transport for a mutating method on an allowed path', async () => {
    const client = createDesktopClient('https://vm.example:443/api/v1', throwingTransport());
    const result = await forwardDesktopReadProxy(client, 'DELETE', '/api/v1/runs/run-1/gates');
    expect(result.status).toBe(405);
  });

  it('never calls the transport for any VM-store write path', async () => {
    const client = createDesktopClient('https://vm.example:443/api/v1', throwingTransport());
    await expect(forwardDesktopReadProxy(client, 'PUT', '/api/v1/hosts/vm')).resolves.toMatchObject({ status: 404 });
    await expect(forwardDesktopReadProxy(client, 'POST', '/api/v1/runs/run-1/reports')).resolves.toMatchObject({ status: 404 });
  });
});

describe('forwardDesktopReadProxy forwards the two allowed routes over desktopClient (P6-C53)', () => {
  it('forwards GET .../events, including the text/event-stream Accept form', async () => {
    const { transport, calls } = recordingTransport({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' });
    const client = createDesktopClient('https://vm.example:443/api/v1', transport);
    const result = await forwardDesktopReadProxy(client, 'GET', '/api/v1/runs/run-1/events', { accept: 'event-stream' });
    expect(calls).toEqual([{ method: 'GET', url: 'https://vm.example:443/api/v1/runs/run-1/events' }]);
    expect(result.headers['content-type']).toBe('text/event-stream');
  });

  it('forwards GET .../gates', async () => {
    const { transport, calls } = recordingTransport({ status: 200, headers: {}, body: '{"gates":[]}' });
    const client = createDesktopClient('https://vm.example:443/api/v1', transport);
    await forwardDesktopReadProxy(client, 'GET', '/api/v1/runs/run-1/gates');
    expect(calls).toEqual([{ method: 'GET', url: 'https://vm.example:443/api/v1/runs/run-1/gates' }]);
  });

  it('a VM-minted cursor replays through the proxy unchanged [P6-C41]', async () => {
    const vmMintedCursor = 'eyJraW5kIjoicnVuLWV2ZW50cyJ9.c2lnbmF0dXJlLWJ5dGVz';
    const { transport, calls } = recordingTransport({ status: 200, headers: {}, body: '{}' });
    const client = createDesktopClient('https://vm.example:443/api/v1', transport);
    await forwardDesktopReadProxy(client, 'GET', '/api/v1/runs/run-1/events', { cursor: vmMintedCursor });
    expect(calls[0]!.url).toBe(`https://vm.example:443/api/v1/runs/run-1/events?cursor=${encodeURIComponent(vmMintedCursor)}`);
    // Decoding the forwarded query param recovers the EXACT original token, byte-for-byte.
    const forwardedCursor = new URL(calls[0]!.url).searchParams.get('cursor');
    expect(forwardedCursor).toBe(vmMintedCursor);
  });
});

describe('desktopReadProxy.ts registers no mutating route (P6-C53)', () => {
  it('every allowlist entry is a GET', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(evaluateProxyRequest(method, '/api/v1/runs/run-1/events').allow).toBe(false);
      expect(evaluateProxyRequest(method, '/api/v1/runs/run-1/gates').allow).toBe(false);
    }
  });
});
