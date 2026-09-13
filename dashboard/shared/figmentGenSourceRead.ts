export type GenSourceReadAvailability = 'available' | 'busy' | 'quarantined' | 'not-configured';

export interface GenSourceReadEntry {
  readonly id: string;
  readonly planSha256: string;
}

export interface GenSourceReadInventory {
  readonly schema: 'figment/studio-gen-source-reads@1';
  readonly configured: boolean;
  readonly availability: GenSourceReadAvailability;
  readonly entries: readonly GenSourceReadEntry[];
}

export interface GenSourceReadDigests {
  readonly personaSha256: string;
  readonly approvalSha256: string;
  readonly approvalLineageSha256: string;
  readonly sourcePlanSha256: string;
  readonly checkpointSha256: string;
  readonly genManifestSha256: readonly [string];
}

export interface GenSourceReadClaims {
  readonly launchReady: false;
  readonly qualityApproved: false;
  readonly atomicSnapshot: false;
}

export interface GenSourceReadResult {
  readonly schema: 'figment/studio-gen-source-read@1';
  readonly id: string;
  readonly planSha256: string;
  readonly outcome: 'source-checked';
  readonly checkedAtUtc: string;
  readonly digests: GenSourceReadDigests;
  readonly claims: GenSourceReadClaims;
  readonly limitations: readonly [string, string, string, string];
}

export const GEN_SOURCE_ID_RE = /^[0-9a-f-]{36}$/;

export const GEN_SOURCE_LIMITATIONS: readonly [string, string, string, string] = Object.freeze([
  'This is a past observation only, and it is not an atomic snapshot.',
  'Code, runtime and ancestor integrity are trusted cooperative preconditions.',
  'This result grants no launch, quality, or approval authority.',
  'This is separate from and does not modify any recorded assignments.',
]);

const AVAILABILITIES: ReadonlySet<string> = new Set(['available', 'busy', 'quarantined', 'not-configured']);
const MAX_ENTRIES = 2;

const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return true;
};

const ownEnumerableStringKeys = (value: object): string[] => {
  const keys: string[] = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return [];
    if (!descriptor.enumerable) return [];
    if (!('value' in descriptor)) return [];
    keys.push(key);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return [];
  return keys;
};

const hasExactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = ownEnumerableStringKeys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isAvailability = (value: unknown): value is GenSourceReadAvailability =>
  typeof value === 'string' && AVAILABILITIES.has(value);

const isValidUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === value || new Date(ms).toISOString().replace(/\.000Z$/, 'Z') === value;
};

const readBoundedArray = (value: unknown, maxLength: number): unknown[] | null => {
  if (!Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)) return null;
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > maxLength) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== length + 1) return null;
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    items.push(descriptor.value);
  }
  return items;
};

const sameLimitations = (value: unknown): boolean => {
  const items = readBoundedArray(value, 4);
  if (items === null || items.length !== 4) return false;
  for (let index = 0; index < 4; index++) {
    if (items[index] !== GEN_SOURCE_LIMITATIONS[index]) return false;
  }
  return true;
};

const ENTRY_KEYS = ['id', 'planSha256'];

function decodeEntry(value: unknown): GenSourceReadEntry | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  if (typeof value.id !== 'string' || !GEN_SOURCE_ID_RE.test(value.id)) return null;
  if (!isSha256(value.planSha256)) return null;
  return { id: value.id, planSha256: value.planSha256 };
}

const INVENTORY_KEYS = ['schema', 'configured', 'availability', 'entries'];

export function decodeGenSourceReadInventory(value: unknown): GenSourceReadInventory | null {
  if (!isPlainObject(value) || !hasExactKeys(value, INVENTORY_KEYS)) return null;
  if (value.schema !== 'figment/studio-gen-source-reads@1') return null;
  if (typeof value.configured !== 'boolean') return null;
  if (!isAvailability(value.availability)) return null;
  const rawEntries = readBoundedArray(value.entries, MAX_ENTRIES);
  if (rawEntries === null) return null;

  const entries: GenSourceReadEntry[] = [];
  const seenIds = new Set<string>();
  for (const rawEntry of rawEntries) {
    const entry = decodeEntry(rawEntry);
    if (entry === null) return null;
    if (seenIds.has(entry.id)) return null;
    seenIds.add(entry.id);
    entries.push(entry);
  }

  if (!value.configured) {
    if (value.availability !== 'not-configured') return null;
    if (entries.length !== 0) return null;
  } else {
    if (value.availability === 'not-configured') return null;
    if (entries.length < 1 || entries.length > MAX_ENTRIES) return null;
  }

  return {
    schema: 'figment/studio-gen-source-reads@1',
    configured: value.configured,
    availability: value.availability,
    entries,
  };
}

