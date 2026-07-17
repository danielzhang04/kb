/**
 * D3.6 (Option B) — pure, dependency-free parser: Windows SID binary → canonical string form.
 *
 * WHY WE PARSE BYTES INSTEAD OF CALLING ConvertSidToStringSidW: koffi 3.1.1's `decode()` returns a
 * pointer as a BigInt and CANNOT then read a wchar_t string from that BigInt address — doing so
 * segfaults (an uncatchable access violation that would crash the daemon, violating the never-crash
 * invariant). The SID bytes are already present in the koffi-owned `TokenUser` buffer, so we format them
 * ourselves: deterministic, allocation-free, leak-free (no LocalAlloc → no LocalFree), and crash-proof.
 * Output is byte-identical to ConvertSidToStringSidW (verified empirically on this box).
 *
 * SID binary layout (little-endian host):
 *   byte 0      Revision (u8; Windows SIDs are always 1)
 *   byte 1      SubAuthorityCount (u8; 0..15 — SID_MAX_SUB_AUTHORITIES)
 *   bytes 2..7  IdentifierAuthority (6 bytes, BIG-endian)
 *   bytes 8..   SubAuthority[SubAuthorityCount] (each u32, LITTLE-endian)
 * String form: "S-<rev>-<authority>-<sub0>-<sub1>-…" (authority decimal if < 2^32, else 0x-hex — matching
 * ConvertSidToStringSidW).
 */

/** SID_MAX_SUB_AUTHORITIES — a well-formed SID never exceeds this; anything larger is rejected. */
const SID_MAX_SUB_AUTHORITIES = 15;

/**
 * Parse a raw SID (as laid out by the OS in a TokenUser buffer) into its canonical "S-1-5-…" string.
 * THROWS on any malformed / truncated / over-long input — callers MUST treat a throw as "SID unresolved"
 * and fail closed (reject the connection). Never returns a partial or guessed SID.
 */
export function parseSidString(bytes: Uint8Array): string {
  if (bytes.length < 8) {
    throw new Error(`SID too short: ${bytes.length} bytes (need >= 8 for header)`);
  }
  const revision = bytes[0];
  const subCount = bytes[1];
  if (subCount > SID_MAX_SUB_AUTHORITIES) {
    throw new Error(`SID SubAuthorityCount ${subCount} exceeds max ${SID_MAX_SUB_AUTHORITIES}`);
  }
  const needed = 8 + subCount * 4;
  if (bytes.length < needed) {
    throw new Error(`SID truncated: ${bytes.length} bytes, need ${needed} for ${subCount} sub-authorities`);
  }

  // IdentifierAuthority: 6 bytes, big-endian.
  let authority = 0n;
  for (let i = 0; i < 6; i++) {
    authority = (authority << 8n) | BigInt(bytes[2 + i]);
  }
  const authorityStr =
    authority < 0x100000000n
      ? authority.toString(10)
      : '0x' + authority.toString(16).padStart(12, '0');

  let out = `S-${revision}-${authorityStr}`;
  for (let i = 0; i < subCount; i++) {
    const o = 8 + i * 4;
    // u32 little-endian → unsigned. Avoid `<< 24` sign issues by multiplying the top byte.
    const v = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) + bytes[o + 3] * 0x1000000;
    out += '-' + (v >>> 0);
  }
  return out;
}
