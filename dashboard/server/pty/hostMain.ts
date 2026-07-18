/**
 * D3.1g — the PTY HOST process entry (the missing "main guard" the `host.ts` docstring defers to the D3.1
 * go-live gate). Registered by the human gate as a Windows scheduled task running as kb-fleet at logon
 * (scripts/register_pty_host.md). It is the ONLY component that spawns node-pty.
 *
 * BOOT GATES — all fail-closed, all BEFORE the pipe ever opens (design §6 point 2):
 *   1. PREAMBLE FIRST (ordering-law 8): `assertFleetRunnable` — a STOP-frozen / `ANTHROPIC_API_KEY`-set /
 *      over-budget fleet host does NOT even listen.
 *   2. OWN IDENTITY: resolve this process's SID and refuse unless it == the pinned kb-fleet SID. A host
 *      that is not kb-fleet must not open the cross-user pipe (it would authorize Daniel from the wrong
 *      account).
 *   3. PEER IDENTITY: resolve <DANIEL_SID> from the DACL-provenanced `peer.sid` (peerConfig) — fail closed
 *      on absent/malformed.
 *   4. MINT the per-boot token; CREATE the cross-user pipe (FIRST_PIPE_INSTANCE squat defense + Medium
 *      read-back inside the transport); WRITE+VERIFY `boot.token` (SecureTokenFileWriter allowlist).
 *
 * SERVE: one accepting instance always live; each authenticated connection runs a persistent PTY session
 * whose child env is `buildChildEnv(process.env, DEFAULT_ENV_ALLOWLIST)` (no push cred / OAuth reaches the
 * shell). A per-open `assertFleetRunnable` re-check refuses NEW terminals under STOP even between watcher
 * ticks. STOP watcher → `stopAll()` drains live shells; SIGTERM/SIGBREAK → `stopAll()` + close pipe → exit 0.
 *
 * Every seam is INJECTED (preamble runner, native API, peer fs, host factory, STOP watcher) so the whole
 * lifecycle is tested hermetically — no real koffi, node-pty, STOP file, or scheduled task.
 */
