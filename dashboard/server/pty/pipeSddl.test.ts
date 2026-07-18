/**
 * D3.1c — cross-user SDDL builders (pure). RED-first.
 *
 * The pipe and the token file must carry the EXACT security descriptors from design §2/§3: kb-fleet
 * (owner) full, Daniel (peer) LEAST-PRIVILEGE (pipe: GRGW = client connect; token file: FR = read only),
 * SYSTEM full, protected DACL, Medium mandatory-integrity label. These builders are the pure string
 * construction; the native create/read-back verify is Phase 2. We assert the byte-exact strings, the
 * least-privilege grants (NOT GA/FA to the peer), the Medium label via the REAL broker helper, and that
 * no broad trustee (World / Authenticated Users / Users) ever appears.
 */
import { describe, expect, it } from 'vitest';
import { buildPipeSddl, buildTokenFileSddl, ownerSidFromSddl, tokenFileSddlVerified } from './pipeSddl.ts';
import { sddlHasMediumLabel } from '../../../broker/win32Api.ts';

const OWNER = 'S-1-5-21-732142867-588960626-3228783940-1007'; // kb-fleet
const PEER = 'S-1-5-21-732142867-588960626-3228783940-1001'; // Daniel

/** Broad, must-never-appear trustee aliases (World/Everyone, Authenticated Users, Users). */
const BROAD_TRUSTEES = ['WD', 'AU', 'BU', 'S-1-1-0', 'S-1-5-11', 'S-1-5-32-545'];

/** Extract the DACL ACE trustees (the last `;`-field of each `(...)` group before the SACL). */
function daclTrustees(sddl: string): string[] {
  const dm = sddl.match(/D:[A-Z]*((?:\([^)]*\))*)/);
  if (!dm) return [];
  return [...dm[1].matchAll(/\(([^)]*)\)/g)].map((m) => m[1].split(';').pop() ?? '');
}

describe('buildPipeSddl', () => {
  it('emits the EXACT design §2 string (with the explicit O: owner component)', () => {
    expect(buildPipeSddl({ ownerSid: OWNER, peerSid: PEER })).toBe(
      `O:${OWNER}D:P(A;;GA;;;${OWNER})(A;;GRGW;;;${PEER})(A;;GA;;;SY)S:(ML;;NW;;;ME)`,
    );
  });

  it('prepends an explicit O:<ownerSid> owner component (deterministic kb-fleet USER sid, not admin-group)', () => {
    const sddl = buildPipeSddl({ ownerSid: OWNER, peerSid: PEER });
    expect(sddl.startsWith(`O:${OWNER}`)).toBe(true);
    expect(ownerSidFromSddl(sddl)).toBe(OWNER);
  });

  it('grants the peer GRGW (client connect) — least privilege, NOT GA', () => {
    const sddl = buildPipeSddl({ ownerSid: OWNER, peerSid: PEER });
    expect(sddl).toContain(`(A;;GRGW;;;${PEER})`);
    expect(sddl).not.toContain(`(A;;GA;;;${PEER})`);
  });

  it('carries a Medium mandatory label (real broker helper)', () => {
    expect(sddlHasMediumLabel(buildPipeSddl({ ownerSid: OWNER, peerSid: PEER }))).toBe(true);
  });

  it('grants ONLY {owner, peer, SYSTEM} — no World/Authenticated-Users/Users ACE', () => {
    const trustees = daclTrustees(buildPipeSddl({ ownerSid: OWNER, peerSid: PEER }));
    expect(trustees.sort()).toEqual([OWNER, PEER, 'SY'].sort());
    for (const broad of BROAD_TRUSTEES) expect(trustees).not.toContain(broad);
  });
});

describe('buildTokenFileSddl', () => {
  it('emits the EXACT design §3 string', () => {
    expect(buildTokenFileSddl({ ownerSid: OWNER, readerSid: PEER })).toBe(
      `D:P(A;;FA;;;${OWNER})(A;;FR;;;${PEER})(A;;FA;;;SY)S:(ML;;NRNWNX;;;ME)`,
    );
  });

  it('grants the reader FR (read only) — least privilege, NOT FA', () => {
    const sddl = buildTokenFileSddl({ ownerSid: OWNER, readerSid: PEER });
    expect(sddl).toContain(`(A;;FR;;;${PEER})`);
    expect(sddl).not.toContain(`(A;;FA;;;${PEER})`);
  });

  it('carries a Medium mandatory label (real broker helper)', () => {
    expect(sddlHasMediumLabel(buildTokenFileSddl({ ownerSid: OWNER, readerSid: PEER }))).toBe(true);
  });

  it('grants ONLY {owner, reader, SYSTEM} — no broad trustee', () => {
    const trustees = daclTrustees(buildTokenFileSddl({ ownerSid: OWNER, readerSid: PEER }));
    expect(trustees.sort()).toEqual([OWNER, PEER, 'SY'].sort());
    for (const broad of BROAD_TRUSTEES) expect(trustees).not.toContain(broad);
  });
});

