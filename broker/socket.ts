/**
 * D3.3 — the Broker's authenticated localhost control socket.
 *
 * THREAT (plan §D3.3, ordering-law 7): the socket exposes verbs that can inject into a sibling agent's
 * in-flight turn (`steer`) or kill it (`stop`). An unauthenticated socket would therefore grant
 * genuinely NEW lateral-movement capability. So every connection must clear BOTH of two independent
 * checks — either one failing rejects the connection:
 *
 *   1. PEER CREDENTIAL — the connecting process must belong to the SAME OS owner as the daemon. On a
 *      UNIX domain socket this is `SO_PEERCRED` (peer uid); on a Windows named pipe it is the peer PID
 *      resolved to its owning account. Both are normalised to a string `ownerId`, compared against the
 *      daemon's own `expectedOwnerId`. This binds the socket to the local user — a different local
 *      account (or a sandboxed process dropped to another uid) cannot connect even with a valid token.
 *   2. PER-BOOT TOKEN — a fresh 256-bit random token minted at each daemon boot and issued to the
 *      dispatcher/dashboard out of band. Compared in constant time. This binds the socket to a client
 *      that was actually handed this boot's token — a same-user process that never received the token
 *      (e.g. a compromised unrelated tool running as the user) still cannot connect.
 *
 * Requiring BOTH means neither a stolen token (wrong peer) nor a same-user-but-unbriefed process
 * (right peer, no token) is sufficient. `authenticateConnection` is the pure, exhaustively-tested core;
 * the `net.Server` wiring below calls it per connection.
 *
 * FAIL-CLOSED DEFAULT (flagged for the D3.6 threat review): Node does not expose `SO_PEERCRED` /
 * named-pipe peer identity through its standard `net` API. `defaultPeerReader` therefore returns
 * `null` (→ every connection is rejected on the peer check) until a concrete platform reader is
 * injected at deploy time. Rejecting-by-default is the safe posture; wiring the real peer read is
 * explicitly part of the human security review, NOT silently stubbed to "allow".
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { SessionOwner } from './index.ts';
import { ownerBoundedReader } from './peerBoundary.ts';
import type { OwnerBoundary } from './peerBoundary.ts';

/** A resolved peer identity. `ownerId` is the OS owner normalised to a string (uid on POSIX, resolved
 *  account on Windows). `pid` is informational (audit/debug), never the auth decision on its own. */
export interface PeerCredential {
  ownerId: string;
  pid?: number;
}

/** Resolves the peer identity of a live connection. Injected — the default is fail-closed (see doc). */
export type PeerCredentialReader = (conn: Socket) => PeerCredential | null;

/** Fail-closed default: no standard Node API exposes peer credentials, so reject until a real reader is
 *  wired. The concrete reader is `ownerBoundedReader` (broker/peerBoundary.ts, D3.6), selected via
 *  `createSecureControlSocket`; this default remains the reject-all fallback when none is injected and is
 *  what a not-enforced boundary collapses to. Never returns a permissive credential. */
export const defaultPeerReader: PeerCredentialReader = () => null;

/** Injectable inputs to `resolveExpectedOwnerId` (platform + the win32 SID source), so the boot can supply
 *  the native SID resolver and tests can exercise every branch hermetically. */
export interface ExpectedOwnerIdDeps {
  platform?: NodeJS.Platform;
  getuid?: (() => number) | undefined;
  /** On win32, resolves the daemon's OWN SID string (from its process token). Injected by the boot from
   *  broker/win32Api.ts (`currentSidString`). socket.ts stays free of the native FFI, so there is NO pure
   *  default — an un-provided win32 resolve throws (fail closed) rather than falling back to a weaker id. */
  win32SidProvider?: () => string | null;
}

/**
 * The daemon's own OS owner id, for SID/uid-vs-peer comparison in `authenticateConnection`.
 *   • POSIX  → the numeric uid (`getuid()`), matching `peerBoundary.ts`'s `ownerId`.
 *   • win32  → the daemon's own SID string via the injected `win32SidProvider` (the SAME token query the
 *     per-connection peer read uses in broker/win32PipeServer.ts), so the comparison is SID-vs-SID end to
 *     end. This REPLACES the old `USERNAME` heuristic. If no SID can be resolved, this THROWS — the boot
 *     must fail closed rather than run with an unverifiable daemon identity.
 */
export function resolveExpectedOwnerId(
  env: Record<string, string | undefined> = process.env,
  deps: ExpectedOwnerIdDeps = {},
): string {
  const getuid = 'getuid' in deps ? deps.getuid : (process as NodeJS.Process & { getuid?: () => number }).getuid?.bind(process);
  if (typeof getuid === 'function') return String(getuid());
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    const sid = deps.win32SidProvider?.() ?? null;
    if (!sid) throw new Error('daemon SID unavailable on win32 (no SID provider); fail-closed');
    return sid;
  }
  return env.USERNAME ?? env.USER ?? 'unknown-owner';
}

/** Mint this boot's control-socket token: 256 bits of CSPRNG randomness, hex. Never persisted to disk;
 *  issued to the dispatcher/dashboard out of band and held only in the daemon's memory for its lifetime. */
export function mintBootToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time string compare that never short-circuits on length. */
function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SocketAuthContext {
  /** The daemon's own OS owner id (from `resolveExpectedOwnerId`). */
  expectedOwnerId: string;
  /** This boot's token (from `mintBootToken`). */
  bootToken: string;
}

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'peer-credential'; detail: string }
  | { ok: false; reason: 'bad-token'; detail: string };

