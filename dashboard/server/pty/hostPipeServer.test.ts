/**
 * D3.1e — cross-identity pipe SERVER orchestration. Hermetic: fake `PtyPipeTransport` + `PtyPeerFfi` + a
 * fake `PtyHost` (no koffi, no node-pty). Proves the CROSS-USER auth inversion and dual-factor discipline:
 * only Daniel's SID + the correct per-boot token is dispatched; the host's own SID, a third SID, a wrong
 * token, a missing token, and an unresolved peer credential are each rejected with NO spawn — and a
 * squatted first instance fails `listen()` closed.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHostPipeServer } from './hostPipeServer.ts';
import type { PipeHandle, PtyPeerFfi, PtyPipeTransport } from './hostPipeServer.ts';
import type { ControlFrame, InboundFrame, PtyServerChannel } from './ptyProtocol.ts';
import type { PtyHost, PtySession, PtyHandle } from './host.ts';

const OWNER = 'S-1-5-21-732142867-588960626-3228783940-1007'; // kb-fleet (host's own)
const DANIEL = 'S-1-5-21-732142867-588960626-3228783940-1001'; // authorized peer
const OTHER = 'S-1-5-21-999999999-888888888-777777777-1234'; // a third account
const TOKEN = 'f'.repeat(64);

/** Encode a canonical "S-1-<auth>-<sub…>" SID into the raw bytes `parseSidString` consumes. */
function sidToBytes(sid: string): Uint8Array {
  const parts = sid.split('-');
  const rev = Number(parts[1]);
  const authority = BigInt(parts[2]);
  const subs = parts.slice(3).map((s) => Number(s));
  const bytes = new Uint8Array(8 + subs.length * 4);
  bytes[0] = rev;
  bytes[1] = subs.length;
  for (let i = 0; i < 6; i++) bytes[2 + i] = Number((authority >> BigInt((5 - i) * 8)) & 0xffn);
  subs.forEach((v, i) => {
    const o = 8 + i * 4;
    bytes[o] = v & 0xff;
    bytes[o + 1] = (v >>> 8) & 0xff;
    bytes[o + 2] = (v >>> 16) & 0xff;
    bytes[o + 3] = (v >>> 24) & 0xff;
  });
  return bytes;
}

function fakeHandle(): PtyHandle {
  return {
    pid: 1,
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
}

function fakeHost() {
  const open = vi.fn((): PtySession => ({ sessionId: 'pty-1', handle: fakeHandle() }));
  const host: PtyHost = { open, stop: () => true, stopAll: () => {}, sessions: () => [] };
  return { host, open };
}

/** One connection's fake server channel: yields a single queued `open` frame, records sent frames. */
function fakeChannel(openFrame: InboundFrame) {
  const sent: ControlFrame[] = [];
  let pulled = false;
  const channel: PtyServerChannel = {
    nextFrame: async () => {
      if (pulled) return null;
      pulled = true;
      return openFrame;
    },
    sendFrame(f) {
      sent.push(f);
      return true;
    },
    onFrame: () => {},
    onClose: () => {},
    close: () => {},
  };
  return { channel, sent };
}

/** A transport that drives exactly ONE connection (the first instance), so a test can inspect its frames.
 *  Replacement instances stay in `accept` until `closeConnection` unwinds them (mirrors the real transport,
 *  where closing the handle makes the pending accept fail — so `server.close()` never hangs). */
function fakeTransport(openFrame: InboundFrame) {
  let seq = 0;
  const channels: Array<ReturnType<typeof fakeChannel>> = [];
  const rejecters = new Map<PipeHandle, () => void>();
  const transport: PtyPipeTransport = {
    createPipe: () => ({ id: seq++ }) as PipeHandle,
    accept: (handle) =>
      (handle as { id: number }).id === 0
        ? Promise.resolve()
        : new Promise<void>((_resolve, reject) => rejecters.set(handle, () => reject(new Error('closed')))),
    channel: () => {
      const fc = fakeChannel(openFrame);
      channels.push(fc);
      return fc.channel;
    },
    closeConnection: (handle) => {
      rejecters.get(handle)?.();
      rejecters.delete(handle);
    },
  };
  return { transport, firstSent: () => channels[0]?.sent ?? [] };
}

function peerReturning(sid: string | null): PtyPeerFfi {
  return {
    getClientSidBytes: () => (sid == null ? null : sidToBytes(sid)),
    getClientPid: () => 4321,
  };
}

const openFrame = (token: string | undefined): InboundFrame => ({
  type: 'open',
  ...(token === undefined ? {} : { token }),
  requestId: 'req-1',
  cols: 80,
  rows: 24,
  cwd: '/repo',
  sessionSubject: 'operator-1',
});

async function run(peerSid: string | null, token: string | undefined) {
  const ft = fakeTransport(openFrame(token));
  const host = fakeHost();
  const server = createHostPipeServer({
    pipeName: '\\\\.\\pipe\\kb-pty-host-test',
    expectedPeerSid: DANIEL,
    bootToken: TOKEN,
    transport: ft.transport,
    peerFfi: peerReturning(peerSid),
    host: host.host,
    isRunnable: () => true,
    openDefaults: { cwd: '/repo', cols: 80, rows: 24 },
  });
  await server.listen();
  await new Promise((r) => setTimeout(r, 20)); // let the connection be handled
  await server.close();
  return { sent: ft.firstSent(), open: host.open };
}

describe('createHostPipeServer — cross-user dual-factor auth', () => {
  it('ACCEPTS Daniel + correct token → spawns the session, sends open-ack', async () => {
    const { sent, open } = await run(DANIEL, TOKEN);
    expect(open).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ type: 'open-ack', sessionId: 'pty-1' });
    expect(sent.find((f) => f.type === 'open-nack')).toBeUndefined();
  });

  it("REJECTS the host's OWN (kb-fleet) SID even with the correct token — auth is inverted to the peer", async () => {
    const { sent, open } = await run(OWNER, TOKEN);
    expect(open).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ type: 'open-nack', error: 'unauthenticated: peer-credential' });
  });

  it('REJECTS a third account SID', async () => {
    const { sent, open } = await run(OTHER, TOKEN);
    expect(open).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({ type: 'open-nack', error: 'unauthenticated: peer-credential' });
  });

  it('REJECTS Daniel with a WRONG token (bad-token) — no spawn', async () => {
    const { sent, open } = await run(DANIEL, 'deadbeef');
    expect(open).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({ type: 'open-nack', error: 'unauthenticated: bad-token' });
  });

  it('REJECTS a missing token (bad-token) even from Daniel', async () => {
    const { sent, open } = await run(DANIEL, undefined);
    expect(open).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({ type: 'open-nack', error: 'unauthenticated: bad-token' });
  });

  it('REJECTS when the peer credential cannot be resolved (impersonation failed), even with the token', async () => {
    const { sent, open } = await run(null, TOKEN);
    expect(open).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({ type: 'open-nack', error: 'unauthenticated: peer-credential' });
  });
});

