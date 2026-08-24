import { describe, expect, it } from 'vitest';
import type { BrowserClientFrame, SessionSummary } from '../../shared/ptyProtocol.ts';
import {
  DEFAULT_SMOKE_TIMEOUT_MS,
  SMOKE_ECHO_MARK,
  SMOKE_EXIT,
  SMOKE_INPUT,
  SmokeFailure,
  compareReplayToLive,
  decodeBrowserServerFrame,
  mainP3RealPtySmoke,
  parseP3RealPtySmokeArgs,
} from './p3RealPtySmokeClient.ts';
import type {
  RawWebSocket, SmokeHttpRequest, SmokeSocketConnect, TranscriptSpan,
} from './p3RealPtySmokeClient.ts';

const ORIGIN = 'https://127.0.0.1:4317';
const TOKEN = 'fixture-session-token';

function baseArgv(overrides: Record<string, string | null> = {}): string[] {
  const merged: Record<string, string | null> = {
    '--origin': ORIGIN,
    '--session-token': TOKEN,
    '--interactive': 'shell',
    '--timeout-ms': '200',
    ...overrides,
  };
  const out: string[] = [];
  for (const [flag, value] of Object.entries(merged)) {
    if (value === null) continue;
    if (value === '') out.push(flag);
    else out.push(flag, value);
  }
  return out;
}

function expectUsage(run: () => unknown, fragment: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SmokeFailure);
    expect((error as SmokeFailure).code).toBe(SMOKE_EXIT.usage);
    expect((error as SmokeFailure).message).toContain(fragment);
    return;
  }
  throw new Error('expected a usage refusal');
}

/* ------------------------------------------------------------------------------------------------ *
 * An in-process fake v2 server
 * ------------------------------------------------------------------------------------------------ */

function summary(sessionId: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId,
    name: 'shell · kb',
    host: 'desktop',
    launcher: 'shell',
    rootId: 'repo',
    cwd: '',
    state: 'live',
    attachmentCount: 1,
    attachmentState: 'attached',
    startedAt: '2026-08-22T00:00:00.000Z',
    endedAt: null,
    exit: null,
    ...overrides,
  };
}

interface FakeServerOptions {
  /** Bytes the "host" replays on reattach. Defaults to exactly what it emitted live. */
  replayOverride?: string[];
  /** Emit this raw text instead of a decodable `created` frame. */
  malformedCreated?: string;
  /** Never answer `create`, so the client's bounded wait expires. */
  silentOnCreate?: boolean;
}

interface FakeServer {
  connect: SmokeSocketConnect;
  sessionIds: string[];
  connections: number;
  cookies: string[];
  tokens: string[];
}

