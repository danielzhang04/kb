/**
 * D3.1f/h — the daemon-side `HostConnection` adapter (`createHostConnection`) over a `PtyClientChannel`.
 * Hermetic: a fake channel (no koffi). This is where the CLIENT open handshake + persistent-stream
 * multiplex logic is proven, because the NATIVE `requestSync` blocks the event loop and so cannot be
 * round-tripped same-process (see win32PtyApi.integration.test.ts). Proves: the per-boot token rides the
 * `open` frame; the ack's session id is returned; data→onData, exit→onExit; nack / malformed / timeout all
 * throw and close; write/resize/close emit the right frames; channel close surfaces as onExit(null).
 */
import { describe, expect, it } from 'vitest';
import { createHostConnection } from './hostClient.ts';
import type { ControlFrame, InboundFrame, PtyClientChannel } from './ptyProtocol.ts';
import type { OpenPtyRequest } from './hostClient.ts';

/** A fake client channel: canned handshake response + manual streaming drive. */
function fakeChannel(handshakeResponse: InboundFrame | null) {
  const sent: ControlFrame[] = [];
  const handshakes: ControlFrame[] = [];
  let frameCb: ((f: InboundFrame) => void) | null = null;
  let closeCb: (() => void) | null = null;
  let closed = false;
  const channel: PtyClientChannel = {
    requestSync(frame) {
      handshakes.push(frame);
      return handshakeResponse;
    },
    sendFrame(frame) {
      sent.push(frame);
      return !closed;
    },
    onFrame(cb) {
      frameCb = cb;
    },
    onClose(cb) {
      closeCb = cb;
    },
    close() {
      closed = true;
    },
  };
  return {
    channel,
    sent,
    handshakes,
    isClosed: () => closed,
    pushFrame: (f: InboundFrame) => frameCb?.(f),
    fireClose: () => closeCb?.(),
  };
}

const REQ: OpenPtyRequest = {
  type: 'open-pty',
  requestId: 'req-1',
  cols: 120,
  rows: 40,
  cwd: '/repo',
  sessionSubject: 'operator-1',
};

describe('createHostConnection — open handshake', () => {
  it('sends `open` carrying the per-boot token + geometry, and returns the ack session id', () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-99' });
    const conn = createHostConnection(fc.channel, 'boot-token-xyz');

    const ack = conn.requestOpen(REQ);
    expect(ack).toEqual({ sessionId: 'pty-99' });

    expect(fc.handshakes).toHaveLength(1);
    expect(fc.handshakes[0]).toEqual({
      type: 'open',
      token: 'boot-token-xyz',
      requestId: 'req-1',
      cols: 120,
      rows: 40,
      cwd: '/repo',
      sessionSubject: 'operator-1',
    });
  });

  it('throws + closes on an open-nack (host refused)', () => {
    const fc = fakeChannel({ type: 'open-nack', error: 'unauthenticated: peer-credential' });
    const conn = createHostConnection(fc.channel, 'boot');
    expect(() => conn.requestOpen(REQ)).toThrow(/refused the open: unauthenticated: peer-credential/);
    expect(fc.isClosed()).toBe(true);
  });

  it('throws + closes on a timeout / closed channel (null response)', () => {
    const fc = fakeChannel(null);
    const conn = createHostConnection(fc.channel, 'boot');
    expect(() => conn.requestOpen(REQ)).toThrow(/timed out or the channel closed/);
    expect(fc.isClosed()).toBe(true);
  });

  it('throws + closes on a malformed ack (no sessionId)', () => {
    const fc = fakeChannel({ type: 'open-ack' });
    const conn = createHostConnection(fc.channel, 'boot');
    expect(() => conn.requestOpen(REQ)).toThrow(/malformed open response/);
    expect(fc.isClosed()).toBe(true);
  });
});

describe('createHostConnection — persistent stream', () => {
  it('routes data frames to onData and the exit frame to onExit', () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot');
    const chunks: string[] = [];
    let exitCode: number | null | undefined;
    conn.onData((c) => chunks.push(c));
    conn.onExit((code) => {
      exitCode = code;
    });
    conn.requestOpen(REQ);

    fc.pushFrame({ type: 'data', data: 'hello ' });
    fc.pushFrame({ type: 'data', data: 'world' });
    fc.pushFrame({ type: 'exit', code: 7 });

    expect(chunks).toEqual(['hello ', 'world']);
    expect(exitCode).toBe(7);
  });

  it('forwards write/resize as frames and close sends a stop then closes', () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot');
    conn.requestOpen(REQ);

    conn.write('echo hi\r');
    conn.resize(132, 50);
    conn.close();

    expect(fc.sent).toEqual([
      { type: 'write', data: 'echo hi\r' },
      { type: 'resize', cols: 132, rows: 50 },
      { type: 'stop' },
    ]);
    expect(fc.isClosed()).toBe(true);
  });

  it('a channel close (broken pipe) surfaces as onExit(null), exactly once', () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot');
    const exits: Array<number | null> = [];
    conn.onExit((c) => exits.push(c));
    conn.requestOpen(REQ);

    fc.fireClose();
    fc.fireClose(); // idempotent
    expect(exits).toEqual([null]);
  });

  it('an exit frame with a non-numeric code normalizes to null', () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot');
    let code: number | null | undefined = undefined;
    conn.onExit((c) => {
      code = c;
    });
    conn.requestOpen(REQ);
    fc.pushFrame({ type: 'exit' });
    expect(code).toBeNull();
  });
});