/**
 * The pure auth core: a connection is accepted ONLY when its peer credential matches the daemon owner
 * AND its presented token matches this boot's token. Either check failing rejects. The peer check is
 * evaluated first so a wrong-owner connection is refused before any token comparison, but BOTH must
 * hold to accept — there is no path that accepts on one alone.
 */
export function authenticateConnection(
  presented: { peerCred: PeerCredential | null; token: string | null | undefined },
  ctx: SocketAuthContext,
): AuthResult {
  // 1. Peer credential — must be present AND match the daemon's own owner.
  if (!presented.peerCred) {
    return { ok: false, reason: 'peer-credential', detail: 'no peer credential could be resolved (fail-closed)' };
  }
  if (presented.peerCred.ownerId !== ctx.expectedOwnerId) {
    return {
      ok: false,
      reason: 'peer-credential',
      detail: `peer owner '${presented.peerCred.ownerId}' != daemon owner '${ctx.expectedOwnerId}'`,
    };
  }
  // 2. Per-boot token — must be present AND match in constant time.
  if (!presented.token) {
    return { ok: false, reason: 'bad-token', detail: 'no per-boot token supplied' };
  }
  if (!safeStringEqual(presented.token, ctx.bootToken)) {
    return { ok: false, reason: 'bad-token', detail: 'per-boot token mismatch' };
  }
  return { ok: true };
}

/** One control-socket request line: a verb name plus its JSON args, and the presented token. */
export interface ControlRequest {
  token?: string;
  verb: string;
  args?: Record<string, unknown>;
}

/** Injectable dependencies for the `net.Server` wiring. */
export interface ControlSocketDeps {
  socketPath: string;
  owner: SessionOwner;
  auth: SocketAuthContext;
  peerReader?: PeerCredentialReader;
  /** Dispatches an authenticated verb to `broker/verbs.ts`. Injected so this module stays verb-agnostic. */
  dispatch: (owner: SessionOwner, req: ControlRequest) => unknown;
}

/**
 * Create (but do not yet `listen`) the localhost control `net.Server`. Every connection's first line is
 * a JSON `ControlRequest`; the connection is authenticated by peer credential AND token before the verb
 * is ever dispatched. An auth failure writes a JSON error and destroys the socket — the verb layer is
 * never reached. This wiring is deliberately thin; the security-load-bearing logic is in
 * `authenticateConnection` (pure, tested).
 */
export function createControlSocket(deps: ControlSocketDeps): Server {
  const peerReader = deps.peerReader ?? defaultPeerReader;
  const server = createServer((conn: Socket) => {
    let buf = '';
    conn.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return; // wait for a full request line
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      let req: ControlRequest;
      try {
        req = JSON.parse(line) as ControlRequest;
      } catch {
        conn.end(JSON.stringify({ ok: false, error: 'malformed request line' }) + '\n');
        return;
      }

      // LOW-1: the peer read is injected platform code (a real reader may stat the fs or, in a future
      // native variant, call into the OS). A throw here must be treated as an UNRESOLVED credential
      // (→ null → reject), never propagate as an uncaught exception out of this 'data' handler where it
      // would crash the daemon. Fail-closed on throw is at least as strict as the null default.
      let peerCred: PeerCredential | null = null;
      try {
        peerCred = peerReader(conn);
      } catch {
        peerCred = null;
      }

      const auth = authenticateConnection(
        { peerCred, token: req.token },
        deps.auth,
      );
      if (!auth.ok) {
        // Never echo the token or the reason detail's sensitive parts back verbatim beyond the category.
        conn.end(JSON.stringify({ ok: false, error: `unauthenticated: ${auth.reason}` }) + '\n');
        return;
      }

      let result: unknown;
      try {
        result = deps.dispatch(deps.owner, req);
      } catch (err) {
        result = { ok: false, error: (err as Error).message };
      }
      conn.end(JSON.stringify(result) + '\n');
    });
  });
  return server;
}

/** Deps for `createSecureControlSocket`: the control-socket wiring minus `peerReader` (derived from the
 *  boundary) plus the established OS-owner boundary. */
export interface SecureControlSocketDeps {
  socketPath: string;
  owner: SessionOwner;
  auth: SocketAuthContext;
  dispatch: (owner: SessionOwner, req: ControlRequest) => unknown;
  /** The result of `establishOwnerBoundary(socketPath)` (broker/peerBoundary.ts). Its `enforced` flag
   *  selects the peer reader: enforced → the daemon-owner reader; not enforced → the fail-closed default. */
  boundary: OwnerBoundary;
}

/**
 * Compose the control socket with the concrete, boundary-derived peer reader. The caller's flow is:
 *   1. `const boundary = establishOwnerBoundary({ socketPath })`  — apply + verify the OS restriction.
 *   2. `const server = createSecureControlSocket({ ..., boundary })`.
 *   3. `server.listen(socketPath)`; then `secureSocketFile(boundary)` to tighten the socket inode.
 * When the boundary is NOT enforced (win32, permission failure, …) the reader is fail-closed, so the
 * socket rejects every connection on the peer check — never a permissive fallback.
 */
export function createSecureControlSocket(deps: SecureControlSocketDeps): Server {
  return createControlSocket({
    socketPath: deps.socketPath,
    owner: deps.owner,
    auth: deps.auth,
    dispatch: deps.dispatch,
    peerReader: ownerBoundedReader(deps.boundary),
  });
}
