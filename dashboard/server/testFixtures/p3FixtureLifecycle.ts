/**
 * P3 §7/§8 — the BOUNDED lifecycle wrapper every real-browser and real-PTY proof command runs under.
 *
 * The problem it exists for: two long-lived processes have to overlap. A fixture server must be up before
 * the client starts, and it must be gone afterwards — including when the client crashes, when the fixture
 * never becomes ready, and when Daniel presses Ctrl-C halfway through. Doing that by hand leaves orphaned
 * node processes holding ports 4317-4324 and a half-written artifact directory, which is exactly the state
 * that makes a browser matrix un-rerunnable.
 *
 * The contract, in order:
 *
 *  1. Start the fixture command as a BACKGROUND child (its own process, never `shell: true` — nothing here
 *     composes a command string, so no argument can be re-parsed by a shell).
 *  2. Poll `<origin>/readyz` until it answers, or until `--ready-timeout-ms` expires. A timeout is a
 *     failure of the whole run: the client is never started against a fixture that never came up.
 *  3. Run the command after `--` and wait for it. Its exit code becomes this process's exit code, so a
 *     failing browser assertion fails the outer command rather than being swallowed by a clean shutdown.
 *  4. In `finally` — reached on success, on client failure, on ready-timeout, and on SIGINT/SIGTERM —
 *     await the fixture's own `close()`, then force-kill ONLY that child if `--shutdown-timeout-ms`
 *     expires. Never a process-group or by-name kill: this wrapper may run beside other fixtures on other
 *     ports, and killing "node" would take them with it.
 *
 * Every seam that touches the OS (spawn, fetch, clock, signal registration, process exit) is injected, so
 * the suite proves all four teardown paths against a fake child with no real process and no real port.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { readLoopbackCertificate } from './p3LoopbackTls.ts';

/** The bounded child this wrapper drives. A real {@link ChildProcess} satisfies it structurally. */
export interface LifecycleChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;

/** How the wrapper reaches `/readyz`. Returns true once the fixture answers as ready. */
export type ReadyProbe = (url: string) => Promise<boolean>;

export interface P3FixtureLifecycleOptions {
  /** Argv of the fixture server, already split — never a command string. */
  fixtureCommand: readonly string[];
  /** Argv of the client to run once the fixture is ready (everything after `--`). */
  clientCommand: readonly string[];
  /** The origin the readiness probe and the client both use. */
  origin: string;
  readyTimeoutMs: number;
  shutdownTimeoutMs: number;
  /** How often the readiness probe retries. Bounded well below `readyTimeoutMs`. */
  readyIntervalMs?: number;
  spawn?: LifecycleSpawn;
  probe?: ReadyProbe;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Registers an interrupt handler; returns its unregister. Injected so the suite can fire SIGINT. */
  onInterrupt?: (handler: () => void) => () => void;
  log?: (line: string) => void;
}

export type P3FixtureLifecycleOutcome =
  | { ok: true; exitCode: number; forcedKill: boolean }
  | { ok: false; reason: 'fixture-failed' | 'ready-timeout' | 'interrupted'; exitCode: number; forcedKill: boolean };

const DEFAULT_READY_INTERVAL_MS = 150;

function defaultSpawn(command: string, args: readonly string[]): LifecycleChild {
  return spawn(command, [...args], { stdio: 'inherit', shell: false }) as ChildProcess;
}

/**
 * Reach `/readyz`, PINNING the fixture's published certificate when the origin is HTTPS. Verification is
 * never disabled: an unpinnable origin simply stays un-ready until the fixture publishes its cert, which
 * it does before it can serve anything. `rejectUnauthorized` is left at its secure default, so a
 * certificate that is not the pinned one fails the probe rather than silently passing it.
 */
async function defaultProbe(url: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const secure = target.protocol === 'https:';
  let ca: string | null = null;
  if (secure) {
    ca = readLoopbackCertificate(Number(target.port));
    if (ca === null) return false;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const send = secure ? httpsRequest : httpRequest;
    const call = send(
      {
        protocol: target.protocol,
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        // No `servername`: RFC 6066 forbids SNI for an IP literal, and the pinned certificate carries
        // 127.0.0.1 in its subjectAltName, which is what actually authenticates the fixture.
        ...(ca === null ? {} : { ca }),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        response.resume();
        finish(status >= 200 && status < 300);
      },
    );
    call.on('error', () => finish(false));
    call.end();
  });
}