const DIGESTS_KEYS = [
  'personaSha256',
  'approvalSha256',
  'approvalLineageSha256',
  'sourcePlanSha256',
  'checkpointSha256',
  'genManifestSha256',
];

function decodeDigests(value: unknown): GenSourceReadDigests | null {
  if (!isPlainObject(value) || !hasExactKeys(value, DIGESTS_KEYS)) return null;
  if (
    !isSha256(value.personaSha256) ||
    !isSha256(value.approvalSha256) ||
    !isSha256(value.approvalLineageSha256) ||
    !isSha256(value.sourcePlanSha256) ||
    !isSha256(value.checkpointSha256)
  ) return null;
  const manifestItems = readBoundedArray(value.genManifestSha256, 1);
  if (manifestItems === null || manifestItems.length !== 1) return null;
  const manifestSha = manifestItems[0];
  if (!isSha256(manifestSha)) return null;
  return {
    personaSha256: value.personaSha256,
    approvalSha256: value.approvalSha256,
    approvalLineageSha256: value.approvalLineageSha256,
    sourcePlanSha256: value.sourcePlanSha256,
    checkpointSha256: value.checkpointSha256,
    genManifestSha256: [manifestSha],
  };
}

const CLAIMS_KEYS = ['launchReady', 'qualityApproved', 'atomicSnapshot'];

function decodeClaims(value: unknown): GenSourceReadClaims | null {
  if (!isPlainObject(value) || !hasExactKeys(value, CLAIMS_KEYS)) return null;
  if (value.launchReady !== false || value.qualityApproved !== false || value.atomicSnapshot !== false) return null;
  return { launchReady: false, qualityApproved: false, atomicSnapshot: false };
}

const RESULT_KEYS = ['schema', 'id', 'planSha256', 'outcome', 'checkedAtUtc', 'digests', 'claims', 'limitations'];

