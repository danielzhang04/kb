/**
 * D3.6 (Option B) — the platform-selecting control-transport factory.
 *
 * The Broker's control channel is authenticated identically on every platform (peer credential AND
 * per-boot token, via the pure `authenticateConnection` core in broker/socket.ts), but the TRANSPORT and
 * the peer-credential MECHANISM differ by OS:
 *
 *   • POSIX  → a `net.Server` unix-domain socket whose same-user identity is enforced by an OS 0700
 *              owner-only parent dir (broker/peerBoundary.ts). `createSecureControlSocket` wires it.
 *   • win32  → a native koffi-managed named-pipe server (broker/win32PipeServer.ts) that performs a REAL
 *              per-connection SID check by IMPERSONATING the client (TOCTOU-free) vs the daemon's own SID,
 *              plus an owner-only pipe DACL (defense-in-depth), because Node's `net` API does not expose
 *              the server pipe handle needed to read the peer.
 *
 * `ControlTransport` is the common lifecycle both expose to the daemon boot (broker/index.ts): `listen()`
 * (throws on a hard bind failure — e.g. a squatted win32 pipe name — so boot fails closed) and `close()`.
 */
import type { Server } from 'node:net';
import { createSecureControlSocket } from './socket.ts';
import type { ControlRequest, SocketAuthContext } from './socket.ts';
import { establishOwnerBoundary, secureSocketFile } from './peerBoundary.ts';
import { createWin32PipeServer } from './win32PipeServer.ts';
import { loadWin32Api } from './win32Api.ts';
import type { SessionOwner } from './index.ts';

/** The OS-agnostic lifecycle the daemon boot drives. `listen()` REJECTS on a hard bind failure so the
 *  boot fails closed; `close()` is best-effort teardown (idempotent). */
export interface ControlTransport {
  listen(): Promise<void>;
  close(): Promise<void>;
}

/** What the factory needs. `socketPath` is a filesystem path on POSIX and a `\\.\pipe\…` name on win32.
 *  `auth.expectedOwnerId` MUST already be the daemon's own identity (uid on POSIX, SID on win32 — via
 *  `resolveExpectedOwnerId`). */
export interface ControlTransportDeps {
  socketPath: string;
  auth: SocketAuthContext;
  owner: SessionOwner;
  dispatch: (owner: SessionOwner, req: ControlRequest) => unknown;
  /** Injected so a test can force either branch; defaults to the real platform. */
  platform?: NodeJS.Platform;
  /** Optional diagnostic sink (win32 rejected connections). MUST NOT log tokens. */
  onError?: (err: unknown) => void;
}

/** POSIX transport: establish the 0700 owner boundary, wire the secure `net.Server`, and on `listen`
 *  tighten + re-verify the socket. A post-listen boundary downgrade is treated as fatal (fail closed). */
function createPosixTransport(deps: ControlTransportDeps): ControlTransport {
  const boundary = establishOwnerBoundary({ socketPath: deps.socketPath });
  const server: Server = createSecureControlSocket({
    socketPath: deps.socketPath,
    owner: deps.owner,
    auth: deps.auth,
    dispatch: deps.dispatch,
    boundary,
  });
  return {
    listen: () =>
      new Promise<void>((resolve, reject) => {
        const onErr = (err: unknown): void => reject(err);
        server.once('error', onErr);
        server.listen(deps.socketPath, () => {
          server.removeListener('error', onErr);
          // Post-listen hardening; if an enforced boundary downgrades here, the socket is compromised.
          if (boundary.enforced && !secureSocketFile(boundary).enforced) {
            server.close();
            reject(new Error('control socket failed post-listen owner/mode verification; fail-closed'));
            return;
          }
          resolve();
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** win32 transport: the native koffi pipe server (real per-connection SID check). The same `Win32Api`
 *  instance provides both the pipe transport and the peer-credential FFI. */
function createWin32Transport(deps: ControlTransportDeps): ControlTransport {
  const api = loadWin32Api();
  return createWin32PipeServer({
    pipeName: deps.socketPath,
    transport: api,
    peerFfi: api,
    auth: deps.auth,
    owner: deps.owner,
    dispatch: deps.dispatch,
    onError: deps.onError,
  });
}

/** Build the control transport for this platform: win32 → native pipe server; POSIX → net.Server socket. */
export function createControlTransport(deps: ControlTransportDeps): ControlTransport {
  const platform = deps.platform ?? process.platform;
  return platform === 'win32' ? createWin32Transport(deps) : createPosixTransport(deps);
}
