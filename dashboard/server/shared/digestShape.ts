/**
 * Pure shape guard for a SHA-256 hex digest — no `node:` builtins, so it is safe for a client-reachable
 * module to import (unlike `hashing.ts`, which pulls in `node:crypto` for the actual hashing functions).
 *
 * Canonical definition; `hashing.ts` re-exports it so existing importers are byte-untouched.
 */
const HEX64 = /^[0-9a-f]{64}$/;

/** 64 lowercase hex — a SHA-256 digest. */
export function isDigestSha256(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}
