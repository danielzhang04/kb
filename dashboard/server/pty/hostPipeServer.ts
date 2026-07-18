/**
 * D3.1e — the CROSS-IDENTITY PTY-host pipe SERVER orchestration.
 *
 * Structural analogue of the Broker's `broker/win32PipeServer.ts`, but with two deliberate differences the
 * cross-user model forces:
 *   1. AUTH INVERSION — the Broker authorizes the peer SID == its OWN SID (same-user). Here the pipe is
 *      OWNED by kb-fleet but the sole legitimate client is Daniel, so the authorized peer is a DIFFERENT
 *      SID (`expectedPeerSid` = <DANIEL_SID> from `peer.sid`), fed to the SAME reused pure auth core via
 *      `authenticateCrossUserConnection`. Factor A (peer SID) is read TOCTOU-free by IMPERSONATION after
 *      ≥1 byte has been read (the first `open` frame); Factor B (per-boot token) rides in that frame.
 *   2. PERSISTENT STREAMING — the Broker is one-shot request/response. Here, after both factors pass, the
 *      connection STAYS OPEN and `runHostSession` multiplexes PTY IO for the terminal's whole life.
 *
 * The instance model (always one accepting instance; a replacement is spawned the moment a client connects;
 * FIRST_PIPE_INSTANCE squat-defense on the first; F5 onFatal if no listener could remain) is copied from
 * the Broker verbatim in spirit. The native pipe/peer FFI is INJECTED (`PtyPipeTransport` / `PtyPeerFfi`),
 * so this orchestration — including the auth reject paths — is tested hermetically without koffi; the real
 * surface is `win32PtyApi.ts`, integration-tested on a real box.
 */
import { randomBytes } from 'node:crypto';
import { parseSidString } from '../../../broker/win32Sid.ts';
import type { PeerCredential } from '../../../broker/socket.ts';
import { authenticateCrossUserConnection } from './crossUserAuth.ts';
import { runHostSession } from './hostPtySession.ts';
import { openRequestFromFrame } from './hostPtySession.ts';
import { buildPtyChallenge } from './ptyChallenge.ts';
import type { PtyAssertion, PtyServerChannel } from './ptyProtocol.ts';
import type { PtyHost } from './host.ts';

/**
 * Factor C verifier: HOST-side WebAuthn assertion check over the fresh nonce THIS connection issued.
 * Injected so the orchestration (incl. every fail-closed path) is tested hermetically without a real
 * `py` subprocess; production wires the subprocess-driven verifier (`ptyAssertionVerify.ts`). Must be
 * total — a throw is treated as a rejection by the caller (fail-closed).
 */
export type PtyAssertionVerifier = (input: { expectedChallenge: string; assertion: PtyAssertion }) => {
  ok: boolean;
  reason: string;
};

/** Read a candidate `PtyAssertion` off the raw inbound `open` frame, or null if any field is missing /
 *  not a string (→ Factor C fails closed; no partial assertion ever reaches the verifier). */
function assertionFromFrame(frame: Record<string, unknown>): PtyAssertion | null {
  const a = frame.assertion;
  if (a === null || typeof a !== 'object') return null;
  const { credentialId, authenticatorData, clientDataJSON, signature } = a as Record<string, unknown>;
  if (
    typeof credentialId !== 'string' ||
    typeof authenticatorData !== 'string' ||
    typeof clientDataJSON !== 'string' ||
    typeof signature !== 'string'
  ) {
    return null;
  }
  return { credentialId, authenticatorData, clientDataJSON, signature };
}

/** An opaque per-instance pipe handle (a koffi connection object in production; any token in tests). */
export type PipeHandle = unknown;

/** The peer-identity FFI surface (TOCTOU-free impersonation read). Each method returns null on ANY failure
 *  (fail closed); a throw is caught upstream and also treated as null. Mirrors the Broker's `Win32PeerFfi`. */
export interface PtyPeerFfi {
  /** ImpersonateNamedPipeClient → OpenThreadToken → GetTokenInformation(TokenUser) → raw SID bytes, or
   *  null on ANY failure. TOCTOU-free (reads the token bound to THIS connection at check time). */
  getClientSidBytes(handle: PipeHandle): Uint8Array | null;
  /** GetNamedPipeClientProcessId → the client PID. INFORMATIONAL ONLY (audit) — never the auth decision. */
  getClientPid(handle: PipeHandle): number | null;
}

