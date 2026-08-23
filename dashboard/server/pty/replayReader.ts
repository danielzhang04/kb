/**
 * Bounded read-only raw transcript replay ([C-R6]).
 *
 *  ON-DISK FORMAT FINDING — W3's `createTranscriptRetention.append(sessionId, sequence, data)`
 *  (`sessionPersistence.ts:577-660`) writes `data` and NOTHING else into
 *  `<stateRoot>/pty/transcripts/<sessionId>.raw`: no length prefix, no record header, no delimiter and
 *  no sidecar index. Compaction keeps the LAST `maxBytes` bytes of the stream. A `.raw` file is
 *  therefore a BARE BYTE STREAM.
 *
 *  THE CURSOR CONTRACT ([C-R6], W0 amendment #3). Every PTY `sequence` on the wire — live `data` frames,
 *  replayed `data` frames, `attach.fromSequence`, `attached.nextSequence` — is a BYTE OFFSET into the
 *  session's output stream: the offset of the frame's FIRST byte, counted from the first byte the
 *  session ever produced. The registry mints those offsets (`sessionRecord.ts`) and hands the same
 *  offset to `append`, so the byte at stream offset `n` is the byte this reader serves for `n`. That is
 *  what makes a bare byte stream sufficient: frame boundaries are NOT preserved and do not need to be,
 *  because a replayed frame is any slice of the retained window and its `sequence` is its own offset.
 *
 *  The retained window is `[floor, total)` where `total` is the cumulative byte count the record holds
 *  and `floor = total - fileSize`: compaction drops the head, never rebases what survives. A read is
 *  therefore never a lie about which bytes it returned — `replayFrom` names where the reader actually
 *  started, which is how the client knows to say that earlier output was not kept.
 *
 *  Pure read path. This module opens the transcript for reading and does nothing else: no control, no
 *  writes, no compaction, no path from a caller-supplied string to a filesystem path (the session id is
 *  validated against the same `pty-<32 hex>` shape the writer uses and the derived path is contained).
 */
import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { RawSessionReplay } from './contracts.ts';
import type { SessionReplayReader } from './route.ts';

/** The largest slice a single replayed `data` frame may carry. */
export const REPLAY_FRAME_BYTES = 65_536;
/** [C-R6]: at most 65,536 bytes and at most 256 frames per call — the whole reattach window. */
export const MAX_REPLAY_BYTES = 65_536;
export const MAX_REPLAY_FRAMES = 256;

const SESSION_ID_RE = /^pty-[0-9a-f]{32}$/;

export type RawSessionReplayRefusalCode =
  /** The session id is not the server-derived `pty-<32 hex>` shape. */
  | 'invalid-session'
  /** `fromSequence` is past the last byte written — the caller's cursor names bytes that never existed. */
  | 'replay-gap'
  /** The transcript exists but cannot be read as a byte stream (not a file, unreadable, racing rename). */
  | 'replay-unreadable';

/** A refusal is a VALUE on every path in this module. Nothing here throws a raw filesystem error. */
export class RawSessionReplayRefusal extends Error {
  readonly code: RawSessionReplayRefusalCode;
  readonly sessionId: string;
  readonly fromSequence: number;
  /** The oldest byte offset still retained. */
  readonly floorSequence: number | null;
  /** The cursor the caller should hold after this refusal. */
  readonly nextSequence: number | null;

  constructor(
    code: RawSessionReplayRefusalCode,
    message: string,
    detail: { sessionId: string; fromSequence: number; floorSequence?: number; nextSequence?: number },
  ) {
    super(message);
    this.name = 'RawSessionReplayRefusal';
    this.code = code;
    this.sessionId = detail.sessionId;
    this.fromSequence = detail.fromSequence;
    this.floorSequence = detail.floorSequence ?? null;
    this.nextSequence = detail.nextSequence ?? null;
  }
}

export type RawSessionReplayResult =
  | { ok: true; value: RawSessionReplay }
  | { ok: false; refusal: RawSessionReplayRefusal };

