import { describe, it, expect } from 'vitest';
import {
  parseGenSourceJson,
  decodeGenSourceReadInventory,
  decodeGenSourceReadResult,
  GEN_SOURCE_ID_RE,
  GEN_SOURCE_LIMITATIONS,
} from './figmentGenSourceRead.ts';

const ID_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ID_B = '00000000-0000-0000-0000-000000000002';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ERR = 'invalid source JSON';

function entry(id: string, plan: string) {
  return { id, planSha256: plan };
}
function inventory(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'figment/studio-gen-source-reads@1',
    configured: true,
    availability: 'available',
    entries: [entry(ID_A, SHA_A)],
    ...overrides,
  };
}
function digests(overrides: Record<string, unknown> = {}) {
  return {
    personaSha256: SHA_A,
    approvalSha256: SHA_A,
    approvalLineageSha256: SHA_A,
    sourcePlanSha256: SHA_A,
    checkpointSha256: SHA_A,
    genManifestSha256: [SHA_A],
    ...overrides,
  };
}
function claims(overrides: Record<string, unknown> = {}) {
  return { launchReady: false, qualityApproved: false, atomicSnapshot: false, ...overrides };
}
function result(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'figment/studio-gen-source-read@1',
    id: ID_A,
    planSha256: SHA_A,
    outcome: 'source-checked',
    checkedAtUtc: '2024-01-01T00:00:00.000Z',
    digests: digests(),
    claims: claims(),
    limitations: [...GEN_SOURCE_LIMITATIONS],
    ...overrides,
  };
}

describe('GEN_SOURCE_ID_RE', () => {
  it('accepts 36-char hex/dash strings', () => {
    expect(GEN_SOURCE_ID_RE.test(ID_A)).toBe(true);
  });
  it('rejects wrong length or characters', () => {
    expect(GEN_SOURCE_ID_RE.test('x')).toBe(false);
    expect(GEN_SOURCE_ID_RE.test(ID_A.toUpperCase())).toBe(false);
    expect(GEN_SOURCE_ID_RE.test(ID_A.slice(0, 35))).toBe(false);
  });
});

describe('parseGenSourceJson: valid shapes', () => {
  it('parses nested objects/arrays/numbers', () => {
    expect(parseGenSourceJson('{"a":[1,2.5,-3,{"b":[true,false,null]}]}')).toEqual({
      a: [1, 2.5, -3, { b: [true, false, null] }],
    });
  });
  it('parses escaped quote and backslash', () => {
    expect(parseGenSourceJson('{"a":"a\\"b\\\\c"}')).toEqual({ a: 'a"b\\c' });
  });
  it('parses a valid unicode surrogate pair', () => {
    expect(parseGenSourceJson('{"a":"\\ud83d\\ude00"}')).toEqual({ a: '😀' });
  });
});

describe('parseGenSourceJson: duplicate keys', () => {
  it('rejects raw duplicate keys', () => {
    expect(() => parseGenSourceJson('{"a":1,"a":2}')).toThrow(ERR);
  });
  it('rejects escaped-equivalent duplicate keys', () => {
    expect(() => parseGenSourceJson('{"a":1,"\\u0061":2}')).toThrow(ERR);
  });
  it('rejects nested escaped-equivalent duplicate keys', () => {
    expect(() => parseGenSourceJson('{"x":{"a":1,"\\u0061":2}}')).toThrow(ERR);
  });
});

describe('parseGenSourceJson: forbidden keys', () => {
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    it(`rejects key ${k}`, () => {
      expect(() => parseGenSourceJson(`{"${k}":1}`)).toThrow(ERR);
    });
  }
});

describe('parseGenSourceJson: unpaired surrogates', () => {
  it('rejects unpaired high surrogate value', () => {
    expect(() => parseGenSourceJson('{"a":"\\ud800"}')).toThrow(ERR);
  });
  it('rejects unpaired low surrogate value', () => {
    expect(() => parseGenSourceJson('{"a":"\\udc00"}')).toThrow(ERR);
  });
  it('rejects unpaired surrogate in key', () => {
    expect(() => parseGenSourceJson('{"\\ud800":"x"}')).toThrow(ERR);
  });
});

describe('parseGenSourceJson: depth limits', () => {
  it('accepts depth 16', () => {
    const text = '{"a":'.repeat(16) + '1' + '}'.repeat(16);
    expect(() => parseGenSourceJson(text)).not.toThrow();
  });
  it('rejects depth 17', () => {
    const text = '{"a":'.repeat(17) + '1' + '}'.repeat(17);
    expect(() => parseGenSourceJson(text)).toThrow(ERR);
  });
});