import { watch as fsWatch, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { createPtyHost, DEFAULT_ENV_ALLOWLIST } from './host.ts';
import type { PtyHost, PtyHostDeps } from './host.ts';
import { createHostPipeServer } from './hostPipeServer.ts';
import type { HostPipeServer, PtyAssertionVerifier } from './hostPipeServer.ts';
import { makePtyAssertionVerifier } from './ptyAssertionVerify.ts';
import { loadWin32PtyApi } from './win32PtyApi.ts';
import type { Win32PtyApi } from './win32PtyApi.ts';
import { resolveRendezvousDir, resolvePeerSid } from './peerConfig.ts';
import type { PeerConfigFs } from './peerConfig.ts';
import { bootTokenPath, mintHostBootToken } from './rendezvousToken.ts';
import { resolveFleetSid } from './fleetIdentity.ts';
import { DEFAULT_PTY_HOST_PIPE } from './hostClient.ts';

/** The native surface the host boot needs (subset of Win32PtyApi) — injectable for hermetic tests. */
export type PtyHostNativeApi = Pick<Win32PtyApi, 'currentSidString' | 'makeHostTransport' | 'writeAndVerify'>;

/** A minimal STOP watcher handle. */
export interface StopWatchHandle {
  close(): void;
}

export interface PtyHostBootDeps {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  runPreamble?: PreambleRunner;
  /** The native koffi surface. Default: `loadWin32PtyApi()`. */
  nativeApi?: PtyHostNativeApi;
  /** Filesystem surface for peer.sid resolution. Default: real fs. */
  peerFs?: PeerConfigFs;
  /** Rendezvous dir override (default `C:\ProgramData\kb\pty-host`). */
  rendezvousDir?: string;
  /** Pipe name override (must match the daemon's `DASHBOARD_PTY_HOST_PIPE`). */
  pipeName?: string;
  /** PTY host factory. Default: `createPtyHost` with an allowlisted child env. */
  makeHost?: (deps: PtyHostDeps) => PtyHost;
  /** Per-boot token source. Default: `mintHostBootToken` (256-bit CSPRNG). Injected for hermetic tests. */
  mintToken?: () => string;
  /** Arm the STOP watcher. Default: fs.watch on `repoRoot`. */
  startStopWatch?: (repoRoot: string, onStop: () => void) => StopWatchHandle;
  /** Factor C (D3.1 MED mitigation) host-side assertion verifier. Default: subprocess-driven
   *  `makePtyAssertionVerifier({ repoRoot })`. Injected for hermetic tests. */
  verifyAssertion?: PtyAssertionVerifier;
  onError?: (err: unknown) => void;
}

export type PtyHostBootRefusal =
  | { ok: false; reason: 'fleet-frozen'; detail: string }
  | { ok: false; reason: 'identity-mismatch'; detail: string }
  | { ok: false; reason: 'rendezvous-missing'; detail: string }
  | { ok: false; reason: 'peer-unresolved'; detail: string }
  | { ok: false; reason: 'token-write-failed'; detail: string }
  | { ok: false; reason: 'pipe-listen-failed'; detail: string };

export type PtyHostBootResult =
  | {
      ok: true;
      host: PtyHost;
      server: HostPipeServer;
      pipeName: string;
      ownSid: string;
      peerSid: string;
      /** Drain live shells, close the pipe + STOP watcher. Idempotent. Wired to SIGTERM/SIGBREAK. */
      shutdown: () => Promise<void>;
    }
  | PtyHostBootRefusal;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** Default fs.watch STOP watcher — fires `onStop` when a `STOP` entry appears in `repoRoot`. */
function defaultStartStopWatch(repoRoot: string, onStop: () => void): StopWatchHandle {
  const watcher = fsWatch(repoRoot, (_evt, filename) => {
    if (filename === 'STOP' && existsSync(join(repoRoot, 'STOP'))) onStop();
  });
  return { close: () => watcher.close() };
}

/**
 * Boot the PTY host. Returns a refusal (nothing opened) on any fail-closed gate; otherwise listens and
 * returns the live handles + a `shutdown()`. Never throws for an expected failure — only a truly
 * unexpected condition would propagate.
 */
export async function bootPtyHost(deps: PtyHostBootDeps): Promise<PtyHostBootResult> {
  const env = deps.env ?? process.env;
  const runPreamble = deps.runPreamble ?? defaultPreambleRunner;
  const api = deps.nativeApi ?? loadWin32PtyApi();
  const pipeName = deps.pipeName ?? env.DASHBOARD_PTY_HOST_PIPE?.trim() ?? DEFAULT_PTY_HOST_PIPE;

  // 1. PREAMBLE GATE FIRST — no listen under STOP / API key / over budget.
  const runnable = assertFleetRunnable(deps.repoRoot, runPreamble);
  if (!runnable.ok) {
    return { ok: false, reason: 'fleet-frozen', detail: runnable.problems.join('; ') };
  }

  // 2. OWN IDENTITY — must be kb-fleet.
  const expectedOwn = resolveFleetSid(env);
  const ownSid = api.currentSidString();
  if (!ownSid) {
    return { ok: false, reason: 'identity-mismatch', detail: 'could not resolve own SID; fail-closed' };
  }
  if (ownSid !== expectedOwn) {
    return { ok: false, reason: 'identity-mismatch', detail: `own SID '${ownSid}' != kb-fleet '${expectedOwn}'; refusing to listen` };
  }

  // 3. RENDEZVOUS DIR + PEER IDENTITY (Daniel) from the DACL-provenanced peer.sid.
  const dirRes = resolveRendezvousDir({ fs: peerFsOf(deps), dir: deps.rendezvousDir });
  if (!dirRes.ok) {
    return { ok: false, reason: 'rendezvous-missing', detail: dirRes.reason };
  }
  const peerRes = resolvePeerSid({ fs: peerFsOf(deps), dir: dirRes.dir, ownSid });
  if (!peerRes.ok) {
    return { ok: false, reason: 'peer-unresolved', detail: peerRes.reason };
  }
  const peerSid = peerRes.peerSid;

  // 4. MINT token; CREATE the cross-user pipe; LISTEN (squat defense inside).
  const bootToken = (deps.mintToken ?? mintHostBootToken)();
  const { transport, peerFfi } = api.makeHostTransport({ ownerSid: ownSid, peerSid });
  const host = (deps.makeHost ?? createPtyHost)({ parentEnv: env, envAllowlist: DEFAULT_ENV_ALLOWLIST });

  const server = createHostPipeServer({
    pipeName,
    expectedPeerSid: peerSid,
    bootToken,
    transport,
    peerFfi,
    host,
    // Factor C — host-side passkey assertion over each connection's fresh nonce (subprocess default).
    verifyAssertion: deps.verifyAssertion ?? makePtyAssertionVerifier({ repoRoot: deps.repoRoot }),
    // per-open STOP re-check — refuse NEW terminals under a frozen fleet even between watcher ticks.
    isRunnable: () => {
      try {
        return assertFleetRunnable(deps.repoRoot, runPreamble).ok;
      } catch {
        return false;
      }
    },
    openDefaults: { cwd: deps.repoRoot, cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    onError: deps.onError,
  });

  try {
    await server.listen();
  } catch (err) {
    return { ok: false, reason: 'pipe-listen-failed', detail: (err as Error).message };
  }

  // 4b. WRITE+VERIFY boot.token (kb-fleet write, Daniel read). Fail closed: close the server on failure.
  const tokenPath = bootTokenPath(dirRes.dir);
  if (!api.writeAndVerify(tokenPath, bootToken, { ownerSid: ownSid, readerSid: peerSid })) {
    await server.close();
    return { ok: false, reason: 'token-write-failed', detail: `failed to write/verify ${tokenPath}; fail-closed` };
  }

  // 5. STOP watcher → drain live shells (STOP supremacy; distinct from the spawn-door per-open gate).
  const watcher = (deps.startStopWatch ?? defaultStartStopWatch)(deps.repoRoot, () => {
    try {
      host.stopAll();
    } catch {
      /* best-effort drain */
    }
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      host.stopAll();
    } catch {
      /* best-effort */
    }
    try {
      watcher.close();
    } catch {
      /* best-effort */
    }
    await server.close();
  };

  return { ok: true, host, server, pipeName, ownSid, peerSid, shutdown };
}

/** Resolve the peer fs seam (default: real fs). Hermetic tests inject `deps.peerFs` and never touch disk. */
function peerFsOf(deps: PtyHostBootDeps): PeerConfigFs {
  if (deps.peerFs) return deps.peerFs;
  return {
    readFile: (p: string) => readFileSync(p, 'utf-8'),
    dirExists: (p: string) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

// ── Entry: run the boot only when executed directly (`node dashboard/server/pty/hostMain.ts`). ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = process.cwd();
  bootPtyHost({ repoRoot, onError: (err) => process.stderr.write(`[kb-pty-host] connection error: ${(err as Error)?.message ?? err}\n`) })
    .then((result) => {
      if (!result.ok) {
        process.stderr.write(`[kb-pty-host] refusing to listen (${result.reason}): ${result.detail}\n`);
        process.exit(1);
      }
      process.stderr.write(`[kb-pty-host] listening on ${result.pipeName} (peer ${result.peerSid})\n`);
      const onSignal = (sig: string): void => {
        process.stderr.write(`[kb-pty-host] ${sig} — draining + closing\n`);
        result.shutdown().then(() => process.exit(0)).catch(() => process.exit(0));
      };
      process.on('SIGTERM', () => onSignal('SIGTERM'));
      process.on('SIGBREAK', () => onSignal('SIGBREAK'));
      process.on('SIGINT', () => onSignal('SIGINT'));
    })
    .catch((err) => {
      process.stderr.write(`[kb-pty-host] boot failed (fail-closed): ${(err as Error)?.message ?? err}\n`);
      process.exit(1);
    });
}
