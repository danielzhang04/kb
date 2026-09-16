/**
 * Canonical card-content hashing — the "what exactly is being approved" binding for a T2/T3 card.
 * A consumer (e.g. the Broker's D3.3 steer re-approval check, `broker/verbs.ts`) recomputes
 * `contentHash(canonicalCardPayload(card, body))` to prove that a proposed edit to a card's
 * consequential fields, or its `## Work order` body, changes the hash — so a stale approval can never
 * be stretched to cover a mutated card.
 *
 * SECURITY INVARIANT (governance/card-schema.md "Hash-binding note" — binding, do not "harmonize"):
 * `contentHash` MUST cover the FULL canonical card payload — `action`, `target`, `risk-tier`,
 * `owner`, AND the `## Work order` body — so none of those can be mutated after an approval is
 * collected without invalidating it (this closes the tier-laundering / target-swap / owner-swap AND
 * the work-order-body-tamper hole). The fleet's `approvals.payload_hash` deliberately binds a
 * different, narrower set (`action` + `target` + work-order prose only, no `risk-tier`/`owner`) —
 * the two channels canonicalize differently ON PURPOSE; never assume the fleet hash covers risk-tier
 * and never assume it lays the fields out the same way this preimage does.
 *
 * ---- Canonical preimage spec ----
 *
 * `canonicalCardPayload(card, body)`:
 *   - Exactly FIVE lines, in this FIXED order. The first four are consequential frontmatter fields,
 *     read by name off the card's frontmatter (never by iterating the object's own key order, and
 *     never from raw YAML text) so frontmatter key order / surrounding whitespace can never change
 *     the hash:
 *       1. action
 *       2. target
 *       3. risk-tier
 *       4. owner
 *       5. work-order   <- the `## Work order` section BODY, extracted fence-awarely (see below)
 *   - Each value is encoded with `JSON.stringify` (a bare string is quoted, `null` stays `null`, an
 *     array serializes as a JSON array) — this makes the encoding injective across types, mirroring
 *     the fleet's `approval_payload` rationale: a scalar and a list must never collide. The fifth
 *     value is always a STRING (the extracted body), so it too is JSON-quoted; embedded newlines are
 *     `\n`-escaped by JSON, so the body can never inject an extra field line or shift a boundary.
 *   - The work-order body is extracted with `workOrderOf(body)` — a byte-for-byte mirror of the
 *     fleet's `scripts/approvals.work_order_of` (see that function): the FIRST top-level
 *     `## Work order` section, fence-aware (a column-0 ``` toggles a fenced block; lines inside a
 *     fence are never treated as headings, so a fake `## heading` inside a ``` block does NOT end the
 *     section), captured up to the next column-0 unfenced `## ` heading (or EOF), then `.trim()`med.
 *   - Line format: `"<field-name>:<json-encoded-value>"`, one field per line, fields joined with a
 *     single `"\n"` (LF, no trailing newline).
 *
 * `contentHash(payload)`:
 *   - SHA-256 over the UTF-8 bytes of `payload`, rendered as lowercase hex.
 */
import { sha256Hex } from '../shared/hashing.ts';
// `workOrderOf` lives in its own pure module (no node builtins) so the browser Approvals corroboration
// panel can import it WITHOUT pulling this file's `node:crypto` into the client bundle. Re-exported
// below so server-side callers of `workOrderOf` from `cardHash.ts` keep working unchanged.
import { workOrderOf } from './workOrder.ts';
import type { CardMeta } from '../planeA/cards.ts';

export { workOrderOf } from './workOrder.ts';

/** The exact, fixed field order bound into the hash. See the module doc for why this is frozen. */
const CANONICAL_FIELDS = ['action', 'target', 'risk-tier', 'owner'] as const;

type CanonicalCard = Pick<CardMeta, (typeof CANONICAL_FIELDS)[number]>;

function encodeField(value: unknown): string {
  // `undefined` (field absent) and `null` (field explicitly null) must encode identically — both
  // mean "no value" — otherwise an absent-vs-null distinction with no card-schema meaning would leak
  // into the hash.
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Build the canonical, order-stable preimage of a card's consequential fields PLUS its `## Work
 * order` body (see module doc for the frozen five-line list/order/encoding). Takes named fields only
 * — never raw frontmatter text — so key order and whitespace in the source card never affect the
 * result; the fifth line is the fence-awarely-extracted, JSON-quoted work-order body.
 */
export function canonicalCardPayload(card: CanonicalCard, body: string): string {
  const fieldLines = CANONICAL_FIELDS.map((field) => `${field}:${encodeField(card[field])}`);
  fieldLines.push(`work-order:${JSON.stringify(workOrderOf(body))}`);
  return fieldLines.join('\n');
}

/** SHA-256 of the UTF-8 bytes of `payload`, as lowercase hex. */
export function contentHash(payload: string): string {
  return sha256Hex(payload);
}