describe('parseGenSourceJson: value count limits', () => {
  it('accepts exactly 4096 values (array + 4095 elements)', () => {
    const text = '[' + Array(4095).fill('1').join(',') + ']';
    expect(() => parseGenSourceJson(text)).not.toThrow();
  });
  it('rejects 4097 values (array + 4096 elements)', () => {
    const text = '[' + Array(4096).fill('1').join(',') + ']';
    expect(() => parseGenSourceJson(text)).toThrow(ERR);
  });
});

describe('parseGenSourceJson: size and maxChars', () => {
  it('accepts text at maxChars boundary', () => {
    const pad = '1'.repeat(10);
    expect(() => parseGenSourceJson(pad, 10)).not.toThrow();
  });
  it('rejects text exceeding maxChars', () => {
    const pad = '1'.repeat(11);
    expect(() => parseGenSourceJson(pad, 10)).toThrow(ERR);
  });
  it('rejects invalid maxChars values', () => {
    expect(() => parseGenSourceJson('1', 0)).toThrow(ERR);
    expect(() => parseGenSourceJson('1', -1)).toThrow(ERR);
    expect(() => parseGenSourceJson('1', 1.5)).toThrow(ERR);
    expect(() => parseGenSourceJson('1', 65537)).toThrow(ERR);
  });
  it('rejects empty text', () => {
    expect(() => parseGenSourceJson('')).toThrow(ERR);
  });
});

describe('parseGenSourceJson: whitespace', () => {
  it('accepts standard whitespace between tokens', () => {
    expect(parseGenSourceJson(' \t\r\n{ \t\r\n"a" \t\r\n: \t\r\n1 \t\r\n} \t\r\n')).toEqual({ a: 1 });
  });
  it('rejects non-standard whitespace like form-feed', () => {
    expect(() => parseGenSourceJson('{"a":\f1}')).toThrow(ERR);
  });
  it('rejects non-breaking space', () => {
    expect(() => parseGenSourceJson('{"a":\u00A01}')).toThrow(ERR);
  });
});

describe('parseGenSourceJson: malformed grammar', () => {
  it('rejects trailing comma in object', () => {
    expect(() => parseGenSourceJson('{"a":1,}')).toThrow(ERR);
  });
  it('rejects trailing comma in array', () => {
    expect(() => parseGenSourceJson('[1,2,]')).toThrow(ERR);
  });
  it('rejects leading zero prefix number', () => {
    expect(() => parseGenSourceJson('01')).toThrow(ERR);
  });
  it('rejects leading plus sign', () => {
    expect(() => parseGenSourceJson('+1')).toThrow(ERR);
  });
  it('rejects numeric overflow to non-finite', () => {
    expect(() => parseGenSourceJson('1e400')).toThrow(ERR);
  });
  it('rejects extra trailing content', () => {
    expect(() => parseGenSourceJson('{}x')).toThrow(ERR);
  });
  it('rejects incomplete literal', () => {
    expect(() => parseGenSourceJson('tru')).toThrow(ERR);
  });
  it('rejects unescaped control char in string', () => {
    expect(() => parseGenSourceJson('{"a":"b\nc"}')).toThrow(ERR);
  });
  it('non-string input throws fixed message', () => {
    // @ts-expect-error intentional wrong type
    expect(() => parseGenSourceJson(123)).toThrow(ERR);
  });
});

describe('parseGenSourceJson: roundtrip against JSON.parse', () => {
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(42);
  const SAFE_KEYS = ['a', 'b', 'c', 'x', 'y', 'z', 'foo', 'bar'];

  function genValue(depth: number): unknown {
    const r = rnd();
    if (depth <= 0) {
      return genScalar();
    }
    if (r < 0.2) return genScalar();
    if (r < 0.6) {
      const len = Math.floor(rnd() * 3);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(genValue(depth - 1));
      return arr;
    }
    const len = Math.floor(rnd() * 3);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const key = SAFE_KEYS[Math.floor(rnd() * SAFE_KEYS.length)];
      obj[key] = genValue(depth - 1);
    }
    return obj;
  }
  function genScalar(): unknown {
    const r = rnd();
    if (r < 0.25) return Math.floor(rnd() * 1000) - 500;
    if (r < 0.5) return Math.round(rnd() * 10000) / 100;
    if (r < 0.65) return true;
    if (r < 0.8) return false;
    if (r < 0.9) return null;
    return 'str' + Math.floor(rnd() * 100);
  }

  for (let i = 0; i < 20; i++) {
    it(`roundtrip case ${i}`, () => {
      const value = genValue(4);
      const text = JSON.stringify(value);
      expect(parseGenSourceJson(text)).toEqual(JSON.parse(text));
    });
  }
});

