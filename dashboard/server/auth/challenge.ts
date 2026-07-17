/**
 * Challenge construction — the WebAuthn "what am I actually signing" binding for T3 dashboard
 * approvals (D2.2). D2.3's dispatcher-side verifier recomputes `contentHash` and rebuilds/parses the
 * challenge byte-for-byte, so every encoding choice below is FROZEN — do not change it without
 * updating D2.3 in lockstep.
 *
 * SECURITY INVARIANT (governance/card-schema.md "Hash-binding note" — binding, do not "harmonize"):
 * `contentHash` MUST cover the FULL canonical card payload — `action`, `target`, `risk-tier`,
 * `owner`, AND the `## Work order` body — so none of those can be mutated after a signature is
 * collected without invalidating it (this closes the tier-laundering / target-swap / owner-swap AND
 * the work-order-body-tamper hole on the WebAuthn channel; gate D2.11 decided to bind the body
 * because the executor acts on it). The fleet's `approvals.payload_hash` deliberately binds a
 * different, narrower set (`action` + `target` + work-order prose only, no `risk-tier`/`owner`) —
 * the two channels canonicalize differently ON PURPOSE; never assume the fleet hash covers risk-tier
 * and never assume it lays the fields out the same way this preimage does.
 *
 * ---- Canonical preimage spec (for D2.3's Python verifier to reproduce byte-identically) ----
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
 *     Both dashboard legs (this TS issuer + the Python verifier) therefore agree with the fleet on
 *     exactly what "the body" is.
 *   - Line format: `"<field-name>:<json-encoded-value>"`, one field per line, fields joined with a
 *     single `"\n"` (LF, no trailing newline). Python equivalent:
 *       payload = "\n".join(
 *           f"{field}:{json.dumps(card[field], separators=(',', ':'), ensure_ascii=False)}"
 *           for field in ["action", "target", "risk-tier", "owner"])
 *       payload += "\n" + f"work-order:{json.dumps(work_order_of(body), separators=(',', ':'), ensure_ascii=False)}"
 *     (Node's default `JSON.stringify` already omits whitespace around separators, matching Python's
 *     `separators=(",", ":")`, and emits raw UTF-8 for non-ASCII — matching Python's
 *     `ensure_ascii=False`. Both are REQUIRED for byte-identity; see the Python module's PARITY note.)
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
import type { CardMeta } from '../planeA/cards.ts';

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
 * The exact line boundaries Python's `str.splitlines()` recognizes, so `workOrderOf` splits a card
 * body identically to `scripts/approvals.work_order_of` (which uses `splitlines()`). `\r\n` MUST lead
 * the alternation so a CRLF is consumed as ONE boundary, not two. (Card bodies the verifier sees are
 * already `\n`-normalised by `cards.parse_text`; this fuller set keeps the TS issuer byte-identical
 * even if it is ever handed a raw CRLF / unusual-separator body.)
 */
const PY_LINE_BOUNDARIES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `str.splitlines()` semantics: split on the boundaries above, and — like Python — do NOT emit a
 * trailing empty element when the string ends with a boundary. */
function pySplitlines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split(PY_LINE_BOUNDARIES);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Extract the FIRST top-level `## Work order` section, fence-aware. A byte-for-byte mirror of
 * `scripts/approvals.work_order_of` (the fleet channel's extractor) so both channels agree on what
 * "the body" is: a column-0 ``` toggles fenced state; fenced lines are never headings; only a
 * column-0 unfenced `## ` line is a heading; capture runs from the line after the exact
 * `## Work order` heading to the next such heading (or EOF); later occurrences do not re-arm; the
 * captured lines are joined with `\n` and `.trim()`med. Throws if there is no `## Work order` section
 * (the verifier treats that as a fail-closed rejection).
 */
export function workOrderOf(body: string): string {
  const lines: string[] = [];
  let capture = false;
  let fenced = false;
  let found = false;
  let done = false;
  for (const line of pySplitlines(body)) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      if (capture) lines.push(line);
      continue;
    }
    const isHeading = !fenced && line.startsWith('## ');
    if (isHeading) {
      if (capture) {
        capture = false;
        done = true;
      } else if (!done && line === '## Work order') {
        capture = true;
        found = true;
      }
      continue;
    }
    if (capture) lines.push(line);
  }
  if (!found) throw new Error("no '## Work order' section");
  return lines.join('\n').trim();
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
