/**
 * The canonical SHA-256 / hex-shape primitives. `sha256Hex` is the one-shot UTF-8→lowercase-hex digest
 * reinvented inline across the server; `isCommitSha` / `isDigestSha256` are the 40- and 64-hex guards.
 *
 * Previously defined in `write/durableManifest.ts`; moved here (the shared-primitives home) and
 * re-exported from durableManifest so existing importers are byte-untouched.
 */
import { createHash } from 'node:crypto';

/** One-shot lowercase-hex SHA-256 of a string, hashed as UTF-8. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** 40 lowercase hex — a git commit sha. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && HEX40.test(value);
}
/** 64 lowercase hex — a SHA-256 digest. */
export function isDigestSha256(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}
