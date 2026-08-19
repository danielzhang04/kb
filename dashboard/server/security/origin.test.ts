import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { assertOrigin, originPlugin, resolveAllowedOrigins } from './origin.ts';
import { createBus } from '../hub/bus.ts';
import { registerReadWs } from '../hub/ws.ts';

let app: FastifyInstance | undefined;
afterEach(async () => {
  const a = app;
  app = undefined;
  if (a) {
    // Null out first, then close — a rejected WS upgrade can leave a lingering socket, and we must
    // never let one test's teardown cascade into the next.
    try {
      await a.close();
    } catch {
      // ignore
    }
  }
});

/** Raw GET with fully controllable headers (fetch/undici strips forbidden headers like Origin). */
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

interface WsProbe {
  opened: boolean;
  errored: boolean;
  closeCode?: number;
}

/** Attempt a WS upgrade with controllable Origin/Host and report the settled state. */
function wsProbe(port: number, headers: Record<string, string>): Promise<WsProbe> {
  return new Promise((resolve) => {
    let opened = false;
    let errored = false;
    let closeCode: number | undefined;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    socket.on('open', () => {
      opened = true;
    });
    socket.on('error', () => {
      errored = true;
    });
    socket.on('unexpected-response', (clientReq: { destroy: () => void }, res: { destroy: () => void }) => {
      // The upgrade was refused (403). Tear down the client socket so the server-side connection
      // does not linger into app.close().
      errored = true;
      try {
        res.destroy();
        clientReq.destroy();
      } catch {
        // ignore
      }
    });
    socket.on('close', (code: number) => {
      closeCode = code;
    });
    setTimeout(() => {
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      resolve({ opened, errored, closeCode });
    }, 300);
  });
}