/** What the session record knows about a transcript: bytes ever written, and bytes still on disk. */
export type TranscriptExtent = { total: number; bytes: number };

export interface RawSessionReplayOptions {
  /** The dashboard state root. The `.raw` path is derived from it exactly as the writer derives it. */
  stateRoot: string;
  /**
   * The record's view of the transcript — `total` is `transcript.lastSequence` (the cumulative byte
   * count, i.e. the offset one past the last byte) and `bytes` is the retained file size. Absent or
   * `null` means "no record": the file is then taken at face value as an uncompacted stream.
   */
  extent?: (sessionId: string) => TranscriptExtent | null;
  /** Bytes emitted per call, `1..65_536`. [C-R6] forbids a caller raising this above the window. */
  maxBytes?: number;
  /** Frames emitted per call, `1..256`. */
  maxFrames?: number;
}

export interface RawSessionReplaySource {
  /** The typed read. Refusals come back as values. */
  read(sessionId: string, fromSequence: number): Promise<RawSessionReplayResult>;
  /** The route adapter: same read, refusals degraded to "attach with no scrollback". Never throws. */
  reader: SessionReplayReader;
}

const safeInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export function createRawSessionReplaySource(options: RawSessionReplayOptions): RawSessionReplaySource {
  const stateRoot = options.stateRoot;
  const maxBytes = options.maxBytes ?? MAX_REPLAY_BYTES;
  const maxFrames = options.maxFrames ?? MAX_REPLAY_FRAMES;
  if (!isAbsolute(stateRoot)
    || !safeInteger(maxBytes, 1, MAX_REPLAY_BYTES)
    || !safeInteger(maxFrames, 1, MAX_REPLAY_FRAMES)) {
    throw new Error('PTY raw replay reader configuration is invalid');
  }
  const directory = resolve(stateRoot, 'pty', 'transcripts');

  const read = async (sessionId: string, fromSequence: number): Promise<RawSessionReplayResult> => {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      return {
        ok: false,
        refusal: new RawSessionReplayRefusal('invalid-session', 'PTY replay session id is invalid', {
          sessionId: typeof sessionId === 'string' ? sessionId : '', fromSequence: 0,
        }),
      };
    }
    if (!safeInteger(fromSequence, 0, Number.MAX_SAFE_INTEGER)) {
      return {
        ok: false,
        refusal: new RawSessionReplayRefusal('replay-gap', 'PTY replay cursor is invalid', {
          sessionId, fromSequence: 0, nextSequence: 0,
        }),
      };
    }
    const path = resolve(directory, `${sessionId}.raw`);
    if (relative(directory, path).startsWith('..')) {
      return {
        ok: false,
        refusal: new RawSessionReplayRefusal('invalid-session', 'PTY replay transcript path is invalid', {
          sessionId, fromSequence,
        }),
      };
    }

    let extent: TranscriptExtent | null = null;
    try {
      extent = options.extent?.(sessionId) ?? null;
    } catch {
      extent = null;
    }
    if (extent !== null
      && (!safeInteger(extent.total, 0, Number.MAX_SAFE_INTEGER)
        || !safeInteger(extent.bytes, 0, Number.MAX_SAFE_INTEGER)
        || extent.bytes > extent.total)) {
      return {
        ok: false,
        refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript extent is invalid', {
          sessionId, fromSequence,
        }),
      };
    }
    // A session with no output yet has no file at all. That is an empty transcript, not a failure.
    if (!existsSync(path)) {
      const total = extent?.total ?? 0;
      const empty = extent === null || extent.bytes === 0;
      if (!empty) {
        return {
          ok: false,
          refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript is missing', {
            sessionId, fromSequence,
          }),
        };
      }
      if (fromSequence > total) {
        return {
          ok: false,
          refusal: new RawSessionReplayRefusal('replay-gap', 'PTY replay cursor is past the transcript', {
            sessionId, fromSequence, floorSequence: total, nextSequence: total,
          }),
        };
      }
      return {
        ok: true,
        value: { sessionId, fromSequence, replayFrom: total, nextSequence: total, complete: true, frames: [] },
      };
    }

    // Size is taken from the OPEN descriptor, never from a separate `stat`: compaction renames a rebuilt
    // file over this path, and a size read before the open can describe a file this read never touched.
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let size = 0;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (handle !== null) await handle.close().catch(() => undefined);
        handle = await open(path, 'r');
        const stats = await handle.stat();
        if (!stats.isFile()) {
          await handle.close().catch(() => undefined);
          return {
            ok: false,
            refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript is not a file', {
              sessionId, fromSequence,
            }),
          };
        }
        size = stats.size;
        // The record and the descriptor must describe the same file. A single disagreement is the
        // compaction race; a second one is a transcript this reader cannot serve honestly.
        if (extent === null || extent.bytes === size) break;
        if (attempt === 1) {
          await handle.close().catch(() => undefined);
          return {
            ok: false,
            refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript changed under the read', {
              sessionId, fromSequence,
            }),
          };
        }
      }

      const total = extent?.total ?? size;
      const floor = Math.max(0, total - size);
      if (fromSequence > total) {
        return {
          ok: false,
          refusal: new RawSessionReplayRefusal('replay-gap', 'PTY replay cursor is past the transcript', {
            sessionId, fromSequence, floorSequence: floor, nextSequence: total,
          }),
        };
      }
      // The reattach window is the MOST RECENT bytes, never the oldest: a terminal that comes back wants
      // the tail it just lost. `replayFrom` reports the real start, so a caller that asked for more than
      // the window can tell its operator that earlier output was not kept.
      const start = Math.max(fromSequence, floor, total - maxBytes);
      const frames: RawSessionReplay['frames'] = [];
      let cursor = start;
      let budget = Math.min(maxBytes, total - start);
      while (handle !== null && budget > 0 && frames.length < maxFrames) {
        const length = Math.min(REPLAY_FRAME_BYTES, budget);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, cursor - floor);
        if (bytesRead !== length) {
          return {
            ok: false,
            refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript ended early', {
              sessionId, fromSequence, floorSequence: floor, nextSequence: cursor,
            }),
          };
        }
        frames.push({ sequence: cursor, encoding: 'base64', data: buffer.toString('base64') });
        cursor += length;
        budget -= length;
      }
      return {
        ok: true,
        value: {
          sessionId,
          fromSequence,
          replayFrom: start,
          nextSequence: cursor,
          complete: cursor >= total,
          frames,
        },
      };
    } catch {
      return {
        ok: false,
        refusal: new RawSessionReplayRefusal('replay-unreadable', 'PTY replay transcript cannot be read', {
          sessionId, fromSequence,
        }),
      };
    } finally {
      if (handle !== null) await handle.close().catch(() => undefined);
    }
  };

  const reader: SessionReplayReader = async (sessionId, fromSequence) => {
    const result = await read(sessionId, fromSequence);
    if (result.ok) {
      return { frames: result.value.frames, replayFrom: result.value.replayFrom, nextSequence: result.value.nextSequence };
    }
    // A refused replay is an attach WITHOUT scrollback, never a control fallback and never a thrown
    // error that would fail the whole attach. `nextSequence` names where the caller should resume, and
    // `replayFrom` equals it: no byte was replayed, and the client says earlier output was not kept.
    const resume = result.refusal.nextSequence ?? result.refusal.floorSequence ?? fromSequence;
    return { frames: [], replayFrom: resume, nextSequence: resume };
  };

  return { read, reader };
}

/** The production factory: the route's `SessionReplayReader`, refusals already degraded. */
export function createRawSessionReplayReader(options: RawSessionReplayOptions): SessionReplayReader {
  return createRawSessionReplaySource(options).reader;
}