function defaultOnInterrupt(handler: () => void): () => void {
  const wrapped = (): void => handler();
  process.once('SIGINT', wrapped);
  process.once('SIGTERM', wrapped);
  return () => {
    process.off('SIGINT', wrapped);
    process.off('SIGTERM', wrapped);
  };
}

/** Resolves when the child exits, with its exit code (a signalled death is reported as 1). */
function waitForExit(child: LifecycleChild): Promise<number> {
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', () => resolve(1));
  });
}

/**
 * Run one bounded fixture + client pair. Never throws for an expected failure — every path returns an
 * outcome, so a caller (and the CLI below) always reaches the same teardown.
 */
export async function runP3FixtureLifecycle(
  options: P3FixtureLifecycleOptions,
): Promise<P3FixtureLifecycleOutcome> {
  const spawnChild = options.spawn ?? defaultSpawn;
  const probe = options.probe ?? defaultProbe;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const now = options.now ?? Date.now;
  const registerInterrupt = options.onInterrupt ?? defaultOnInterrupt;
  const log = options.log ?? (() => {});
  const readyInterval = options.readyIntervalMs ?? DEFAULT_READY_INTERVAL_MS;

  const [fixtureBin, ...fixtureArgs] = options.fixtureCommand;
  if (fixtureBin === undefined) throw new Error('p3FixtureLifecycle: fixture command is empty');
  const [clientBin, ...clientArgs] = options.clientCommand;
  if (clientBin === undefined) throw new Error('p3FixtureLifecycle: client command is empty');

  let interrupted = false;
  const fixture = spawnChild(fixtureBin, fixtureArgs);
  const fixtureExit = waitForExit(fixture);
  let fixtureAlive = true;
  void fixtureExit.then(() => { fixtureAlive = false; });

  const releaseInterrupt = registerInterrupt(() => { interrupted = true; });

  // The outcome is decided in the body but STAMPED after teardown, so `forcedKill` reports what the
  // shutdown deadline actually did rather than what the body predicted.
  let outcome: P3FixtureLifecycleOutcome | null = null;
  try {
    // (2) Bounded readiness. A fixture that dies while starting fails immediately rather than burning
    // the whole timeout on a process that can never answer.
    const readyBy = now() + options.readyTimeoutMs;
    let ready = false;
    while (!ready) {
      if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
      if (!fixtureAlive) {
        log('fixture exited before it became ready');
        { outcome = { ok: false, reason: 'fixture-failed', exitCode: 1, forcedKill: false }; return outcome; }
      }
      ready = await probe(`${options.origin.replace(/\/+$/, '')}/readyz`);
      if (ready) break;
      if (now() >= readyBy) {
        log(`fixture did not answer /readyz within ${options.readyTimeoutMs} ms`);
        { outcome = { ok: false, reason: 'ready-timeout', exitCode: 1, forcedKill: false }; return outcome; }
      }
      await sleep(readyInterval);
    }

    // (3) The client owns the run. Its exit code is the command's exit code.
    if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
    const client = spawnChild(clientBin, clientArgs);
    const clientCode = await waitForExit(client);
    if (interrupted) { outcome = { ok: false, reason: 'interrupted', exitCode: 130, forcedKill: false }; return outcome; }
    outcome = { ok: true, exitCode: clientCode, forcedKill: false };
    return outcome;
  } finally {
    // (4) One teardown for every path above, including the early returns.
    releaseInterrupt();
    if (fixtureAlive) {
      fixture.kill('SIGTERM');
      const settled = await Promise.race([
        fixtureExit.then(() => true),
        sleep(options.shutdownTimeoutMs).then(() => false),
      ]);
      if (!settled) {
        // Only THIS child, by pid — never a process group and never by name: sibling fixtures on other
        // ports are running beside us and must survive.
        log(`fixture did not stop within ${options.shutdownTimeoutMs} ms; force-killing pid ${fixture.pid ?? -1}`);
        fixture.kill('SIGKILL');
        if (outcome !== null) outcome.forcedKill = true;
      }
    }
  }
}