function makeFakeV2Server(options: FakeServerOptions = {}): FakeServer {
  const state: FakeServer = {
    connect: async () => { throw new Error('unset'); },
    sessionIds: [],
    connections: 0,
    cookies: [],
    tokens: [],
  };

  state.connect = async (input) => {
    state.connections += 1;
    state.cookies.push(input.cookie);
    state.tokens.push(input.sessionToken);

    const inbox: string[] = [];
    const waiters: { resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
    let closed = false;
    const emitRaw = (raw: string): void => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(raw);
      else inbox.push(raw);
    };
    const emit = (frame: unknown): void => emitRaw(JSON.stringify(frame));

    const sessionId = `pty-${(state.sessionIds.length + 1).toString(16).padStart(32, '0')}`;
    state.sessionIds.push(sessionId);
    const attachmentId = 'att-0001';
    const live: string[] = [];
    // [C-R6]: a frame's `sequence` is the BYTE OFFSET of its first byte, so the fake host counts bytes.
    let sequence = 0;
    const pushLive = (text: string): void => {
      const bytes = Buffer.from(text, 'utf8');
      live.push(text);
      emit({
        type: 'data', requestId: null, sessionId, attachmentId,
        sequence, encoding: 'base64', data: bytes.toString('base64'), replay: false,
      });
      sequence += bytes.byteLength;
    };

    const handle = (raw: string): void => {
      const frame = JSON.parse(raw) as BrowserClientFrame;
      switch (frame.type) {
        case 'create': {
          if (options.silentOnCreate) return;
          if (options.malformedCreated !== undefined) { emitRaw(options.malformedCreated); return; }
          emit({
            type: 'created', requestId: frame.requestId, revision: 1,
            session: summary(sessionId, { launcher: frame.launcher }), attachmentId,
          });
          pushLive(`kb ${frame.launcher} ready\r\n`);
          return;
        }
        case 'input': {
          const decoded = Buffer.from(frame.data, 'base64').toString('utf8');
          pushLive(decoded);
          emit({
            type: 'ack', requestId: frame.requestId, action: 'input',
            sessionId, revision: 2, accepted: decoded.length,
          });
          return;
        }
        case 'detach': {
          emit({
            type: 'ack', requestId: frame.requestId, action: 'detach',
            sessionId, revision: 3, attachmentId: frame.attachmentId,
          });
          return;
        }
        case 'attach': {
          const replayed = options.replayOverride ?? live;
          const chunks = replayed.map((text) => Buffer.from(text, 'utf8'));
          const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          emit({
            type: 'attached', requestId: frame.requestId, revision: 4,
            session: summary(sessionId), attachmentId: 'att-0002',
            replayFrom: 0, nextSequence: total,
          });
          let offset = 0;
          for (const chunk of chunks) {
            emit({
              type: 'data', requestId: null, sessionId, attachmentId: 'att-0002',
              sequence: offset, encoding: 'base64', data: chunk.toString('base64'), replay: true,
            });
            offset += chunk.byteLength;
          }
          return;
        }
        case 'close': {
          emit({
            type: 'ack', requestId: frame.requestId, action: 'close', sessionId, revision: 5,
            exit: { exitCode: 0, reason: 'closed', observedAt: '2026-08-22T00:01:00.000Z' },
          });
          return;
        }
        default:
          emit({ type: 'error', requestId: null, sessionId: null, code: 'invalid-request', detail: null });
      }
    };

    const socket: RawWebSocket = {
      send(text: string): void {
        if (closed) throw new SmokeFailure(SMOKE_EXIT.protocol, 'send on a closed socket');
        handle(text);
      },
      next(timeoutMs: number): Promise<string> {
        const queued = inbox.shift();
        if (queued !== undefined) return Promise.resolve(queued);
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new SmokeFailure(SMOKE_EXIT.timeout, `no frame within ${timeoutMs} ms`)),
            timeoutMs,
          );
          timer.unref?.();
          waiters.push({
            resolve: (value) => { clearTimeout(timer); resolve(value); },
            reject: (error) => { clearTimeout(timer); reject(error); },
          });
        });
      },
      isClosed: () => closed,
      close(): void { closed = true; },
    };
    return socket;
  };

  return state;
}

function makeHttp(overrides: {
  capability?: unknown;
  capabilityStatus?: number;
  setCookie?: string | null;
  sessionsBody?: unknown;
} = {}): { http: SmokeHttpRequest; calls: string[] } {
  const calls: string[] = [];
  const http: SmokeHttpRequest = async ({ method, url }) => {
    calls.push(`${method} ${url}`);
    if (url.endsWith('/api/runtime/capabilities')) {
      return {
        status: overrides.capabilityStatus ?? 200,
        headers: {},
        body: JSON.stringify(overrides.capability ?? {
          pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'],
          roots: ['repo', 'worktrees'], checkedAt: '2026-08-22T00:00:00.000Z', localTranscripts: false,
        }),
      };
    }
    if (url.includes('/fixture/context-')) {
      const cookie = overrides.setCookie === undefined
        ? 'kb_browser_session=bsr-aaaa; Path=/; HttpOnly'
        : overrides.setCookie;
      return { status: 302, headers: cookie === null ? {} : { 'set-cookie': [cookie] }, body: '' };
    }
    if (url.endsWith('/api/pty/sessions')) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify(overrides.sessionsBody ?? {
          revision: 7,
          sessions: [summary('pty-00000000000000000000000000000001')],
        }),
      };
    }
    return { status: 404, headers: {}, body: '{}' };
  };
  return { http, calls };
}

