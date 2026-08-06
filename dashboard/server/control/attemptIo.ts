import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';

export type AttemptIoDir = 'out' | 'in' | 'meta';

export interface AttemptIoEntry {
  seq: number;
  t: string;
  dir: AttemptIoDir;
  line: string;
}

export interface AttemptIoAppend {
  attemptRef: string;
  entry: AttemptIoEntry;
}

/** Narrow write-side seam the adapters receive â€” keeps adapters ignorant of read/subscribe. */
export interface AttemptIoSink {
  append(attemptRef: string, dir: AttemptIoDir, line: string): void;
}

export interface AttemptIoStore extends AttemptIoSink {
  read(attemptRef: string, afterSeq?: number, limit?: number): AttemptIoEntry[];
  onAppend(cb: (evt: AttemptIoAppend) => void): () => void;
  stop(): void;
  /** Test-only visibility into the bounded resident buffer cache. */
  bufferedAttemptCountForTest(): number;
}

interface AttemptBuffer {
  entries: AttemptIoEntry[];
  bytes: number;
  pending: string[];
  compact: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inPemBlock: boolean;
}

const ATTEMPT_REF_RE = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED_BASENAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DEFAULT_MAX_BYTES = 512_000;
const DEFAULT_FLUSH_MS = 2_000;
const MAX_RESIDENT_ATTEMPTS = 32;
const MAX_LINE_CHARS = 8_000;
const TRUNCATED_LINE_SUFFIX = '…[truncated]';

function serialized(entry: AttemptIoEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

function entryBytes(entry: AttemptIoEntry): number {
  return Buffer.byteLength(serialized(entry));
}

function validEntry(value: unknown): value is AttemptIoEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AttemptIoEntry>;
  return Number.isSafeInteger(entry.seq)
    && typeof entry.t === 'string'
    && (entry.dir === 'out' || entry.dir === 'in' || entry.dir === 'meta')
    && typeof entry.line === 'string';
}

