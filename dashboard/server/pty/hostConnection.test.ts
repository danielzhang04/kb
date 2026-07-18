/**
 * D3.1f/h + D3.1 MED mitigation — the daemon-side `HostConnection` adapter (`createHostConnection`) over
 * a `PtyClientChannel`. Hermetic: a fake channel (no koffi). Proves the TWO-PHASE open ceremony (receive
 * the host `challenge` → collect a passkey assertion via the injected provider → send `open` carrying the
 * per-boot token + assertion), the ack/nack/timeout/malformed handling, the fail-closed paths when no
 * challenge is issued or the assertion ceremony fails, and the persistent-stream multiplex.
 */
import { describe, expect, it } from 'vitest';
import { createHostConnection } from './hostClient.ts';
import type { PtyAssertionProvider } from './hostClient.ts';
import type { ControlFrame, InboundFrame, PtyAssertion, PtyClientChannel } from './ptyProtocol.ts';
import type { OpenPtyRequest } from './hostClient.ts';

const CHALLENGE = 'WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0';
const ASSERTION: PtyAssertion = {
  credentialId: 'cred-1',
  authenticatorData: 'YXV0aA',
  clientDataJSON: 'Y2RhdGE',
  signature: 'c2ln',
};

/** A fake client channel: a canned `challenge` from receiveFrame, a canned handshake response, and manual
 *  streaming drive. `challenge:null` models a host that never issues a challenge. */
function fakeChannel(
  handshakeResponse: InboundFrame | null,
  opts: { challenge?: InboundFrame | null } = {},
) {
  const sent: ControlFrame[] = [];
  const handshakes: ControlFrame[] = [];
  let frameCb: ((f: InboundFrame) => void) | null = null;
  let closeCb: (() => void) | null = null;
  let closed = false;
  const challenge: InboundFrame | null =
    'challenge' in opts ? (opts.challenge ?? null) : ({ type: 'challenge', challenge: CHALLENGE } as InboundFrame);
  const channel: PtyClientChannel = {
    receiveFrame() {
      return challenge;
    },
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

/** Records the challenge it was asked to attest, returns a fixed assertion. */
function recordingProvider(assertion: PtyAssertion = ASSERTION) {
  const challenges: string[] = [];
  const provider: PtyAssertionProvider = async (challenge) => {
    challenges.push(challenge);
    return assertion;
  };
  return { provider, challenges };
}

const REQ: OpenPtyRequest = {
  type: 'open-pty',
  requestId: 'req-1',
  cols: 120,
  rows: 40,
  cwd: '/repo',
  sessionSubject: 'operator-1',
};

describe('createHostConnection — two-phase open handshake', () => {
  it('receives the challenge, attests it, and sends `open` carrying the token + assertion; returns the ack', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-99' });
    const rp = recordingProvider();
    const conn = createHostConnection(fc.channel, 'boot-token-xyz', rp.provider);

    const ack = await conn.requestOpen(REQ);
    expect(ack).toEqual({ sessionId: 'pty-99' });

    // The provider was asked to attest exactly the host-issued challenge.
    expect(rp.challenges).toEqual([CHALLENGE]);
    expect(fc.handshakes).toHaveLength(1);
    expect(fc.handshakes[0]).toEqual({
      type: 'open',
      token: 'boot-token-xyz',
      requestId: 'req-1',
      cols: 120,
      rows: 40,
      cwd: '/repo',
      sessionSubject: 'operator-1',
      assertion: ASSERTION,
    });
  });

  it('fails closed (throws + closes) when the host issues NO challenge', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'x' }, { challenge: null });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/did not issue a challenge/);
    expect(fc.isClosed()).toBe(true);
  });

  it('fails closed when the assertion ceremony throws (declined / no touch)', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'x' });
    const provider: PtyAssertionProvider = async () => {
      throw new Error('user declined the passkey');
    };
    const conn = createHostConnection(fc.channel, 'boot', provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/assertion ceremony failed/);
    expect(fc.isClosed()).toBe(true);
    // The open frame was NEVER sent — no spawn can happen without Factor C material.
    expect(fc.handshakes).toHaveLength(0);
  });

  it('fails closed when the provider returns an invalid assertion (missing field)', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'x' });
    const provider = (async () => ({ credentialId: 'c' })) as unknown as PtyAssertionProvider;
    const conn = createHostConnection(fc.channel, 'boot', provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/no\/invalid assertion/);
    expect(fc.isClosed()).toBe(true);
    expect(fc.handshakes).toHaveLength(0);
  });

  it('throws + closes on an open-nack (host refused, e.g. Factor C failed host-side)', async () => {
    const fc = fakeChannel({ type: 'open-nack', error: 'unauthenticated: assertion:replay?' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/refused the open: unauthenticated: assertion:replay/);
    expect(fc.isClosed()).toBe(true);
  });

  it('throws + closes on a timeout / closed channel (null response)', async () => {
    const fc = fakeChannel(null);
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/timed out or the channel closed/);
    expect(fc.isClosed()).toBe(true);
  });

  it('throws + closes on a malformed ack (no sessionId)', async () => {
    const fc = fakeChannel({ type: 'open-ack' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    await expect(conn.requestOpen(REQ)).rejects.toThrow(/malformed open response/);
    expect(fc.isClosed()).toBe(true);
  });
});

describe('createHostConnection — persistent stream', () => {
  it('routes data frames to onData and the exit frame to onExit', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    const chunks: string[] = [];
    let exitCode: number | null | undefined;
    conn.onData((c) => chunks.push(c));
    conn.onExit((code) => {
      exitCode = code;
    });
    await conn.requestOpen(REQ);

    fc.pushFrame({ type: 'data', data: 'hello ' });
    fc.pushFrame({ type: 'data', data: 'world' });
    fc.pushFrame({ type: 'exit', code: 7 });

    expect(chunks).toEqual(['hello ', 'world']);
    expect(exitCode).toBe(7);
  });

  it('forwards write/resize as frames and close sends a stop then closes', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    await conn.requestOpen(REQ);

    conn.write('echo hi\r');
    conn.resize(132, 50);
    conn.close();

    // `open` went through requestSync (see the handshake suite); only the stream frames use sendFrame.
    expect(fc.sent).toEqual([
      { type: 'write', data: 'echo hi\r' },
      { type: 'resize', cols: 132, rows: 50 },
      { type: 'stop' },
    ]);
    expect(fc.isClosed()).toBe(true);
  });

  it('a channel close (broken pipe) surfaces as onExit(null), exactly once', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    const exits: Array<number | null> = [];
    conn.onExit((c) => exits.push(c));
    await conn.requestOpen(REQ);

    fc.fireClose();
    fc.fireClose(); // idempotent
    expect(exits).toEqual([null]);
  });

  it('an exit frame with a non-numeric code normalizes to null', async () => {
    const fc = fakeChannel({ type: 'open-ack', sessionId: 'pty-1' });
    const conn = createHostConnection(fc.channel, 'boot', recordingProvider().provider);
    let code: number | null | undefined = undefined;
    conn.onExit((c) => {
      code = c;
    });
    await conn.requestOpen(REQ);
    fc.pushFrame({ type: 'exit' });
    expect(code).toBeNull();
  });
});
