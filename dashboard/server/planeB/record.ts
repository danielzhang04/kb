/**
 * Plane-B transcript record — the PURE parsing primitives, split out of `tailer.ts` (D0.3) so the
 * browser (the Vibe streaming client) can reuse `parseRecord`/`SKIP_RECORD_TYPES`/`TranscriptRecord`
 * WITHOUT dragging `tailer.ts`'s `node:fs`/`node:buffer` imports into the client bundle. Behaviour is
 * byte-for-byte identical to the original definitions; the file-tailing `tailFrom` (which needs the
 * node builtins) stays in `tailer.ts` and re-exports these.
 */

/**
 * Plane-B transcript record. Only the fields the dashboard reads are typed; the
 * on-disk records carry many more keys, kept under the index signature.
 */
export interface TranscriptRecord {
  type?: string;
  message?: {
    model?: string;
    usage?: unknown;
    content?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Record types that are NOT timeline content and are dropped by the tailer
 * (allowlist-by-exclusion: everything not here — chiefly `assistant`/`user` —
 * is kept). Aligned to the record types OBSERVED in real kb sessions.
 *
 * `system` is a conscious skip: it carries session metadata, not timeline
 * content. `summary` is a defensive entry — never observed in a sampled kb
 * session, included belt-and-suspenders (its presence here is not evidence it
 * occurs).
 */
export const SKIP_RECORD_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'last-prompt',
  'mode',
  'permission-mode',
  'ai-title',
  'system',
  'file-history-snapshot',
  'file-history-delta',
  'queue-operation',
  'summary', // defensive — not observed in kb sessions
]);

/**
 * Parse one complete JSONL line into a record. Returns `null` for blank /
 * whitespace-only lines and for lines that fail to parse (a defensive tailer
 * never crashes the stream on one malformed line).
 */
export function parseRecord(line: string): TranscriptRecord | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed) as TranscriptRecord;
  } catch {
    return null;
  }
}