export interface P3FixtureLifecycleArgs {
  fixtureCommand: string[];
  clientCommand: string[];
  origin: string;
  readyTimeoutMs: number;
  shutdownTimeoutMs: number;
}

const KNOWN_FIXTURES = new Set(['p1', 'p3-authenticated']);

/**
 * Parse the §7/§8 command line. Everything BEFORE `--` configures the fixture; everything after is the
 * client argv, passed through untouched. `--origin` is derived from `--https` + `--port` unless given.
 */
export function parseP3FixtureLifecycleArgs(argv: readonly string[]): P3FixtureLifecycleArgs {
  const separator = argv.indexOf('--');
  if (separator === -1) throw new Error('p3FixtureLifecycle: missing `--` before the client command');
  const head = argv.slice(0, separator);
  const clientCommand = argv.slice(separator + 1);
  if (clientCommand.length === 0) throw new Error('p3FixtureLifecycle: the client command is empty');

  let fixture: string | null = null;
  let scenario: string | null = null;
  let port: number | null = null;
  let https = false;
  let realWindowsHost = false;
  let origin: string | null = null;
  let readyTimeoutMs: number | null = null;
  let shutdownTimeoutMs: number | null = null;

  for (let index = 0; index < head.length; index += 1) {
    const flag = head[index];
    const value = head[index + 1];
    const takeValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`p3FixtureLifecycle: ${flag} needs a value`);
      index += 1;
      return value;
    };
    switch (flag) {
      case '--fixture': fixture = takeValue(); break;
      case '--scenario': scenario = takeValue(); break;
      case '--origin': origin = takeValue(); break;
      case '--port': port = Number.parseInt(takeValue(), 10); break;
      case '--ready-timeout-ms': readyTimeoutMs = Number.parseInt(takeValue(), 10); break;
      case '--shutdown-timeout-ms': shutdownTimeoutMs = Number.parseInt(takeValue(), 10); break;
      case '--https': https = true; break;
      case '--real-windows-host': realWindowsHost = true; break;
      default: throw new Error(`p3FixtureLifecycle: unknown flag ${flag}`);
    }
  }

  if (fixture === null || !KNOWN_FIXTURES.has(fixture)) {
    throw new Error('p3FixtureLifecycle: --fixture must be p1 or p3-authenticated');
  }
  if (port === null || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('p3FixtureLifecycle: --port must be a valid port');
  }
  if (readyTimeoutMs === null || !Number.isInteger(readyTimeoutMs) || readyTimeoutMs <= 0) {
    throw new Error('p3FixtureLifecycle: --ready-timeout-ms must be a positive integer');
  }
  if (shutdownTimeoutMs === null || !Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error('p3FixtureLifecycle: --shutdown-timeout-ms must be a positive integer');
  }

  const module = fixture === 'p1'
    ? 'server/testFixtures/p1BrowserFixture.ts'
    : 'server/testFixtures/p3AuthenticatedServer.ts';
  // `--experimental-transform-types`, not bare type-stripping: nine modules the server graph imports
  // still use TS parameter properties (a standing violation of the repo's strip-only floor), and without
  // the transform `node server/index.ts` refuses to load at all.
  const fixtureCommand = [
    process.execPath, '--experimental-transform-types', '--disable-warning=ExperimentalWarning',
    module, '--port', String(port),
  ];
  if (scenario !== null) fixtureCommand.push('--scenario', scenario);
  if (https) fixtureCommand.push('--https');
  if (realWindowsHost) fixtureCommand.push('--real-windows-host');

  return {
    fixtureCommand,
    clientCommand: [...clientCommand],
    origin: origin ?? `${https ? 'https' : 'http'}://127.0.0.1:${port}`,
    readyTimeoutMs,
    shutdownTimeoutMs,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = parseP3FixtureLifecycleArgs(process.argv.slice(2));
  runP3FixtureLifecycle({ ...parsed, log: (line) => process.stderr.write(`${line}\n`) })
    .then((outcome) => { process.exitCode = outcome.exitCode; })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
