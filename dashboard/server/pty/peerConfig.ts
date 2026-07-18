/**
 * D3.1b — peer-SID resolver + rendezvous-dir locator (pure, fs-injected).
 *
 * The host authorizes exactly ONE peer SID — Daniel's — and learns it at boot from a Daniel-write-only
 * `peer.sid` file in the rendezvous directory (design Point 1). The file's DACL (Daniel-write,
 * kb-fleet-read, SYSTEM) makes its PROVENANCE OS-guaranteed; this module is only the content
 * parse/validate. It is FAIL-CLOSED by construction: absent, empty, malformed, multi-line, or
 * equal-to-own-SID content all return an error sentinel — never a permissive default, never a fallback
 * to "authorize own SID" or "authorize any user". A host that cannot positively establish who its peer
 * is must refuse to listen.
 *
 * The fs reader is DEPENDENCY-INJECTED (same DI rationale as the rest of the pty module) so every branch
 * is exercised hermetically — no real filesystem is touched under test.
 */

/** The default rendezvous root (design Point 3; ACL locked at the human gate). */
export const DEFAULT_RENDEZVOUS_DIR = 'C:\\ProgramData\\kb\\pty-host';
/** The Daniel-write-only peer-SID filename inside the rendezvous dir. */
export const PEER_SID_FILENAME = 'peer.sid';

/**
 * A well-formed Windows account SID: `S-1-<authority>-<sub>-…` with at least one sub-authority, every
 * component decimal. Deliberately strict — anything the OS would not have written as a canonical account
 * SID is rejected. (Matches the canonical form `parseSidString` emits for a real TokenUser.)
 */
const SID_RE = /^S-1-\d+(?:-\d+)+$/;

/** The injected filesystem surface. `readFile` MUST throw when the target is absent/unreadable. */
export interface PeerConfigFs {
  /** Read a file's UTF-8 content. Throws (→ fail closed) if the file does not exist or cannot be read. */
  readFile(path: string): string;
  /** True iff `path` exists and is a directory. */
  dirExists(path: string): boolean;
}

export type PeerSidResult =
  | { ok: true; peerSid: string }
  | { ok: false; reason: string };

export type RendezvousDirResult =
  | { ok: true; dir: string }
  | { ok: false; reason: string };

/** Join a rendezvous dir with the `peer.sid` filename (Windows backslash separator). */
export function peerSidPath(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  return `${trimmed}\\${PEER_SID_FILENAME}`;
}

/**
 * Locate + validate the rendezvous directory. Defaults to `DEFAULT_RENDEZVOUS_DIR` (overridable). Fails
 * closed if the directory does not exist — the host cannot read `peer.sid`/`boot.token` from a dir that
 * is not there, and must not silently create an unlocked one.
 */
export function resolveRendezvousDir(deps: { fs: PeerConfigFs; dir?: string }): RendezvousDirResult {
  const dir = deps.dir?.trim() || DEFAULT_RENDEZVOUS_DIR;
  let exists = false;
  try {
    exists = deps.fs.dirExists(dir);
  } catch {
    exists = false;
  }
  if (!exists) {
    return { ok: false, reason: `rendezvous directory not found: ${dir}` };
  }
  return { ok: true, dir };
}

/**
 * Read + validate the expected peer SID from `<dir>\peer.sid`. Returns the SID only when the file holds
 * exactly one well-formed `S-1-…` SID that is NOT the host's own SID; otherwise an error sentinel.
 *
 * Fail-closed on: unreadable/absent file; empty/whitespace-only content; more than one non-empty line;
 * a malformed (non-SID) token; or a SID equal to `ownSid` (a misconfiguration or an attempt to make the
 * host authorize itself — never allowed).
 */
export function resolvePeerSid(deps: { fs: PeerConfigFs; dir: string; ownSid: string }): PeerSidResult {
  const path = peerSidPath(deps.dir);

  let raw: string;
  try {
    raw = deps.fs.readFile(path);
  } catch (err) {
    return { ok: false, reason: `peer.sid unreadable/absent: ${(err as Error).message}` };
  }

  // Split on any newline style; a legitimate peer.sid is a single line (optionally with a trailing EOL).
  const lines = raw.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { ok: false, reason: 'peer.sid is empty' };
  }
  if (lines.length > 1) {
    return { ok: false, reason: `peer.sid has multiple non-empty lines (${lines.length}); expected exactly one SID` };
  }

  const sid = lines[0];
  if (!SID_RE.test(sid)) {
    return { ok: false, reason: `peer.sid content is not a well-formed SID: '${sid}'` };
  }
  if (sid === deps.ownSid) {
    return { ok: false, reason: "peer.sid equals the host's OWN SID; refusing to authorize self as peer" };
  }
  return { ok: true, peerSid: sid };
}
