import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createAttemptIoStore } from './attemptIo.ts';

const root = () => mkdtempSync(join(tmpdir(), 'attempt-io-'));

describe('attemptIo store', () => {
  it('appends redacted JSONL lines with monotonic seq and reads them back after a given seq', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    store.append('attempt-1', 'out', 'hello');
    store.append('attempt-1', 'in', 'steer left');
    const all = store.read('attempt-1');
    expect(all.map((e) => [e.seq, e.dir, e.line])).toEqual([[1, 'out', 'hello'], [2, 'in', 'steer left']]);
    expect(store.read('attempt-1', 1).map((e) => e.line)).toEqual(['steer left']);
    store.stop();
  });

  it('redacts recognized secrets and strips NULs at the write boundary', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    store.append('a', 'out', 'api_key=abcdefghijklmnopqrstuvwxyz0123456789\0end');
    const [entry] = store.read('a');
    expect(entry.line).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(entry.line).not.toContain('\0');
    store.stop();
  });

  it('drops oldest lines beyond the byte cap but keeps seq monotonic', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0, maxBytesPerAttempt: 200 });
    for (let i = 0; i < 50; i++) store.append('a', 'out', `line-${i}-${'x'.repeat(20)}`);
    const entries = store.read('a');
    expect(entries.length).toBeLessThan(50);
    expect(entries.at(-1)?.line).toContain('line-49');
    const seqs = entries.map((e) => e.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    store.stop();
  });

  it('truncates one oversized line before it can bypass the per-attempt byte cap', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0, maxBytesPerAttempt: 9_000 });
    store.append('a', 'out', 'x'.repeat(100_000));

    const [entry] = store.read('a');
    expect(entry.line).toHaveLength(8_000 + '…[truncated]'.length);
    expect(entry.line.endsWith('…[truncated]')).toBe(true);
    expect(Buffer.byteLength(`${JSON.stringify(entry)}\n`)).toBeLessThanOrEqual(9_000);
    store.stop();
  });

  it('redacts a private key block split across appended lines', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    store.append('a', 'out', 'before -----BEGIN PRIVATE KEY-----');
    store.append('a', 'out', 'base64 body one');
    store.append('a', 'out', 'base64 body two');
    store.append('a', 'out', '-----END PRIVATE KEY----- after');

    expect(store.read('a').map((entry) => entry.line)).toEqual([
      '[private key redacted]', '[private key redacted]', '[private key redacted]', '[private key redacted]',
    ]);
    store.stop();
  });

  it('keeps at most 32 flushed attempt buffers resident', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    for (let i = 0; i < 40; i++) store.read(`attempt-${i}`);
    expect(store.bufferedAttemptCountForTest()).toBeLessThanOrEqual(32);
    store.stop();
  });

  it('persists to <root>/<attemptRef>.jsonl and survives reopen', () => {
    const dir = root();
    const store = createAttemptIoStore({ root: dir, flushMs: 0 });
    store.append('run-1__s1__a1', 'out', 'persisted');
    store.stop();
    expect(existsSync(join(dir, 'run-1__s1__a1.jsonl'))).toBe(true);
    const reopened = createAttemptIoStore({ root: dir, flushMs: 0 });
    expect(reopened.read('run-1__s1__a1').map((e) => e.line)).toEqual(['persisted']);
    reopened.stop();
  });

  it('rejects attemptRefs that are not single filename-safe segments', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    expect(() => store.append('../evil', 'out', 'x')).toThrow();
    expect(() => store.read('a/b')).toThrow();
    expect(() => store.append('CON', 'out', 'x')).toThrow();
    store.stop();
  });

  it('notifies onAppend subscribers with the redacted entry and honors unsubscribe', () => {
    const store = createAttemptIoStore({ root: root(), flushMs: 0 });
    const seen: string[] = [];
    const off = store.onAppend((evt) => seen.push(`${evt.attemptRef}:${evt.entry.dir}:${evt.entry.line}`));
    store.append('a', 'meta', 'started');
    off();
    store.append('a', 'meta', 'unseen');
    expect(seen).toEqual(['a:meta:started']);
    store.stop();
  });

  it('does not schedule another flush after stop', () => {
    vi.useFakeTimers();
    const store = createAttemptIoStore({ root: root(), flushMs: 500 });
    store.append('a', 'out', 'before stop');
    expect(vi.getTimerCount()).toBe(1);
    store.stop();
    expect(vi.getTimerCount()).toBe(0);
    store.append('a', 'out', 'after stop');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
