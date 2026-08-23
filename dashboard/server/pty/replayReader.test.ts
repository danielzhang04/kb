import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTranscriptRetention } from './sessionPersistence.ts';
import {
  MAX_REPLAY_BYTES,
  REPLAY_FRAME_BYTES,
  createRawSessionReplayReader,
  createRawSessionReplaySource,
} from './replayReader.ts';
import type { TranscriptExtent } from './replayReader.ts';

const SESSION = 'pty-0123456789abcdef0123456789abcdef';
const OTHER = 'pty-fedcba9876543210fedcba9876543210';

let stateRoot: string;

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'kb-replay-reader-'));
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

const decode = (frames: { data: string }[]): Buffer =>
  Buffer.concat(frames.map((frame) => Buffer.from(frame.data, 'base64')));

/**
 * Write through the REAL retention exactly as the registry does: `sequence` is the running byte offset
 * of the frame's first byte, and the record it hands back carries the cumulative total. The extent the
 * reader is given is the record's, so these tests exercise the production pairing, not a stub of it.
 */
function writeStream(chunks: Buffer[], maxBytes = 4_000_000): { extent: TranscriptExtent; expected: Buffer } {
  const retention = createTranscriptRetention(stateRoot, maxBytes);
  let offset = 0;
  let last = { bytes: 0, lastSequence: 0 };
  for (const chunk of chunks) {
    const record = retention.append(SESSION, offset, chunk);
    offset += chunk.byteLength;
    last = { bytes: record.bytes, lastSequence: record.lastSequence };
  }
  return {
    extent: { total: last.lastSequence, bytes: last.bytes },
    expected: Buffer.concat(chunks),
  };
}

const withExtent = (extent: TranscriptExtent | null, overrides: { maxBytes?: number; maxFrames?: number } = {}) =>
  createRawSessionReplaySource({ stateRoot, extent: () => extent, ...overrides });

