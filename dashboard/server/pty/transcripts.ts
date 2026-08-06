/**
 * TRANSCRIPTS — what the operator and the agent actually said to each other, kept after the shell dies.
 *
 * A session run's record says a session happened; this is the only thing that says WHAT happened. It
 * exists because the alternative — reading the shell's scrollback — dies with the process: the
 * `persistentSessions` ring is in-memory and disappears with the daemon.
 *
 * ── How it taps the stream (and why it cannot disturb it) ──
 *
 * `persistentSessions` already exposes exactly the right primitive and, until now, nothing used it:
 * `observe()` (persistentSessions.ts:109-115) installs a NON-EXCLUSIVE, owner-checked output tap. Unlike
 * a sink it is never evicted by an attach, it can never send input, and an observer that throws is
 * contained inside the pump. So a recorder registered at create time sees every byte for the session's
 * whole life without competing with the browser terminal for the single sink — and this file makes ZERO
 * changes to that pump or to the session lifecycle. The paired `onGone` notification (fires exactly
 * once, on shell exit or explicit close) is what turns "the shell died" into a final flush.
 *
 * ── The buffer is byte-capped and drop-oldest, and the UI must SAY so ──
 *
 * A noisy shell left running for a day must not grow the daemon's memory or the operator's disk without
 * bound, so the recorder keeps at most {@link DEFAULT_TRANSCRIPT_BYTES} of the MOST RECENT output and
 * drops whole oldest chunks past that — the same discipline, and the same ceiling, as the session ring.
 * When that happens `truncated` is set and stays set. That flag is a truth label: a truncated transcript
 * is rendered as "last 512KB", never as the session. An `abandoned` session's transcript likewise ends
 * at the daemon restart, and its detail says exactly that.
 *
 * ── Reads are owner-checked ELSEWHERE, on purpose ──
 *
 * A transcript contains the operator's own keystrokes. This module is keyed by PTY session id and knows
 * nothing about who owns one; the route layer resolves the owner-scoped session-run record FIRST and
 * only then reads the transcript belonging to its `ptySessionId`. Files are written 0600 and live under
 * the daemon state root, never in the repo.
 */
import { mkdirSync, openSync, closeSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SESSION_ID_RE } from './persistentSessions.ts';
import type { PersistentSessionRegistry } from './persistentSessions.ts';

/** Retained-output ceiling per transcript: the most-recent ~512 KB, drop-oldest. Deliberately the same
 *  ceiling as the in-memory session ring, so what is kept on disk matches what the terminal could show. */
export const DEFAULT_TRANSCRIPT_BYTES = 512_000;

/** How often a dirty buffer is written out while the session is still alive. A crash therefore costs at
 *  most this much transcript — never the whole session. */
export const DEFAULT_FLUSH_INTERVAL_MS = 2_000;

/** Where a transcript ended up, and whether it is the WHOLE session. */
export interface TranscriptSummary {
  path: string;
  bytes: number;
  truncated: boolean;
}

/** A bounded read of a transcript file for the UI. */
export interface TranscriptRead {
  text: string;
  bytes: number;
  /** True if anything was dropped — by the recorder's ceiling, by this read's bound, or both. */
  truncated: boolean;
}

export interface TranscriptRecorder {
  /**
   * Start capturing one session. Installs the `observe()` tap and returns its unsubscribe. `onGone`
   * fires once, AFTER the final flush, with the finished summary — that is the daemon's cue to end the
   * session-run record.
   */
  record(
    registry: PersistentSessionRegistry,
    owner: string,
    sessionId: string,
    onGone?: (summary: TranscriptSummary | null) => void,
  ): () => void;
  /** Flush and finalize one session's buffer, returning its summary (null if nothing was captured). */
  finish(sessionId: string): TranscriptSummary | null;
  /** The current summary without finalizing — null when this session was never recorded here. */
  summary(sessionId: string): TranscriptSummary | null;
  /** Bounded read of a transcript from disk. Null when there is no file for this session. */
  read(sessionId: string, maxBytes?: number): TranscriptRead | null;
  /** Daemon shutdown: flush everything dirty and stop the periodic timer. */
  dispose(): void;
}

export interface TranscriptRecorderOptions {
  /** The daemon state root; transcripts land under `<root>/pty/transcripts/`. */
  root: string;
  maxBytes?: number;
  flushIntervalMs?: number;
}

/**
 * The absolute path for one session's transcript. The session id is validated against the registry's own
 * grammar FIRST, so a malformed id can never contribute a path separator or a `..` segment.
 */
