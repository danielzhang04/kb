/**
 * D3.6 (Option B) — the Windows control transport: a daemon-owned named-pipe server with a REAL
 * per-connection peer-credential (SID) check.
 *
 * WHY THIS EXISTS (see also broker/controlTransport.ts): Node's `net` API does not expose the OS HANDLE
 * of a server-side named-pipe connection (`conn._handle.fd === -1` on Windows; only a v8 External to
 * StreamBase is present — dereferencing it would be an ABI guess, forbidden by the fail-closed rule).
 * `GetNamedPipeClientProcessId` REQUIRES that server handle. So on win32 we do not use `net.Server` at
 * all: this module creates and owns the pipe via koffi (`CreateNamedPipeW`), which gives us the handle,
 * and reads the connecting peer's SID per connection. The daemon-owns-the-handle model is the ONLY way
 * to obtain a sound Windows peer check (Daniel's Option B).
 *
 * ── INSTANCE MODEL (concurrency) ────────────────────────────────────────────────────────────────────
 * A named pipe SERVER is a set of INSTANCES sharing one name. Each instance handles exactly one client
 * at a time. We keep exactly one instance in the "listening" (accepting) state at all times: the moment
 * an instance's `ConnectNamedPipe` completes (a client arrived), we immediately create a REPLACEMENT
 * instance and put IT into accept, then handle the just-connected client on the original instance. So N
 * concurrent clients are served by N instances. The FIRST instance is created with
 * FILE_FLAG_FIRST_PIPE_INSTANCE (if the name already exists, creation fails → squatting defense → the
 * boot fails closed); replacements are created without it.
 *
 * ── FAIL-CLOSED / NEVER-CRASH ───────────────────────────────────────────────────────────────────────
 * Every per-connection step is wrapped so ANY throw (a koffi marshalling error, a peer-read failure, a
 * malformed request) results in the connection being rejected/closed — never an uncaught exception out
 * of an async callback that would crash the daemon (review invariant LOW-1). The peer SID is resolved
 * fail-closed: any failure at GetNamedPipeClientProcessId / OpenProcess / OpenProcessToken /
 * GetTokenInformation / SID-parse yields `null`, which `authenticateConnection` rejects. The auth
 * decision reuses the SAME pure `authenticateConnection` core as the POSIX socket — auth logic is never
 * forked. Every handle is closed on every path (DisconnectNamedPipe + CloseHandle).
 */
import { authenticateConnection } from './socket.ts';
import type { ControlRequest, PeerCredential, SocketAuthContext } from './socket.ts';
import type { SessionOwner } from './index.ts';
import type { ControlTransport } from './controlTransport.ts';
import { parseSidString } from './win32Sid.ts';

/** An opaque per-instance pipe handle (a koffi `void *` in production; any token in tests). */
export type PipeHandle = unknown;

/** The low-level peer-identity FFI surface — injected so the SID-resolution fail paths are hermetically
 *  testable without koffi. Each method returns `null` on ANY failure (fail closed); it never throws for
 *  an expected OS error (a throw is still caught upstream and treated as null). */
export interface Win32PeerFfi {
  /** GetNamedPipeClientProcessId(handle) → the connected client's PID, or null on failure. */
  getClientPid(handle: PipeHandle): number | null;
  /** OpenProcess(QUERY_LIMITED)+OpenProcessToken(QUERY)+GetTokenInformation(TokenUser) → the raw SID
   *  bytes for `pid`, or null on failure. The bytes are parsed by `parseSidString` (crash-proof). */
  getProcessSidBytes(pid: number): Uint8Array | null;
}

/** The pipe TRANSPORT FFI surface — create/accept/read/write/flush/close. Injected for hermetic tests. */
export interface Win32PipeTransport {
  /** CreateNamedPipeW with an owner-only security descriptor. `firstInstance` adds
   *  FILE_FLAG_FIRST_PIPE_INSTANCE (squat defense). Returns the handle, or null on failure. */
  createPipe(name: string, firstInstance: boolean): PipeHandle | null;
  /** Async ConnectNamedPipe: resolves when a client connects; rejects on error. Runs on the libuv
   *  threadpool so the MAIN event loop is never blocked while waiting for a client. */
  accept(handle: PipeHandle): Promise<void>;
  /** Async read up to and including the first newline; resolves the request line WITHOUT the trailing
   *  newline, or `null` on EOF/error. */
  readLine(handle: PipeHandle): Promise<string | null>;
  /** Write a full response string; returns false on any failure (never throws). */
  write(handle: PipeHandle, data: string): boolean;
  /** Async FlushFileBuffers (waits for the client to drain the response); never rejects (best-effort). */
  flush(handle: PipeHandle): Promise<void>;
  /** DisconnectNamedPipe + CloseHandle — idempotent, never throws. */
  closeConnection(handle: PipeHandle): void;
}

/** Resolve the connecting peer's SID (+pid), or `null` on ANY failure (→ connection rejected). Wraps the
 *  whole chain so a throw anywhere (incl. a malformed SID that makes `parseSidString` throw) → null. */
export function resolveClientCredential(handle: PipeHandle, ffi: Win32PeerFfi): PeerCredential | null {
  try {
    const pid = ffi.getClientPid(handle);
    if (pid == null) return null;
    const bytes = ffi.getProcessSidBytes(pid);
    if (!bytes) return null;
    const ownerId = parseSidString(bytes); // may throw on malformed bytes → caught below → null
    return { ownerId, pid };
  } catch {
    return null;
  }
}