describe('createRawSessionReplaySource', () => {
  it('round-trips W3-written bytes exactly, numbering every frame by its byte offset', async () => {
    // Every byte value, so a stray toString('utf8') anywhere in the path would corrupt the stream.
    const binary = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
    const { extent, expected } = writeStream([
      Buffer.from('banner\r\n', 'utf8'), binary, Buffer.from([0xff, 0x00, 0xfe]),
    ]);
    expect(extent).toEqual({ total: expected.byteLength, bytes: expected.byteLength });

    const result = await withExtent(extent).read(SESSION, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      sessionId: SESSION, fromSequence: 0, replayFrom: 0, nextSequence: expected.byteLength, complete: true,
    });
    expect(result.value.frames.map((frame) => frame.sequence)).toEqual([0]);
    expect(result.value.frames.every((frame) => frame.encoding === 'base64')).toBe(true);
    expect(decode(result.value.frames).equals(expected)).toBe(true);

    // A mid-stream cursor starts at the byte it names, not at a frame boundary the file never kept.
    const tail = await withExtent(extent).read(SESSION, 8);
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.value.replayFrom).toBe(8);
    expect(decode(tail.value.frames).equals(expected.subarray(8))).toBe(true);
  });

  it('replays the most recent window, not the oldest, when the transcript is larger than 64 KiB', async () => {
    const { extent, expected } = writeStream([
      Buffer.alloc(REPLAY_FRAME_BYTES, 0x61), Buffer.alloc(REPLAY_FRAME_BYTES, 0x62), Buffer.from('tail\r\n'),
    ]);
    expect(extent.total).toBe(expected.byteLength);

    const fresh = await withExtent(extent).read(SESSION, 0);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    // A fresh attach asked for everything and was told the truth about what it got.
    expect(fresh.value.replayFrom).toBe(expected.byteLength - MAX_REPLAY_BYTES);
    expect(fresh.value.nextSequence).toBe(expected.byteLength);
    expect(fresh.value.complete).toBe(true);
    expect(decode(fresh.value.frames).equals(expected.subarray(expected.byteLength - MAX_REPLAY_BYTES))).toBe(true);
    expect(fresh.value.frames[0].sequence).toBe(fresh.value.replayFrom);

    // Same for a cursor so far behind that the window cannot reach it.
    const stale = await withExtent(extent).read(SESSION, 10);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.replayFrom).toBeGreaterThan(10);
    expect(decode(stale.value.frames).byteLength).toBe(MAX_REPLAY_BYTES);
  });

  it('clamps a replay to the retained floor after compaction dropped the head', async () => {
    const ceiling = 4_096;
    const { extent, expected } = writeStream([Buffer.alloc(3_000, 0x61), Buffer.alloc(3_000, 0x62)], ceiling);
    expect(extent).toEqual({ total: 6_000, bytes: ceiling });
    const floor = extent.total - extent.bytes;

    const result = await withExtent(extent).read(SESSION, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.replayFrom).toBe(floor);
    expect(result.value.nextSequence).toBe(6_000);
    expect(result.value.complete).toBe(true);
    expect(decode(result.value.frames).equals(expected.subarray(floor))).toBe(true);

    // A cursor INSIDE the retained window is honoured exactly — the surviving bytes were not rebased.
    const inside = await withExtent(extent).read(SESSION, 5_000);
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    expect(inside.value.replayFrom).toBe(5_000);
    expect(decode(inside.value.frames).equals(expected.subarray(5_000))).toBe(true);
  });

  it('refuses a cursor past the last byte ever written as a gap', async () => {
    const { extent } = writeStream([Buffer.from('one frame')]);

    // Exactly the total is a legal empty read: the caller is simply up to date.
    const edge = await withExtent(extent).read(SESSION, extent.total);
    expect(edge.ok).toBe(true);
    if (edge.ok) {
      expect(edge.value).toMatchObject({ complete: true, frames: [], replayFrom: extent.total, nextSequence: extent.total });
    }

    const result = await withExtent(extent).read(SESSION, extent.total + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('replay-gap');
    expect(result.refusal.nextSequence).toBe(extent.total);
  });

  it('refuses rather than serving rebased bytes when the file disagrees with the record', async () => {
    const { extent } = writeStream([Buffer.alloc(2_000, 0x61)]);
    // The compaction race: the record describes a file of a different size than the one this read
    // opened. Re-opening cannot reconcile it, so nothing is served.
    const racing = withExtent({ total: extent.total + 5_000, bytes: extent.bytes + 5_000 });
    const result = await racing.read(SESSION, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('replay-unreadable');
  });

  it('reports an empty, complete replay for a session that has written nothing', async () => {
    const source = withExtent(null);
    const result = await source.read(SESSION, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      sessionId: SESSION, fromSequence: 0, replayFrom: 0, nextSequence: 0, complete: true, frames: [],
    });
  });

  it('pages on maxFrames and continues from nextSequence with no duplicate and no gap', async () => {
    const { extent, expected } = writeStream([Buffer.alloc(3_000, 0x61)]);
    const source = withExtent(extent, { maxBytes: 1_000, maxFrames: 2 });

    const first = await source.read(SESSION, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.frames.map((frame) => frame.sequence)).toEqual([2_000]);
    expect(first.value.complete).toBe(true);

    // A 1 000-byte budget can only ever serve the last kilobyte; the window is the tail, always.
    expect(decode(first.value.frames).equals(expected.subarray(2_000))).toBe(true);
    expect(first.value.nextSequence).toBe(3_000);
  });

  it('slices the window into at most 256 frames of at most 64 KiB each', async () => {
    const { extent } = writeStream([Buffer.alloc(1_024, 0x63)]);
    const source = withExtent(extent, { maxBytes: 1_024, maxFrames: 256 });
    const result = await source.read(SESSION, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frames).toHaveLength(1);
    expect(result.value.frames[0].sequence).toBe(0);
  });

  it('refuses an unreadable transcript instead of throwing', async () => {
    // A directory where the `.raw` stream belongs: the path resolves, the read cannot.
    mkdirSync(resolve(stateRoot, 'pty', 'transcripts'), { recursive: true });
    mkdirSync(resolve(stateRoot, 'pty', 'transcripts', `${SESSION}.raw`), { recursive: true });
    const source = withExtent(null);
    const result = await source.read(SESSION, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('replay-unreadable');
  });

  it('refuses every session id that is not the server-derived shape', async () => {
    const source = withExtent(null);
    for (const candidate of ['', 'pty-', '../../etc/passwd', `${SESSION}/../${OTHER}`, 'PTY-0123456789abcdef0123456789abcdef']) {
      const result = await source.read(candidate, 0);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.refusal.code).toBe('invalid-session');
    }
  });

  it('refuses an out-of-bounds configuration rather than reading with one', () => {
    expect(() => createRawSessionReplaySource({ stateRoot: 'relative/root' })).toThrow(/configuration is invalid/);
    // [C-R6] caps the request window; a caller may lower it but never raise it.
    expect(() => createRawSessionReplaySource({ stateRoot, maxBytes: MAX_REPLAY_BYTES + 1 })).toThrow(/configuration is invalid/);
    expect(() => createRawSessionReplaySource({ stateRoot, maxBytes: 0 })).toThrow(/configuration is invalid/);
    expect(() => createRawSessionReplaySource({ stateRoot, maxFrames: 0 })).toThrow(/configuration is invalid/);
    expect(() => createRawSessionReplaySource({ stateRoot, maxFrames: 257 })).toThrow(/configuration is invalid/);
  });

  it('degrades a refusal to scrollback-free attach in the route adapter, never a throw', async () => {
    writeFileSync(resolve(stateRoot, 'seed'), 'x');
    const reader = createRawSessionReplayReader({ stateRoot });
    await expect(reader('not-a-session', 0)).resolves.toEqual({ frames: [], replayFrom: 0, nextSequence: 0 });
  });
});
