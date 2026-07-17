/**
 * D3.6 — the concrete peer-credential mechanism for the Broker's control socket.
 *
 * `broker/socket.ts` requires every connection to clear a PEER-CREDENTIAL check (same OS owner as the
 * daemon) in addition to the per-boot token. That check consumes a `PeerCredentialReader`; the shipped
 * default (`defaultPeerReader`) is fail-closed (returns null → reject all). This module supplies the
 * REAL reader, and — crucially — the OS restriction that makes it sound.
 *
 * ── APPROACH: OS-ENFORCED BOUNDARY (not an explicit peer read) ──────────────────────────────────────
 * We do NOT introduce a native binding to call `getsockopt(SO_PEERCRED)` / `GetNamedPipeClientProcessId`.
 * Instead we make the OS itself guarantee that only the daemon's own user can open the socket, and let
 * the reader return the daemon's own ownerId — which is then, by construction, the ONLY owner that can
 * ever be on the other end.
 *
 *   • POSIX (unix-domain socket): the socket inode lives inside a parent directory created 0700 and
 *     owned by the daemon uid. A different local account cannot search/traverse a 0700 dir it does not
 *     own, so it cannot even reach the socket path to `connect()`; we additionally chmod the socket file
 *     itself to 0600. Both the directory mode/owner and (post-listen) the socket file mode/owner are
 *     VERIFIED via stat — the restriction is applied AND checked, never merely assumed. Only when that
 *     verification passes does `ownerBoundedReader` return `{ ownerId: <daemon uid> }`.
 *
 *   • Windows (named pipe) / any platform without getuid: Node's standard `net`/`fs` API exposes no way
 *     to SET a named-pipe security descriptor at bind time, and no way to READ BACK the applied DACL to
 *     verify it. We therefore cannot guarantee a different local account is unable to open the pipe.
 *     Per the D3.6 hard rule (fail closed under ANY uncertainty), we do NOT pretend: the boundary is
 *     reported un-enforced and the reader stays fail-closed (reject every connection). Wiring a Windows
 *     peer read is a native-binding follow-up flagged for the re-review; until then the Windows control
 *     socket is intentionally unusable rather than insecure.
 *
 * FAIL-CLOSED GUARANTEE: `ownerBoundedReader` returns a permissive credential ONLY for a boundary whose
 * `enforced` flag is true, and that flag is set true only after mkdir+chmod+stat all succeed and the
 * verified owner/mode are exactly right. Every other path — win32, no getuid, mkdir/chmod/stat throwing,
 * wrong owner, any group/other permission bit set — yields `enforced:false`, whose reader is the
 * fail-closed `defaultPeerReader`. There is no path that returns a guessed or "allow" credential.
 */
import { mkdirSync as nodeMkdirSync, chmodSync as nodeChmodSync, statSync as nodeStatSync } from 'node:fs';
import { dirname as nodeDirname } from 'node:path';
// Type-only import (erased at compile time under verbatimModuleSyntax) — this keeps the socket↔boundary
// dependency one-directional at RUNTIME (socket.ts imports the value `ownerBoundedReader` from here; we
// import nothing of its runtime shape back), so there is no import cycle to reason about.
import type { PeerCredentialReader } from './socket.ts';

/** Fail-closed reader: resolves no credential, so `authenticateConnection` rejects the connection. Kept
 *  local (not imported from socket.ts) to avoid a runtime import cycle; identical semantics to that
 *  module's `defaultPeerReader`. */
const failClosedReader: PeerCredentialReader = () => null;

/** The minimal filesystem surface the boundary needs — injected so unit tests stay hermetic (no real
 *  sockets, dirs, or platform dependence). Structurally satisfied by `node:fs`'s sync functions. */
export interface BoundaryFs {
  mkdirSync: (path: string, opts: { recursive: boolean; mode: number }) => unknown;
  chmodSync: (path: string, mode: number) => void;
  statSync: (path: string) => { uid: number; mode: number };
}

/** Inputs to `establishOwnerBoundary`. Everything platform/OS-touching is injectable; production callers
 *  pass only `socketPath` and get real `process`/`node:fs`/`node:path` defaults. */
export interface BoundaryDeps {
  socketPath: string;
  /** `process.platform` — injected so a Windows host can unit-test the POSIX branch and vice-versa. */
  platform?: NodeJS.Platform;
  /** `process.getuid` (absent on Windows). Its presence + a POSIX platform is required to enforce. */
  getuid?: (() => number) | undefined;
  fs?: BoundaryFs;
  dirname?: (path: string) => string;
}

/** The result of trying to establish an OS-enforced same-user boundary around the control socket. */
export type OwnerBoundary =
  | { enforced: true; ownerId: string; socketPath: string; detail: string }
  | { enforced: false; detail: string };

