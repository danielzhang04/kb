/**
 * D3.1h — host-side streaming multiplexer. Hermetic: a fake `PtyFrameChannel` + a fake `PtyHost` (no koffi,
 * no real node-pty). Proves the persistent-connection behaviors: open-ack, output→data, write/resize/stop
 * forwarding, onExit reaping, per-open STOP re-check, and channel-close teardown killing the process group.
 */
import { describe, expect, it, vi } from 'vitest';
import { runHostSession, openRequestFromFrame } from './hostPtySession.ts';
import type { ControlFrame, InboundFrame, PtyFrameChannel } from './ptyProtocol.ts';
import type { HostOpenRequest, PtyHost, PtyHandle, PtySession } from './host.ts';

/** A fake frame channel that records sent frames and lets the test drive inbound frames + close. */
function fakeChannel() {
  const sent: ControlFrame[] = [];
  let onFrameCb: ((f: InboundFrame) => void) | null = null;
  let onCloseCb: (() => void) | null = null;
  let closed = false;
  const channel: PtyFrameChannel = {
    sendFrame(f) {
      sent.push(f);
      return !closed;
    },
    onFrame(cb) {
      onFrameCb = cb;
    },
    onClose(cb) {
      onCloseCb = cb;
    },
    close() {
      closed = true;
    },
  };
  return {
    channel,
    sent,
    isClosed: () => closed,
    inbound: (f: InboundFrame) => onFrameCb?.(f),
    fireClose: () => onCloseCb?.(),
  };
}

