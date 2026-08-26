/**
 * The shared-primitives home. Small pure utilities that were reinvented per-module now have one
 * canonical source here; modules import from `../shared/...` (or this barrel). Nothing in `shared/`
 * imports back out of it — it is a leaf.
 */
export { ContractDecodeError } from './contractDecodeError.ts';
export { sha256Hex, isCommitSha, isDigestSha256 } from './hashing.ts';
export { record, isPlainRecord, exactKeys, isoUtc, headerFirstValue } from './decode.ts';
