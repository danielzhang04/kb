/**
 * Hermetic tests for the session-run store. Every test gets its own temp state root, so nothing here
 * touches the daemon's real state directory, the repo, or the control plane.
 *
 * What is actually pinned: the owner scoping (a foreign ref is NOT FOUND, never forbidden), the
 * lifecycle's one-way transitions, the boot sweep's "nothing survives a restart", and the archive's
 * copied idempotency + live-refusal shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SESSION_RUN_REF_RE,
  SessionRunStoreError,
  createSessionRunStore,
} from './sessionRuns.ts';
// W6.3: session runs are the `legacyRuns` array of the one v2 PTY document, so the store is built over
// that document's port and its retention ceiling is the document's own.
import {
  MAX_LEGACY_RUNS,
  PtySessionPersistenceError,
  createSessionPersistence,
} from './sessionPersistence.ts';
import type { SessionRunStore } from './sessionRuns.ts';

const dirs: string[] = [];
function stateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-session-runs-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function store(root = stateRoot()): { store: SessionRunStore; root: string } {
  return { store: createSessionRunStore(createSessionPersistence(root)), root };
}

async function liveRun(s: SessionRunStore, owner = 'operator-1', targetRef = 'fyt-runner') {
  return s.create({ owner, kind: 'agent', targetRef, ptySessionId: 'pty-test-1' });
}

describe('createSessionRunStore — construction', () => {
  it('is INERT: building a store touches no filesystem (no state directory is created)', () => {
    const root = stateRoot();
    createSessionRunStore(createSessionPersistence(root));
    expect(existsSync(join(root, 'pty'))).toBe(false);
  });

  // The state root is now validated once, by the document port every PTY store shares, instead of once
  // per store — so a relative or NUL-bearing root can never be resolved somewhere surprising.
  it('refuses a relative or NUL-bearing state root rather than resolving it somewhere surprising', () => {
    expect(() => createSessionPersistence('relative/path')).toThrow(PtySessionPersistenceError);
    expect(() => createSessionPersistence(`${tmpdir()}\0evil`)).toThrow(PtySessionPersistenceError);
  });
});

describe('create — the record is born live and complete', () => {
  it('mints a server-side srun-<uuid> ref and writes a live record with its pty session id', async () => {
    const { store: s } = store();
    const record = await s.create({
      owner: 'operator-1',
      kind: 'workflow',
      targetRef: 'video-run',
      ptySessionId: 'pty-test-9',
      primingPath: '/state/pty-priming/workflow-video-run.md',
    });
    expect(SESSION_RUN_REF_RE.test(record.sessionRunRef)).toBe(true);
    expect(record).toMatchObject({
      kind: 'workflow',
      targetRef: 'video-run',
      owner: 'operator-1',
      ptySessionId: 'pty-test-9',
      primingPath: '/state/pty-priming/workflow-video-run.md',
      outcome: 'live',
      endedAt: null,
      exitCode: null,
      transcript: null,
      version: 1,
    });
  });

  it('refuses an invalid owner, kind, or target reference', async () => {
    const { store: s } = store();
    await expect(s.create({ owner: '', kind: 'agent', targetRef: 'a', ptySessionId: null })).rejects.toThrow(SessionRunStoreError);
    await expect(s.create({ owner: 'o', kind: 'shell' as 'agent', targetRef: 'a', ptySessionId: null })).rejects.toThrow(SessionRunStoreError);
    await expect(s.create({ owner: 'o', kind: 'agent', targetRef: '', ptySessionId: null })).rejects.toThrow(SessionRunStoreError);
  });
});

describe('owner scoping — a foreign record does not exist', () => {
  it('hides another operator\'s record from get and list alike', async () => {
    const { store: s } = store();
    const mine = await liveRun(s, 'operator-1');
    await liveRun(s, 'operator-2');
    expect(s.get('operator-1', mine.sessionRunRef)?.sessionRunRef).toBe(mine.sessionRunRef);
    // Not "forbidden" — an existence oracle across operators would leak the shape of their work.
    expect(s.get('operator-2', mine.sessionRunRef)).toBeNull();
    expect(s.list('operator-1')).toHaveLength(1);
    expect(s.list('operator-2')).toHaveLength(1);
  });

  it('refuses to end, stamp, or archive a record owned by someone else', async () => {
    const { store: s } = store();
    const mine = await liveRun(s, 'operator-1');
    expect(await s.end('operator-2', mine.sessionRunRef)).toBeNull();
    await s.stampExitCode('operator-2', mine.sessionRunRef, 3);
    expect(s.get('operator-1', mine.sessionRunRef)).toMatchObject({ outcome: 'live', exitCode: null });
    await expect(s.archive('operator-2', mine.sessionRunRef, { idempotencyKey: 'k1', reason: null }))
      .resolves.toEqual({ ok: false, error: 'not-found' });
  });
});

describe('end — the observed death of a shell', () => {
  it('records ended with the flushed transcript and bumps the CAS version', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    const ended = await s.end('operator-1', record.sessionRunRef, {
      transcript: { path: '/state/pty/transcripts/pty-test-1.log', bytes: 4_096, truncated: true },
    });
    expect(ended).toMatchObject({ outcome: 'ended', version: 2 });
    expect(ended?.endedAt).not.toBeNull();
    expect(ended?.transcript).toEqual({ path: '/state/pty/transcripts/pty-test-1.log', bytes: 4_096, truncated: true });
  });

  it('is idempotent: a second gone-notification never rewrites an outcome already observed', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    await s.end('operator-1', record.sessionRunRef, { exitCode: 0 });
    const again = await s.end('operator-1', record.sessionRunRef, { exitCode: 137 });
    expect(again).toMatchObject({ outcome: 'ended', exitCode: 0, version: 2 });
  });

  it('never lets an end precede its own start, even under a clock that goes backwards', async () => {
    const root = stateRoot();
    let t = 2_000;
    const s = createSessionRunStore(createSessionPersistence(root), { now: () => t });
    const record = await s.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: null });
    t = 1_000; // clock jumps backwards (NTP correction, VM resume)
    const ended = await s.end('operator-1', record.sessionRunRef);
    expect(Date.parse(ended?.endedAt as string)).toBeGreaterThan(Date.parse(record.startedAt));
  });
});

describe('stampExitCode — filling an UNKNOWN only', () => {
  it('fills a null exit code and never overwrites one already observed', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    await s.end('operator-1', record.sessionRunRef);
    await s.stampExitCode('operator-1', record.sessionRunRef, 137);
    expect(s.get('operator-1', record.sessionRunRef)?.exitCode).toBe(137);
    await s.stampExitCode('operator-1', record.sessionRunRef, 0);
    expect(s.get('operator-1', record.sessionRunRef)?.exitCode).toBe(137);
  });
});

describe('sweepAbandoned — nothing survives a daemon restart', () => {
  it('turns every surviving live record into abandoned, across ALL owners, and stamps an end', async () => {
    const root = stateRoot();
    const first = createSessionRunStore(createSessionPersistence(root));
    const mine = await first.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: 'pty-test-1' });
    const theirs = await first.create({ owner: 'operator-2', kind: 'workflow', targetRef: 'w', ptySessionId: 'pty-test-2' });
    const done = await first.create({ owner: 'operator-1', kind: 'agent', targetRef: 'b', ptySessionId: 'pty-test-3' });
    await first.end('operator-1', done.sessionRunRef);

    // A FRESH store over the same root — the next daemon boot reading the last daemon's state.
    const next = createSessionRunStore(createSessionPersistence(root));
    expect(await next.sweepAbandoned()).toBe(2);
    expect(next.get('operator-1', mine.sessionRunRef)).toMatchObject({ outcome: 'abandoned' });
    expect(next.get('operator-2', theirs.sessionRunRef)).toMatchObject({ outcome: 'abandoned' });
    // An already-terminal record is not touched (its outcome was truthfully observed).
    expect(next.get('operator-1', done.sessionRunRef)).toMatchObject({ outcome: 'ended', version: 2 });
  });

  it('is a no-op on an empty document', async () => {
    const { store: s } = store();
    expect(await s.sweepAbandoned()).toBe(0);
  });
});

describe('archive — the copied governed shape', () => {
  it('REFUSES a live session: it must be killed through the close path first', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    expect(await s.archive('operator-1', record.sessionRunRef, { idempotencyKey: 'k1', reason: null }))
      .toEqual({ ok: false, error: 'session-run-live' });
    // Ended → archivable, which is exactly the flow the refusal points at.
    await s.end('operator-1', record.sessionRunRef);
    const archived = await s.archive('operator-1', record.sessionRunRef, { idempotencyKey: 'k1', reason: 'stale' });
    expect(archived).toMatchObject({ ok: true, replayed: false });
  });

  it('replays the same key and CONFLICTS on a key reused for a different decision', async () => {
    const { store: s } = store();
    const a = await liveRun(s, 'operator-1', 'a');
    const b = await liveRun(s, 'operator-1', 'b');
    await s.end('operator-1', a.sessionRunRef);
    await s.end('operator-1', b.sessionRunRef);

    const first = await s.archive('operator-1', a.sessionRunRef, { idempotencyKey: 'key-1', reason: 'cleanup' });
    expect(first).toMatchObject({ ok: true, replayed: false });
    const replay = await s.archive('operator-1', a.sessionRunRef, { idempotencyKey: 'key-1', reason: 'cleanup' });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    // Same key, different record → a conflict, never a silent second archive.
    expect(await s.archive('operator-1', b.sessionRunRef, { idempotencyKey: 'key-1', reason: 'cleanup' }))
      .toEqual({ ok: false, error: 'idempotency-conflict' });
    // Same key, same record, different words → still a conflict: the reason IS the decision.
    expect(await s.archive('operator-1', a.sessionRunRef, { idempotencyKey: 'key-1', reason: 'other' }))
      .toEqual({ ok: false, error: 'idempotency-conflict' });
  });

  it('is absorbing and drops the record out of the default list', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    await s.end('operator-1', record.sessionRunRef);
    await s.archive('operator-1', record.sessionRunRef, { idempotencyKey: 'k', reason: null });
    expect(s.list('operator-1')).toEqual([]);
    expect(s.list('operator-1', { includeArchived: true })).toHaveLength(1);
    expect(s.get('operator-1', record.sessionRunRef)).toMatchObject({ outcome: 'archived' });
  });

  it('refuses an empty or oversized idempotency key', async () => {
    const { store: s } = store();
    const record = await liveRun(s);
    await s.end('operator-1', record.sessionRunRef);
    await expect(s.archive('operator-1', record.sessionRunRef, { idempotencyKey: '', reason: null }))
      .rejects.toThrow(SessionRunStoreError);
    await expect(s.archive('operator-1', record.sessionRunRef, { idempotencyKey: 'x'.repeat(513), reason: null }))
      .rejects.toThrow(SessionRunStoreError);
  });
});

describe('list — newest first, and durable across store instances', () => {
  it('sorts by start time descending and survives a fresh store over the same root', async () => {
    const root = stateRoot();
    let t = 1_000;
    const first = createSessionRunStore(createSessionPersistence(root), { now: () => t });
    await first.create({ owner: 'operator-1', kind: 'agent', targetRef: 'oldest', ptySessionId: null });
    t = 2_000;
    await first.create({ owner: 'operator-1', kind: 'agent', targetRef: 'newest', ptySessionId: null });
    const next = createSessionRunStore(createSessionPersistence(root));
    expect(next.list('operator-1').map((entry) => entry.targetRef)).toEqual(['newest', 'oldest']);
  });
});

describe('retention — a live record is never evicted', () => {
  it('evicts oldest TERMINAL records past the cap and keeps every live one', async () => {
    const root = stateRoot();
    let t = 1_000;
    const s = createSessionRunStore(createSessionPersistence(root), { now: () => (t += 1) });
    const live = await s.create({ owner: 'operator-1', kind: 'agent', targetRef: 'live-one', ptySessionId: null });
    for (let i = 0; i < MAX_LEGACY_RUNS + 5; i += 1) {
      const record = await s.create({ owner: 'operator-1', kind: 'agent', targetRef: `t-${i}`, ptySessionId: null });
      await s.end('operator-1', record.sessionRunRef);
    }
    const all = s.list('operator-1');
    expect(all.length).toBeLessThanOrEqual(MAX_LEGACY_RUNS);
    // The oldest record in the document is the live one, and it is still there.
    expect(s.get('operator-1', live.sessionRunRef)).toMatchObject({ outcome: 'live' });
  }, 60_000);
});

/**
 * W6.3b — documenting a real behaviour change the W6.3 diff made silently. Under the deleted v1
 * `applyRetention`, a document at the cap with EVERY run still `live` was tolerated ("honestly over the
 * cap"): retention evicted only terminal rows, found none to evict, and the write succeeded. The shared
 * v2 `enforcePtySessionRetention` instead throws `capacity` and fails the whole write.
 *
 * That is the right posture — silently exceeding a declared cap is how a 4 MB document ceiling gets
 * discovered in production — and it is unreachable in practice, because the PTY host caps live sessions
 * far below `MAX_LEGACY_RUNS`. It is pinned here so it is a decision, not an accident.
 */
describe('retention — an over-cap document of ONLY live records now refuses (W6.3 change)', () => {
  it('throws instead of quietly exceeding the cap when nothing terminal can be evicted', async () => {
    const root = stateRoot();
    let t = 1_000;
    const store = createSessionRunStore(createSessionPersistence(root), { now: () => (t += 1) });
    for (let i = 0; i < MAX_LEGACY_RUNS; i += 1) {
      await store.create({ owner: 'operator-1', kind: 'agent', targetRef: `live-${i}`, ptySessionId: null });
    }
    expect(store.list('operator-1')).toHaveLength(MAX_LEGACY_RUNS);

    // The (MAX + 1)-th live record: no terminal row exists to make room, so the write is refused whole.
    await expect(store.create({
      owner: 'operator-1', kind: 'agent', targetRef: 'live-over-cap', ptySessionId: null,
    })).rejects.toThrow();

    // Refused WHOLE: the document is exactly as it was, never left at MAX + 1.
    expect(store.list('operator-1')).toHaveLength(MAX_LEGACY_RUNS);
  }, 120_000);
});