/** Everything `createWin32PipeServer` needs. `auth.expectedOwnerId` MUST be the daemon's OWN SID string
 *  (from broker/socket.ts `resolveExpectedOwnerId` on win32) so the compare is SID-vs-SID. */
export interface Win32PipeServerDeps {
  pipeName: string;
  transport: Win32PipeTransport;
  peerFfi: Win32PeerFfi;
  auth: SocketAuthContext;
  owner: SessionOwner;
  dispatch: (owner: SessionOwner, req: ControlRequest) => unknown;
  /** Optional diagnostic sink for rejected/failed connections. MUST NOT be used to log tokens. */
  onError?: (err: unknown) => void;
}

/**
 * Build the win32 control transport. `listen()` creates the first (FIRST_PIPE_INSTANCE) pipe instance and
 * starts the accept loop; it REJECTS if that instance cannot be created (name squatted / access denied)
 * so the daemon boot fails closed. `close()` stops accepting and tears down outstanding instances.
 */
export function createWin32PipeServer(deps: Win32PipeServerDeps): ControlTransport {
  const { pipeName, transport, peerFfi, auth, owner, dispatch, onError } = deps;
  const live = new Set<PipeHandle>();
  const inflight = new Set<Promise<void>>();
  let closed = false;

  /** Track a serve() loop so `close()` can await its unwind (deterministic teardown between callers/tests). */
  function track(p: Promise<void>): void {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }

  const report = (err: unknown): void => {
    try {
      onError?.(err);
    } catch {
      /* a logging sink must never take down the daemon */
    }
  };

  async function flushSafe(handle: PipeHandle): Promise<void> {
    try {
      await transport.flush(handle);
    } catch {
      /* best-effort */
    }
  }

  /** Handle ONE connected client on `handle`: mirror the POSIX socket's newline-JSON protocol byte for
   *  byte (same error strings), authenticate via the shared pure core, dispatch, respond, flush. */
  async function handleConnection(handle: PipeHandle): Promise<void> {
    const line = await transport.readLine(handle);
    if (line === null) return; // EOF / read error → nothing to answer; caller closes the handle

    let req: ControlRequest;
    try {
      req = JSON.parse(line) as ControlRequest;
    } catch {
      transport.write(handle, JSON.stringify({ ok: false, error: 'malformed request line' }) + '\n');
      await flushSafe(handle);
      return;
    }

    // Peer SID is resolved fail-closed (null on any failure). LOW-1: resolveClientCredential never throws.
    const peerCred = resolveClientCredential(handle, peerFfi);
    const authResult = authenticateConnection({ peerCred, token: req.token }, auth);
    if (!authResult.ok) {
      transport.write(handle, JSON.stringify({ ok: false, error: `unauthenticated: ${authResult.reason}` }) + '\n');
      await flushSafe(handle);
      return;
    }

    let result: unknown;
    try {
      result = dispatch(owner, req);
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }
    transport.write(handle, JSON.stringify(result) + '\n');
    await flushSafe(handle);
  }

  /** Accept on `handle`, spin up a replacement instance so the next client can connect concurrently, then
   *  serve this one. Any throw is contained (fail-closed); the handle is always closed. */
  async function serve(handle: PipeHandle): Promise<void> {
    try {
      await transport.accept(handle);
    } catch (err) {
      // An accept that fails because we're shutting down (the instance handle was closed by `close()`) is
      // expected teardown, not an error worth reporting.
      if (!closed) report(err);
      live.delete(handle);
      transport.closeConnection(handle);
      return;
    }
    // A client connected. Put a fresh instance into accept BEFORE handling, so concurrent clients work.
    if (!closed) spawnInstance(false);
    try {
      await handleConnection(handle);
    } catch (err) {
      report(err); // never let an async throw escape → never crash the daemon (LOW-1)
    } finally {
      live.delete(handle);
      transport.closeConnection(handle);
    }
  }

  /** Create one more accepting instance. Returns false if creation failed (caller decides if fatal). */
  function spawnInstance(firstInstance: boolean): boolean {
    if (closed) return false;
    const handle = transport.createPipe(pipeName, firstInstance);
    if (handle == null) {
      report(new Error(`CreateNamedPipe failed (firstInstance=${firstInstance}) for ${pipeName}`));
      return false;
    }
    live.add(handle);
    track(serve(handle));
    return true;
  }

  return {
    listen(): Promise<void> {
      if (closed) return Promise.reject(new Error('pipe server already closed'));
      // First instance uses FILE_FLAG_FIRST_PIPE_INSTANCE — if the name is already taken (a squatter),
      // creation fails and boot fails closed rather than binding a pipe an attacker pre-created.
      if (!spawnInstance(true)) {
        return Promise.reject(
          new Error(`failed to create first pipe instance for ${pipeName} (name squatted or access denied); fail-closed`),
        );
      }
      return Promise.resolve();
    },
    async close(): Promise<void> {
      closed = true;
      // Closing each instance handle makes any pending accept/read/drain poll observe `closed` and unwind.
      for (const handle of live) {
        try {
          transport.closeConnection(handle);
        } catch {
          /* best-effort teardown */
        }
      }
      live.clear();
      // Await every in-flight serve() loop so teardown is deterministic (no stray async into the next caller).
      await Promise.all([...inflight]);
    },
  };
}