describe('createHostPipeServer — FIX 4: `live` handle set does not leak on normal completion', () => {
  it('drops a handle from `live` when its session closes normally (server.close() no longer re-closes it)', async () => {
    let seq = 0;
    const closedIds: number[] = [];
    const rejecters = new Map<PipeHandle, () => void>();

    // A controllable server channel for the (single) real connection: yields one `open` frame, lets the test
    // drive an inbound `stop`, and fires onClose from close() so teardown propagates like the real channel.
    let pulled = false;
    let onFrameCb: ((f: InboundFrame) => void) | null = null;
    let onCloseCb: (() => void) | null = null;
    let chClosed = false;
    const connChannel: PtyServerChannel = {
      nextFrame: async () => {
        if (pulled) return null;
        pulled = true;
        return openFrame(TOKEN);
      },
      sendFrame: () => true,
      onFrame: (cb) => {
        onFrameCb = cb;
      },
      onClose: (cb) => {
        onCloseCb = cb;
        if (chClosed) cb();
      },
      close: () => {
        if (chClosed) return;
        chClosed = true;
        onCloseCb?.();
      },
    };

    const transport: PtyPipeTransport = {
      createPipe: () => ({ id: seq++ }) as PipeHandle,
      accept: (handle) =>
        (handle as { id: number }).id === 0
          ? Promise.resolve()
          : new Promise<void>((_resolve, reject) => rejecters.set(handle, () => reject(new Error('closed')))),
      channel: () => connChannel, // only handle 0 is ever channel()'d
      closeConnection: (handle) => {
        closedIds.push((handle as { id: number }).id);
        rejecters.get(handle)?.();
        rejecters.delete(handle);
      },
    };

    const fireInbound = (f: InboundFrame): void => onFrameCb?.(f);

    const host = fakeHost();
    const server = createHostPipeServer({
      pipeName: '\\\\.\\pipe\\kb-pty-host-test',
      expectedPeerSid: DANIEL,
      bootToken: TOKEN,
      transport,
      peerFfi: peerReturning(DANIEL),
      host: host.host,
      isRunnable: () => true,
      openDefaults: { cwd: '/repo', cols: 80, rows: 24 },
    });

    await server.listen();
    await new Promise((r) => setTimeout(r, 20)); // let handle 0 be authed + session wired
    expect(host.open).toHaveBeenCalledTimes(1);

    // The session closes normally (daemon `stop`) → teardown → channel.close() → FIX 4 drops handle 0 from live.
    fireInbound({ type: 'stop' });
    await new Promise((r) => setTimeout(r, 5));

    await server.close();

    // Handle 0 (the completed session) must NOT be re-closed by server.close() — it already left `live`.
    // The still-accepting replacement (handle 1) IS torn down by close(), proving close() still works.
    expect(closedIds).not.toContain(0);
    expect(closedIds).toContain(1);
  });
});

describe('createHostPipeServer — squat defense', () => {
  it('listen() rejects (fail-closed) when the first pipe instance cannot be created', async () => {
    const transport: PtyPipeTransport = {
      createPipe: () => null, // name squatted / access denied
      accept: () => new Promise<void>(() => {}),
      channel: () => {
        throw new Error('should never be reached');
      },
      closeConnection: () => {},
    };
    const host = fakeHost();
    const server = createHostPipeServer({
      pipeName: '\\\\.\\pipe\\kb-pty-host-test',
      expectedPeerSid: DANIEL,
      bootToken: TOKEN,
      transport,
      peerFfi: peerReturning(DANIEL),
      host: host.host,
      isRunnable: () => true,
      openDefaults: { cwd: '/repo', cols: 80, rows: 24 },
    });
    await expect(server.listen()).rejects.toThrow(/fail-closed/);
  });
});
