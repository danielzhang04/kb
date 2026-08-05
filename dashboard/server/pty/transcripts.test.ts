/**
 * Hermetic tests for the transcript recorder, driven through the REAL persistent-session registry over a
 * fake PtyHost — so what is exercised is the actual `observe()` tap, not a stand-in for it.
 *
 * The properties that matter: the tap never competes with the browser's sink, the byte ceiling drops
 * OLDEST and says so, the gone-notification flushes exactly once, and files land 0600 under the state
 * root and never in the repo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentSessionRegistry } from './persistentSessions.ts';
import type { PersistentSessionRegistry } from './persistentSessions.ts';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from './host.ts';
import { createTranscriptRecorder, transcriptPath } from './transcripts.ts';
import type { TranscriptSummary } from './transcripts.ts';

const dirs: string[] = [];
function stateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-transcripts-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function fakeHost(sessionId = 'pty-test-1') {
  const dataCallbacks: Array<(chunk: string) => void> = [];
  const exitCallbacks: Array<(event: { exitCode: number }) => void> = [];
  const handle: PtyHandle = {
    pid: 1,
    onData(cb) { dataCallbacks.push(cb); },
    onExit(cb) { exitCallbacks.push(cb); },
    write() {},
    resize() {},
    kill() {},
  };
  const host: PtyHost = {
    open(_request: HostOpenRequest): PtySession { return { sessionId, handle }; },
    stop() { return true; },
    stopAll() {},
    sessions() { return [sessionId]; },
  };
  return {
    host,
    sessionId,
    emit: (chunk: string) => dataCallbacks.forEach((cb) => cb(chunk)),
    exit: (code = 0) => exitCallbacks.forEach((cb) => cb({ exitCode: code })),
  };
}

function openSession(registry: PersistentSessionRegistry, host: PtyHost, owner = 'operator-1'): string {
  return registry.create(owner, host, { requestId: '', cwd: '/repo', cols: 80, rows: 24 },
    { kind: 'agent', targetRef: 'fyt-runner' }).sessionId;
}

describe('transcriptPath', () => {
  it('lands under the state root and refuses an id that could escape it', () => {
    const root = stateRoot();
    expect(transcriptPath(root, 'pty-test-1')).toBe(join(root, 'pty', 'transcripts', 'pty-test-1.log'));
    expect(() => transcriptPath(root, '../../etc/passwd')).toThrow();
    expect(() => transcriptPath(root, 'pty-a/../../b')).toThrow();
  });
});

describe('recording one session', () => {
  it('captures output written after the tap and flushes it to a 0600 file on shell exit', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host);

    let gone: TranscriptSummary | null | undefined;
    recorder.record(registry, 'operator-1', sessionId, (summary) => { gone = summary; });
    host.emit('hello ');
    host.emit('world');
    host.exit(0);

    expect(gone).toMatchObject({ truncated: false });
    const path = transcriptPath(root, sessionId);
    expect(readFileSync(path, 'utf8')).toBe('hello world');
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    recorder.dispose();
  });

  it('does NOT compete with the terminal: the attached sink still receives every byte', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host);
    recorder.record(registry, 'operator-1', sessionId);

    const seen: string[] = [];
    registry.attach('operator-1', sessionId, { send: (chunk) => seen.push(chunk), closed: () => false });
    host.emit('to the browser');

    expect(seen).toContain('to the browser');
    expect(recorder.summary(sessionId)?.bytes).toBe('to the browser'.length);
    recorder.dispose();
  });

  it('drops the OLDEST bytes past the ceiling and marks the transcript truncated', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root, maxBytes: 10 });
    const sessionId = openSession(registry, host.host);
    recorder.record(registry, 'operator-1', sessionId);

    host.emit('aaaaa');
    host.emit('bbbbb');
    expect(recorder.summary(sessionId)?.truncated).toBe(false);
    host.emit('ccccc'); // over the ceiling: the oldest whole chunk goes
    const summary = recorder.summary(sessionId);
    expect(summary?.truncated).toBe(true);
    expect(summary?.bytes).toBeLessThanOrEqual(10);

    const read = recorder.read(sessionId);
    expect(read?.text).toBe('bbbbbccccc');
    expect(read?.truncated).toBe(true);
    recorder.dispose();
  });

  it('flushes and settles on an OPERATOR close, not only on a shell exit', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host);
    let goneCalls = 0;
    recorder.record(registry, 'operator-1', sessionId, () => { goneCalls += 1; });

    host.emit('typed something');
    registry.close('operator-1', sessionId);

    expect(goneCalls).toBe(1);
    expect(readFileSync(transcriptPath(root, sessionId), 'utf8')).toBe('typed something');
    recorder.dispose();
  });

  it('reports gone exactly once even when a close is followed by a shell exit', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host);
    let goneCalls = 0;
    recorder.record(registry, 'operator-1', sessionId, () => { goneCalls += 1; });

    registry.close('operator-1', sessionId);
    host.exit(0);
    expect(goneCalls).toBe(1);
    recorder.dispose();
  });

  it('settles immediately for a foreign owner and records nothing', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host, 'operator-1');
    let gone: TranscriptSummary | null | undefined;
    // `observe` is owner-checked; a foreign tap is inert and immediately reported gone.
    recorder.record(registry, 'operator-2', sessionId, (summary) => { gone = summary; });
    host.emit('secret keystrokes');
    expect(gone).toBeNull();
    expect(existsSync(transcriptPath(root, sessionId))).toBe(false);
    recorder.dispose();
  });
});

describe('read — bounded and never stale', () => {
  it('flushes a live session before reading, and returns the TAIL when over the read bound', () => {
    const root = stateRoot();
    const registry = createPersistentSessionRegistry();
    const host = fakeHost();
    const recorder = createTranscriptRecorder({ root });
    const sessionId = openSession(registry, host.host);
    recorder.record(registry, 'operator-1', sessionId);

    host.emit('0123456789');
    // No flush has been asked for and the periodic timer has not fired; the read must still be current.
    expect(recorder.read(sessionId)?.text).toBe('0123456789');
    const bounded = recorder.read(sessionId, 4);
    expect(bounded).toEqual({ text: '6789', bytes: 4, truncated: true });
    recorder.dispose();
  });

  it('returns null for a session that was never recorded', () => {
    const recorder = createTranscriptRecorder({ root: stateRoot() });
    expect(recorder.read('pty-test-404')).toBeNull();
    expect(recorder.read('not a session id')).toBeNull();
    recorder.dispose();
  });
});
