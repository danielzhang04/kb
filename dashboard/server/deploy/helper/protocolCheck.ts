// Dashboard v3 P5 W2 — the desktop-helper PROTOCOL CHECK. This is the design 667 / P5-C27 obligation:
// every outbound request AND every inbound receipt is validated against `protocol.schema.json`, P5's own
// line-by-line transcription of movement §3 prose. The helper itself is never rewritten — only its
// messages are validated, both directions [P5-C16, P5-C27].
//
// A version handshake precedes the first Deploy (and the first Pull) of a daemon lifetime: the client
// fetches the helper's advertised protocol version and this module compares it against the schema's
// `$id` version. A mismatch or an unfetchable advertisement FAILS CLOSED at the call site [design:667].
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

/** The schema is loaded from disk once; it is the single source of truth for the wire shapes. */
const schema = JSON.parse(
  readFileSync(new URL('./protocol.schema.json', import.meta.url), 'utf8'),
) as { readonly $id: string };

export const PROTOCOL_SCHEMA_ID = schema.$id;

/** The version segment of the schema `$id` (e.g. `v1`). The helper advertises `<verb>/<version>`. */
export const PROTOCOL_VERSION = ((): string => {
  const match = /\/(v[0-9]+)$/.exec(PROTOCOL_SCHEMA_ID);
  if (!match) throw new Error(`deploy helper schema $id lacks a version segment: ${PROTOCOL_SCHEMA_ID}`);
  return match[1]!;
})();

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

function subschema(pointer: string): ValidateFunction {
  const validate = ajv.getSchema(`${PROTOCOL_SCHEMA_ID}#/$defs/${pointer}`);
  if (!validate) throw new Error(`deploy helper schema is missing $defs/${pointer}`);
  return validate;
}

const validateRequest = subschema('request');
const validateReceipt = subschema('receipt');

/** Raised when a message fails the schema wall — the client maps it to `protocol-invalid` and sends/stores nothing. */
export class ProtocolSchemaError extends Error {
  readonly direction: 'request' | 'receipt';
  constructor(direction: 'request' | 'receipt', detail: string) {
    super(`deploy-helper ${direction} failed protocol.schema.json: ${detail}`);
    this.name = 'ProtocolSchemaError';
    this.direction = direction;
  }
}

/** Raised when the helper's advertised protocol version does not match the schema, or is unfetchable. */
export class ProtocolVersionError extends Error {
  readonly verb: string;
  constructor(verb: string, detail: string) {
    super(`deploy-helper protocol version mismatch for ${verb}: ${detail}`);
    this.name = 'ProtocolVersionError';
    this.verb = verb;
  }
}

/** Validate an OUTBOUND request against the movement:235 verb union before serialization. Throws on any failure. */
export function assertRequestValid(value: unknown): void {
  if (!validateRequest(value)) {
    throw new ProtocolSchemaError('request', ajv.errorsText(validateRequest.errors, { separator: '; ' }));
  }
}

/** Validate an INBOUND receipt against the movement:237 record before decoding. Throws on any failure. */
export function assertReceiptValid(value: unknown): void {
  if (!validateReceipt(value)) {
    throw new ProtocolSchemaError('receipt', ajv.errorsText(validateReceipt.errors, { separator: '; ' }));
  }
}

/** The advertisement string the helper MUST return for a verb, e.g. `deploy/v1`. */
export function expectedAdvertisement(verb: string): string {
  return `${verb}/${PROTOCOL_VERSION}`;
}

/**
 * Compare the helper's advertised protocol version for a verb against the schema. Fails closed: an
 * empty/absent advertisement (the caller passes `null` when the fetch failed) or a mismatched string
 * throws `ProtocolVersionError`, so Deploy is not offered and no request is sent [design:667].
 */
export function assertAdvertised(verb: string, advertised: string | null | undefined): void {
  if (typeof advertised !== 'string' || advertised.length === 0) {
    throw new ProtocolVersionError(verb, 'advertisement missing or unfetchable');
  }
  const expected = expectedAdvertisement(verb);
  if (advertised !== expected) {
    throw new ProtocolVersionError(verb, `expected ${expected}, got ${advertised}`);
  }
}
