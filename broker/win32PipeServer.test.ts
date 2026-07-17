import { describe, it, expect } from 'vitest';
import {
  createWin32PipeServer,
  resolveClientCredential,
} from './win32PipeServer.ts';
import type { PipeHandle, Win32PeerFfi, Win32PipeTransport } from './win32PipeServer.ts';
import type { ControlRequest, SocketAuthContext } from './socket.ts';
import type { SessionOwner } from './index.ts';

const DAEMON_SID = 'S-1-5-21-11-22-33-1001';
const OTHER_SID = 'S-1-5-21-99-88-77-500';
const TOKEN = 'a'.repeat(64);
const authCtx: SocketAuthContext = { expectedOwnerId: DAEMON_SID, bootToken: TOKEN };

/** Build raw SID bytes for a given "S-1-5-…" string (inverse of parseSidString) for the fake peer FFI. */
function sidBytes(sid: string): Uint8Array {
  const parts = sid.split('-').slice(1); // drop leading "S"
  const revision = Number(parts[0]);
  const authority = BigInt(parts[1]);
  const subs = parts.slice(2).map((s) => Number(s));
  const b = new Uint8Array(8 + subs.length * 4);
  b[0] = revision;
  b[1] = subs.length;
  let a = authority;
  for (let i = 5; i >= 0; i--) {
    b[2 + i] = Number(a & 0xffn);
    a >>= 8n;
  }
  subs.forEach((s, i) => {
    const o = 8 + i * 4;
    b[o] = s & 0xff;
    b[o + 1] = (s >>> 8) & 0xff;
    b[o + 2] = (s >>> 16) & 0xff;
    b[o + 3] = (s >>> 24) & 0xff;
  });
  return b;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface FakePeerOpts {
  pidNull?: boolean;
  sidNull?: boolean; // impersonation / thread-token / token-query failed → SID bytes null (fail closed)
  malformedSid?: boolean;
  sid?: string; // which SID the peer resolves to (default: daemon → match)
}
function fakePeerFfi(opts: FakePeerOpts = {}): Win32PeerFfi {
  return {
    getClientSidBytes: () => {
      if (opts.sidNull) return null;
      if (opts.malformedSid) return new Uint8Array([1, 5]); // too short → parseSidString throws
      return sidBytes(opts.sid ?? DAEMON_SID);
    },
    getClientPid: () => (opts.pidNull ? null : 4321), // informational only
  };
}

interface FakeTransportOpts {
  line?: string | null;
  readRejects?: boolean;
  firstCreateNull?: boolean;
}
function fakeTransport(opts: FakeTransportOpts = {}) {
  const created: Array<{ firstInstance: boolean; handle: PipeHandle }> = [];
  const written = new Map<PipeHandle, string[]>();
  const closedHandles: PipeHandle[] = [];
  // A replacement instance's accept stays pending until its handle is closed — mirroring the real api,
  // where closeConnection() unblocks a pending accept (so close() can deterministically await teardown).
  const pendingAccept = new Map<PipeHandle, (err: Error) => void>();
  let counter = 0;
  const transport: Win32PipeTransport = {
    createPipe: (_name, firstInstance) => {
      if (opts.firstCreateNull && created.length === 0) return null;
      const h = `h${++counter}`;
      created.push({ firstInstance, handle: h });
      written.set(h, []);
      return h;
    },
    // The first instance gets the one client; replacements stay pending until closed.
    accept: (handle) =>
      handle === 'h1'
        ? Promise.resolve()
        : new Promise<void>((_resolve, reject) => pendingAccept.set(handle, reject)),
    readLine: (_h) => (opts.readRejects ? Promise.reject(new Error('read blew up')) : Promise.resolve(opts.line ?? null)),
    write: (handle, data) => {
      written.get(handle)!.push(data);
      return true;
    },
    flush: () => Promise.resolve(),
    closeConnection: (handle) => {
      closedHandles.push(handle);
      const reject = pendingAccept.get(handle);
      if (reject) {
        pendingAccept.delete(handle);
        reject(new Error('closed'));
      }
    },
  };
  return { transport, created, written, closedHandles };
}

async function drive(opts: {
  line?: string | null;
  readRejects?: boolean;
  peer?: FakePeerOpts;
  dispatch?: (owner: SessionOwner, req: ControlRequest) => unknown;
}) {
  const t = fakeTransport({ line: opts.line, readRejects: opts.readRejects });
  const dispatchCalls: ControlRequest[] = [];
  const errors: unknown[] = [];
  const dispatch =
    opts.dispatch ??
    ((_o: SessionOwner, req: ControlRequest) => {
      dispatchCalls.push(req);
      return { ok: true, sessions: [] };
    });
  const server = createWin32PipeServer({
    pipeName: '\\\\.\\pipe\\kb-test',
    transport: t.transport,
    peerFfi: fakePeerFfi(opts.peer),
    auth: authCtx,
    owner: {} as SessionOwner,
    dispatch,
    onError: (e) => errors.push(e),
  });
  await server.listen();
  await tick();
  await tick();
  const firstResponses = t.written.get('h1') ?? [];
  await server.close();
  return { ...t, dispatchCalls, errors, firstResponses };
}

describe('resolveClientCredential (fail-closed peer SID resolution)', () => {
  it('resolves { ownerId (impersonated SID), pid (informational) } when both are available', () => {
    const cred = resolveClientCredential('h', fakePeerFfi());
    expect(cred).toEqual({ ownerId: DAEMON_SID, pid: 4321 });
  });
  it('returns null when the impersonated client SID cannot be read (fail closed)', () => {
    expect(resolveClientCredential('h', fakePeerFfi({ sidNull: true }))).toBeNull();
  });
  it('still resolves (pid is informational) when only the client PID cannot be read', () => {
    // pid null does NOT reject — the auth decision is the impersonated SID, not the pid.
    expect(resolveClientCredential('h', fakePeerFfi({ pidNull: true }))).toEqual({ ownerId: DAEMON_SID, pid: undefined });
  });
  it('returns null (never throws) when the SID bytes are malformed', () => {
    expect(resolveClientCredential('h', fakePeerFfi({ malformedSid: true }))).toBeNull();
  });
});

describe('createWin32PipeServer connection handling', () => {
  it('accepts and dispatches when peer SID matches the daemon AND the token is valid', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }) });
    expect(r.dispatchCalls.length).toBe(1);
    expect(r.firstResponses[0]).toContain('sessions');
  });

  it('rejects (bad-token) with a valid peer but a WRONG token — never dispatches', async () => {
    const r = await drive({ line: JSON.stringify({ token: 'b'.repeat(64), verb: 'list' }) });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('unauthenticated: bad-token');
  });

  it('rejects (bad-token) when no token is supplied', async () => {
    const r = await drive({ line: JSON.stringify({ verb: 'list' }) });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('unauthenticated: bad-token');
  });

  it('rejects (peer-credential) when the impersonated client SID cannot be read — even with a valid token', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }), peer: { sidNull: true } });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('unauthenticated: peer-credential');
  });

  it('accepts even when the informational client PID cannot be read (pid is not the auth factor)', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }), peer: { pidNull: true } });
    expect(r.dispatchCalls.length).toBe(1);
    expect(r.firstResponses[0]).toContain('sessions');
  });

  it('rejects (peer-credential) when the SID bytes are malformed (parse throws → null)', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }), peer: { malformedSid: true } });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('unauthenticated: peer-credential');
  });

  it('rejects (peer-credential) when the peer SID differs from the daemon SID', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }), peer: { sid: OTHER_SID } });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('unauthenticated: peer-credential');
  });

  it('rejects a malformed JSON request line (never dispatches)', async () => {
    const r = await drive({ line: 'not json{' });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses[0]).toContain('malformed request line');
  });

  it('closes cleanly with no response when readLine yields null (EOF)', async () => {
    const r = await drive({ line: null });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.firstResponses.length).toBe(0);
    expect(r.closedHandles).toContain('h1');
  });

  it('never crashes when readLine throws — reports, closes, does not dispatch (LOW-1)', async () => {
    const r = await drive({ readRejects: true });
    expect(r.dispatchCalls.length).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.closedHandles).toContain('h1');
  });

  it('returns a JSON error (never crashes) when dispatch throws', async () => {
    const r = await drive({
      line: JSON.stringify({ token: TOKEN, verb: 'boom' }),
      dispatch: () => {
        throw new Error('verb blew up');
      },
    });
    expect(r.firstResponses[0]).toContain('verb blew up');
  });

  it('spins up a replacement instance after a client connects (concurrency)', async () => {
    const r = await drive({ line: JSON.stringify({ token: TOKEN, verb: 'list' }) });
    // First instance uses FIRST_PIPE_INSTANCE; a replacement is created without it after the accept.
    expect(r.created[0].firstInstance).toBe(true);
    expect(r.created.length).toBeGreaterThanOrEqual(2);
    expect(r.created[1].firstInstance).toBe(false);
  });
});

describe('createWin32PipeServer.listen fail-closed', () => {
  it('rejects when the first pipe instance cannot be created (squat / access denied)', async () => {
    const t = fakeTransport({ firstCreateNull: true });
    const server = createWin32PipeServer({
      pipeName: '\\\\.\\pipe\\kb-test',
      transport: t.transport,
      peerFfi: fakePeerFfi(),
      auth: authCtx,
      owner: {} as SessionOwner,
      dispatch: () => ({ ok: true }),
    });
    await expect(server.listen()).rejects.toThrow(/fail-closed/);
  });
});
