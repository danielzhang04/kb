import { describe, it, expect } from 'vitest';
import { connect } from 'node:net';
import { createWin32PipeServer } from './win32PipeServer.ts';
import type { Win32PeerFfi } from './win32PipeServer.ts';
import { loadWin32Api } from './win32Api.ts';
import type { ControlRequest, SocketAuthContext } from './socket.ts';
import type { SessionOwner } from './index.ts';

// REAL Windows integration: a genuine koffi-managed named-pipe server + a genuine Node `net` client,
// same box / same user. Skipped everywhere but win32.
const onWin32 = process.platform === 'win32';
const TOKEN = 'f'.repeat(64);
let pipeSeq = 0;
const uniquePipe = (): string => `\\\\.\\pipe\\kb-broker-it-${process.pid}-${Date.now()}-${pipeSeq++}`;

/** Connect, send one JSON line, resolve the one JSON response line. */
function callPipe(pipeName: string, payload: unknown, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = connect(pipeName);
    let buf = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => { c.destroy(); reject(new Error('client timeout')); }), timeoutMs);
    c.on('connect', () => c.write(JSON.stringify(payload) + '\n'));
    c.on('data', (d) => {
      buf += d.toString('utf-8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) finish(() => { resolve(buf.slice(0, nl)); c.end(); });
    });
    c.on('error', (e) => finish(() => reject(e)));
  });
}

function makeServer(pipeName: string, opts: { peerFfi?: Win32PeerFfi; dispatch?: (o: SessionOwner, r: ControlRequest) => unknown } = {}) {
  const api = loadWin32Api();
  const sid = api.currentSidString();
  if (!sid) throw new Error('daemon SID unresolved on win32');
  const auth: SocketAuthContext = { expectedOwnerId: sid, bootToken: TOKEN };
  return createWin32PipeServer({
    pipeName,
    transport: api,
    peerFfi: opts.peerFfi ?? api,
    auth,
    owner: {} as SessionOwner,
    dispatch: opts.dispatch ?? ((_o, _r) => ({ ok: true, marker: 'PONG' })),
  });
}

describe.skipIf(!onWin32)('win32 pipe server REAL integration (koffi + net client)', () => {
  it('resolves the daemon SID via the token query', () => {
    const sid = loadWin32Api().currentSidString();
    expect(sid).toMatch(/^S-1-\d/);
  });

  it('same-user connect with the correct token → accepted end-to-end (peer SID + token both pass)', async () => {
    const pipeName = uniquePipe();
    const server = makeServer(pipeName);
    await server.listen();
    try {
      const resp = await callPipe(pipeName, { token: TOKEN, verb: 'list' });
      expect(resp).toContain('PONG');
    } finally {
      await server.close();
    }
  });

  it('same-user connect with a WRONG token → rejected (bad-token), never dispatched', async () => {
    const pipeName = uniquePipe();
    let dispatched = false;
    const server = makeServer(pipeName, { dispatch: () => { dispatched = true; return { ok: true }; } });
    await server.listen();
    try {
      const resp = await callPipe(pipeName, { token: 'deadbeef', verb: 'list' });
      expect(resp).toContain('unauthenticated: bad-token');
      expect(dispatched).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('peer read forced to fail → rejected (peer-credential), even with the correct token', async () => {
    const pipeName = uniquePipe();
    const api = loadWin32Api();
    // Real transport, but a peer FFI whose client-PID read fails → SID unresolved → fail closed.
    const failingPeer: Win32PeerFfi = { getClientPid: () => null, getProcessSidBytes: () => null };
    let dispatched = false;
    const sid = api.currentSidString()!;
    const server = createWin32PipeServer({
      pipeName,
      transport: api,
      peerFfi: failingPeer,
      auth: { expectedOwnerId: sid, bootToken: TOKEN },
      owner: {} as SessionOwner,
      dispatch: () => { dispatched = true; return { ok: true }; },
    });
    await server.listen();
    try {
      const resp = await callPipe(pipeName, { token: TOKEN, verb: 'list' });
      expect(resp).toContain('unauthenticated: peer-credential');
      expect(dispatched).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('serves a SECOND concurrent client (replacement instances work)', async () => {
    const pipeName = uniquePipe();
    const server = makeServer(pipeName);
    await server.listen();
    try {
      const [a, b] = await Promise.all([
        callPipe(pipeName, { token: TOKEN, verb: 'list' }),
        callPipe(pipeName, { token: TOKEN, verb: 'list' }),
      ]);
      expect(a).toContain('PONG');
      expect(b).toContain('PONG');
    } finally {
      await server.close();
    }
  });

  it('fails closed at listen when the pipe name is already taken (FIRST_PIPE_INSTANCE squat defense)', async () => {
    const pipeName = uniquePipe();
    const first = makeServer(pipeName);
    await first.listen();
    try {
      const second = makeServer(pipeName);
      await expect(second.listen()).rejects.toThrow(/fail-closed/);
    } finally {
      await first.close();
    }
  });
});
