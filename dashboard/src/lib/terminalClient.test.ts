// @vitest-environment jsdom
/**
 * P3 W6.4 — the v2 browser transport. These tests pin the three things that make it closed: the upgrade
 * URL carries no query at all, every server frame goes through W4's decoder before a caller sees it, and
 * a keystroke is a typed base64 `input` frame rather than a raw text write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachFrame,
  closeFrame,
  createFrame,
  decodeOutput,
  defaultPtySocketFactory,
  deletePtySession,
  detachFrame,
  encodeInput,
  inputFrame,
  listPtySessions,
  newRequestId,
  openPtyConnection,
  PTY_SUBPROTOCOL,
  refusalMessage,
  resizeFrame,
} from './terminalClient';
import type { PtyConnectionHandlers } from './terminalClient';
import { PTY_CLOSE_CODES, decodePtyCloseReason } from '../../shared/ptyProtocol.ts';
import type { BrowserServerFrame, SessionSummary } from '../../shared/ptyProtocol.ts';

const SESSION_ID = `pty-${'a'.repeat(32)}`;
const ATTACHMENT_ID = `att-${'b'.repeat(32)}`;

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: SESSION_ID,
    name: 'shell 1',
    host: 'desktop',
    launcher: 'shell',
    rootId: 'repo',
    cwd: 'ops',
    state: 'live',
    attachmentCount: 1,
    attachmentState: 'attached',
    startedAt: '2026-08-22T10:00:00.000Z',
    endedAt: null,
    exit: null,
    ...overrides,
  };
}

class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  url = '';
  protocols: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.closed = true;
  }
}

function connect(handlers: Partial<PtyConnectionHandlers> = {}) {
  const socket = new FakeWS();
  const frames: BrowserServerFrame[] = [];
  const connection = openPtyConnection('tok', {
    onFrame: (frame) => frames.push(frame),
    ...handlers,
  }, () => socket as unknown as WebSocket);
  return { socket, frames, connection };
}

afterEach(() => vi.restoreAllMocks());

describe('request ids and encoding', () => {
  it('mints request ids the server decoder accepts', () => {
    expect(newRequestId()).toMatch(/^req-[0-9a-f]{32}$/);
    expect(newRequestId()).not.toBe(newRequestId());
  });

  it('round-trips UTF-8 through canonical base64', () => {
    for (const text of ['ls -la\r', 'é — ✓', '']) {
      expect(decodeOutput(encodeInput(text))).toBe(text);
    }
  });

  it('renders nothing for base64 it cannot decode', () => {
    expect(decodeOutput('!!!not base64!!!')).toBe('');
  });
});

describe('the upgrade URL', () => {
  it('carries no query at all and puts the bearer in a subprotocol', () => {
    const seen: Array<{ url: string; protocols: string[] }> = [];
    class Capturing extends FakeWS {
      constructor(url: string, protocols: string[]) {
        super();
        seen.push({ url, protocols });
      }
    }
    vi.stubGlobal('WebSocket', Capturing as unknown as typeof WebSocket);
    defaultPtySocketFactory('tok-abc');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/api\/pty$/);
    expect(seen[0].url).not.toContain('?');
    expect(seen[0].url).not.toContain('tok-abc');
    expect(seen[0].protocols).toEqual([PTY_SUBPROTOCOL, 'tok-abc']);
    vi.unstubAllGlobals();
  });
});

describe('REST companions', () => {
  it('returns the exact {revision, sessions} envelope', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ revision: 7, sessions: [summary()] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const listing = await listPtySessions('tok', fetchImpl as unknown as typeof fetch);
    expect(listing).toEqual({ revision: 7, sessions: [summary()] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('reports "could not ask" as null, never as an empty list', async () => {
    for (const response of [
      new Response('', { status: 401 }),
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]) {
      const listing = await listPtySessions('tok', (async () => response) as unknown as typeof fetch);
      expect(listing).toBeNull();
    }
    const thrown = await listPtySessions('tok', (() => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(thrown).toBeNull();
  });

  it('refuses the WHOLE listing when a row fails the strict decoder, never a filtered short list', async () => {
    // One weak row (extra key, unknown state) among good ones: a filtered list would look authoritative.
    const body = JSON.stringify({
      revision: 7,
      sessions: [summary(), { ...summary(), state: 'zombie' }],
    });
    const listing = await listPtySessions('tok', (async () => new Response(body, {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
    expect(listing).toBeNull();
  });

  it('maps the DELETE outcomes the route defines', async () => {
    const cases: Array<[number, unknown]> = [
      [200, { ok: true }],
      [404, { ok: false, reason: 'not-found' }],
      [409, { ok: false, reason: 'exit-unconfirmed' }],
      [500, { ok: false, reason: 'unreachable' }],
    ];
    for (const [status, expected] of cases) {
      const result = await deletePtySession(
        SESSION_ID,
        'tok',
        (async () => new Response('{}', { status })) as unknown as typeof fetch,
      );
      expect(result).toEqual(expected);
    }
  });
});

describe('the frame pump', () => {
  it('hands the caller only frames the closed decoder accepts', () => {
    const violations: number[] = [];
    const { socket, frames } = connect({ onProtocolViolation: () => violations.push(1) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'session', requestId: null, revision: 1, session: summary() }) });
    expect(frames).toHaveLength(1);
    // Not JSON, then valid JSON the decoder refuses (an unknown type, and a `data` frame with a
    // non-canonical payload) — none of it reaches the caller.
    socket.onmessage?.({ data: 'raw pty bytes' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'banana' }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'data', requestId: null, sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
        sequence: 1, encoding: 'base64', data: '!!!', replay: false,
      }),
    });
    expect(frames).toHaveLength(1);
    expect(violations).toHaveLength(3);
  });

  it('sends typed frames only while the socket is open', () => {
    const { socket, connection } = connect();
    expect(connection.send(closeFrame(SESSION_ID))).toBe(true);
    socket.readyState = 3;
    expect(connection.send(closeFrame(SESSION_ID))).toBe(false);
    expect(socket.sent).toHaveLength(1);
  });

  it('distinguishes a transport error from an ordinary close, once', () => {
    const closures: string[] = [];
    const { socket } = connect({ onClose: (closure) => closures.push(closure) });
    socket.onerror?.();
    socket.onclose?.();
    expect(closures).toEqual(['error']);
  });

  it('reads the close CODE into the closed reason set, so a shed reader is distinguishable', () => {
    // 1013 (the daemon shedding a reader that could not keep up) and 1009 (a frame over the ceiling)
    // used to be indistinguishable from an ordinary close, which is how "still running" got shown to an
    // operator whose output had just been dropped.
    for (const [code, reason] of [[1000, 'normal'], [1008, 'policy'], [1009, 'tooLarge'],
      [1013, 'backpressure'], [4000, 'other']] as [number, string][]) {
      const closures: string[] = [];
      const { socket } = connect({ onClose: (closure) => closures.push(closure) });
      socket.onclose?.({ code });
      expect(closures).toEqual([reason]);
    }
    // A close event with no code at all is `other`, never a guess.
    const bare: string[] = [];
    const { socket } = connect({ onClose: (closure) => bare.push(closure) });
    socket.onclose?.();
    expect(bare).toEqual(['other']);
    expect(decodePtyCloseReason(PTY_CLOSE_CODES.backpressure)).toBe('backpressure');
  });
});

describe('client frame builders', () => {
  it('build exactly the shapes the route decodes', () => {
    expect(createFrame({ launcher: 'claude', rootId: 'repo', relativeCwd: '.', cols: 80, rows: 24 }, 'req-1'))
      .toEqual({ type: 'create', requestId: 'req-1', launcher: 'claude', rootId: 'repo', relativeCwd: '.', cols: 80, rows: 24 });
    expect(attachFrame(SESSION_ID, 12, 'req-2'))
      .toEqual({ type: 'attach', requestId: 'req-2', sessionId: SESSION_ID, fromSequence: 12 });
    expect(inputFrame(SESSION_ID, ATTACHMENT_ID, 'ls', 'req-3'))
      .toEqual({ type: 'input', requestId: 'req-3', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, encoding: 'base64', data: encodeInput('ls') });
    expect(resizeFrame(SESSION_ID, ATTACHMENT_ID, 100, 30, 'req-4'))
      .toEqual({ type: 'resize', requestId: 'req-4', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, cols: 100, rows: 30 });
    expect(detachFrame(SESSION_ID, ATTACHMENT_ID, 'req-5'))
      .toEqual({ type: 'detach', requestId: 'req-5', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID });
  });
});

describe('refusals', () => {
  it('gives every refusal code an operator-facing sentence', () => {
    for (const code of ['capacity', 'unavailable', 'not-found', 'binding-conflict', 'internal'] as const) {
      expect(refusalMessage(code).length).toBeGreaterThan(0);
    }
  });
});