export function transcriptPath(root: string, sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('transcriptPath: invalid session id');
  return join(resolve(root), 'pty', 'transcripts', `${sessionId}.log`);
}

interface TranscriptEntry {
  sessionId: string;
  path: string;
  chunks: string[];
  bytes: number;
  truncated: boolean;
  dirty: boolean;
  /** True once anything has been written to disk — distinguishes "empty session" from "never flushed". */
  written: boolean;
}

export function createTranscriptRecorder(options: TranscriptRecorderOptions): TranscriptRecorder {
  if (!isAbsolute(options.root) || options.root.includes('\0')) {
    throw new Error('createTranscriptRecorder: transcript root is invalid');
  }
  const root = resolve(options.root);
  const maxBytes = options.maxBytes ?? DEFAULT_TRANSCRIPT_BYTES;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const entries = new Map<string, TranscriptEntry>();
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Append, then drop WHOLE oldest chunks until back under the ceiling — same rule as the session ring.
   *  A single chunk larger than the ceiling is retained: it is the freshest output and there is nothing
   *  older left to drop. */
  const push = (entry: TranscriptEntry, chunk: string): void => {
    entry.chunks.push(chunk);
    entry.bytes += Buffer.byteLength(chunk, 'utf8');
    while (entry.bytes > maxBytes && entry.chunks.length > 1) {
      const dropped = entry.chunks.shift() as string;
      entry.bytes -= Buffer.byteLength(dropped, 'utf8');
      entry.truncated = true;
    }
    entry.dirty = true;
  };

  const flush = (entry: TranscriptEntry): void => {
    if (!entry.dirty) return;
    try {
      mkdirSync(dirname(entry.path), { recursive: true, mode: 0o700 });
      // Create with 0600 explicitly (a mode argument only applies at creation), then rewrite in place:
      // the buffer already holds exactly the retained window, so the file is always what a reader should
      // see, with no append-side bookkeeping to drift out of step with the drop-oldest ceiling.
      if (!existsSync(entry.path)) closeSync(openSync(entry.path, 'w', 0o600));
      writeFileSync(entry.path, entry.chunks.join(''), { encoding: 'utf8', mode: 0o600 });
      entry.dirty = false;
      entry.written = true;
    } catch {
      // A transcript is a record, not a control path: a disk failure must never break the terminal or
      // the session lifecycle. The buffer stays dirty and the next flush retries.
    }
  };

  const ensureTimer = (): void => {
    if (timer !== null) return;
    timer = setInterval(() => {
      for (const entry of entries.values()) flush(entry);
    }, flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const summaryOf = (entry: TranscriptEntry): TranscriptSummary => ({
    path: entry.path,
    bytes: entry.bytes,
    truncated: entry.truncated,
  });

  return {
    record(registry, owner, sessionId, onGone) {
      let entry = entries.get(sessionId);
      if (!entry) {
        entry = {
          sessionId,
          path: transcriptPath(root, sessionId),
          chunks: [],
          bytes: 0,
          truncated: false,
          dirty: false,
          written: false,
        };
        entries.set(sessionId, entry);
      }
      const target = entry;
      ensureTimer();
      return registry.observe(
        owner,
        sessionId,
        (chunk) => push(target, chunk),
        () => {
          flush(target);
          const summary = target.written || target.bytes > 0 ? summaryOf(target) : null;
          entries.delete(sessionId);
          if (onGone) onGone(summary);
        },
      );
    },

    finish(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      flush(entry);
      const summary = entry.written || entry.bytes > 0 ? summaryOf(entry) : null;
      entries.delete(sessionId);
      return summary;
    },

    summary(sessionId) {
      const entry = entries.get(sessionId);
      return entry ? summaryOf(entry) : null;
    },

    read(sessionId, maxBytes: number = DEFAULT_TRANSCRIPT_BYTES) {
      let path: string;
      try {
        path = transcriptPath(root, sessionId);
      } catch {
        return null;
      }
      // A live session's freshest bytes may still be buffered; flush first so a read is never stale.
      const entry = entries.get(sessionId);
      if (entry) flush(entry);
      if (!existsSync(path)) return null;
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return null;
      }
      const droppedByRecorder = entry?.truncated ?? false;
      if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
        return { text, bytes: Buffer.byteLength(text, 'utf8'), truncated: droppedByRecorder };
      }
      // Keep the TAIL: the end of a session is what an operator reads for.
      const tail = Buffer.from(text, 'utf8').subarray(-maxBytes).toString('utf8');
      return { text: tail, bytes: Buffer.byteLength(tail, 'utf8'), truncated: true };
    },

    dispose() {
      for (const entry of entries.values()) flush(entry);
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