/** A fake PTY handle capturing writes/resizes/kills and exposing hooks to fire data/exit. */
function fakeHandle() {
  let dataCb: ((s: string) => void) | null = null;
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const kill = vi.fn();
  const handle: PtyHandle = {
    pid: 4242,
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    write(d) {
      writes.push(d);
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill,
  };
  return { handle, writes, resizes, kill, emitData: (s: string) => dataCb?.(s), emitExit: (code: number) => exitCb?.({ exitCode: code }) };
}

/** A fake PtyHost whose `open` returns a fixed session and records stop() calls. */
function fakeHost(handle: PtyHandle, sessionId = 'pty-1') {
  const stops: string[] = [];
  const session: PtySession = { sessionId, handle };
  const host: PtyHost = {
    open: vi.fn(() => session),
    stop: (id) => {
      stops.push(id);
      return true;
    },
    stopAll: vi.fn(),
    sessions: () => [sessionId],
  };
  return { host, stops, openMock: host.open as ReturnType<typeof vi.fn> };
}

const OPEN: HostOpenRequest = { requestId: 'req-1', cols: 80, rows: 24, cwd: '/repo' };

describe('openRequestFromFrame', () => {
  it('honors valid geometry/cwd/requestId and falls back on invalid ones', () => {
    const d = { cwd: '/repo', cols: 80, rows: 24 };
    expect(openRequestFromFrame({ type: 'open', requestId: 'r', cols: 120, rows: 40, cwd: '/x' }, d)).toEqual({
      requestId: 'r',
      cols: 120,
      rows: 40,
      cwd: '/x',
    });
    // Invalid / missing fields fall back (never NaN or empty cwd into node-pty).
    expect(openRequestFromFrame({ type: 'open', cols: -5, rows: 0, cwd: '' }, d)).toEqual({
      requestId: '',
      cols: 80,
      rows: 24,
      cwd: '/repo',
    });
  });
});

describe('runHostSession — open + streaming', () => {
  it('spawns the session, acks with the session id, and streams output as data frames', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle, 'pty-77');

    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    expect(host.openMock).toHaveBeenCalledWith(OPEN);
    expect(fc.sent).toContainEqual({ type: 'open-ack', sessionId: 'pty-77' });

    fh.emitData('hello ');
    fh.emitData('world');
    expect(fc.sent).toContainEqual({ type: 'data', data: 'hello ' });
    expect(fc.sent).toContainEqual({ type: 'data', data: 'world' });
  });

  it('forwards inbound write and resize to the PTY handle', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle);
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    fc.inbound({ type: 'write', data: 'echo hi\r' });
    fc.inbound({ type: 'resize', cols: 132, rows: 50 });
    expect(fh.writes).toEqual(['echo hi\r']);
    expect(fh.resizes).toEqual([{ cols: 132, rows: 50 }]);
  });

  it('on PTY exit: sends an exit frame and closes the channel (reaps its own tracking)', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle);
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    fh.emitExit(0);
    expect(fc.sent).toContainEqual({ type: 'exit', code: 0 });
    expect(fc.isClosed()).toBe(true);
    // A shell that exited on its own is NOT killed again.
    expect(fh.kill).not.toHaveBeenCalled();
  });

  it('a daemon `stop` frame kills the session process group and closes', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle, 'pty-9');
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    fc.inbound({ type: 'stop' });
    expect(host.stops).toEqual(['pty-9']);
    expect(fc.isClosed()).toBe(true);
  });

  it('channel close (daemon disconnect / broken pipe) kills the session — no orphan survives', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle, 'pty-orphan');
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    fc.fireClose();
    expect(host.stops).toEqual(['pty-orphan']);
  });

  it('FIX 3 — a PTY write that THROWS (teardown race) tears down only that session and never propagates', () => {
    const fc = fakeChannel();
    const throwingHandle: PtyHandle = {
      pid: 7,
      onData: () => {},
      onExit: () => {},
      write: () => {
        throw new Error('write EPIPE: the PTY already exited');
      },
      resize: () => {},
      kill: vi.fn(),
    };
    const host = fakeHost(throwingHandle, 'pty-race');
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });

    // The write throws inside the frame handler; the guard must contain it (no throw escapes the pump).
    expect(() => fc.inbound({ type: 'write', data: 'boom' })).not.toThrow();
    // That one session is reaped and its channel closed — the host keeps running.
    expect(host.stops).toEqual(['pty-race']);
    expect(fc.isClosed()).toBe(true);
  });

  it('FIX 3 — a resize that THROWS on a just-exited PTY is contained (session torn down, no propagation)', () => {
    const fc = fakeChannel();
    const throwingHandle: PtyHandle = {
      pid: 8,
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {
        throw new Error('resize on a dead PTY');
      },
      kill: vi.fn(),
    };
    const host = fakeHost(throwingHandle, 'pty-race2');
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });
    expect(() => fc.inbound({ type: 'resize', cols: 100, rows: 40 })).not.toThrow();
    expect(host.stops).toEqual(['pty-race2']);
  });

  it('post-teardown inbound frames are ignored (no write after the session is gone)', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle);
    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => true });
    fc.inbound({ type: 'stop' });
    fc.inbound({ type: 'write', data: 'should-be-ignored' });
    expect(fh.writes).toEqual([]);
  });
});

describe('runHostSession — per-open STOP re-check (fail-closed)', () => {
  it('refuses to spawn under a frozen fleet: open-nack fleet-frozen, host.open never called', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle);

    runHostSession(fc.channel, OPEN, { host: host.host, isRunnable: () => false });

    expect(host.openMock).not.toHaveBeenCalled();
    expect(fc.sent).toEqual([{ type: 'open-nack', error: 'fleet-frozen' }]);
    expect(fc.isClosed()).toBe(true);
  });

  it('an isRunnable that THROWS is treated as not-runnable (fail-closed)', () => {
    const fc = fakeChannel();
    const fh = fakeHandle();
    const host = fakeHost(fh.handle);
    runHostSession(fc.channel, OPEN, {
      host: host.host,
      isRunnable: () => {
        throw new Error('preamble runner blew up');
      },
    });
    expect(host.openMock).not.toHaveBeenCalled();
    expect(fc.sent[0]).toEqual({ type: 'open-nack', error: 'fleet-frozen' });
  });
});
