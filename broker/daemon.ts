/**
 * D3.6 (Phase 2) — the Broker daemon BOOT entry (the process PM2 supervises: `node broker/daemon.ts`).
 *
 * Nothing outside tests previously started the control socket; this wires the real boot, preserving every
 * existing invariant:
 *   1. PREAMBLE GATE (ordering-law 8): `assertFleetRunnable` runs FIRST — a STOP-frozen / API-keyed /
 *      budget-breached fleet refuses to boot (no socket is opened, no token minted-to-disk).
 *   2. MINT + ISSUE the per-boot token: `mintBootToken` (256-bit), then write it to an OWNER-ONLY file
 *      beside the socket path (0600 on POSIX; under the per-user profile on win32, where the profile dir's
 *      ACL is owner-only). The token is NEVER logged and NEVER placed in pm2.config.cjs.
 *   3. RESOLVE the daemon's own identity (`resolveExpectedOwnerId`: uid on POSIX, SID on win32) — the
 *      value peers are compared against. On win32 the SID comes from the same token query the
 *      per-connection peer read uses (SID-vs-SID end to end).
 *   4. LISTEN via the platform transport (POSIX net.Server / win32 native pipe server). A hard bind
 *      failure (e.g. a squatted win32 pipe name) rejects → the daemon fails closed instead of running.
 *   5. STOP-drain: `watchStop` arms the active STOP watcher so a STOP that lands mid-run drains live
 *      handles down the Q8 ladder (STOP supremacy preserved; distinct from the spawn-door preamble gate).
 *
 * This lives in a dedicated entry (not broker/index.ts) so index.ts stays the pure `SessionOwner` module
 * that broker/verbs.ts depends on — importing the boot's transport/dispatch graph into index.ts would
 * create an index↔verbs runtime import cycle. pm2.config.cjs points `script` here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SessionOwner } from './index.ts';
import { assertFleetRunnable, defaultPreambleRunner } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';
import { mintBootToken, resolveExpectedOwnerId } from './socket.ts';
import { createControlTransport } from './controlTransport.ts';
import type { ControlTransport, ControlTransportDeps } from './controlTransport.ts';
import { dispatchControlRequest } from './verbs.ts';
import { watchStop } from './stopWatch.ts';
import type { StopWatcher } from './stopWatch.ts';
import { loadWin32Api } from './win32Api.ts';

/** Where the control socket + its token file live for a platform. POSIX: under `$XDG_RUNTIME_DIR` (or
 *  `$HOME/.kb-broker`), a trusted, non-world-writable, daemon-owned root (see peerBoundary.ts caller
 *  precondition). win32: a per-user pipe name + a token file under `%LOCALAPPDATA%` (owner-only by the
 *  profile ACL). */
export function resolveControlPaths(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { socketPath: string; tokenPath: string } {
  if (platform === 'win32') {
    const user = env.USERNAME ?? 'user';
    const base = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? 'C:\\Users\\Default', 'AppData', 'Local');
    return {
      socketPath: `\\\\.\\pipe\\kb-broker-${user}`,
      tokenPath: join(base, 'kb-broker', 'control.token'),
    };
  }
  const runtimeDir = env.XDG_RUNTIME_DIR ?? join(env.HOME ?? '/tmp', '.kb-broker');
  const dir = join(runtimeDir, 'kb-broker');
  return { socketPath: join(dir, 'control.sock'), tokenPath: join(dir, 'control.token') };
}

/** Write the per-boot token to an owner-only file. POSIX: dir 0700 + file 0600. win32: dir under the
 *  user profile (owner-only ACL by default). NEVER logs the token. */
export function writeTokenFile(tokenPath: string, token: string, platform: NodeJS.Platform): void {
  const dir = dirname(tokenPath);
  if (platform === 'win32') {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tokenPath, token, { encoding: 'utf-8' });
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(tokenPath, token, { encoding: 'utf-8', mode: 0o600 });
  }
}

export interface BootDeps {
  repoRoot: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  runPreamble?: PreambleRunner;
  // Injection seams (hermetic boot test): default to the real implementations.
  makeOwner?: () => SessionOwner;
  mintToken?: () => string;
  resolveOwnerId?: () => string;
  createTransport?: (deps: ControlTransportDeps) => ControlTransport;
  writeToken?: (tokenPath: string, token: string, platform: NodeJS.Platform) => void;
  startStopWatch?: (repoRoot: string, owner: SessionOwner) => StopWatcher;
  onError?: (err: unknown) => void;
}

export type BootResult =
  | { ok: true; owner: SessionOwner; transport: ControlTransport; watcher: StopWatcher; socketPath: string; tokenPath: string }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] };

/**
 * Boot the daemon. Returns `fleet-frozen` (no socket opened) if the preamble gate refuses; otherwise
 * listens, issues the token file, arms the STOP watcher, and returns the live handles. Throws only on a
 * hard transport bind failure (fail closed).
 */
export async function bootBroker(deps: BootDeps): Promise<BootResult> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;

  // 1. Preamble gate FIRST — refuse to boot a frozen/API-keyed/over-budget fleet.
  const runnable = assertFleetRunnable(deps.repoRoot, deps.runPreamble ?? defaultPreambleRunner);
  if (!runnable.ok) {
    return { ok: false, reason: 'fleet-frozen', problems: runnable.problems };
  }

  // 2. Owner + per-boot token + daemon identity.
  const owner = (deps.makeOwner ?? (() => new SessionOwner({ repoRoot: deps.repoRoot })))();
  const bootToken = (deps.mintToken ?? mintBootToken)();
  const expectedOwnerId = (deps.resolveOwnerId ??
    (() => resolveExpectedOwnerId(env, { platform, win32SidProvider: () => loadWin32Api().currentSidString() })))();

  // 3. Listen via the platform transport (fails closed on a hard bind error).
  const { socketPath, tokenPath } = resolveControlPaths(platform, env);
  const transport = (deps.createTransport ?? createControlTransport)({
    socketPath,
    auth: { expectedOwnerId, bootToken },
    owner,
    dispatch: dispatchControlRequest,
    platform,
    onError: deps.onError,
  });
  await transport.listen();

  // 4. Issue the token to an owner-only file (never logged, never in pm2 config).
  (deps.writeToken ?? writeTokenFile)(tokenPath, bootToken, platform);

  // 5. Arm the active STOP-drain (STOP supremacy).
  const watcher = (deps.startStopWatch ?? ((root, o) => watchStop(root, o)))(deps.repoRoot, owner);

  return { ok: true, owner, transport, watcher, socketPath, tokenPath };
}

// ── Entry point: run the boot only when executed directly (`node broker/daemon.ts`), never on import. ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = process.cwd();
  bootBroker({ repoRoot, onError: (err) => process.stderr.write(`[kb-broker] connection error: ${(err as Error)?.message ?? err}\n`) })
    .then((result) => {
      if (!result.ok) {
        process.stderr.write(`[kb-broker] refusing to boot (fleet not runnable): ${result.problems.join('; ')}\n`);
        process.exit(1);
      }
      process.stderr.write('[kb-broker] control transport listening\n');
    })
    .catch((err) => {
      process.stderr.write(`[kb-broker] boot failed (fail-closed): ${(err as Error)?.message ?? err}\n`);
      process.exit(1);
    });
}
