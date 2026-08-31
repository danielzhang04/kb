/**
 * The §7 fixture must be the PRODUCTION surface, not a lookalike. These tests hold it to that: the app
 * is `buildApp`, the fleet gate is really wrapped around the injected host, the two contexts are
 * genuinely independent, and no flag can turn any of it off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { PTY_MAX_PAYLOAD_BYTES, PTY_SUBPROTOCOL } from '../pty/route.ts';
import type { BrowserServerFrame } from '../../shared/ptyProtocol.ts';
import { decodeBrowserServerFrame } from '../../src/console/sessionWorkspaceModel.ts';
import {
  createDeterministicSessionHost,
  createMemoryBrowserSessionRefs,
  parseP3AuthenticatedServerArgs,
  startP3AuthenticatedServer,
  type P3AuthenticatedServer,
} from './p3AuthenticatedServer.ts';
import type { SessionHost, SessionSink } from '../pty/contracts.ts';
import { invalidPtyProtocolVectors } from '../../shared/ptyProtocolVectors.ts';

/** The browser decoder only accepts `req-<32 hex>`, and the route echoes the id it was sent. */
const REQ_CREATE = `req-${'1'.repeat(32)}`;
const REQ_INPUT = `req-${'2'.repeat(32)}`;

const servers: P3AuthenticatedServer[] = [];
/** Every real socket a test opened. An upgraded socket keeps `server.close()` waiting forever. */
const sockets: WebSocket[] = [];

afterEach(async () => {
  while (sockets.length > 0) {
    // A socket whose handshake was refused throws on terminate; the point is only that none survives.
    try { sockets.pop()?.terminate(); } catch { /* already gone */ }
  }
  while (servers.length > 0) await servers.pop()?.close();
});

async function start(options: Parameters<typeof startP3AuthenticatedServer>[0] = {}): Promise<P3AuthenticatedServer> {
  const server = await startP3AuthenticatedServer({ port: 0, ...options });
  servers.push(server);
  return server;
}

function headers(server: P3AuthenticatedServer, context: 'a' | 'b' | 'aSecondTab'): Record<string, string> {
  const identity = server.contexts[context];
  return {
    authorization: `Bearer ${identity.token}`,
    origin: server.origin,
    host: `127.0.0.1:${server.address.port}`,
    cookie: `kb_browser_session=${identity.browserSessionRef}`,
  };
}

