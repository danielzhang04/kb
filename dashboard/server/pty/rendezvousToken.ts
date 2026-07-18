/**
 * D3.1d — rendezvous token-exchange logic (fs-injected; native ACL write/read-back is Phase 2).
 *
 * Factor B of the cross-user auth. The HOST (kb-fleet) mints a fresh 256-bit token at boot (reusing the
 * Broker's `mintBootToken` verbatim) and writes it to `boot.token` in the rendezvous dir. The DAEMON
 * (Daniel) reads it FRESH on every `openPty` — never caches — so a host restart that re-mints does not
 * strand the daemon and a stale in-memory copy can never cause a silent single-factor accept.
 *
 * THE D-2 FIX (load-bearing): the daemon-side read FAILS CLOSED on an absent / empty / short / malformed
 * token file and NEVER fabricates a fallback. The old `resolveChannelAuth` minted a `randomUUID()` when
 * its env was unset; that is exactly the fabricated token this resolver refuses to produce — a missing
 * file must yield an error the caller maps to `host-unreachable`, not a token that can only ever mismatch.
 *
 * SCOPE: this module is the PURE core (mint + fresh-read validation), all fs-injected. The host-side
 * write is NOT a plain fs write — it must go through a native security-descriptor'd create + Medium-label
 * read-back verify (design §3), which is Phase 2. That native surface is declared here as an injectable
 * SEAM (`SecureTokenFileWriter`) so hostMain.ts can depend on the interface now; it is implemented in
 * Phase 2 (win32PtyApi.ts) and must not be stubbed permissively.
 */
import { mintBootToken } from '../../../broker/socket.ts';

/** The rendezvous token filename inside the rendezvous dir. */
export const BOOT_TOKEN_FILENAME = 'boot.token';

/** A valid per-boot token is 64 hex chars (256 bits) — the exact shape `mintBootToken` emits. Anything
 *  shorter (including a 36-char UUID) is rejected as "too short / malformed". */
export const MIN_BOOT_TOKEN_LEN = 64;

const BOOT_TOKEN_RE = /^[0-9a-f]+$/;

/** Injected reader for the daemon side: read the token file's UTF-8 content. MUST throw when the file is
 *  absent/unreadable so the resolver can fail closed (never a fabricated fallback). */
export type TokenFileReader = (path: string) => string;

export type TokenReadResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

/**
 * Phase 2 SEAM — the native, security-descriptor'd token-file writer the HOST uses. It must: create the
 * file with the design §3 SDDL (via `buildTokenFileSddl`), open reparse-safe (FILE_FLAG_OPEN_REPARSE_
 * POINT), write the token, then READ THE DACL+LABEL BACK and verify it grants only {owner, reader, SYSTEM}
 * + a Medium label — returning false (→ caller unlinks + fails closed) on any deviation. NOT implemented
 * in Phase 1: koffi is out of scope here. hostMain.ts (Phase 2) injects the real implementation.
 */
export interface SecureTokenFileWriter {
  /** Write `token` to `path` under the cross-user token-file SD and verify the ACL read-back. Returns
   *  false on any failure. */
  writeAndVerify(path: string, token: string, sids: { ownerSid: string; readerSid: string }): boolean;
}

/** Join a rendezvous dir with the `boot.token` filename (Windows backslash). */
export function bootTokenPath(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  return `${trimmed}\\${BOOT_TOKEN_FILENAME}`;
}

/** HOST side: mint this boot's per-boot token. Reuses the Broker's `mintBootToken` (256-bit CSPRNG hex)
 *  unchanged — the token is never persisted beyond the ACL-locked `boot.token` the host writes. */
export function mintHostBootToken(): string {
  return mintBootToken();
}

/**
 * DAEMON side: read the per-boot token FRESH from `boot.token`. Returns the token only when the file
 * holds a single well-formed 256-bit hex token; otherwise an error sentinel. FAILS CLOSED — no fabricated
 * fallback — on: unreadable/absent file, empty/whitespace-only content, a token shorter than
 * `MIN_BOOT_TOKEN_LEN`, or a non-hex token.
 *
 * Phase 2: staleness relative to the host boot (an mtime check against the host's boot marker) is a
 * real-box concern layered on top of this pure validation; the fresh-read-per-open discipline here is
 * what makes a re-mint after a host restart transparent.
 */
export function readBootTokenFresh(deps: { read: TokenFileReader; path: string }): TokenReadResult {
  let raw: string;
  try {
    raw = deps.read(deps.path);
  } catch (err) {
    return { ok: false, reason: `boot.token unreadable/absent: ${(err as Error).message}` };
  }

  const token = raw.trim();
  if (token.length === 0) {
    return { ok: false, reason: 'boot.token is empty' };
  }
  if (token.length < MIN_BOOT_TOKEN_LEN) {
    return { ok: false, reason: `boot.token too short (${token.length} < ${MIN_BOOT_TOKEN_LEN})` };
  }
  if (!BOOT_TOKEN_RE.test(token)) {
    return { ok: false, reason: 'boot.token is not a well-formed hex token' };
  }
  return { ok: true, token };
}
