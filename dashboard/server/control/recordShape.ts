/**
 * Control-plane record-shape validators that were byte-identical in `assetPullState.ts` and
 * `deploymentState.ts`. Consolidated here (one source) and imported by both. Bodies are verbatim
 * copies of the former per-module definitions — behavior-identical. Note: `isPlainRecord` here
 * carries the `!Array.isArray(value)` guard the record walls were written against, which is a
 * DIFFERENT truth table from the prototype-only `isPlainRecord` in `controlHashing.ts`; the two are
 * deliberately kept apart.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

export function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

export function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