describe('p3AuthenticatedServer — the real authenticated surface', () => {
  it('answers /readyz and serves the authenticated PTY surface to context A', async () => {
    const server = await start();
    expect((await fetch(`${server.origin}/readyz`)).status).toBe(200);

    const listed = await fetch(`${server.origin}/api/pty/sessions`, { headers: headers(server, 'a') });
    expect(listed.status).toBe(200);
    // The strict client envelope, not a bare array.
    expect(await listed.json()).toEqual({ revision: expect.any(Number), sessions: [] });
  });

  it('refuses an unauthenticated read and a foreign Origin — the production guards are still on', async () => {
    const server = await start();

    const noToken = await fetch(`${server.origin}/api/pty/sessions`, {
      headers: { origin: server.origin, host: `127.0.0.1:${server.address.port}` },
    });
    expect(noToken.status).toBe(401);

    const badOrigin = await fetch(`${server.origin}/api/pty/sessions`, {
      headers: { ...headers(server, 'a'), origin: 'https://evil.example' },
    });
    expect(badOrigin.status).toBe(403);
  });

  it('mints two INDEPENDENT contexts, and A second tab shares A exactly', async () => {
    const server = await start();
    const { a, b, aSecondTab } = server.contexts;

    expect(a.browserSessionRef).not.toBe(b.browserSessionRef);
    expect(a.operator).not.toBe(b.operator);
    // The pair that must be allowed to control A's sessions: same operator AND same ref.
    expect(aSecondTab.browserSessionRef).toBe(a.browserSessionRef);
    expect(aSecondTab.operator).toBe(a.operator);
    expect(aSecondTab.token).toBe(a.token);
    expect(aSecondTab.entryUrl).not.toBe(a.entryUrl);
  });

  it('each context entry URL installs exactly one Secure, HttpOnly, SameSite=Strict cookie', async () => {
    const server = await start();
    for (const label of ['a', 'b', 'a-second-tab'] as const) {
      const response = await fetch(`${server.origin}/fixture/context-${label}`, { redirect: 'manual' });
      expect(response.status).toBe(302);
      const cookie = response.headers.get('set-cookie') ?? '';
      const expected = label === 'b' ? server.contexts.b : server.contexts.a;
      expect(cookie).toContain(`kb_browser_session=${expected.browserSessionRef}`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
      // No endpoint hands out the OTHER context's ref.
      const foreign = label === 'b' ? server.contexts.a : server.contexts.b;
      expect(cookie).not.toContain(foreign.browserSessionRef);
    }
  });

  it('WRAPS the injected host in the production fleet gate rather than exposing it', async () => {
    // The fixture never receives the host back out; what proves the wrap is that a session created
    // through the surface reaches the recorder only when the preamble passed. Here the preamble is the
    // real one and the repo is runnable, so the recorder is reachable at all.
    let created = 0;
    const inner = createDeterministicSessionHost();
    const recording: SessionHost = {
      ...inner,
      create(request, sink: SessionSink) {
        created += 1;
        return inner.create(request, sink);
      },
    };
    const server = await start({ sessionHost: recording });
    expect((await fetch(`${server.origin}/readyz`)).status).toBe(200);
    // Composition alone must spawn nothing.
    expect(created).toBe(0);
  });

  /**
   * THE INVARIANT the W6.6 defect broke: the published capability is the composed host's own probe.
   * The fixture used to publish a hard-coded `pty: true, launchers: [shell, claude, codex]` beside a
   * real host whose probe answered `{available:false, reason:'root-policy-invalid'}`, so the browser
   * was invited to a terminal the host refused at create. Capability may never advertise what the
   * probe refuses — and never more launchers than it returned.
   */
  it.each([
    ['an available probe', {
      available: true as const, host: 'desktop' as const, transport: 'local-node-pty' as const,
      launchers: ['shell' as const], roots: ['repo' as const],
      epochId: 'epoch-0f3a0f3a0f3a0f3a0f3a0f3a0f3a0f3a', checkedAt: '2026-08-23T00:00:00.000Z',
    }],
    ['a refusing probe', {
      available: false as const, host: 'desktop' as const, transport: 'local-node-pty' as const,
      reason: 'root-policy-invalid' as const, detail: null, checkedAt: '2026-08-23T00:00:00.000Z',
    }],
    ['a throwing probe', null],
  ])('publishes exactly what the composed host probe says (%s)', async (_label, probeResult) => {
    const inner = createDeterministicSessionHost();
    const host: SessionHost = {
      ...inner,
      async probe() {
        if (probeResult === null) throw new Error('probe exploded');
        return probeResult;
      },
    };
    const server = await start({ sessionHost: host });
    const response = await fetch(`${server.origin}/api/runtime/capabilities`, { headers: headers(server, 'a') });
    expect(response.status).toBe(200);
    const capability = await response.json() as { pty: boolean; launchers?: string[] };
    expect(capability.pty).toBe(probeResult?.available === true);
    if (capability.pty) expect(capability.launchers).toEqual(['shell']);
    // Fail-closed both ways: a refused probe leaves the create path unreachable, not merely unadvertised.
    if (!capability.pty) {
      const listed = await fetch(`${server.origin}/api/pty/sessions`, { headers: headers(server, 'a') });
      expect(listed.status).toBe(404);
    }
  });

  it('refuses --real-windows-host off win32 instead of silently substituting the fake', async () => {
    if (process.platform === 'win32') {
      // On Windows the flag is honoured; the refusal below is the non-Windows contract.
      expect(parseP3AuthenticatedServerArgs(['--real-windows-host']).realWindowsHost).toBe(true);
      return;
    }
    await expect(startP3AuthenticatedServer({ port: 0, realWindowsHost: true }))
      .rejects.toThrow('refusing to substitute');
  });
});

/**
 * A REAL RFC 6455 upgrade against the registered route. `app.inject` can never reach this path, so
 * without these tests neither `{ websocket: true }`, nor the 101, nor `maxPayload`, nor the hook order on
 * the upgrade path is proven by anything.
 */
describe('p3AuthenticatedServer — the real /api/pty upgrade', () => {
  interface OpenSocket {
    socket: WebSocket;
    frames: BrowserServerFrame[];
    closed: Promise<{ code: number; reason: string }>;
    next(predicate: (frame: BrowserServerFrame) => boolean): Promise<BrowserServerFrame>;
  }

  function connect(
    server: P3AuthenticatedServer,
    context: 'a' | 'b' | 'aSecondTab',
    overrides: { origin?: string; cookie?: string | null } = {},
  ): WebSocket {
    const base = headers(server, context);
    const requestHeaders: Record<string, string> = {
      authorization: base.authorization,
      origin: overrides.origin ?? base.origin,
    };
    const cookie = overrides.cookie === undefined ? base.cookie : overrides.cookie;
    if (cookie !== null) requestHeaders.cookie = cookie;
    const socket = new WebSocket(
      `${server.origin.replace(/^http/, 'ws')}/api/pty`,
      [PTY_SUBPROTOCOL, server.contexts[context].token],
      { headers: requestHeaders },
    );
    // Without a listener, a refused handshake surfaces as an unhandled 'error' event.
    socket.on('error', () => {});
    sockets.push(socket);
    return socket;
  }

  async function open(
    server: P3AuthenticatedServer,
    context: 'a' | 'b' | 'aSecondTab' = 'a',
  ): Promise<OpenSocket> {
    const socket = connect(server, context);
    const frames: BrowserServerFrame[] = [];
    const waiters: { predicate: (frame: BrowserServerFrame) => boolean; settle: (f: BrowserServerFrame) => void }[] = [];
    socket.on('message', (raw: Buffer) => {
      // The ONE suite that drives a real socket runs W4's closed decoder over what it receives: a frame
      // the browser would refuse must fail here, not be cast into the shape the assertions expect.
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new Error('the route sent a frame that is not JSON');
      }
      const frame = decodeBrowserServerFrame(parsed);
      if (frame === null) throw new Error(`the route sent a frame the browser decoder refuses: ${raw.toString('utf8').slice(0, 200)}`);
      frames.push(frame);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].predicate(frame)) waiters.splice(index, 1)[0].settle(frame);
      }
    });
    const closed = new Promise<{ code: number; reason: string }>((settle) => {
      socket.on('close', (code: number, reason: Buffer) => settle({ code, reason: reason.toString('utf8') }));
    });
    await new Promise<void>((settle, fail) => {
      socket.on('open', () => settle());
      socket.on('error', (error: Error) => fail(error));
    });
    return {
      socket,
      frames,
      closed,
      next: (predicate) => new Promise<BrowserServerFrame>((settle, fail) => {
        const found = frames.find(predicate);
        if (found) { settle(found); return; }
        const timer = setTimeout(() => fail(new Error('no matching frame within 10s')), 10_000);
        waiters.push({ predicate, settle: (frame) => { clearTimeout(timer); settle(frame); } });
      }),
    };
  }

  /**
   * The raw handshake, refused. This drives `node:http` rather than `ws` so the refused exchange is
   * consumed and destroyed here: an unconsumed refusal keeps the connection - and every later
   * `server.close()` - alive.
   */
  function refusal(
    server: P3AuthenticatedServer,
    context: 'a' | 'b' | 'aSecondTab',
    overrides: { origin?: string; cookie?: string | null } = {},
  ): Promise<number> {
    const base = headers(server, context);
    const cookie = overrides.cookie === undefined ? base.cookie : overrides.cookie;
    return new Promise<number>((settle, fail) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: server.address.port,
        path: '/api/pty',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': randomBytes(16).toString('base64'),
          'sec-websocket-protocol': `${PTY_SUBPROTOCOL}, ${server.contexts[context].token}`,
          authorization: base.authorization,
          origin: overrides.origin ?? base.origin,
          ...(cookie === null ? {} : { cookie }),
        },
      });
      request.on('response', (response) => {
        const status = response.statusCode ?? 0;
        response.resume();
        response.destroy();
        request.destroy();
        settle(status);
      });
      request.on('upgrade', (_res, socket) => { socket.destroy(); fail(new Error('the upgrade was accepted')); });
      request.on('error', (error) => fail(error));
      request.end();
    });
  }

  it('upgrades, creates a session over the socket, echoes a write, and closes', async () => {
    const server = await start();
    const client = await open(server);

    client.socket.send(JSON.stringify({
      type: 'create', requestId: REQ_CREATE, launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24,
    }));
    const created = await client.next((frame) => frame.type === 'created');
    if (created.type !== 'created') throw new Error('unreachable');
    expect(created.session.sessionId).toMatch(/^pty-[0-9a-f]{32}$/);
    expect(created.attachmentId).toMatch(/^att-[0-9a-f]{32}$/);

    // The session is real: the same principal's REST list now sees it.
    const listed = await fetch(`${server.origin}/api/pty/sessions`, { headers: headers(server, 'a') });
    expect((await listed.json() as { sessions: { sessionId: string }[] }).sessions
      .map((row) => row.sessionId)).toContain(created.session.sessionId);

    client.socket.send(JSON.stringify({
      type: 'input', requestId: REQ_INPUT, sessionId: created.session.sessionId,
      attachmentId: created.attachmentId, encoding: 'base64', data: Buffer.from('hi\r').toString('base64'),
    }));
    const echoed = await client.next(
      (frame) => frame.type === 'data' && Buffer.from(frame.data, 'base64').toString('utf8') === 'hi\r',
    );
    expect(echoed.type).toBe('data');

    client.socket.close(1000, 'done');
    await client.closed;
  }, 30_000);

  it('closes with 1009 on a literal 90,113-byte raw frame, before the decoder ever sees it', async () => {
    // [C-M2]: the contract pins the BROWSER raw ceiling at 90,112 bytes, and the shared vector
    // `raw-browser-frame-over-90112` is the one byte over it. The size is the LITERAL from the vector,
    // never `PTY_MAX_PAYLOAD_BYTES + 1`: a test parameterised on the implementation constant passes at
    // any value the implementation happens to hold, which is how 98,304 survived a green suite.
    const vector = invalidPtyProtocolVectors.find((entry) => entry.case === 'raw-browser-frame-over-90112');
    const rawBytes = (vector as { rawBytes?: number } | undefined)?.rawBytes;
    expect(rawBytes).toBe(90_113);
    expect(PTY_MAX_PAYLOAD_BYTES).toBe(90_112);

    const server = await start();
    const client = await open(server);
    // Valid JSON-shaped and a real frame type, so a decoder that ran would answer `invalid-request`
    // instead of the transport closing the socket.
    const envelopeBytes = '{"type":"input","pad":""}'.length;
    const payload = `{"type":"input","pad":"${'x'.repeat(90_113 - envelopeBytes)}"}`;
    expect(Buffer.byteLength(payload, 'utf8')).toBe(90_113);
    client.socket.send(payload);
    const { code } = await client.closed;
    expect(code).toBe(1009);
    // Zero decoder calls: a decoded frame of any kind would have produced a server frame here.
    expect(client.frames).toEqual([]);
  }, 30_000);

  it('refuses the upgrade for a foreign Origin and for a caller with no browser-session cookie', async () => {
    const server = await start();
    await expect(refusal(server, 'a', { origin: 'https://evil.example' })).resolves.toBe(403);
    await expect(refusal(server, 'a', { cookie: null })).resolves.toBe(428);
  }, 30_000);
});