/* ------------------------------------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------------------------------------ */

describe('parseP3RealPtySmokeArgs', () => {
  it('accepts the section 7 cycle and defaults the bounded timeout', () => {
    const args = parseP3RealPtySmokeArgs([
      '--origin', ORIGIN, '--session-token', TOKEN,
      '--interactive', 'shell,claude,codex', '--headless', 'claude,codex',
      '--cycle', 'create,list,detach,reattach,compare-transcript,close',
      '--roundtrip-current-recipes', '--fail-if-unavailable',
    ]);
    expect(args.interactive).toEqual(['shell', 'claude', 'codex']);
    expect(args.headless).toEqual(['claude', 'codex']);
    expect(args.cycle).toEqual(['create', 'list', 'detach', 'reattach', 'compare-transcript', 'close']);
    expect(args.roundtripCurrentRecipes).toBe(true);
    expect(args.failIfUnavailable).toBe(true);
    expect(args.timeoutMs).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(args.contextPath).toBe('/fixture/context-a');
  });

  it('refuses a missing --origin, a non-http origin, a missing token and a bad timeout', () => {
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--origin': null })), '--origin is required');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--origin': 'wss://127.0.0.1:4317' })), '--origin must be http(s)');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--session-token': null })), '--session-token is required');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--timeout-ms': '-5' })), '--timeout-ms must be a positive integer');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--interactive': 'bash' })), 'unknown launcher bash');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--cycle': 'create,teleport' })), 'unknown step teleport');
    expectUsage(() => parseP3RealPtySmokeArgs([...baseArgv(), '--insecure']), 'unknown flag --insecure');
    expectUsage(() => parseP3RealPtySmokeArgs(baseArgv({ '--context-path': 'fixture/context-a' })), 'must be absolute');
  });
});

describe('decodeBrowserServerFrame', () => {
  it('refuses non-JSON, unknown types, and a frame with a wrongly typed member', () => {
    expect(decodeBrowserServerFrame('not json')).toBeNull();
    expect(decodeBrowserServerFrame('{"type":"teleport"}')).toBeNull();
    expect(decodeBrowserServerFrame(JSON.stringify({
      type: 'data', requestId: null, sessionId: 's', attachmentId: 'a',
      sequence: '3', encoding: 'base64', data: '', replay: false,
    }))).toBeNull();
    expect(decodeBrowserServerFrame(JSON.stringify({
      type: 'created', requestId: 'r', revision: 1, attachmentId: 'a',
    }))).toBeNull();
  });

  it('accepts the frames the cycle depends on', () => {
    expect(decodeBrowserServerFrame(JSON.stringify({
      type: 'created', requestId: 'r', revision: 1, session: summary('pty-1'), attachmentId: 'a',
    }))?.type).toBe('created');
    expect(decodeBrowserServerFrame(JSON.stringify({
      type: 'ack', requestId: 'r', action: 'close', sessionId: 'pty-1', revision: 2,
      exit: { exitCode: 0, reason: 'closed', observedAt: 'now' },
    }))?.type).toBe('ack');
  });
});