async function boot(allowed: string[], withWs: boolean): Promise<number> {
  // forceCloseConnections so app.close() destroys any half-open (e.g. rejected-upgrade) sockets
  // instead of waiting on keep-alive drain.
  app = Fastify({ logger: false, forceCloseConnections: true });
  // Register the WS plugin BEFORE the origin guard so the plugin's request.ws-setter onRequest hook
  // runs first — its onResponse cleanup (which destroys a refused upgrade's raw socket) depends on it.
  if (withWs) {
    await registerReadWs(app, createBus(), { allowedOrigins: allowed });
  }
  originPlugin(app, { allowedOrigins: allowed });
  app.get('/probe', async () => ({ ok: true }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as { port: number }).port;
}

describe('assertOrigin (unit)', () => {
  it('accepts a request whose Origin and Host are in the allowlist', () => {
    const res = assertOrigin(
      { headers: { origin: 'https://box.example.ts.net', host: 'box.example.ts.net' } },
      ['https://box.example.ts.net'],
    );
    expect(res.ok).toBe(true);
  });

  it('rejects a present-but-unlisted Origin', () => {
    const res = assertOrigin(
      { headers: { origin: 'https://evil.example', host: 'box.example.ts.net' } },
      ['https://box.example.ts.net'],
    );
    expect(res.ok).toBe(false);
  });

  it('rejects a mismatched Host even when Origin is absent (DNS-rebinding guard)', () => {
    const res = assertOrigin(
      { headers: { host: 'evil.example' } },
      ['https://box.example.ts.net'],
    );
    expect(res.ok).toBe(false);
  });

  it('accepts an explicit HTTPS default port in Host', () => {
    const res = assertOrigin(
      { headers: { host: 'box.example.ts.net:443' } },
      ['https://box.example.ts.net'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('rejects a non-default HTTPS port against a default-port allowlist entry', () => {
    const res = assertOrigin(
      { headers: { host: 'box.example.ts.net:8443' } },
      ['https://box.example.ts.net'],
    );
    expect(res).toEqual({ ok: false, reason: 'host-not-allowed' });
  });

  it('requires the exact non-default port configured in the allowlist', () => {
    expect(
      assertOrigin(
        { headers: { host: 'box.example.ts.net:8443' } },
        ['https://box.example.ts.net:8443'],
      ),
    ).toEqual({ ok: true });
    expect(
      assertOrigin(
        { headers: { host: 'box.example.ts.net' } },
        ['https://box.example.ts.net:8443'],
      ),
    ).toEqual({ ok: false, reason: 'host-not-allowed' });
  });

  it('accepts an explicit HTTPS default port in Origin', () => {
    const res = assertOrigin(
      { headers: { origin: 'https://box.example.ts.net:443', host: 'box.example.ts.net' } },
      ['https://box.example.ts.net'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('keeps bracketed IPv6 Hosts intact', () => {
    const res = assertOrigin(
      { headers: { host: '[2001:db8::1]' } },
      ['https://[2001:db8::1]'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('fails closed on malformed Host authorities', () => {
    const res = assertOrigin(
      { headers: { host: 'box.example.ts.net:443:1' } },
      ['https://box.example.ts.net'],
    );
    expect(res).toEqual({ ok: false, reason: 'host-not-allowed' });
  });
});

describe('originPlugin over HTTP', () => {
  it('accepts the configured origin', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, false);
    allowed.push(`http://127.0.0.1:${port}`);
    const res = await rawGet(port, '/probe', {
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request whose Origin != the configured ts.net RP origin', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, false);
    allowed.push(`http://127.0.0.1:${port}`);
    const res = await rawGet(port, '/probe', {
      origin: 'https://evil.example',
      host: `127.0.0.1:${port}`,
    });
    expect(res.status).toBe(403);
  });

  it('rejects a request with a mismatched Host (DNS-rebinding guard)', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, false);
    allowed.push(`http://127.0.0.1:${port}`);
    const res = await rawGet(port, '/probe', { host: 'attacker.example' });
    expect(res.status).toBe(403);
  });
});

describe('originPlugin over the WebSocket upgrade', () => {
  it('accepts a WebSocket upgrade from the configured origin', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, true);
    allowed.push(`http://127.0.0.1:${port}`);
    const probe = await wsProbe(port, {
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`,
    });
    expect(probe.opened).toBe(true);
    expect(probe.closeCode === undefined || probe.closeCode === 1000 || probe.closeCode === 1006).toBe(
      true,
    );
  });

  it('rejects a WebSocket upgrade with a mismatched Host', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, true);
    allowed.push(`http://127.0.0.1:${port}`);
    const probe = await wsProbe(port, { host: 'attacker.example' });
    // Never left in a healthy open state: either the upgrade was refused pre-handshake,
    // or the handler policy-closed it (1008).
    expect(probe.opened && probe.closeCode === undefined).toBe(false);
  });

  it('rejects a WebSocket upgrade whose Origin is not allowed', async () => {
    const allowed: string[] = [];
    const port = await boot(allowed, true);
    allowed.push(`http://127.0.0.1:${port}`);
    const probe = await wsProbe(port, {
      origin: 'https://evil.example',
      host: `127.0.0.1:${port}`,
    });
    expect(probe.opened && probe.closeCode === undefined).toBe(false);
  });
});

describe('resolveAllowedOrigins', () => {
  it('is fail-closed (empty) when no origin env is configured', () => {
    expect(resolveAllowedOrigins({})).toEqual([]);
  });

  it('includes the ts.net RP origin from DASHBOARD_RP_ORIGIN', () => {
    const list = resolveAllowedOrigins({ DASHBOARD_RP_ORIGIN: 'https://box.example.ts.net' });
    expect(list).toContain('https://box.example.ts.net');
  });

  it('adds the localhost dev origin only when explicitly enrolled', () => {
    const off = resolveAllowedOrigins({ DASHBOARD_RP_ORIGIN: 'https://box.example.ts.net' });
    expect(off.some((o) => o.includes('localhost'))).toBe(false);
    const on = resolveAllowedOrigins({
      DASHBOARD_RP_ORIGIN: 'https://box.example.ts.net',
      DASHBOARD_DEV_ORIGIN: 'http://localhost:4317',
    });
    expect(on).toContain('http://localhost:4317');
  });
});

describe('resolveAllowedOrigins in tailnet mode', () => {
  const TAILNET = { DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_HOST: 'kb.tail82dd4f.ts.net' };

  it('derives the allowlist from the tailscale serve host', () => {
    expect(resolveAllowedOrigins(TAILNET)).toEqual(['https://kb.tail82dd4f.ts.net']);
  });

  it('IGNORES a stale DASHBOARD_RP_ORIGIN — the WebAuthn RP origin leaves the unit in this mode', () => {
    expect(resolveAllowedOrigins({ ...TAILNET, DASHBOARD_RP_ORIGIN: 'https://old.example.ts.net' }))
      .toEqual(['https://kb.tail82dd4f.ts.net']);
  });

  it('stays fail-closed (empty) when the serve host is unset', () => {
    expect(resolveAllowedOrigins({ DASHBOARD_AUTH_MODE: 'tailnet' })).toEqual([]);
  });

  it('still honours an explicitly enrolled dev origin', () => {
    expect(resolveAllowedOrigins({ ...TAILNET, DASHBOARD_DEV_ORIGIN: 'http://localhost:4317' }))
      .toEqual(['https://kb.tail82dd4f.ts.net', 'http://localhost:4317']);
  });
});