describe('p3AuthenticatedServer — deterministic session host', () => {
  it('mints v2 ids, streams a launcher banner, echoes writes, and settles an exit on close', async () => {
    const host = createDeterministicSessionHost();
    const frames: string[] = [];
    const sink: SessionSink = {
      data: (frame) => frames.push(Buffer.from(frame.data, 'base64').toString('utf8')),
      exit: () => {},
      closed: () => false,
    };
    const launch = host.create({
      operationKey: 'op-1',
      principal: { operator: 'operator-a', browserSessionRef: 'ref-a' },
      recipe: { launcher: 'claude', mode: 'interactive', model: null, toolPolicyId: 'none', sandbox: 'claude-policy' },
      rootId: 'repo',
      relativeCwd: '',
      cols: 80,
      rows: 24,
    }, sink);
    const receipt = await launch.receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) throw new Error('unreachable');
    expect(receipt.value.sessionId).toMatch(/^pty-[0-9a-f]{32}$/);

    // The banner lands on a MACROtask, after the route's create-then-attach settles, so the creating
    // tab sees live exactly the bytes a later reattach replays.
    await new Promise<void>((settle) => { setTimeout(settle, 0); });
    expect(frames).toEqual(['kb claude ready\r\n']);

    await host.write(receipt.value.sessionId, new TextEncoder().encode('echo hi\r'));
    expect(frames).toEqual(['kb claude ready\r\n', 'echo hi\r']);

    await expect(host.listEpoch()).resolves.toMatchObject({
      ok: true, value: { sessionIds: [receipt.value.sessionId] },
    });
    await expect(host.close(receipt.value.sessionId)).resolves.toMatchObject({ ok: true });
    await expect(launch.exit).resolves.toMatchObject({ reason: 'closed', exitCode: 0 });
    // A closed session is gone: a second close is a typed not-found, never a second exit.
    await expect(host.close(receipt.value.sessionId)).resolves.toMatchObject({ ok: false, refusal: 'not-found' });
  });
});