const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
/** Any group/other permission bit — the boundary is void if any of these are set on dir or socket. */
const GROUP_OTHER_BITS = 0o077;

function defaultGetuid(): (() => number) | undefined {
  return (process as NodeJS.Process & { getuid?: () => number }).getuid?.bind(process);
}

/**
 * Apply AND verify the OS-owner restriction for `socketPath`, returning whether a same-user boundary is
 * enforced. On POSIX this creates/tightens the socket's parent directory to 0700 owned by the daemon uid
 * and stat-verifies it. On Windows / no-getuid it fails closed (see module doc). MUST be called BEFORE
 * `server.listen(socketPath)`; pair with `secureSocketFile` AFTER listen to tighten the socket inode.
 */
export function establishOwnerBoundary(deps: BoundaryDeps): OwnerBoundary {
  const platform = deps.platform ?? process.platform;
  const getuid = 'getuid' in deps ? deps.getuid : defaultGetuid();
  const fs = deps.fs ?? { mkdirSync: nodeMkdirSync, chmodSync: nodeChmodSync, statSync: nodeStatSync };
  const dirname = deps.dirname ?? nodeDirname;
  const { socketPath } = deps;

  if (platform === 'win32') {
    return {
      enforced: false,
      detail:
        'win32 named-pipe owner ACL cannot be set at bind time nor read back to verify via standard ' +
        'Node API; fail-closed (a native peer reader is the follow-up — see peerBoundary.ts doc)',
    };
  }
  if (typeof getuid !== 'function') {
    return { enforced: false, detail: `platform '${platform}' exposes no getuid(); cannot establish an owner boundary; fail-closed` };
  }

  try {
    const uid = getuid();
    const dir = dirname(socketPath);
    // APPLY: parent dir owner-only. mkdir(recursive) is idempotent; a pre-existing dir keeps its old
    // mode, so chmod explicitly afterwards, then VERIFY by stat (never trust the apply blindly).
    fs.mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
    fs.chmodSync(dir, OWNER_ONLY_DIR);
    const st = fs.statSync(dir);
    if (st.uid !== uid) {
      return { enforced: false, detail: `control-socket dir '${dir}' is owned by uid ${st.uid}, not the daemon uid ${uid}; fail-closed` };
    }
    if ((st.mode & GROUP_OTHER_BITS) !== 0) {
      return {
        enforced: false,
        detail: `control-socket dir '${dir}' grants group/other access (mode ${(st.mode & 0o777).toString(8)}); fail-closed`,
      };
    }
    return {
      enforced: true,
      ownerId: String(uid),
      socketPath,
      detail: `owner-only dir '${dir}' (0700, uid ${uid}) enforces same-user connect`,
    };
  } catch (err) {
    return { enforced: false, detail: `failed to establish owner boundary: ${(err as Error).message}; fail-closed` };
  }
}

/**
 * Post-`listen` hardening: tighten the socket inode itself to 0600 and re-verify owner+mode. Any failure
 * (or a boundary that was never enforced) downgrades to fail-closed. Idempotent to call once after the
 * server begins listening — the socket inode only exists after `listen`.
 */
export function secureSocketFile(boundary: OwnerBoundary, fs?: BoundaryFs): OwnerBoundary {
  if (!boundary.enforced) return boundary;
  const ops = fs ?? { mkdirSync: nodeMkdirSync, chmodSync: nodeChmodSync, statSync: nodeStatSync };
  try {
    ops.chmodSync(boundary.socketPath, OWNER_ONLY_FILE);
    const st = ops.statSync(boundary.socketPath);
    if (st.uid !== Number(boundary.ownerId) || (st.mode & GROUP_OTHER_BITS) !== 0) {
      return {
        enforced: false,
        detail: `control socket '${boundary.socketPath}' failed post-listen owner/mode verification (uid ${st.uid}, mode ${(st.mode & 0o777).toString(8)}); fail-closed`,
      };
    }
    return boundary;
  } catch (err) {
    return { enforced: false, detail: `failed to secure socket file: ${(err as Error).message}; fail-closed` };
  }
}

/**
 * The concrete `PeerCredentialReader`. When the boundary is enforced, the OS guarantees every connecting
 * peer is the daemon's own user, so the reader returns the daemon's ownerId for any connection — sound
 * precisely BECAUSE the boundary (verified 0700 owner-only dir) admits no other owner. When the boundary
 * is not enforced, the reader is the fail-closed default (returns null → the connection is rejected).
 */
export function ownerBoundedReader(boundary: OwnerBoundary): PeerCredentialReader {
  if (!boundary.enforced) return failClosedReader;
  const ownerId = boundary.ownerId;
  // The peer object is irrelevant: identity is enforced by the socket's OS permissions, not read per-conn.
  return () => ({ ownerId });
}