/** The pipe TRANSPORT FFI surface. `createPipe`'s security descriptor is already bound to {ownerSid,peerSid}
 *  by the factory that produced this transport (win32PtyApi `makeHostTransport`). */
export interface PtyPipeTransport {
  /** CreateNamedPipeW with the cross-user SDDL + Medium-label read-back verify. `firstInstance` adds
   *  FILE_FLAG_FIRST_PIPE_INSTANCE (squat defense). Returns the handle, or null on ANY failure (fail closed —
   *  never a default DACL). */
  createPipe(name: string, firstInstance: boolean): PipeHandle | null;
  /** Async ConnectNamedPipe: resolves when a client connects; rejects on error. */
  accept(handle: PipeHandle): Promise<void>;
  /** Wrap a connected handle as an async duplex frame channel (persistent streaming). */
  channel(handle: PipeHandle): PtyServerChannel;
  /** Cancel IO + DisconnectNamedPipe + CloseHandle — idempotent, never throws. */
  closeConnection(handle: PipeHandle): void;
}

/** Resolve the connecting peer's SID (+ informational pid), or null on ANY failure (→ connection rejected).
 *  Wraps the whole chain so a throw anywhere (incl. a malformed SID that makes `parseSidString` throw) →
 *  null. Byte-for-byte the Broker's `resolveClientCredential`. */
export function resolveClientCredential(handle: PipeHandle, ffi: PtyPeerFfi): PeerCredential | null {
  try {
    const bytes = ffi.getClientSidBytes(handle);
    if (!bytes) return null;
    const ownerId = parseSidString(bytes);
    const pid = ffi.getClientPid(handle) ?? undefined;
    return { ownerId, pid };
  } catch {
    return null;
  }
}

export interface HostPipeServerDeps {
  pipeName: string;
  /** The one authorized peer SID (Daniel), resolved from `peer.sid`. NOT the host's own SID. */
  expectedPeerSid: string;
  /** This host-boot's per-boot token (Factor B). */
  bootToken: string;
  transport: PtyPipeTransport;
  peerFfi: PtyPeerFfi;
  /** The reused PTY host (`createPtyHost`) that actually spawns node-pty. */
  host: PtyHost;
  /** Factor C (D3.1 MED mitigation): host-side WebAuthn assertion verifier over this connection's nonce. */
  verifyAssertion: PtyAssertionVerifier;
  /** Fresh per-connection 256-bit nonce source. Default: `randomBytes(32)`. Injected for deterministic
   *  tests (e.g. replay: two connections whose nonces are made to differ). */
  mintNonce?: () => Uint8Array;
  /** Per-open preamble re-check (assertFleetRunnable) — forwarded to each session. */
  isRunnable: () => boolean;
  /** Defaults for an `open` frame missing/with-invalid geometry or cwd. */
  openDefaults: { cwd: string; cols: number; rows: number };
  /** How long a connected client has to send its first (`open`) frame before it is dropped (slow-loris). */
  requestTimeoutMs?: number;
  onError?: (err: unknown) => void;
  /** Invoked when no accepting instance can be respawned (F5). Default: process.exit(71). */
  onFatal?: () => void;
}

export interface HostPipeServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Build the cross-user PTY pipe server. `listen()` creates the first (FIRST_PIPE_INSTANCE) instance and
 * starts accepting; it REJECTS if that instance cannot be created (name squatted / access denied) so the
 * host boot fails closed. `close()` tears down every live instance.
 */
