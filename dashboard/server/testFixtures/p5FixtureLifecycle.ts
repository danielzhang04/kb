/**
 * P5 W6.1/W6.4 — the BOUNDED lifecycle wrapper the §8 Inbox deployment + asset-pull browser proofs run
 * under. It is the P5 analogue of {@link file://./p4FixtureLifecycle.ts}: the same guarantee that a
 * fixture server is up before the browser runner starts and gone afterwards — on success, on client
 * failure, on a ready-timeout, and on SIGINT/SIGTERM — with no orphaned node process.
 *
 * The P5 Inbox surface lives in the shipping dashboard shell fixture (`p1BrowserFixture.ts`), which now
 * serves the four-source envelope and the deployment T3 refusal route, so this wrapper spawns THAT
 * fixture rather than a bespoke one. Every OS seam (spawn, ready probe, clock, signal registration) is
 * injected, so all four teardown paths are proven against a fake child with no real process.
 *
 * The fixture command is always started as a BACKGROUND child in its own process, never `shell: true`:
 * nothing here composes a command string, so no argument can be re-parsed by a shell.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  defaultOnSignal, defaultReadyProbe, type LifecycleChild, type ReadyProbe, type SleepFn,
} from './p4FixtureLifecycle.ts';

export type { LifecycleChild } from './p4FixtureLifecycle.ts';
export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;

/** The P5 Inbox browser scenarios the §8 matrix drives, each a shell-fixture scenario that renders the
 *  deployment/asset-pull arms. Frozen here so the arg parser and the runner agree on the closed set. */
export const P5_INBOX_SCENARIOS = [
  'inbox-populated',
  'inbox-empty',
] as const;
export type P5InboxScenario = (typeof P5_INBOX_SCENARIOS)[number];

export function isP5InboxScenario(value: string): value is P5InboxScenario {
  return (P5_INBOX_SCENARIOS as readonly string[]).includes(value);
}

export interface P5FixtureLifecycleOptions {
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

export interface P5FixtureLifecycleDeps {
  spawn: LifecycleSpawn;
  readyProbe: ReadyProbe;
  now: () => number;
  sleep: SleepFn;
  /** Register a SIGINT/SIGTERM handler; returns a disposer. */
  onSignal: (handler: () => void) => () => void;
  log?: (line: string) => void;
}

export const P5_LIFECYCLE_EXIT = { ok: 0, clientFailed: 1, readyTimeout: 66, usage: 2 } as const;
export type P5LifecycleExitCode = number;

export class P5LifecycleUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P5LifecycleUsageError';
  }
}

/** Parse `--scenario … --port … --https --ready-timeout-ms … -- <client argv>` into the option shape. */
export function parseP5FixtureLifecycleArgs(argv: readonly string[]): P5FixtureLifecycleOptions {
  const dashDash = argv.indexOf('--');
  const own = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const clientArgv = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  if (clientArgv.length === 0) throw new P5LifecycleUsageError('a client command after `--` is required');

  let scenario: P5InboxScenario = 'inbox-populated';
  let port = 4521;
  let https = false;
  let readyTimeoutMs = 20000;
  let shutdownTimeoutMs = 5000;
  let pollIntervalMs = 100;
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    const value = own[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P5LifecycleUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--scenario': {
        const v = needValue();
        if (!isP5InboxScenario(v)) throw new P5LifecycleUsageError(`--scenario must be one of: ${P5_INBOX_SCENARIOS.join(', ')}`);
        scenario = v;
        break;
      }
      case '--port': port = Number.parseInt(needValue(), 10); break;
      case '--https': https = true; break;
      case '--ready-timeout-ms': readyTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--shutdown-timeout-ms': shutdownTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--poll-interval-ms': pollIntervalMs = Number.parseInt(needValue(), 10); break;
      default: throw new P5LifecycleUsageError(`unknown flag: ${arg}`);
    }
  }
  const scheme = https ? 'https' : 'http';
  return {
    // `node <file>.ts` — bare type-stripping under native node v24, exactly as the P4 wrapper spawns its
    // fixture. process.execPath is the current node binary, so the child is the same runtime. The P5
    // Inbox surface is served by the shipping shell fixture.
    fixtureArgv: [
      process.execPath, 'server/testFixtures/p1BrowserFixture.ts',
      '--scenario', scenario, '--port', String(port), ...(https ? ['--https'] : []),
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
 * path. Returns the exit code the outer command should adopt. Identical control flow to the proven P4
 * wrapper, so the four teardown paths behave the same.
 */
export async function runP5FixtureLifecycle(
  options: P5FixtureLifecycleOptions,
  deps: P5FixtureLifecycleDeps,
): Promise<P5LifecycleExitCode> {
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
    const readyDeadline = deps.now() + options.readyTimeoutMs;
    let ready = false;
    while (deps.now() < readyDeadline) {
      if (await deps.readyProbe(options.readyUrl)) { ready = true; break; }
      await deps.sleep(options.pollIntervalMs);
    }
    if (!ready) {
      log(`fixture never became ready at ${options.readyUrl}`);
      return P5_LIFECYCLE_EXIT.readyTimeout;
    }

    const clientChild = deps.spawn(options.clientArgv[0], options.clientArgv.slice(1));
    const clientExit = await new Promise<number>((resolvePromise) => {
      clientChild.once('exit', (code) => resolvePromise(code ?? P5_LIFECYCLE_EXIT.clientFailed));
      clientChild.once('error', () => resolvePromise(P5_LIFECYCLE_EXIT.clientFailed));
    });
    return clientExit;
  } finally {
    disposeSignal();
    await closeFixture();
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * Real OS deps for the CLI path. The ready probe and signal registration are the PROVEN P4 ones
 * (loopback-cert pinning included); only the spawn is defined here.
 * ------------------------------------------------------------------------------------------------ */

/** Spawn a bounded child in its own process, never `shell: true`. */
export function defaultLifecycleSpawn(command: string, args: readonly string[]): LifecycleChild {
  return spawn(command, [...args], { stdio: 'inherit', shell: false }) as ChildProcess;
}

/** The full real-dep set, so the CLI is one call. */
export function defaultP5FixtureLifecycleDeps(
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): P5FixtureLifecycleDeps {
  return {
    spawn: defaultLifecycleSpawn,
    readyProbe: defaultReadyProbe,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); }),
    onSignal: defaultOnSignal,
    log,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = (line: string): void => { process.stderr.write(`${line}\n`); };
  try {
    const options = parseP5FixtureLifecycleArgs(process.argv.slice(2));
    void runP5FixtureLifecycle(options, defaultP5FixtureLifecycleDeps(log))
      .then((code) => { process.exitCode = code; });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = P5_LIFECYCLE_EXIT.usage;
  }
}
