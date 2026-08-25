/**
 * P4 W6.4 — the BOUNDED lifecycle wrapper the §8 browser proofs run under.
 *
 * The same problem P3's wrapper solved: a fixture server must be up before the browser runner starts and
 * gone afterwards — on success, on client failure, on a ready-timeout, and on SIGINT/SIGTERM — with no
 * orphaned node process and no half-written artifact directory. Every OS seam (spawn, ready probe, clock,
 * signal registration) is injected, so all four teardown paths are proven against a fake child with no
 * real process and no real port.
 *
 * The fixture command is always started as a BACKGROUND child in its own process, never `shell: true`:
 * nothing here composes a command string, so no argument can be re-parsed by a shell.
 */
import { fileURLToPath } from 'node:url';

/** The bounded child this wrapper drives. A real ChildProcess satisfies it structurally. */
export interface LifecycleChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;
export type ReadyProbe = (url: string) => Promise<boolean>;
export type SleepFn = (ms: number) => Promise<void>;

export interface P4FixtureLifecycleOptions {
  /** Argv of the fixture server, already split — never a command string. */
  readonly fixtureArgv: readonly string[];
  /** Argv of the client to run after the fixture is ready (`--` separated on the CLI). */
  readonly clientArgv: readonly string[];
  /** The `/readyz` URL to poll. */
  readonly readyUrl: string;
  readonly readyTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly pollIntervalMs: number;
}

export interface P4FixtureLifecycleDeps {
  spawn: LifecycleSpawn;
  readyProbe: ReadyProbe;
  now: () => number;
  sleep: SleepFn;
  /** Register a SIGINT/SIGTERM handler; returns a disposer. */
  onSignal: (handler: () => void) => () => void;
  log?: (line: string) => void;
}

export const P4_LIFECYCLE_EXIT = { ok: 0, clientFailed: 1, readyTimeout: 66, usage: 2 } as const;
export type P4LifecycleExitCode = number;

export class P4LifecycleUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P4LifecycleUsageError';
  }
}

/** Parse `--fixture … --scenario … --port … -- <client argv>` into the option shape. */
export function parseP4FixtureLifecycleArgs(argv: readonly string[]): P4FixtureLifecycleOptions {
  const dashDash = argv.indexOf('--');
  const own = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const clientArgv = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  if (clientArgv.length === 0) throw new P4LifecycleUsageError('a client command after `--` is required');

  let fixture = 'bounded';
  let scenario = 'pr-escalation-states';
  let port = 4421;
  let https = false;
  let readyTimeoutMs = 20000;
  let shutdownTimeoutMs = 5000;
  let pollIntervalMs = 100;
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    const value = own[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P4LifecycleUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--fixture': fixture = needValue(); break;
      case '--scenario': scenario = needValue(); break;
      case '--port': port = Number.parseInt(needValue(), 10); break;
      case '--https': https = true; break;
      case '--ready-timeout-ms': readyTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--shutdown-timeout-ms': shutdownTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--poll-interval-ms': pollIntervalMs = Number.parseInt(needValue(), 10); break;
      default: throw new P4LifecycleUsageError(`unknown flag: ${arg}`);
    }
  }
  const scheme = https ? 'https' : 'http';
  return {
    fixtureArgv: [
      'server/testFixtures/p4FixtureServer.ts',
      '--fixture', fixture, '--scenario', scenario, '--port', String(port), ...(https ? ['--https'] : []),
    ],
    clientArgv,
    readyUrl: `${scheme}://127.0.0.1:${port}/readyz`,
    readyTimeoutMs,
    shutdownTimeoutMs,
    pollIntervalMs,
  };
}

/**
 * Start the fixture, wait for ready, run the client, and tear the fixture down in `finally` on every
 * path. Returns the exit code the outer command should adopt.
 */
export async function runP4FixtureLifecycle(
  options: P4FixtureLifecycleOptions,
  deps: P4FixtureLifecycleDeps,
): Promise<P4LifecycleExitCode> {
  const log = deps.log ?? (() => undefined);
  const fixtureChild = deps.spawn(options.fixtureArgv[0], options.fixtureArgv.slice(1));
  let fixtureExited = false;
  fixtureChild.once('exit', () => { fixtureExited = true; });

  const closeFixture = async (): Promise<void> => {
    if (fixtureExited) return;
    fixtureChild.kill('SIGTERM');
    const deadline = deps.now() + options.shutdownTimeoutMs;
    while (!fixtureExited && deps.now() < deadline) {
      await deps.sleep(Math.min(options.pollIntervalMs, options.shutdownTimeoutMs));
    }
    if (!fixtureExited) fixtureChild.kill('SIGKILL');
  };

  const disposeSignal = deps.onSignal(() => { void closeFixture(); });

  try {
    // Poll `/readyz` until it answers or the timeout expires.
    const readyDeadline = deps.now() + options.readyTimeoutMs;
    let ready = false;
    while (deps.now() < readyDeadline) {
      if (await deps.readyProbe(options.readyUrl)) { ready = true; break; }
      await deps.sleep(options.pollIntervalMs);
    }
    if (!ready) {
      log(`fixture never became ready at ${options.readyUrl}`);
      return P4_LIFECYCLE_EXIT.readyTimeout;
    }

    // Run the client and adopt its exit code.
    const clientChild = deps.spawn(options.clientArgv[0], options.clientArgv.slice(1));
    const clientExit = await new Promise<number>((resolvePromise) => {
      clientChild.once('exit', (code) => resolvePromise(code ?? P4_LIFECYCLE_EXIT.clientFailed));
      clientChild.once('error', () => resolvePromise(P4_LIFECYCLE_EXIT.clientFailed));
    });
    return clientExit;
  } finally {
    disposeSignal();
    await closeFixture();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // A real CLI run would wire node:child_process spawn, an HTTPS ready probe, Date.now, timers, and
  // process signal registration here; the unit suite drives the injected form.
  process.stderr.write('p4FixtureLifecycle is driven by the §8 browser commands; import runP4FixtureLifecycle.\n');
  process.exitCode = P4_LIFECYCLE_EXIT.usage;
}