export function decodeGenSourceReadResult(
  value: unknown,
  expectedId: string,
  expectedSha: string,
): GenSourceReadResult | null {
  if (typeof expectedId !== 'string' || !GEN_SOURCE_ID_RE.test(expectedId)) return null;
  if (!isSha256(expectedSha)) return null;
  if (!isPlainObject(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  if (value.schema !== 'figment/studio-gen-source-read@1') return null;
  if (typeof value.id !== 'string' || !GEN_SOURCE_ID_RE.test(value.id)) return null;
  if (value.id !== expectedId) return null;
  if (!isSha256(value.planSha256)) return null;
  if (value.planSha256 !== expectedSha) return null;
  if (value.outcome !== 'source-checked') return null;
  if (!isValidUtcTimestamp(value.checkedAtUtc)) return null;
  const digests = decodeDigests(value.digests);
  if (digests === null) return null;
  const claims = decodeClaims(value.claims);
  if (claims === null) return null;
  if (!sameLimitations(value.limitations)) return null;

  return {
    schema: 'figment/studio-gen-source-read@1',
    id: value.id,
    planSha256: value.planSha256,
    outcome: 'source-checked',
    checkedAtUtc: value.checkedAtUtc,
    digests,
    claims,
    limitations: [...GEN_SOURCE_LIMITATIONS] as [string, string, string, string],
  };
}

const MAX_DEPTH = 16;
const MAX_TOKENS = 4096;

function hasUnpairedSurrogates(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface JsonCursor {
  readonly text: string;
  pos: number;
  values: number;
}

function failJson(): never {
  throw new Error('invalid source JSON');
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isJsonDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function skipJsonWhitespace(cursor: JsonCursor): void {
  const text = cursor.text;
  while (cursor.pos < text.length && isJsonWhitespace(text.charCodeAt(cursor.pos))) cursor.pos++;
}

function scanJsonString(cursor: JsonCursor): string {
  const text = cursor.text;
  const start = cursor.pos;
  if (text.charCodeAt(start) !== 0x22) failJson();
  let i = start + 1;
  for (;;) {
    if (i >= text.length) failJson();
    const code = text.charCodeAt(i);
    if (code === 0x22) break;
    if (code < 0x20) failJson();
    if (code === 0x5c) {
      const esc = text.charCodeAt(i + 1);
      if (esc === 0x75) {
        for (let k = 2; k < 6; k++) {
          const h = text.charCodeAt(i + k);
          const isHex = isJsonDigit(h) || (h >= 0x61 && h <= 0x66) || (h >= 0x41 && h <= 0x46);
          if (!isHex) failJson();
        }
        i += 6;
      } else if (
        esc === 0x22 || esc === 0x5c || esc === 0x2f || esc === 0x62 ||
        esc === 0x66 || esc === 0x6e || esc === 0x72 || esc === 0x74
      ) {
        i += 2;
      } else {
        failJson();
      }
    } else {
      i++;
    }
  }
  cursor.pos = i + 1;
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.slice(start, i + 1));
  } catch {
    failJson();
  }
  if (typeof decoded !== 'string' || hasUnpairedSurrogates(decoded)) failJson();
  return decoded as string;
}

function scanJsonNumber(cursor: JsonCursor): number {
  const text = cursor.text;
  const start = cursor.pos;
  let i = start;
  if (text.charCodeAt(i) === 0x2d) i++;
  const first = text.charCodeAt(i);
  if (first === 0x30) {
    i++;
  } else if (first >= 0x31 && first <= 0x39) {
    while (isJsonDigit(text.charCodeAt(i))) i++;
  } else {
    failJson();
  }
  if (text.charCodeAt(i) === 0x2e) {
    i++;
    if (!isJsonDigit(text.charCodeAt(i))) failJson();
    while (isJsonDigit(text.charCodeAt(i))) i++;
  }
  const expMark = text.charCodeAt(i);
  if (expMark === 0x65 || expMark === 0x45) {
    i++;
    const sign = text.charCodeAt(i);
    if (sign === 0x2b || sign === 0x2d) i++;
    if (!isJsonDigit(text.charCodeAt(i))) failJson();
    while (isJsonDigit(text.charCodeAt(i))) i++;
  }
  const parsed = Number(text.slice(start, i));
  if (!Number.isFinite(parsed)) failJson();
  cursor.pos = i;
  return parsed;
}

function parseJsonObject(cursor: JsonCursor, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) failJson();
  const text = cursor.text;
  cursor.pos++;
  const result = Object.create(null) as Record<string, unknown>;
  const seen = new Set<string>();
  skipJsonWhitespace(cursor);
  if (text.charCodeAt(cursor.pos) === 0x7d) {
    cursor.pos++;
    return result;
  }
  for (;;) {
    skipJsonWhitespace(cursor);
    if (text.charCodeAt(cursor.pos) !== 0x22) failJson();
    const key = scanJsonString(cursor);
    if (FORBIDDEN_KEYS.has(key) || seen.has(key)) failJson();
    seen.add(key);
    skipJsonWhitespace(cursor);
    if (text.charCodeAt(cursor.pos) !== 0x3a) failJson();
    cursor.pos++;
    result[key] = parseJsonValue(cursor, depth);
    skipJsonWhitespace(cursor);
    const separator = text.charCodeAt(cursor.pos);
    if (separator === 0x2c) {
      cursor.pos++;
      continue;
    }
    if (separator === 0x7d) {
      cursor.pos++;
      return result;
    }
    failJson();
  }
}

function parseJsonArray(cursor: JsonCursor, depth: number): unknown[] {
  if (depth > MAX_DEPTH) failJson();
  const text = cursor.text;
  cursor.pos++;
  const items: unknown[] = [];
  skipJsonWhitespace(cursor);
  if (text.charCodeAt(cursor.pos) === 0x5d) {
    cursor.pos++;
    return items;
  }
  for (;;) {
    items.push(parseJsonValue(cursor, depth));
    skipJsonWhitespace(cursor);
    const separator = text.charCodeAt(cursor.pos);
    if (separator === 0x2c) {
      cursor.pos++;
      continue;
    }
    if (separator === 0x5d) {
      cursor.pos++;
      return items;
    }
    failJson();
  }
}

function parseJsonValue(cursor: JsonCursor, depth: number): unknown {
  cursor.values++;
  if (cursor.values > MAX_TOKENS) failJson();
  skipJsonWhitespace(cursor);
  const text = cursor.text;
  const code = text.charCodeAt(cursor.pos);
  if (code === 0x7b) return parseJsonObject(cursor, depth + 1);
  if (code === 0x5b) return parseJsonArray(cursor, depth + 1);
  if (code === 0x22) return scanJsonString(cursor);
  if (code === 0x2d || isJsonDigit(code)) return scanJsonNumber(cursor);
  if (text.startsWith('true', cursor.pos)) {
    cursor.pos += 4;
    return true;
  }
  if (text.startsWith('false', cursor.pos)) {
    cursor.pos += 5;
    return false;
  }
  if (text.startsWith('null', cursor.pos)) {
    cursor.pos += 4;
    return null;
  }
  return failJson();
}

export function parseGenSourceJson(text: string, maxChars = 65536): unknown {
  try {
    if (typeof text !== 'string') failJson();
    if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 65536) failJson();
    if (text.length === 0 || text.length > maxChars) failJson();
    const cursor: JsonCursor = { text, pos: 0, values: 0 };
    const result = parseJsonValue(cursor, 0);
    skipJsonWhitespace(cursor);
    if (cursor.pos !== text.length) failJson();
    return result;
  } catch {
    throw new Error('invalid source JSON');
  }
}
