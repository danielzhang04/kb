/**
 * D3.6 — the concrete POSIX peer-credential mechanism for the Broker's control socket.
 *
 * `broker/socket.ts` requires every connection to clear a PEER-CREDENTIAL check (same OS owner as the
 * daemon) in addition to the per-boot token. That check consumes a `PeerCredentialReader`; the shipped
 * default (`defaultPeerReader`) is fail-closed (returns null → reject all). This module supplies the
 * REAL reader for POSIX, and — crucially — the OS restriction that makes it sound.
 *
 * ── APPROACH: OS-ENFORCED BOUNDARY (POSIX; not an explicit peer read) ───────────────────────────────
 * On POSIX we do NOT call `getsockopt(SO_PEERCRED)`. Instead we make the OS itself guarantee that only
 * the daemon's own user can open the socket, and let the reader return the daemon's own ownerId — which
 * is then, by construction, the ONLY owner that can ever be on the other end.
 *
 *   • POSIX (unix-domain socket): the socket inode lives inside a parent directory created 0700 and
 *     owned by the daemon uid. A different local account cannot search/traverse a 0700 dir it does not
 *     own, so it cannot even reach the socket path to `connect()`; we additionally chmod the socket file
 *     itself to 0600. The directory mode/owner, that it is not a symlink, and (post-listen) the socket
 *     file mode/owner AND the parent dir again are VERIFIED via lstat/stat — applied AND checked, never
 *     assumed. Only when that verification passes does `ownerBoundedReader` return `{ ownerId: <daemon uid> }`.
 *
 *   • Windows (named pipe): win32 does NOT use this fs-dir boundary. The Windows control transport is a
 *     native koffi-managed named-pipe server (broker/win32PipeServer.ts) that performs a REAL
 *     per-connection SID check (GetNamedPipeClientProcessId → token SID vs the daemon's own SID). This
 *     module's `establishOwnerBoundary` therefore reports un-enforced on win32 (it is the POSIX path);
 *     the platform-selecting factory in broker/controlTransport.ts routes win32 to the pipe server.
 *
 * FAIL-CLOSED GUARANTEE: `ownerBoundedReader` returns a permissive credential ONLY for a boundary whose
 * `enforced` flag is true, and that flag is set true only after mkdir+chmod+lstat+stat all succeed and the
 * verified owner/mode are exactly right. Every other path — win32, no getuid, mkdir/chmod/stat throwing,
 * a symlinked parent dir, a non-absolute / NUL-bearing socket path, wrong owner, any group/other
 * permission bit set — yields `enforced:false`, whose reader is the fail-closed `defaultPeerReader`.
 * There is no path that returns a guessed or "allow" credential.
 *
 * ── CALLER PRECONDITION (D3.6 adversarial review, MED) ──────────────────────────────────────────────
 * The 0700 owner-only boundary is sound only if EVERY ancestor of the socket's parent dir is itself
 * non-attacker-writable and non-symlink: a 0700 dir reached through an attacker-controlled symlink, or
 * created under a world-writable ancestor an attacker can pre-seed/swap (TOCTOU), does not bind identity.
 * The caller MUST site the control socket under a trusted root it owns (e.g. `$XDG_RUNTIME_DIR`, or a
 * daemon-owned dir under the user profile) — NOT under `/tmp` or any world-writable location. This module
 * defends the parent dir it manages (rejects a symlinked parent; re-verifies parent owner+mode after
 * listen), but it cannot walk and vouch for the whole ancestor chain; that siting is the boot caller's job.
 *
 * NOTE ON ROOT: a 0700 owner-only dir does not exclude root — root can already `ptrace`/read any process
 * on the box, so a same-box root is outside this control's threat model (not a privilege escalation the
 * boundary is meant to stop). The boundary binds the socket to the daemon's own UNPRIVILEGED user vs OTHER
 * unprivileged local accounts, which is exactly ordering-law 7's lateral-movement concern.
 */
import {
  mkdirSync as nodeMkdirSync,
  chmodSync as nodeChmodSync,
  statSync as nodeStatSync,
  lstatSync as nodeLstatSync,
} from 'node:fs';
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
  /** `lstatSync` — does NOT follow symlinks, so it detects a symlinked parent dir the 0700 boundary
   *  would otherwise trust after `statSync` silently resolved it. */
  lstatSync: (path: string) => { uid: number; mode: number };
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
/** `stat` mode file-type mask + the symlink type, for the lstat symlink check. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function defaultFs(): BoundaryFs {
  return { mkdirSync: nodeMkdirSync, chmodSync: nodeChmodSync, statSync: nodeStatSync, lstatSync: nodeLstatSync };
}

function defaultGetuid(): (() => number) | undefined {
  return (process as NodeJS.Process & { getuid?: () => number }).getuid?.bind(process);
}

/**
 * Apply AND verify the OS-owner restriction for `socketPath`, returning whether a same-user boundary is
 * enforced. On POSIX this creates/tightens the socket's parent directory to 0700 owned by the daemon uid,
 * rejects a symlinked parent, and stat-verifies owner+mode. On Windows / no-getuid it reports un-enforced
 * (win32 uses the native pipe server; see module doc). MUST be called BEFORE `server.listen(socketPath)`;
 * pair with `secureSocketFile` AFTER listen to tighten the socket inode and re-verify the parent.
 */