describe('mainP3RealPtySmoke', () => {
  it('exits 0 after create/list/write/detach/reattach/compare/close with a byte-identical replay', async () => {
    const server = makeFakeV2Server();
    const { http, calls } = makeHttp();
    const lines: string[] = [];
    const code = await mainP3RealPtySmoke(
      baseArgv({ '--cycle': 'create,list,write,detach,reattach,compare-transcript,close' }),
      { connect: server.connect, http, log: (line) => lines.push(line) },
    );
    expect(code).toBe(SMOKE_EXIT.ok);
    expect(server.connections).toBe(1);
    expect(server.cookies[0]).toBe('kb_browser_session=bsr-aaaa');
    expect(server.tokens[0]).toBe(TOKEN);
    expect(calls).toContain(`GET ${ORIGIN}/api/runtime/capabilities`);
    expect(calls).toContain(`GET ${ORIGIN}/fixture/context-a`);
    expect(calls).toContain(`GET ${ORIGIN}/api/pty/sessions`);
    expect(lines.join('\n')).toContain('smoked 1 launcher');
  });

  it('writes exactly `echo p3-smoke\\r` and waits for the host echo', async () => {
    const server = makeFakeV2Server();
    const { http } = makeHttp();
    const code = await mainP3RealPtySmoke(
      baseArgv({ '--cycle': 'create,write,reattach,compare-transcript' }),
      { connect: server.connect, http },
    );
    expect(SMOKE_INPUT).toBe('echo p3-smoke\r');
    expect(SMOKE_INPUT).toContain(SMOKE_ECHO_MARK);
    expect(code).toBe(SMOKE_EXIT.ok);
  });

  it('exits 64 on a refused argv without touching the wire', async () => {
    const server = makeFakeV2Server();
    const { http, calls } = makeHttp();
    const code = await mainP3RealPtySmoke(baseArgv({ '--session-token': null }), { connect: server.connect, http });
    expect(code).toBe(SMOKE_EXIT.usage);
    expect(calls).toEqual([]);
    expect(server.connections).toBe(0);
  });

  it('exits 65 when the server sends a frame the decoder refuses', async () => {
    const server = makeFakeV2Server({ malformedCreated: '{"type":"created","requestId":"r","revision":1}' });
    const { http } = makeHttp();
    const code = await mainP3RealPtySmoke(baseArgv({ '--cycle': 'create' }), { connect: server.connect, http });
    expect(code).toBe(SMOKE_EXIT.protocol);
  });

  it('exits 65 when a REST body is not the closed shape', async () => {
    const server = makeFakeV2Server();
    const { http } = makeHttp({ sessionsBody: { revision: 'seven', sessions: [] } });
    const code = await mainP3RealPtySmoke(baseArgv({ '--cycle': 'create,list' }), { connect: server.connect, http });
    expect(code).toBe(SMOKE_EXIT.protocol);
  });

  it('exits 66 when the replayed transcript is not byte-identical', async () => {
    const server = makeFakeV2Server({ replayOverride: ['kb shell ready\r\n', 'echo p3-smoke-DIFFERENT\r'] });
    const { http } = makeHttp();
    const code = await mainP3RealPtySmoke(
      baseArgv({ '--cycle': 'create,write,detach,reattach,compare-transcript' }),
      { connect: server.connect, http },
    );
    expect(code).toBe(SMOKE_EXIT.mismatch);
  });

  it('exits 66 when the capability reports pty:false under --fail-if-unavailable, and 0 without it', async () => {
    const unavailable = {
      pty: false,
      diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: '2026-08-22T00:00:00.000Z' },
    };
    const failing = makeFakeV2Server();
    expect(await mainP3RealPtySmoke([...baseArgv(), '--fail-if-unavailable'], {
      connect: failing.connect, http: makeHttp({ capability: unavailable }).http,
    })).toBe(SMOKE_EXIT.mismatch);
    const tolerant = makeFakeV2Server();
    expect(await mainP3RealPtySmoke(baseArgv(), {
      connect: tolerant.connect, http: makeHttp({ capability: unavailable }).http,
    })).toBe(SMOKE_EXIT.ok);
    expect(failing.connections).toBe(0);
    expect(tolerant.connections).toBe(0);
  });

  it('exits 66 when --roundtrip-current-recipes disagrees with the advertised launchers', async () => {
    const server = makeFakeV2Server();
    const code = await mainP3RealPtySmoke(
      [...baseArgv({ '--interactive': 'shell' }), '--roundtrip-current-recipes'],
      { connect: server.connect, http: makeHttp().http },
    );
    expect(code).toBe(SMOKE_EXIT.mismatch);
  });

  it('exits 66 when the context entry point sets no browser-session cookie', async () => {
    const server = makeFakeV2Server();
    const code = await mainP3RealPtySmoke(baseArgv(), {
      connect: server.connect, http: makeHttp({ setCookie: null }).http,
    });
    expect(code).toBe(SMOKE_EXIT.mismatch);
    expect(server.connections).toBe(0);
  });

  it('exits 67 when a bounded wait expires', async () => {
    const server = makeFakeV2Server({ silentOnCreate: true });
    const code = await mainP3RealPtySmoke(
      baseArgv({ '--cycle': 'create', '--timeout-ms': '60' }),
      { connect: server.connect, http: makeHttp().http },
    );
    expect(code).toBe(SMOKE_EXIT.timeout);
  });
});