describe('decodeGenSourceReadInventory: valid', () => {
  it('accepts configured with 1 unique entry', () => {
    expect(decodeGenSourceReadInventory(inventory())).toEqual(inventory());
  });
  it('accepts configured with 2 unique entries', () => {
    const inv = inventory({ entries: [entry(ID_A, SHA_A), entry(ID_B, SHA_B)] });
    expect(decodeGenSourceReadInventory(inv)).toEqual(inv);
  });
  it('accepts unconfigured with empty entries', () => {
    const inv = inventory({ configured: false, availability: 'not-configured', entries: [] });
    expect(decodeGenSourceReadInventory(inv)).toEqual(inv);
  });
});

describe('decodeGenSourceReadInventory: rejects', () => {
  it('rejects inconsistent availability for configured=false', () => {
    expect(decodeGenSourceReadInventory(inventory({ configured: false, entries: [] }))).toBeNull();
  });
  it('rejects inconsistent availability for configured=true', () => {
    expect(
      decodeGenSourceReadInventory(inventory({ availability: 'not-configured' })),
    ).toBeNull();
  });
  it('rejects unknown keys', () => {
    expect(decodeGenSourceReadInventory({ ...inventory(), extra: 1 })).toBeNull();
  });
  it('rejects wrong types', () => {
    expect(decodeGenSourceReadInventory(inventory({ configured: 'true' }))).toBeNull();
    expect(decodeGenSourceReadInventory(inventory({ availability: 1 }))).toBeNull();
  });
  it('rejects non-plain-object prototype pollution', () => {
    const evil = Object.assign(Object.create({ evil: 1 }), inventory());
    expect(decodeGenSourceReadInventory(evil)).toBeNull();
  });
  it('rejects symbol keys present', () => {
    const withSym = { ...inventory(), [Symbol('x')]: 1 };
    expect(decodeGenSourceReadInventory(withSym)).toBeNull();
  });
  it('rejects non-enumerable properties', () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, 'schema', { value: 'figment/studio-gen-source-reads@1', enumerable: false });
    Object.defineProperty(obj, 'configured', { value: true, enumerable: true });
    Object.defineProperty(obj, 'availability', { value: 'available', enumerable: true });
    Object.defineProperty(obj, 'entries', { value: [entry(ID_A, SHA_A)], enumerable: true });
    expect(decodeGenSourceReadInventory(obj)).toBeNull();
  });
  it('rejects accessor properties without invoking getter', () => {
    let invoked = false;
    const obj: Record<string, unknown> = {
      configured: true,
      availability: 'available',
      entries: [entry(ID_A, SHA_A)],
    };
    Object.defineProperty(obj, 'schema', {
      enumerable: true,
      get() {
        invoked = true;
        return 'figment/studio-gen-source-reads@1';
      },
    });
    expect(decodeGenSourceReadInventory(obj)).toBeNull();
    expect(invoked).toBe(false);
  });
  it('rejects holey arrays without invoking magic', () => {
    const holey = [entry(ID_A, SHA_A), entry(ID_B, SHA_B)];
    delete (holey as unknown[])[1];
    expect(decodeGenSourceReadInventory(inventory({ entries: holey }))).toBeNull();
  });
  it('rejects duplicate entry ids', () => {
    const inv = inventory({ entries: [entry(ID_A, SHA_A), entry(ID_A, SHA_B)] });
    expect(decodeGenSourceReadInventory(inv)).toBeNull();
  });
  it('rejects zero entries when configured', () => {
    expect(decodeGenSourceReadInventory(inventory({ entries: [] }))).toBeNull();
  });
  it('rejects more than max entries', () => {
    const inv = inventory({
      entries: [entry(ID_A, SHA_A), entry(ID_B, SHA_B), entry('00000000-0000-0000-0000-000000000003', SHA_A)],
    });
    expect(decodeGenSourceReadInventory(inv)).toBeNull();
  });
});

