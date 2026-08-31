import { createHash } from 'node:crypto';
import { posix } from 'node:path';

/** SHA-256 for UTF-8 text artifacts, independent of Git checkout EOLs and an optional BOM. */
export function normalizedTextSha256(value: string | Uint8Array): string {
  const source = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  let read = source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  const normalized = Buffer.allocUnsafe(source.length - read);
  let written = 0;
  while (read < source.length) {
    if (source[read] === 0x0d && source[read + 1] === 0x0a) {
      normalized[written++] = 0x0a;
      read += 2;
    } else {
      normalized[written++] = source[read++];
    }
  }
  return createHash('sha256').update(normalized.subarray(0, written)).digest('hex');
}

/** Compare repository-relative provenance with POSIX separators while preserving case. */
export function normalizeRepoRelativePath(value: string): string {
  const normalized = posix.normalize(value.replace(/\\/g, '/'));
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}
