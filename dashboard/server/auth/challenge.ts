/**
 * Challenge construction — the WebAuthn "what am I actually signing" binding for T3 dashboard
 * approvals (D2.2). D2.3's dispatcher-side verifier recomputes `contentHash` and rebuilds/parses the
 * challenge byte-for-byte, so every encoding choice below is FROZEN — do not change it without
 * updating D2.3 in lockstep.
 *
 * SECURITY INVARIANT (governance/card-schema.md "Hash-binding note" — binding, do not "harmonize"):
 * `contentHash` MUST cover the FULL canonical card payload — `action`, `target`, `risk-tier`, AND
 * `owner` — so none of those fields can be mutated after a signature is collected without
 * invalidating it (this is what closes the tier-laundering / target-swap / owner-swap hole on the
 * WebAuthn channel). The fleet's `approvals.payload_hash` deliberately binds a narrower set
 * (`action` + `target` + work-order prose only, no `risk-tier`/`owner`) — the two channels
 * canonicalize differently ON PURPOSE; never assume the fleet hash covers risk-tier.
 *
 * ---- Canonical preimage spec (for D2.3's Python verifier to reproduce byte-identically) ----
 *
 * `canonicalCardPayload(card)`:
 *   - Exactly four fields, in this FIXED order, read by name off the card's frontmatter (never by
 *     iterating the object's own key order, and never from raw YAML text) so frontmatter key order /
 *     surrounding whitespace can never change the hash:
 *       1. action
 *       2. target
 *       3. risk-tier
 *       4. owner
 *   - Each value is encoded with `JSON.stringify` (a bare string is quoted, `null` stays `null`, an
 *     array serializes as a JSON array) — this makes the encoding injective across types, mirroring
 *     the fleet's `approval_payload` rationale: a scalar and a list must never collide.
 *   - Line format: `"<field-name>:<json-encoded-value>"`, one field per line, fields joined with a
 *     single `"\n"` (LF, no trailing newline). Python equivalent:
 *       "\n".join(f"{field}:{json.dumps(card[field], separators=(',', ':'))}" for field in
 *                 ["action", "target", "risk-tier", "owner"])
 *     (Node's default `JSON.stringify` already omits whitespace around separators, matching Python's
 *     `separators=(",", ":")`.)
 *
 * `contentHash(payload)`:
 *   - SHA-256 over the UTF-8 bytes of `payload`, rendered as lowercase hex (`hexdigest()` in Python).
 *
 * `buildChallenge(cardId, action, contentHash, nonce)`:
 *   - Preimage = `JSON.stringify([cardId, action, contentHash, nonce])` — a 4-element JSON array,
 *     UTF-8 encoded. JSON (not a raw delimiter join) is deliberate: `cardId`/`action` come from the
 *     dispatcher/Manager and are not guaranteed delimiter-free, so a naive `‖`-join could let one
 *     field's content shift a fixed-position boundary; JSON's own escaping makes the 4-tuple
 *     unambiguously reversible regardless of content.
 *   - Wire form = base64url (RFC 4648 §5, NO padding) of those UTF-8 bytes — Node's
 *     `Buffer.toString('base64url')` already omits `=` padding, matching the WebAuthn `challenge`
 *     field convention. Python equivalent: `base64.urlsafe_b64encode(json.dumps([...],
 *     separators=(',', ':')).encode()).rstrip(b'=')`.
 *
 * `parseChallenge(challenge)`:
 *   - Inverse of the above: base64url-decode, UTF-8 decode, `JSON.parse` into the 4-tuple. Rejects
 *     (throws) anything that doesn't decode to exactly a 4-element string array — fail closed on a
 *     malformed challenge rather than silently accepting a partial one.
 */
import { createHash } from 'node:crypto';
import type { CardMeta } from '../planeA/cards';

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
 * Build the canonical, order-stable preimage of a card's consequential fields (see module doc for
 * the frozen field list/order/encoding). Takes named fields only — never raw frontmatter text — so
 * key order and whitespace in the source card never affect the result.
 */
export function canonicalCardPayload(card: CanonicalCard): string {
  return CANONICAL_FIELDS.map((field) => `${field}:${encodeField(card[field])}`).join('\n');
}

/** SHA-256 of the UTF-8 bytes of `payload`, as lowercase hex. */
export function contentHash(payload: string): string {
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

export interface ChallengeParts {
  cardId: string;
  action: string;
  contentHash: string;
  nonce: string;
}

/**
 * `challenge = base64url(card_id ‖ action ‖ content_hash ‖ nonce)` — see module doc for the exact
 * JSON-array preimage encoding (chosen over a raw delimiter join so no field's content can shift a
 * fixed-position boundary).
 */
export function buildChallenge(cardId: string, action: string, hash: string, nonce: string): string {
  const preimage = JSON.stringify([cardId, action, hash, nonce]);
  return Buffer.from(preimage, 'utf-8').toString('base64url');
}

/** Inverse of {@link buildChallenge}. Fail closed: throws on anything that isn't a valid 4-tuple. */
export function parseChallenge(challenge: string): ChallengeParts {
  let decoded: string;
  try {
    decoded = Buffer.from(challenge, 'base64url').toString('utf-8');
  } catch {
    throw new Error('malformed challenge: not valid base64url');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('malformed challenge: preimage is not valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length !== 4 || !parsed.every((p) => typeof p === 'string')) {
    throw new Error('malformed challenge: expected a 4-element string array [cardId, action, contentHash, nonce]');
  }

  const [cardId, action, hash, nonce] = parsed as [string, string, string, string];
  return { cardId, action, contentHash: hash, nonce };
}
