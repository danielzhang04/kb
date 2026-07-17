import { describe, it, expect } from 'vitest';
import { sddlIsOwnerOnly, sddlHasMediumLabel } from './win32Api.ts';

// Pure allowlist logic for the token-file security descriptor (L-2 residual: allowlist, not blocklist).
// No koffi involved — importing win32Api.ts does not load the native addon until loadWin32Api() is called.
const SID = 'S-1-5-21-11-22-33-1001';
const LABEL = 'S:(ML;;NRNWNX;;;ME)';

describe('sddlIsOwnerOnly', () => {
  it('accepts a DACL of exactly {daemon SID, SYSTEM} + a Medium label', () => {
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;${SID})(A;;FA;;;SY)${LABEL}`, SID)).toBe(true);
  });

  it('accepts SYSTEM written as its raw SID S-1-5-18, and tolerates the AI flag on the DACL', () => {
    expect(sddlIsOwnerOnly(`D:PAI(A;;FA;;;${SID})(A;;FA;;;S-1-5-18)S:AI(ML;;NWNRNX;;;ME)`, SID)).toBe(true);
  });

  it('REJECTS when any extra/broad trustee is present (Everyone)', () => {
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;${SID})(A;;FA;;;SY)(A;;FR;;;WD)${LABEL}`, SID)).toBe(false);
  });

  it('REJECTS when the daemon SID ACE is absent', () => {
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;SY)${LABEL}`, SID)).toBe(false);
  });

  it('REJECTS when the Medium integrity label is missing', () => {
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;${SID})(A;;FA;;;SY)`, SID)).toBe(false);
  });

  it('REJECTS a label below Medium (e.g. Low)', () => {
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;${SID})(A;;FA;;;SY)S:(ML;;NRNWNX;;;LW)`, SID)).toBe(false);
  });

  it('REJECTS an empty DACL and a missing owner sid arg', () => {
    expect(sddlIsOwnerOnly(`D:P${LABEL}`, SID)).toBe(false);
    expect(sddlIsOwnerOnly(`D:P(A;;FA;;;${SID})(A;;FA;;;SY)${LABEL}`, '')).toBe(false);
  });
});

// The pipe SACL read-back verify (LOW-1) checks ONLY the label — Windows normalizes the pipe DACL's
// GENERIC_ALL to object-specific rights on read-back, so a full DACL allowlist would false-fail.
describe('sddlHasMediumLabel (pipe SACL read-back verify)', () => {
  it('detects a Medium label, incl. the AI flag + reordered policy flags a read-back may produce', () => {
    expect(sddlHasMediumLabel('D:P(A;;FA;;;S-1-5-32-544)S:(ML;;NW;;;ME)')).toBe(true);
    expect(sddlHasMediumLabel('D:PAI(A;;FA;;;WD)S:AI(ML;;NWNRNX;;;ME)')).toBe(true);
  });
  it('returns false when no label / a below-Medium label is present', () => {
    expect(sddlHasMediumLabel('D:P(A;;FA;;;WD)')).toBe(false);
    expect(sddlHasMediumLabel('D:P(A;;FA;;;WD)S:(ML;;NW;;;LW)')).toBe(false);
  });
});