export function createHostPipeServer(deps: HostPipeServerDeps): HostPipeServer {
  const { pipeName, transport, peerFfi, expectedPeerSid, bootToken, host, verifyAssertion, isRunnable, openDefaults } = deps;
  const mintNonce = deps.mintNonce ?? ((): Uint8Array => randomBytes(32));
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const onFatal = deps.onFatal ?? ((): void => process.exit(71));
  const live = new Set<PipeHandle>();
  const inflight = new Set<Promise<void>>();
  let closed = false;

  const report = (err: unknown): void => {
    try {
      deps.onError?.(err);
    } catch {
      /* a logging sink must never take down the host */
    }
  };

  function track(p: Promise<void>): void {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }

  /** Handle ONE connected client: read + authenticate the first `open` frame (BOTH cross-user factors),
   *  then hand the persistent channel to the streaming multiplexer. Any throw is contained (fail-closed). */
  async function handleConnection(handle: PipeHandle): Promise<void> {
    const rawChannel = transport.channel(handle);
    // FIX 4 — the handle was only removed from `live` on the error paths, so a session that completed normally
    // leaked its handle (unbounded growth). Wrap `close()` so EVERY teardown path (auth reject, no-open-frame,
    // PTY exit, `stop`, channel EOF — all of which route through channel.close()) also drops it from `live`.
    let removed = false;
    const channel: PtyServerChannel = {
      ...rawChannel,
      close: () => {
        if (!removed) {
          removed = true;
          live.delete(handle);
        }
        rawChannel.close();
      },
    };
    // D3.1 MED mitigation — issue a FRESH 256-bit nonce for THIS connection, held in a per-connection
    // closure variable (never a shared/global map), so it is single-use by construction and dies with the
    // connection. Assemble the exact WebAuthn challenge string and send it BEFORE the client's `open`.
    // Ordering safety: this host WRITE does not satisfy Factor A's "client wrote first" precondition — the
    // client's `open` frame is still that write, and the peer-SID read still happens after nextFrame returns.
    const expectedChallenge = buildPtyChallenge(mintNonce());
    channel.sendFrame({ type: 'challenge', challenge: expectedChallenge });

    const first = await channel.nextFrame(requestTimeoutMs);
    if (!first || first.type !== 'open') {
      channel.close();
      return; // no open frame in time (or EOF) → drop
    }

    // Factor A — TOCTOU-free peer SID via impersonation (only valid AFTER the client has written, which
    // nextFrame guaranteed). Fail-closed: null on any failure → authenticateCrossUserConnection rejects.
    const peerCred = resolveClientCredential(handle, peerFfi);
    const token = typeof first.token === 'string' ? first.token : null;
    const authResult = authenticateCrossUserConnection({ peerCred, token }, { expectedPeerSid, bootToken });
    if (!authResult.ok) {
      channel.sendFrame({ type: 'open-nack', error: `unauthenticated: ${authResult.reason}` });
      channel.close();
      return;
    }

    // Factor C — host-side WebAuthn assertion over THIS connection's nonce. A strict ADDITIONAL conjunct:
    // A ∧ B already passed; C must also hold or NOTHING spawns. A missing/malformed assertion, a verifier
    // throw, or a rejection all fail closed (open-nack + close, no PTY). This is the crux of the MED fix —
    // the assertion is checked HERE (in the kb-fleet host), so bypassing the daemon does not bypass C.
    const assertion = assertionFromFrame(first);
    if (!assertion) {
      channel.sendFrame({ type: 'open-nack', error: 'unauthenticated: assertion-missing' });
      channel.close();
      return;
    }
    let cResult: { ok: boolean; reason: string };
    try {
      cResult = verifyAssertion({ expectedChallenge, assertion });
    } catch (err) {
      report(err);
      cResult = { ok: false, reason: 'verifier-error' };
    }
    if (!cResult.ok) {
      channel.sendFrame({ type: 'open-nack', error: `unauthenticated: assertion:${cResult.reason}` });
      channel.close();
      return;
    }

    // All THREE factors passed — run the persistent PTY session (per-open STOP re-check happens inside).
    const openReq = openRequestFromFrame(first, openDefaults);
    runHostSession(channel, openReq, { host, isRunnable });
  }

  async function serve(handle: PipeHandle): Promise<void> {
    try {
      await transport.accept(handle);
    } catch (err) {
      if (!closed) report(err);
      live.delete(handle);
      transport.closeConnection(handle);
      return;
    }
    // A client connected — put a fresh instance into accept BEFORE handling (concurrency). F5: if the
    // replacement can't be created, no listener would remain → onFatal (default exit 71) for a clean restart.
    if (!closed && !spawnInstance(false)) {
      report(new Error('replacement PTY pipe instance could not be created; no listener remains — requesting restart'));
      onFatal();
    }
    try {
      await handleConnection(handle);
    } catch (err) {
      report(err); // never let an async throw escape → never crash the host
      live.delete(handle);
      transport.closeConnection(handle);
    }
  }

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
      if (closed) return Promise.reject(new Error('PTY pipe server already closed'));
      if (!spawnInstance(true)) {
        return Promise.reject(
          new Error(`failed to create first PTY pipe instance for ${pipeName} (name squatted or access denied); fail-closed`),
        );
      }
      return Promise.resolve();
    },
    async close(): Promise<void> {
      closed = true;
      for (const handle of live) {
        try {
          transport.closeConnection(handle);
        } catch {
          /* best-effort teardown */
        }
      }
      live.clear();
      await Promise.all([...inflight]);
    },
  };
}
