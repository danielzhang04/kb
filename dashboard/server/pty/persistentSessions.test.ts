/**
 * Hermetic tests for the persistent PTY session registry. A fake PtyHost (per-session handles with
 * data/exit fan-out and a kill flag) exercises the ring buffer, replay-then-live ordering, owner binding,
 * single-sink swap, close-kills-via-host, and exit-removes-from-registry — no real node-pty, no I/O.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from './host.ts';
import { createPersistentSessionRegistry } from './persistentSessions.ts';
import type { SessionSink } from './persistentSessions.ts';

/** A fake host whose sessions expose `emitData`/`emitExit` and a `killed` flag, mirroring node-pty's
 *  event fan-out and process-group kill. Each `open` mints a distinct handle + tracked session. */
function fakeHost(prefix = 'pty-test') {
  let n = 0;
  const controllers = new Map<
    string,
    {
      data: Array<(chunk: string) => void>;
      exit: Array<(e: { exitCode: number; signal?: number }) => void>;
      writes: string[];
      resizes: Array<{ cols: number; rows: number }>;
      killed: boolean;
    }
  >();

  const host: PtyHost = {
    open(_req: HostOpenRequest): PtySession {
      const sessionId = `${prefix}-${(n += 1)}`;
      const ctrl = { data: [], exit: [], writes: [], resizes: [], killed: false } as NonNullable<
        ReturnType<typeof controllers.get>
      >;
      controllers.set(sessionId, ctrl);
      const handle: PtyHandle = {
        pid: 1000 + n,
        onData(cb) {
          ctrl.data.push(cb);
        },
        onExit(cb) {
          ctrl.exit.push(cb);
        },
        write(d) {
          ctrl.writes.push(d);
        },
        resize(cols, rows) {
          ctrl.resizes.push({ cols, rows });
        },
        kill() {
          ctrl.killed = true;
        },
      };
      return { sessionId, handle };
    },
    stop(sessionId) {
      const ctrl = controllers.get(sessionId);
      if (!ctrl) return false;
      ctrl.killed = true;
      controllers.delete(sessionId);
      return true;
    },
    stopAll() {
      for (const ctrl of controllers.values()) ctrl.killed = true;
      controllers.clear();
    },
    sessions() {
      return [...controllers.keys()];
    },
  };

  return {
    host,
    emitData: (id: string, chunk: string) => controllers.get(id)?.data.forEach((cb) => cb(chunk)),
    emitExit: (id: string, exitCode = 0) => controllers.get(id)?.exit.forEach((cb) => cb({ exitCode })),
    killed: (id: string) => controllers.get(id)?.killed ?? true,
    writesOf: (id: string) => controllers.get(id)?.writes ?? [],
    resizesOf: (id: string) => controllers.get(id)?.resizes ?? [],
  };
}

const OPEN_REQ: HostOpenRequest = { requestId: '', cwd: '/repo', cols: 80, rows: 24 };

function recordingSink(): SessionSink & { received: string[]; open: boolean } {
  const sink = {
    received: [] as string[],
    open: true,
    send(chunk: string) {
      this.received.push(chunk);
    },
    closed() {
      return !this.open;
    },
  };
  return sink;
}

describe('createPersistentSessionRegistry — ring buffer', () => {
  it('retains recent output up to the byte cap and drops the oldest chunks', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry({ maxBytes: 10 });
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);

    // 5 four-byte chunks = 20 bytes into a 10-byte ring → oldest are dropped, newest kept.
    for (const c of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) fh.emitData(sessionId, c);

    const sink = recordingSink();
    registry.attach('op', sessionId, sink);
    const replayed = sink.received.join('');
    expect(replayed.length).toBeLessThanOrEqual(10);
    expect(replayed).toBe('ddddeeee'); // only the two freshest 4-byte chunks survive
    expect(replayed).not.toContain('aaaa');
  });

  it('replays the full buffered scrollback to every fresh attach (survives detach/reattach)', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    fh.emitData(sessionId, 'banner\n');
    fh.emitData(sessionId, 'PS> ');

    const first = recordingSink();
    registry.attach('op', sessionId, first);
    expect(first.received.join('')).toBe('banner\nPS> ');

    registry.detach(sessionId);
    fh.emitData(sessionId, 'more'); // buffered while detached

    const second = recordingSink();
    registry.attach('op', sessionId, second);
    expect(second.received.join('')).toBe('banner\nPS> more'); // whole scrollback replays again
  });
});