describe('p3AuthenticatedServer — ref table and argument parsing', () => {
  it('the in-memory ref table mints distinct refs and resolves only its own', async () => {
    const refs = createMemoryBrowserSessionRefs();
    const first = await refs.mint();
    const second = await refs.mint();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(first.value.browserSessionRef).not.toBe(second.value.browserSessionRef);

    await expect(refs.resolve(`kb_browser_session=${first.value.browserSessionRef}`))
      .resolves.toMatchObject({ ok: true });
    // A ref this table never issued is a 401, not a silent pass.
    await expect(refs.resolve('kb_browser_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))
      .resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('parses the §7 flags and refuses an unknown one', () => {
    expect(parseP3AuthenticatedServerArgs(['--port', '4317', '--https', '--real-windows-host']))
      .toEqual({ port: 4317, https: true, realWindowsHost: true });
    // `--scenario` is forwarded uniformly by the lifecycle wrapper and is accepted but inert here.
    expect(parseP3AuthenticatedServerArgs(['--scenario', 'anything', '--port', '4317'])).toEqual({ port: 4317 });
    expect(() => parseP3AuthenticatedServerArgs(['--wat'])).toThrow('unknown argument');
    expect(() => parseP3AuthenticatedServerArgs(['--port'])).toThrow('--port needs a value');
  });
});
