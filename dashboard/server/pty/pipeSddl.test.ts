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
import { buildPipeSddl, buildTokenFileSddl } from './pipeSddl.ts';
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
  it('emits the EXACT design §2 string', () => {
    expect(buildPipeSddl({ ownerSid: OWNER, peerSid: PEER })).toBe(
      `D:P(A;;GA;;;${OWNER})(A;;GRGW;;;${PEER})(A;;GA;;;SY)S:(ML;;NW;;;ME)`,
    );
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
