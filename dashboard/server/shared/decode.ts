/**
 * Canonical pure decode primitives, reinvented per-module before the shared home existed. Each matches
 * the dominant behavior of its scattered copies exactly:
 *   - `record`      — non-null non-array object → the record, else null. Does NOT check the prototype,
 *                     so class instances pass (matches the `record`/`asRecord` guard form).
 *   - `isPlainRecord` — the STRICTER predicate: additionally requires the prototype to be exactly
 *                     `Object.prototype`, rejecting class instances. A different truth table from
 *                     `record`; keep them distinct.
 *   - `exactKeys`   — own keys are exactly `keys` (rejects any extra or missing key).
 *   - `isoUtc`      — a canonical UTC ISO-8601 string that round-trips through `Date`.
 *   - `headerFirstValue` — the first value of a possibly-multi Node header field.
 */

/** Non-null, non-array object → the record, else null. Class instances pass (no prototype check). */
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Plain-object predicate: non-null object whose prototype is exactly `Object.prototype`. Stricter than
 *  {@link record} — it rejects arrays AND class instances. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** True iff `value`'s own keys are exactly the set `keys` — no extra key, no missing key. `keys` is
 *  expected to be a unique literal list (the scattered sort/Set/hasOwn copies all share this truth table). */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** True iff `value` is a canonical UTC ISO-8601 string (parses AND round-trips through `Date.toISOString`). */
export function isoUtc(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

/** The first value of a Node header field that may arrive as a string, an array, or undefined. */
export function headerFirstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