describe('decodeGenSourceReadResult: valid', () => {
  it('accepts matching id/sha and returns exact projection', () => {
    const r = result();
    const decoded = decodeGenSourceReadResult(r, ID_A, SHA_A);
    expect(decoded).toEqual(r);
  });
  it('accepts timestamp without fractional seconds', () => {
    const r = result({ checkedAtUtc: '2024-01-01T00:00:00Z' });
    expect(decodeGenSourceReadResult(r, ID_A, SHA_A)).not.toBeNull();
  });
  it('mutating input after decode does not mutate returned projection', () => {
    const r: any = result();
    const decoded = decodeGenSourceReadResult(r, ID_A, SHA_A);
    r.digests.personaSha256 = SHA_B;
    r.limitations[0] = 'mutated';
    r.claims.launchReady = true;
    expect(decoded!.digests.personaSha256).toBe(SHA_A);
    expect(decoded!.limitations[0]).toBe(GEN_SOURCE_LIMITATIONS[0]);
    expect(decoded!.claims.launchReady).toBe(false);
  });
});

describe('decodeGenSourceReadResult: rejects', () => {
  it('rejects mismatched id or sha', () => {
    expect(decodeGenSourceReadResult(result(), ID_B, SHA_A)).toBeNull();
    expect(decodeGenSourceReadResult(result(), ID_A, SHA_B)).toBeNull();
  });
  it('rejects malformed expectedId/expectedSha inputs', () => {
    expect(decodeGenSourceReadResult(result(), 'bad', SHA_A)).toBeNull();
    expect(decodeGenSourceReadResult(result(), ID_A, 'bad')).toBeNull();
  });
  it('rejects malformed date (no Z)', () => {
    expect(decodeGenSourceReadResult(result({ checkedAtUtc: '2024-01-01T00:00:00' }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects malformed timezone offset instead of Z', () => {
    expect(
      decodeGenSourceReadResult(result({ checkedAtUtc: '2024-01-01T00:00:00+00:00' }), ID_A, SHA_A),
    ).toBeNull();
  });
  it('rejects invalid calendar date', () => {
    expect(decodeGenSourceReadResult(result({ checkedAtUtc: '2024-13-40T00:00:00Z' }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects wrong digest keys', () => {
    const bad = digests();
    delete (bad as any).checkpointSha256;
    (bad as any).unknownKey = SHA_A;
    expect(decodeGenSourceReadResult(result({ digests: bad }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects double-element manifest tuple', () => {
    expect(
      decodeGenSourceReadResult(result({ digests: digests({ genManifestSha256: [SHA_A, SHA_B] }) }), ID_A, SHA_A),
    ).toBeNull();
  });
  it('rejects sparse manifest array', () => {
    const sparse = [SHA_A];
    delete (sparse as unknown[])[0];
    expect(
      decodeGenSourceReadResult(result({ digests: digests({ genManifestSha256: sparse }) }), ID_A, SHA_A),
    ).toBeNull();
  });
  it('rejects a true claim value', () => {
    expect(decodeGenSourceReadResult(result({ claims: claims({ launchReady: true }) }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects scalar limitations instead of array', () => {
    expect(decodeGenSourceReadResult(result({ limitations: 'nope' }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects same-length limitations array with wrong content', () => {
    const wrong = [...GEN_SOURCE_LIMITATIONS];
    wrong[0] = 'different text entirely';
    expect(decodeGenSourceReadResult(result({ limitations: wrong }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects unknown top-level keys', () => {
    expect(decodeGenSourceReadResult({ ...result(), extra: 1 }, ID_A, SHA_A)).toBeNull();
  });
  it('rejects wrong outcome value', () => {
    expect(decodeGenSourceReadResult(result({ outcome: 'other' }), ID_A, SHA_A)).toBeNull();
  });
});

describe('decodeGenSourceReadResult: additional rejects', () => {
  it('rejects scalar manifest digest instead of array', () => {
    expect(
      decodeGenSourceReadResult(result({ digests: digests({ genManifestSha256: SHA_A as unknown }) }), ID_A, SHA_A),
    ).toBeNull();
  });
  it('rejects scalar limitations value', () => {
    expect(decodeGenSourceReadResult(result({ limitations: 'nope-again' }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects sparse limitations array', () => {
    const sparse = [...GEN_SOURCE_LIMITATIONS];
    delete (sparse as unknown[])[0];
    expect(decodeGenSourceReadResult(result({ limitations: sparse }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects array with accessor element without invoking getter (entries)', () => {
    let invoked = false;
    const arr: unknown[] = [entry(ID_A, SHA_A)];
    Object.defineProperty(arr, '0', {
      enumerable: true,
      get() {
        invoked = true;
        return entry(ID_A, SHA_A);
      },
    });
    expect(decodeGenSourceReadInventory(inventory({ entries: arr }))).toBeNull();
    expect(invoked).toBe(false);
  });
  it('rejects array with accessor element without invoking getter (manifest)', () => {
    let invoked = false;
    const arr: unknown[] = [SHA_A];
    Object.defineProperty(arr, '0', {
      enumerable: true,
      get() {
        invoked = true;
        return SHA_A;
      },
    });
    expect(
      decodeGenSourceReadResult(result({ digests: digests({ genManifestSha256: arr }) }), ID_A, SHA_A),
    ).toBeNull();
    expect(invoked).toBe(false);
  });
  it('rejects array with accessor element without invoking getter (limitations)', () => {
    let invoked = false;
    const arr: unknown[] = [...GEN_SOURCE_LIMITATIONS];
    Object.defineProperty(arr, '0', {
      enumerable: true,
      get() {
        invoked = true;
        return GEN_SOURCE_LIMITATIONS[0];
      },
    });
    expect(decodeGenSourceReadResult(result({ limitations: arr }), ID_A, SHA_A)).toBeNull();
    expect(invoked).toBe(false);
  });
  it('rejects arrays with symbol keys (entries)', () => {
    const arr: unknown[] = [entry(ID_A, SHA_A)];
    (arr as any)[Symbol('x')] = 1;
    expect(decodeGenSourceReadInventory(inventory({ entries: arr }))).toBeNull();
  });
  it('rejects arrays with extra own string properties (entries)', () => {
    const arr: unknown[] = [entry(ID_A, SHA_A)];
    (arr as any).extra = 1;
    expect(decodeGenSourceReadInventory(inventory({ entries: arr }))).toBeNull();
  });
  it('rejects missing expected arguments', () => {
    // @ts-expect-error intentional missing arguments
    expect(decodeGenSourceReadResult(result())).toBeNull();
  });
  it('rejects each claim true individually', () => {
    expect(decodeGenSourceReadResult(result({ claims: claims({ launchReady: true }) }), ID_A, SHA_A)).toBeNull();
    expect(decodeGenSourceReadResult(result({ claims: claims({ qualityApproved: true }) }), ID_A, SHA_A)).toBeNull();
    expect(decodeGenSourceReadResult(result({ claims: claims({ atomicSnapshot: true }) }), ID_A, SHA_A)).toBeNull();
  });
  it('rejects uppercase sha256 digest', () => {
    expect(decodeGenSourceReadResult(result({ planSha256: SHA_A.toUpperCase() }), ID_A, SHA_A)).toBeNull();
  });
  it('mutating input entries array after decode does not mutate returned inventory', () => {
    const entriesArr = [entry(ID_A, SHA_A)];
    const inv = inventory({ entries: entriesArr });
    const decoded = decodeGenSourceReadInventory(inv);
    entriesArr[0] = entry(ID_B, SHA_B);
    expect(decoded!.entries[0].id).toBe(ID_A);
  });
  it('mutating input genManifestSha256 array after decode does not mutate returned result', () => {
    const manifestArr = [SHA_A];
    const r = result({ digests: digests({ genManifestSha256: manifestArr }) });
    const decoded = decodeGenSourceReadResult(r, ID_A, SHA_A);
    manifestArr[0] = SHA_B;
    expect(decoded!.digests.genManifestSha256[0]).toBe(SHA_A);
  });
});

describe('parseGenSourceJson: additional malformed grammar', () => {
  it('rejects missing comma between object entries', () => {
    expect(() => parseGenSourceJson('{"a":1 "b":2}')).toThrow(ERR);
  });
  it('rejects missing colon after key', () => {
    expect(() => parseGenSourceJson('{"a" 1}')).toThrow(ERR);
  });
  it('rejects incomplete escape sequence', () => {
    expect(() => parseGenSourceJson('{"a":"\\u12"}')).toThrow(ERR);
  });
  it('rejects incomplete decimal number', () => {
    expect(() => parseGenSourceJson('{"a":1.}')).toThrow(ERR);
  });
  it('rejects incomplete exponent number', () => {
    expect(() => parseGenSourceJson('{"a":1e}')).toThrow(ERR);
  });
  it('rejects unpaired low surrogate in key', () => {
    expect(() => parseGenSourceJson('{"\\udc00":"x"}')).toThrow(ERR);
  });
});