describe('compareReplayToLive', () => {
  /** A `data` frame's payload at an absolute byte offset, the way the wire tags it. */
  const span = (offset: number, text: string): TranscriptSpan => ({ offset, bytes: Buffer.from(text, 'utf8') });

  it('accepts a replay that starts BEFORE the live view — the real-cmd.exe case', () => {
    // 143 bytes of banner were written between create and attach: the client never saw them live, and
    // a `fromSequence: 0` replay legitimately carries them. Only the overlap is the client's business.
    const banner = 'B'.repeat(143);
    const live = [span(143, 'echo p3-smoke'), span(156, 'p3-smoke')];
    const replay = [span(0, banner), span(143, 'echo p3-smokep3-smoke')];

    const result = compareReplayToLive(live, replay);
    expect(result).toEqual({ ok: true, firstLiveOffset: 143, comparedBytes: 21, replayedBeforeLive: 143 });
  });

  it('accepts an exact match, where the live view began at offset 0', () => {
    const live = [span(0, 'abc'), span(3, 'def')];
    const replay = [span(0, 'abcdef')];

    expect(compareReplayToLive(live, replay)).toEqual({
      ok: true, firstLiveOffset: 0, comparedBytes: 6, replayedBeforeLive: 0,
    });
  });

  it('refuses a genuine content difference inside the overlapping range', () => {
    const live = [span(10, 'abcdef')];
    const replay = [span(0, '0123456789'), span(10, 'abcXef')];

    const result = compareReplayToLive(live, replay);
    expect(result.ok).toBe(false);
    // The offset named is ABSOLUTE, so it can be read against the frames on the wire.
    expect(result.ok === false && result.reason).toContain('offset 13');
  });

  it('refuses a replay that stops short of the live range', () => {
    const result = compareReplayToLive([span(10, 'abcdef')], [span(0, '0123456789abc')]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('does not cover the live range');
  });

  it('refuses a replay that starts after the live view did', () => {
    const result = compareReplayToLive([span(0, 'abcdef')], [span(2, 'cdef')]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('does not cover the live range');
  });

  it('refuses a gap in the replay, even when the folded bytes would have matched', () => {
    const result = compareReplayToLive([span(0, 'abcdef')], [span(0, 'abc'), span(4, 'def')]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('replay has a gap at offset 3');
  });

  it('refuses a gap in what was collected live', () => {
    const result = compareReplayToLive([span(0, 'abc'), span(9, 'def')], [span(0, 'abcdef')]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('live transcript has a gap at offset 3');
  });

  it('refuses an empty replay and an empty live view', () => {
    expect(compareReplayToLive([span(0, 'abc')], []).ok).toBe(false);
    expect(compareReplayToLive([], [span(0, 'abc')]).ok).toBe(false);
  });
});