describe('createPersistentSessionRegistry — replay-then-live ordering', () => {
  it('flushes the backlog first, then streams a live chunk after it (flag-then-flush)', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    fh.emitData(sessionId, 'A');
    fh.emitData(sessionId, 'B');

    const sink = recordingSink();
    registry.attach('op', sessionId, sink); // replays [A, B]
    fh.emitData(sessionId, 'C'); // live, after attach

    expect(sink.received).toEqual(['A', 'B', 'C']);
  });
});

describe('createPersistentSessionRegistry — owner binding', () => {
  it('refuses attach/close/list/write/resize from a different owner', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('owner-a', fh.host, OPEN_REQ);

    expect(registry.canAttach('owner-b', sessionId)).toEqual({ ok: false, reason: 'not-owner' });
    expect(registry.attach('owner-b', sessionId, recordingSink())).toEqual({ ok: false, reason: 'not-owner' });
    expect(registry.close('owner-b', sessionId)).toEqual({ ok: false, reason: 'not-owner' });
    expect(registry.write('owner-b', sessionId, 'ls')).toBe(false);
    expect(registry.resize('owner-b', sessionId, 100, 40)).toBe(false);
    expect(registry.list('owner-b')).toEqual([]);
    expect(fh.killed(sessionId)).toBe(false); // a foreign close never touched the shell

    // The rightful owner still sees + drives it.
    expect(registry.list('owner-a').map((s) => s.sessionId)).toEqual([sessionId]);
    expect(registry.write('owner-a', sessionId, 'ls')).toBe(true);
    expect(fh.writesOf(sessionId)).toEqual(['ls']);
  });

  it('reports unknown sessions as not-found via canAttach', () => {
    const registry = createPersistentSessionRegistry();
    expect(registry.canAttach('op', 'pty-missing')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('createPersistentSessionRegistry — single sink swap', () => {
  it('evicts the previously-attached sink and streams live output only to the newest', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);

    const first = recordingSink();
    const evicted = vi.fn(() => {
      first.open = false;
    });
    first.onEvicted = evicted;
    registry.attach('op', sessionId, first);

    const second = recordingSink();
    registry.attach('op', sessionId, second); // swaps
    expect(evicted).toHaveBeenCalledTimes(1);

    fh.emitData(sessionId, 'live');
    expect(second.received).toContain('live');
    expect(first.received).not.toContain('live'); // the displaced sink no longer receives output

    expect(registry.list('op')[0].attached).toBe(true);
  });
});

describe('createPersistentSessionRegistry — lifecycle', () => {
  it('close kills the shell via host.stop and forgets the session', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    expect(registry.liveCount()).toBe(1);

    expect(registry.close('op', sessionId)).toEqual({ ok: true });
    expect(fh.killed(sessionId)).toBe(true);
    expect(registry.liveCount()).toBe(0);
    expect(registry.canAttach('op', sessionId)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('a shell exit notifies the attached sink and removes the entry from the registry', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    const sink = recordingSink();
    const onExit = vi.fn();
    sink.onExit = onExit;
    registry.attach('op', sessionId, sink);

    fh.emitExit(sessionId, 0);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(registry.liveCount()).toBe(0);
    expect(registry.list('op')).toEqual([]);
    expect(registry.canAttach('op', sessionId)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('clear drops every entry without individually killing (the host stopAll drains the PTYs)', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    registry.create('op', fh.host, OPEN_REQ);
    registry.create('op', fh.host, OPEN_REQ);
    expect(registry.liveCount()).toBe(2);
    registry.clear();
    expect(registry.liveCount()).toBe(0);
  });

  it('liveCount counts sessions across owners (the concurrency cap backing state)', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    registry.create('op-a', fh.host, OPEN_REQ);
    registry.create('op-b', fh.host, OPEN_REQ);
    registry.create('op-a', fh.host, OPEN_REQ);
    expect(registry.liveCount()).toBe(3);
    expect(registry.list('op-a')).toHaveLength(2);
    expect(registry.list('op-b')).toHaveLength(1);
  });
});

/**
 * `observe` — the non-exclusive server-side output tap the run roster's completion-marker watcher uses.
 * It must coexist with the browser's single sink, survive an attach/evict, and never be able to write.
 */
describe('server-side output observers', () => {
  it('receives every chunk without competing with the browser sink', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    const seen: string[] = [];
    registry.observe('op', sessionId, (chunk) => seen.push(chunk));
    const sink = recordingSink();
    registry.attach('op', sessionId, sink);

    fh.emitData(sessionId, 'first');
    fh.emitData(sessionId, 'second');
    expect(seen).toEqual(['first', 'second']);
    expect(sink.received).toEqual(['first', 'second']);

    // A second socket attaching EVICTS the first sink; the observer is untouched.
    const newer = recordingSink();
    registry.attach('op', sessionId, newer);
    fh.emitData(sessionId, 'third');
    expect(seen).toEqual(['first', 'second', 'third']);
    // The newly attached sink also gets the ring REPLAY, which observers deliberately never receive —
    // replaying scrollback into a marker scanner would re-fire completions.
    expect(newer.received).toEqual(['first', 'second', 'third']);
  });

  it('unsubscribes exactly one observer and contains an observer that throws', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    const quiet: string[] = [];
    registry.observe('op', sessionId, () => { throw new Error('watcher bug'); });
    const stop = registry.observe('op', sessionId, (chunk) => quiet.push(chunk));
    const sink = recordingSink();
    registry.attach('op', sessionId, sink);

    expect(() => fh.emitData(sessionId, 'a')).not.toThrow();
    expect(quiet).toEqual(['a']);
    expect(sink.received).toEqual(['a']);
    stop();
    fh.emitData(sessionId, 'b');
    expect(quiet).toEqual(['a']);
    expect(sink.received).toEqual(['a', 'b']);
  });

  it('refuses another owner, an unknown id, and an exited session with an inert unsubscribe', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const { sessionId } = registry.create('op', fh.host, OPEN_REQ);
    const foreign: string[] = [];
    const stopForeign = registry.observe('other', sessionId, (chunk) => foreign.push(chunk));
    registry.observe('op', 'pty-nope', (chunk) => foreign.push(chunk));
    fh.emitData(sessionId, 'private');
    expect(foreign).toEqual([]);
    expect(() => stopForeign()).not.toThrow();

    fh.emitExit(sessionId, 0);
    const afterExit: string[] = [];
    expect(() => registry.observe('op', sessionId, (chunk) => afterExit.push(chunk))()).not.toThrow();
    expect(afterExit).toEqual([]);
  });

  it('drops observers when the session is closed or the registry is cleared', () => {
    const fh = fakeHost();
    const registry = createPersistentSessionRegistry();
    const closed = registry.create('op', fh.host, OPEN_REQ);
    const cleared = registry.create('op', fh.host, OPEN_REQ);
    const seen: string[] = [];
    registry.observe('op', closed.sessionId, (chunk) => seen.push(`closed:${chunk}`));
    registry.observe('op', cleared.sessionId, (chunk) => seen.push(`cleared:${chunk}`));

    registry.close('op', closed.sessionId);
    registry.clear();
    fh.emitData(closed.sessionId, 'x');
    fh.emitData(cleared.sessionId, 'y');
    expect(seen).toEqual([]);
  });
});