export function createAttemptIoStore(options: {
  root: string;
  maxBytesPerAttempt?: number;
  flushMs?: number;
}): AttemptIoStore {
  const root = options.root;
  const maxBytesPerAttempt = options.maxBytesPerAttempt ?? DEFAULT_MAX_BYTES;
  const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
  const attempts = new Map<string, AttemptBuffer>();
  const subscribers = new Set<(evt: AttemptIoAppend) => void>();
  let stopped = false;

  if (!Number.isFinite(maxBytesPerAttempt) || maxBytesPerAttempt < 1) {
    throw new Error('maxBytesPerAttempt must be a positive finite number');
  }
  if (!Number.isFinite(flushMs) || flushMs < 0) throw new Error('flushMs must be a non-negative finite number');

  // Attempt refs become filenames below, so reject separators, traversal, and shell metacharacters up front.
  function assertAttemptRef(attemptRef: string): void {
    if (!ATTEMPT_REF_RE.test(attemptRef)) throw new Error('attemptRef must be a single filename-safe segment');
    if (WINDOWS_RESERVED_BASENAME_RE.test(attemptRef.split('.', 1)[0])) {
      throw new Error('attemptRef must not use a Windows reserved device name');
    }
  }

  function pathFor(attemptRef: string): string {
    return join(root, `${attemptRef}.jsonl`);
  }

  function evictFlushedBuffers(currentAttemptRef: string): void {
    while (attempts.size > MAX_RESIDENT_ATTEMPTS) {
      const oldest = [...attempts].find(([attemptRef, buffer]) => attemptRef !== currentAttemptRef
        && buffer.pending.length === 0 && !buffer.compact && buffer.timer === null);
      if (!oldest) return;
      attempts.delete(oldest[0]);
    }
  }

  function load(attemptRef: string): AttemptBuffer {
    const existing = attempts.get(attemptRef);
    if (existing) {
      attempts.delete(attemptRef);
      attempts.set(attemptRef, existing);
      return existing;
    }
    const entries: AttemptIoEntry[] = [];
    const path = pathFor(attemptRef);
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const line of lines) {
        if (line.length === 0) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (validEntry(parsed)) entries.push(parsed);
        } catch {
          // A crash may leave a partial final JSONL line; previously complete entries remain readable.
        }
      }
    }
    const buffer: AttemptBuffer = {
      entries,
      bytes: entries.reduce((total, entry) => total + entryBytes(entry), 0),
      pending: [],
      compact: false,
      timer: null,
      inPemBlock: false,
    };
    attempts.set(attemptRef, buffer);
    evictFlushedBuffers(attemptRef);
    return buffer;
  }

  function flush(attemptRef: string, buffer: AttemptBuffer): void {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.pending.length === 0 && !buffer.compact) return;
    const path = pathFor(attemptRef);
    mkdirSync(root, { recursive: true });
    if (buffer.compact) {
      writeFileSync(path, buffer.entries.map(serialized).join(''));
      buffer.compact = false;
      buffer.pending = [];
      evictFlushedBuffers(attemptRef);
      return;
    }
    appendFileSync(path, buffer.pending.join(''));
    buffer.pending = [];
    evictFlushedBuffers(attemptRef);
  }

  function scheduleFlush(attemptRef: string, buffer: AttemptBuffer): void {
    if (flushMs === 0) {
      flush(attemptRef, buffer);
      return;
    }
    if (buffer.timer) return;
    buffer.timer = setTimeout(() => flush(attemptRef, buffer), flushMs);
    if (typeof buffer.timer.unref === 'function') buffer.timer.unref();
  }

  function redactAttemptLine(buffer: AttemptBuffer, line: string): string {
    const redacted = redactSensitiveText(line).replace(/\0/g, '');
    const beginsPem = redacted.includes('-----BEGIN') && redacted.includes('PRIVATE KEY-----');
    const endsPem = redacted.includes('-----END') && redacted.includes('PRIVATE KEY-----');
    if (buffer.inPemBlock || beginsPem) {
      buffer.inPemBlock = !endsPem;
      return '[private key redacted]';
    }
    return redacted;
  }

  function truncateLine(line: string): string {
    return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}${TRUNCATED_LINE_SUFFIX}` : line;
  }

  function truncateLineToEntryCap(entry: AttemptIoEntry): boolean {
    if (entryBytes(entry) <= maxBytesPerAttempt) return true;
    const baseBytes = entryBytes({ ...entry, line: '' });
    const availableLineBytes = maxBytesPerAttempt - baseBytes;
    if (availableLineBytes < 0) return false;
    const suffix = entry.line.endsWith(TRUNCATED_LINE_SUFFIX) ? TRUNCATED_LINE_SUFFIX : '';
    const body = suffix ? entry.line.slice(0, -suffix.length) : entry.line;
    let low = 0;
    let high = body.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = `${body.slice(0, middle)}${suffix}`;
      if (Buffer.byteLength(candidate) <= availableLineBytes) low = middle;
      else high = middle - 1;
    }
    entry.line = `${body.slice(0, low)}${suffix}`;
    if (Buffer.byteLength(entry.line) > availableLineBytes) entry.line = '';
    return entryBytes(entry) <= maxBytesPerAttempt;
  }

  return {
    append(attemptRef, dir, line) {
      assertAttemptRef(attemptRef);
      if (stopped) return;
      const buffer = load(attemptRef);
      const previous = buffer.entries.at(-1);
      const entry: AttemptIoEntry = {
        seq: (previous?.seq ?? 0) + 1,
        t: new Date().toISOString(),
        dir,
        line: truncateLine(redactAttemptLine(buffer, line)),
      };
      if (!truncateLineToEntryCap(entry)) return;
      buffer.entries.push(entry);
      buffer.bytes += entryBytes(entry);
      buffer.pending.push(serialized(entry));
      while (buffer.bytes > maxBytesPerAttempt && buffer.entries.length > 1) {
        const oldest = buffer.entries.shift();
        if (oldest) buffer.bytes -= entryBytes(oldest);
        buffer.compact = true;
      }
      scheduleFlush(attemptRef, buffer);
      for (const subscriber of subscribers) {
        try {
          subscriber({ attemptRef, entry });
        } catch {
          // A bus subscriber must not prevent the durable write-side append.
        }
      }
    },

    read(attemptRef, afterSeq = 0, limit = Number.MAX_SAFE_INTEGER) {
      assertAttemptRef(attemptRef);
      const entries = load(attemptRef).entries;
      return entries.filter((entry) => entry.seq > afterSeq).slice(0, Math.max(0, limit));
    },

    onAppend(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    stop() {
      for (const [attemptRef, buffer] of [...attempts]) flush(attemptRef, buffer);
      attempts.clear();
      subscribers.clear();
      stopped = true;
    },

    bufferedAttemptCountForTest() {
      return attempts.size;
    },
  };
}
