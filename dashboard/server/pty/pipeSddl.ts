/**
 * D3.1c — cross-user SDDL builders (pure).
 *
 * The Broker's `loadWin32Api` HARDCODES a single-owner SDDL (`D:P(A;;GA;;;${daemonSid})…`) because its
 * channel is same-user. The PTY-host channel crosses a user boundary, so the owner (kb-fleet) and the
 * peer (Daniel) are DIFFERENT SIDs and the peer must get only LEAST-PRIVILEGE rights. These builders
 * emit the exact design §2 (pipe) and §3 (token file) descriptors, parameterized on both SIDs. They are
 * pure strings; the native create + Medium-label read-back verify is Phase 2 (win32PtyApi.ts), which
 * will consume these builders and then re-assert `sddlHasMediumLabel` on the read-back.
 *
 * Least-privilege rationale (vs the Broker's blanket GA/FA to the single owner):
 *   • pipe peer → GRGW (FILE_GENERIC_READ|WRITE = a client connect); NOT GA — the peer never needs to
 *     rewrite the pipe's ACL.
 *   • token-file reader → FR (read only); NOT FA — Daniel only ever READS the per-boot token.
 */

/** Build the cross-user PIPE SDDL (design §2): owner GA, peer GRGW (connect-only), SYSTEM GA, protected
 *  DACL, Medium label with no-write-up (excludes a same-user Low-IL/AppContainer client). */
export function buildPipeSddl(sids: { ownerSid: string; peerSid: string }): string {
  return (
    `D:P(A;;GA;;;${sids.ownerSid})` +
    `(A;;GRGW;;;${sids.peerSid})` +
    `(A;;GA;;;SY)` +
    `S:(ML;;NW;;;ME)`
  );
}

/** Build the cross-user TOKEN-FILE SDDL (design §3): owner FA, reader FR (read-only), SYSTEM FA,
 *  protected DACL, Medium label with no read/write/exec-up (excludes a Low-IL read of the token). */
export function buildTokenFileSddl(sids: { ownerSid: string; readerSid: string }): string {
  return (
    `D:P(A;;FA;;;${sids.ownerSid})` +
    `(A;;FR;;;${sids.readerSid})` +
    `(A;;FA;;;SY)` +
    `S:(ML;;NRNWNX;;;ME)`
  );
}

/** SDDL aliases that denote the SYSTEM account. */
const SYSTEM_SDDL_ALIASES = new Set(['SY', 'S-1-5-18']);

/** A Medium mandatory-integrity label (`S:...(ML;...;ME)`) is present in the SACL. Pure (mirrors the
 *  Broker's `sddlHasMediumLabel`, re-implemented here so this pure module never imports the koffi surface). */
export function sddlHasMediumLabel(sddl: string): boolean {
  return /S:[A-Z]*\(ML;[^)]*;ME\)/.test(sddl);
}

/**
 * ALLOWLIST verify for a token-file SD read back after create (D3.1e). The cross-user analogue of the
 * Broker's `sddlIsOwnerOnly`: the DACL must grant ONLY {ownerSid (kb-fleet), readerSid (Daniel), SYSTEM}
 * — nothing else — AND include BOTH the owner and the reader, AND carry a Medium mandatory label. Any
 * extra trustee, a missing owner/reader, or an absent label → false (caller unlinks + fails closed).
 *
 * SID trustees are read from the LAST `;`-separated field of each DACL ACE. This is sound for a FILE
 * read-back: unlike a kernel object's DACL, the trustee SIDs are not normalized on read (only the rights
 * mask is), so the trustee SET is a stable, verifiable allowlist.
 */
export function tokenFileSddlVerified(sddl: string, sids: { ownerSid: string; readerSid: string }): boolean {
  if (!sids.ownerSid || !sids.readerSid) return false;
  const dm = sddl.match(/D:[A-Z]*((?:\([^)]*\))*)/);
  if (!dm) return false;
  const trustees = [...dm[1].matchAll(/\(([^)]*)\)/g)].map((m) => m[1].split(';').pop() ?? '');
  if (trustees.length === 0) return false;
  const allowed = new Set([sids.ownerSid, sids.readerSid, ...SYSTEM_SDDL_ALIASES]);
  const everyAllowed = trustees.every((t) => allowed.has(t));
  const hasOwner = trustees.includes(sids.ownerSid);
  const hasReader = trustees.includes(sids.readerSid);
  return everyAllowed && hasOwner && hasReader && sddlHasMediumLabel(sddl);
}