export function establishOwnerBoundary(deps: BoundaryDeps): OwnerBoundary {
  const platform = deps.platform ?? process.platform;
  const getuid = 'getuid' in deps ? deps.getuid : defaultGetuid();
  const fs = deps.fs ?? defaultFs();
  const dirname = deps.dirname ?? nodeDirname;
  const { socketPath } = deps;

  if (platform === 'win32') {
    return {
      enforced: false,
      detail:
        'win32 does not use the fs-dir boundary; the native koffi pipe server (win32PipeServer.ts) does a ' +
        'per-connection SID check. This POSIX boundary reports un-enforced on win32 by design.',
    };
  }
  if (typeof getuid !== 'function') {
    return { enforced: false, detail: `platform '${platform}' exposes no getuid(); cannot establish an owner boundary; fail-closed` };
  }

  // LOW (adversarial review): reject an abstract-namespace socket (`\0`-prefixed) or any non-absolute /
  // NUL-bearing path — neither lives under a verifiable 0700 fs dir, so the boundary could not bind it.
  if (socketPath.length === 0 || socketPath[0] === '\0' || socketPath.includes('\0') || !socketPath.startsWith('/')) {
    return {
      enforced: false,
      detail: 'control-socket path is not an absolute filesystem path (or contains NUL / is abstract-namespace); fail-closed',
    };
  }

  try {
    const uid = getuid();
    const dir = dirname(socketPath);
    // APPLY: parent dir owner-only. mkdir(recursive) is idempotent; a pre-existing dir keeps its old
    // mode, so chmod explicitly afterwards, then VERIFY (never trust the apply blindly).
    fs.mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
    fs.chmodSync(dir, OWNER_ONLY_DIR);
    // MED (adversarial review): lstat first — a symlinked parent dir means `statSync` below would verify
    // the symlink TARGET's mode/owner while a different local account controls the link. Reject outright.
    const ls = fs.lstatSync(dir);
    if ((ls.mode & S_IFMT) === S_IFLNK) {
      return { enforced: false, detail: `control-socket dir '${dir}' is a symlink; fail-closed` };
    }
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
 * Post-`listen` hardening: tighten the socket inode itself to 0600 and re-verify owner+mode, AND
 * re-verify the parent dir (not a symlink, owner uid, no group/other bits) — the parent re-check catches
 * an attacker who swapped/relaxed the dir between `establishOwnerBoundary` and `listen` (TOCTOU, MED).
 * Any failure (or a boundary that was never enforced) downgrades to fail-closed. Idempotent to call once
 * after the server begins listening — the socket inode only exists after `listen`.
 */
export function secureSocketFile(boundary: OwnerBoundary, fs?: BoundaryFs): OwnerBoundary {
  if (!boundary.enforced) return boundary;
  const ops = fs ?? defaultFs();
  const dir = nodeDirname(boundary.socketPath);
  const ownerUid = Number(boundary.ownerId);
  try {
    ops.chmodSync(boundary.socketPath, OWNER_ONLY_FILE);
    // Socket inode owner+mode.
    const st = ops.statSync(boundary.socketPath);
    if (st.uid !== ownerUid || (st.mode & GROUP_OTHER_BITS) !== 0) {
      return {
        enforced: false,
        detail: `control socket '${boundary.socketPath}' failed post-listen owner/mode verification (uid ${st.uid}, mode ${(st.mode & 0o777).toString(8)}); fail-closed`,
      };
    }
    // Parent dir re-verification (symlink + owner + mode) AFTER listen.
    const dls = ops.lstatSync(dir);
    if ((dls.mode & S_IFMT) === S_IFLNK) {
      return { enforced: false, detail: `control-socket dir '${dir}' became a symlink before listen; fail-closed` };
    }
    const dst = ops.statSync(dir);
    if (dst.uid !== ownerUid || (dst.mode & GROUP_OTHER_BITS) !== 0) {
      return {
        enforced: false,
        detail: `control-socket dir '${dir}' failed post-listen owner/mode re-verification (uid ${dst.uid}, mode ${(dst.mode & 0o777).toString(8)}); fail-closed`,
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
