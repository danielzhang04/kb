import { describe, it, expect } from 'vitest';
import { parseSidString } from './win32Sid.ts';

/** Build a raw SID byte layout: revision + subauth-count + 6-byte big-endian authority + LE u32 subs. */
function sidBytes(revision: number, authority: number, subs: number[]): Uint8Array {
  const b = new Uint8Array(8 + subs.length * 4);
  b[0] = revision;
  b[1] = subs.length;
  // authority big-endian into bytes 2..7 (BigInt so a >8-bit authority does not wrap the shift)
  let a = BigInt(authority);
  for (let i = 5; i >= 0; i--) {
    b[2 + i] = Number(a & 0xffn);
    a >>= 8n;
  }
  subs.forEach((s, i) => {
    const o = 8 + i * 4;
    b[o] = s & 0xff;
    b[o + 1] = (s >>> 8) & 0xff;
    b[o + 2] = (s >>> 16) & 0xff;
    b[o + 3] = (s >>> 24) & 0xff;
  });
  return b;
}

describe('parseSidString', () => {
  it('parses well-known Local System S-1-5-18', () => {
    expect(parseSidString(sidBytes(1, 5, [18]))).toBe('S-1-5-18');
  });

  it('parses a real user SID with 5 sub-authorities incl. one > 2^31 (unsigned handling)', () => {
    // The exact SID resolved empirically on this box via the koffi token chain.
    const sid = sidBytes(1, 5, [21, 732142867, 588960626, 3228783940, 1001]);
    expect(parseSidString(sid)).toBe('S-1-5-21-732142867-588960626-3228783940-1001');
  });

  it('renders the top sub-authority 0xFFFFFFFF as unsigned 4294967295 (no sign flip)', () => {
    expect(parseSidString(sidBytes(1, 5, [0xffffffff]))).toBe('S-1-5-4294967295');
  });

  it('formats an identifier authority >= 2^32 as 0x-hex (matches ConvertSidToStringSidW)', () => {
    const b = new Uint8Array(8); // revision 1, 0 subs, authority = 0xFFFFFFFFFFFF
    b[0] = 1;
    b[1] = 0;
    for (let i = 2; i < 8; i++) b[i] = 0xff;
    expect(parseSidString(b)).toBe('S-1-0xffffffffffff');
  });

  it('parses a SID with zero sub-authorities', () => {
    expect(parseSidString(sidBytes(1, 5, []))).toBe('S-1-5');
  });

  it('THROWS on a header-truncated buffer (< 8 bytes) — caller must fail closed', () => {
    expect(() => parseSidString(new Uint8Array([1, 1, 0, 0]))).toThrow(/too short/);
  });

  it('THROWS on a body-truncated buffer (count claims more subs than bytes present)', () => {
    const b = sidBytes(1, 5, [21, 1]);
    expect(() => parseSidString(b.subarray(0, 10))).toThrow(/truncated/);
  });

  it('THROWS on an over-long SubAuthorityCount (> 15)', () => {
    const b = new Uint8Array(8 + 16 * 4);
    b[0] = 1;
    b[1] = 16;
    expect(() => parseSidString(b)).toThrow(/exceeds max/);
  });
});
