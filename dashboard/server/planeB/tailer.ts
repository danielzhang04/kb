import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
// The pure parsing primitives (`TranscriptRecord`, `SKIP_RECORD_TYPES`, `parseRecord`) live in
// `./record.ts` — no node builtins — so the browser Vibe stream client can reuse `parseRecord`
// WITHOUT pulling this file's `node:fs`/`node:buffer` into the client bundle. Re-exported below so
// server-side callers of these from `tailer.ts` keep working unchanged; `tailFrom` (which needs the
// node builtins) stays here.
import { SKIP_RECORD_TYPES, parseRecord, type TranscriptRecord } from './record.ts';

export { SKIP_RECORD_TYPES, parseRecord } from './record.ts';
export type { TranscriptRecord } from './record.ts';

export interface TailResult {
  /** Kept (non-skipped) records parsed from complete newline-terminated lines. */
  records: TranscriptRecord[];
  /**
   * Byte offset at the START of any trailing partial line — the resume point.
   * A partial fragment is never consumed; the next `tailFrom` re-reads it once
   * an append completes the line.
   */
  nextOffset: number;
  /** The trailing partial-line fragment (informational; not consumed). */
  remainder: string;
}

const CHUNK_SIZE = 64 * 1024;
const NEWLINE = 0x0a;

/**
 * Incrementally tail a JSONL transcript from `byteOffset` to EOF.
 *
 * Reads in bounded chunks (never a whole-file read), assembles complete
 * newline-terminated lines across chunk boundaries, and carries a trailing
 * partial fragment as `remainder` without consuming it. Multi-MB single lines
 * are assembled from streamed chunks. Non-message record types
 * (`SKIP_RECORD_TYPES`) are dropped.
 */
export async function tailFrom(path: string, byteOffset: number): Promise<TailResult> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, byteOffset);
    if (start >= size) {
      return { records: [], nextOffset: start, remainder: '' };
    }

    const records: TranscriptRecord[] = [];
    // Bytes of complete lines consumed so far (including their trailing '\n').
    let consumed = 0;
    // Rolling buffer of bytes read but not yet terminated by a newline.
    let pending = Buffer.alloc(0);

    const readBuf = Buffer.alloc(CHUNK_SIZE);
    let filePos = start;
    while (filePos < size) {
      const toRead = Math.min(CHUNK_SIZE, size - filePos);
      const { bytesRead } = await fh.read(readBuf, 0, toRead, filePos);
      if (bytesRead <= 0) break;
      filePos += bytesRead;

      pending = pending.length === 0 ? Buffer.from(readBuf.subarray(0, bytesRead)) : Buffer.concat([pending, readBuf.subarray(0, bytesRead)]);

      // Emit every complete line currently in `pending`.
      let nlIndex = pending.indexOf(NEWLINE);
      while (nlIndex !== -1) {
        const lineBytes = pending.subarray(0, nlIndex); // excludes '\n'
        consumed += nlIndex + 1; // include the '\n' in the consumed count
        const rec = parseRecord(lineBytes.toString('utf8'));
        if (rec && !(typeof rec.type === 'string' && SKIP_RECORD_TYPES.has(rec.type))) {
          records.push(rec);
        }
        pending = pending.subarray(nlIndex + 1);
        nlIndex = pending.indexOf(NEWLINE);
      }
    }

    return {
      records,
      nextOffset: start + consumed,
      remainder: pending.toString('utf8'),
    };
  } finally {
    await fh.close();
  }
}
