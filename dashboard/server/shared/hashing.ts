/**
 * The canonical SHA-256 / hex-shape primitives. `sha256Hex` is the one-shot UTF-8→lowercase-hex digest
 * reinvented inline across the server; `isCommitSha` is the 40-hex guard. `isDigestSha256` (64-hex) is
 * defined in `digestShape.ts` (a node-builtin-free module, so client-reachable code can import it) and
 * re-exported here so existing importers are byte-untouched.
 *
 * Previously defined in `write/durableManifest.ts`; moved here (the shared-primitives home) and
 * re-exported from durableManifest so existing importers are byte-untouched.
 */
import { createHash } from 'node:crypto';
import { isDigestSha256 } from './digestShape.ts';

export { isDigestSha256 };

/** One-shot lowercase-hex SHA-256 of a string, hashed as UTF-8. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * One-shot lowercase-hex SHA-256 of EXACT bytes. Distinct from {@link sha256Hex} (UTF-8 text) and from
 * `control/textArtifactHash.ts#normalizedTextSha256` (EOL/BOM-normalized text): a digest that guards a
 * byte-for-byte download must describe the bytes actually transferred, so neither normalizing variant
 * can stand in for it.
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const HEX40 = /^[0-9a-f]{40}$/;

/** 40 lowercase hex — a git commit sha. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && HEX40.test(value);
}