describe('tokenFileSddlVerified — read-back allowlist (D3.1e)', () => {
  it('accepts the exact built descriptor', () => {
    expect(tokenFileSddlVerified(buildTokenFileSddl({ ownerSid: OWNER, readerSid: PEER }), { ownerSid: OWNER, readerSid: PEER })).toBe(true);
  });

  it('accepts the SYSTEM S-1-5-18 alias in place of SY (as Windows may render it on read-back)', () => {
    const sddl = `D:P(A;;FA;;;${OWNER})(A;;FR;;;${PEER})(A;;FA;;;S-1-5-18)S:(ML;;NRNWNX;;;ME)`;
    expect(tokenFileSddlVerified(sddl, { ownerSid: OWNER, readerSid: PEER })).toBe(true);
  });

  it('REJECTS an extra broad trustee even if owner+reader+SYSTEM are present (fail-closed)', () => {
    const sddl = `D:P(A;;FA;;;${OWNER})(A;;FR;;;${PEER})(A;;FA;;;SY)(A;;FR;;;S-1-1-0)S:(ML;;NRNWNX;;;ME)`;
    expect(tokenFileSddlVerified(sddl, { ownerSid: OWNER, readerSid: PEER })).toBe(false);
  });

  it('REJECTS when the reader (Daniel) is missing', () => {
    const sddl = `D:P(A;;FA;;;${OWNER})(A;;FA;;;SY)S:(ML;;NRNWNX;;;ME)`;
    expect(tokenFileSddlVerified(sddl, { ownerSid: OWNER, readerSid: PEER })).toBe(false);
  });

  it('REJECTS when the Medium label is absent', () => {
    const sddl = `D:P(A;;FA;;;${OWNER})(A;;FR;;;${PEER})(A;;FA;;;SY)`;
    expect(tokenFileSddlVerified(sddl, { ownerSid: OWNER, readerSid: PEER })).toBe(false);
  });

  it('REJECTS a non-Medium (e.g. Low) label', () => {
    const sddl = `D:P(A;;FA;;;${OWNER})(A;;FR;;;${PEER})(A;;FA;;;SY)S:(ML;;NRNWNX;;;LW)`;
    expect(tokenFileSddlVerified(sddl, { ownerSid: OWNER, readerSid: PEER })).toBe(false);
  });
});

/**
 * D3.1 anti-squat OWNER parse+compare (the pure core of connectAndVerifyServer's server-identity check).
 * The client reads the pipe's OWNER_SECURITY_INFORMATION back as an SDDL string, parses the `O:` SID, and
 * accepts ONLY when it equals the pinned kb-fleet SID. This mirrors that decision without koffi; the native
 * GetSecurityInfo call + fail-closed-on-nonzero-return remains gate-only (koffi cannot be faked cleanly).
 */
describe('ownerSidFromSddl — anti-squat owner parse+compare', () => {
  /** The exact compare connectAndVerifyServer performs on the read-back owner SDDL. */
  const ownerMatches = (ownerSddl: string, expected: string): boolean => {
    const sid = ownerSidFromSddl(ownerSddl);
    return sid != null && sid === expected;
  };

  it('ACCEPTS when O:<sid> == the expected kb-fleet SID', () => {
    expect(ownerMatches(`O:${OWNER}`, OWNER)).toBe(true);
  });

  it('ACCEPTS an owner-only read-back with the SID followed by no other section', () => {
    // OWNER_SECURITY_INFORMATION-only read-back is just the O: component.
    expect(ownerSidFromSddl(`O:${OWNER}`)).toBe(OWNER);
  });

  it('REJECTS when the owner SID is a DIFFERENT account (squatter)', () => {
    const OTHER = 'S-1-5-21-999999999-888888888-777777777-1234';
    expect(ownerMatches(`O:${OTHER}`, OWNER)).toBe(false);
  });

  it('REJECTS the admin-group owner edge case (S-1-5-32-544) that the explicit O: component prevents', () => {
    expect(ownerMatches('O:S-1-5-32-544', OWNER)).toBe(false);
  });

  it('REJECTS a missing O: component (owner absent → fail closed)', () => {
    expect(ownerSidFromSddl(`D:P(A;;GA;;;${OWNER})S:(ML;;NW;;;ME)`)).toBeNull();
    expect(ownerMatches(`D:P(A;;GA;;;${OWNER})`, OWNER)).toBe(false);
  });

  it('REJECTS a garbage / unparseable owner (fail closed)', () => {
    expect(ownerSidFromSddl('O:not-a-sid')).toBeNull();
    expect(ownerSidFromSddl('')).toBeNull();
    expect(ownerMatches('O:@@@', OWNER)).toBe(false);
  });
});
