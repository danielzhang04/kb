// Canonical pure decode guards for the CLIENT bundle. The server has its own copy under
// `server/shared/decode.ts`; the two bundles are separate, so each keeps its own source. These match
// the dominant behavior of the per-`*Client.ts` reimpls exactly.

/** Non-null, non-array object → the record, else null. Does NOT check the prototype. */
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** True iff `value`'s own keys are exactly the set `keys` — no extra key, no missing key. */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
