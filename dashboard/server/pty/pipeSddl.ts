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
