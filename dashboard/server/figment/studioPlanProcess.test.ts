import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StudioPlanProcessError,
  killOwnedTree,
  runStudioPlanProcess,
  runStudioPlanProcessCapture,
  runStudioPlanProcessCaptureWith,
  runStudioPlanProcessWith,
  studioPlanProcessDefaults,
  type StudioPlanProcessDeps,
  type StudioPlanProcessOptions,
} from './studioPlanProcess.ts';
import { createWindowsStudioPlanJob, type WindowsJob } from './windowsStudioPlanJob.ts';

// Harmless fixture: a node child spawns a node grandchild that inherits the
// stdio pipes (or, for `orphan-ignore`, holds no pipe at all), records both
// PIDs atomically, then misbehaves per `mode`.
const FIXTURE = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [mode, pidFile] = process.argv.slice(2);
if (mode === 'ok') process.exit(0);
if (mode === 'fail') { process.stderr.write('SECRET-STDERR C:/private/path'); process.exit(3); }
if (mode === 'capture-ok') {
  process.stdout.write(Buffer.from([0, 1, 2, 255, 254]));
  process.stdout.write('-chunk-two-');
  process.stderr.write('separate-stderr-not-in-stdout');
  process.exit(0);
}
const stdio = mode === 'orphan-ignore' ? 'ignore' : 'inherit';
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio });
g.on('spawn', () => {
  fs.writeFileSync(pidFile + '.tmp', JSON.stringify({ child: process.pid, grandchild: g.pid }));
  fs.renameSync(pidFile + '.tmp', pidFile);
  if (mode === 'overflow') { process.stdout.write('o'.repeat(600)); process.stderr.write('e'.repeat(600)); }
  if (mode === 'orphan' || mode === 'orphan-ignore') process.exit(0);
  setInterval(() => {}, 1000);
});
`;

let dir = '';
let script = '';
const owned: number[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-plan-process-'));
  script = join(dir, 'fixture.cjs');
  await writeFile(script, FIXTURE);
});

const pidFiles: string[] = [];
let seq = 0;
const nextPidFile = () => { const f = join(dir, `pids-${seq++}.json`); pidFiles.push(f); return f; };

afterEach(() => {
  // Scoped cleanup: only PIDs this suite's own fixture recorded, even on failure.
  for (const f of pidFiles.splice(0)) {
    if (!existsSync(f)) continue;
    const p = JSON.parse(readFileSync(f, 'utf8')) as { child: number; grandchild: number };
    owned.push(p.grandchild, p.child);
  }
  for (const pid of owned.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const opts = (over: Partial<StudioPlanProcessOptions> = {}): StudioPlanProcessOptions => ({
  cwd: dir, timeout: 10_000, maxBuffer: 16 * 1024, windowsHide: true, ...over,
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function goneWithin(pid: number, ms = 3_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return !alive(pid);
}

function readPids(pidFile: string): { child: number; grandchild: number } {
  expect(existsSync(pidFile), 'fixture must be ready before the trigger').toBe(true);
  return JSON.parse(readFileSync(pidFile, 'utf8')) as { child: number; grandchild: number };
}

async function failure(run: Promise<void>): Promise<StudioPlanProcessError> {
  const error = await run.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(StudioPlanProcessError);
  return error as StudioPlanProcessError;
}

const node = process.execPath;

describe('runStudioPlanProcess', () => {
  it('resolves on exit 0', async () => {
    await expect(runStudioPlanProcess(node, [script, 'ok', nextPidFile()], opts())).resolves.toBeUndefined();
  });

  it('rejects nonzero exit with a sanitized message', async () => {
    const error = await failure(runStudioPlanProcess(node, [script, 'fail', nextPidFile()], opts()));
    expect(error.code).toBe('exit_nonzero');
    expect(error.terminationUncertain).toBe(false);
    expect(error.message).not.toMatch(/SECRET|private|fixture/);
  });

  it('rejects spawn failure without uncertainty', async () => {
    const error = await failure(runStudioPlanProcess(join(dir, 'missing-planner.exe'), [], opts()));
    expect(error.code).toBe('spawn_failed');
    expect(error.terminationUncertain).toBe(false);
    expect(error.message).not.toContain(dir);
  });

  it('rejects invalid bounds before spawning', async () => {
    const error = await failure(runStudioPlanProcess(node, [script, 'ok'], opts({ timeout: 0 })));
    expect(error.code).toBe('invalid_options');
  });

  it('kills child and grandchild on timeout', async () => {
    const pidFile = nextPidFile();
    const error = await failure(runStudioPlanProcess(node, [script, 'sleep', pidFile], opts({ timeout: 3_000 })));
    expect(error.code).toBe('timeout');
    const pids = readPids(pidFile);
    expect(error.terminationUncertain).toBe(false);
    expect(await goneWithin(pids.child)).toBe(true);
    expect(await goneWithin(pids.grandchild)).toBe(true);
  }, 20_000);

  it('enforces the combined stdout+stderr cap and kills the tree', async () => {
    const pidFile = nextPidFile();
    // 600 + 600 bytes: each stream alone is under the 1000-byte cap.
    const run = runStudioPlanProcess(node, [script, 'overflow', pidFile], opts({ maxBuffer: 1_000, timeout: 15_000 }));
    const error = await failure(run);
    expect(error.code).toBe('output_overflow');
    const pids = readPids(pidFile);
    expect(error.terminationUncertain).toBe(false);
    expect(await goneWithin(pids.child)).toBe(true);
    expect(await goneWithin(pids.grandchild)).toBe(true);
  }, 20_000);

  // The parent exits 0 while a grandchild lives on, either holding the inherited
  // pipes or (stdio ignore) holding nothing, so no pipe-close assumption helps.
  // The run may resolve only once child AND grandchild are already gone.
  for (const mode of ['orphan', 'orphan-ignore']) {
    it(`resolves exit 0 only after the orphaned grandchild is gone (${mode})`, async () => {
      const pidFile = nextPidFile();
      const deps = { ...studioPlanProcessDefaults, closeGraceMs: 500 };
      await expect(runStudioPlanProcessWith(deps, node, [script, mode, pidFile], opts({ timeout: 10_000 })))
        .resolves.toBeUndefined();
      const pids = readPids(pidFile);
      // Checked immediately at resolution, not polled afterwards.
      expect(alive(pids.child)).toBe(false);
      expect(alive(pids.grandchild)).toBe(false);
    }, 20_000);
  }

  it('flags uncertainty when tree termination cannot be confirmed', async () => {
    const pidFile = nextPidFile();
    const deps: StudioPlanProcessDeps = {
      ...studioPlanProcessDefaults,
      killTree: async (child: ChildProcess, platform: NodeJS.Platform, job: WindowsJob | null) => {
        await killOwnedTree(child, platform, job);
        return false; // synthetic: kill ran, confirmation withheld
      },
      closeGraceMs: 500,
    };
    const error = await failure(runStudioPlanProcessWith(deps, node, [script, 'sleep', pidFile], opts({ timeout: 3_000 })));
    expect(error.code).toBe('timeout');
    expect(error.terminationUncertain).toBe(true);
  }, 20_000);
});

// A stand-in wrapper that spawns but never exits or closes; it is no real process.
function stuckWrapper(): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    pid: 424242, exitCode: null, signalCode: null, stdin: null, stdout: null, stderr: null, kill: () => true,
  });
  process.nextTick(() => child.emit('spawn'));
  return child as unknown as ChildProcess;
}

describe('Windows owned-job containment (fail closed)', () => {
  it('refuses before spawning anything when no job can be created', async () => {
    let spawns = 0;
    const deps: StudioPlanProcessDeps = {
      ...studioPlanProcessDefaults,
      platform: 'win32',
      createJob: () => null,
      spawn: ((..._args: unknown[]) => { spawns += 1; return stuckWrapper(); }) as unknown as StudioPlanProcessDeps['spawn'],
    };
    const error = await failure(runStudioPlanProcessWith(deps, node, [script, 'ok'], opts()));
    expect(error.code).toBe('containment_failed');
    expect(error.terminationUncertain).toBe(false);
    expect(spawns).toBe(0);
  });

  it('flags bounded cleanup uncertainty when an unassigned wrapper will not close', async () => {
    let closes = 0;
    const job: WindowsJob = { assign: () => false, terminateAndConfirmEmpty: async () => true, close: () => { closes += 1; } };
    const deps: StudioPlanProcessDeps = {
      ...studioPlanProcessDefaults,
      platform: 'win32',
      createJob: () => job,
      spawn: (() => stuckWrapper()) as unknown as StudioPlanProcessDeps['spawn'],
      closeGraceMs: 100,
    };
    const error = await failure(runStudioPlanProcessWith(deps, node, [script, 'ok'], opts()));
    expect(error.code).toBe('containment_failed');
    expect(error.terminationUncertain).toBe(true);
    expect(closes).toBe(1);
  });

  it('spawns the gate wrapper without any inherited NODE_OPTIONS and leaves process.env intact', async () => {
    const names = process.platform === 'win32' ? ['NODE_OPTIONS'] : ['NODE_OPTIONS', 'node_options', 'Node_Options'];
    const saved = names.map((name) => [name, process.env[name]] as const);
    for (const name of names) process.env[name] = '--require=./fixture-preload.cjs';
    try {
      let captured: NodeJS.ProcessEnv | undefined;
      const job: WindowsJob = { assign: () => false, terminateAndConfirmEmpty: async () => true, close: () => {} };
      const deps: StudioPlanProcessDeps = {
        ...studioPlanProcessDefaults,
        platform: 'win32',
        createJob: () => job,
        spawn: ((_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
          captured = options.env;
          return stuckWrapper();
        }) as unknown as StudioPlanProcessDeps['spawn'],
        closeGraceMs: 100,
      };
      await failure(runStudioPlanProcessWith(deps, node, [script, 'ok'], opts()));
      expect(captured).toBeDefined();
      expect(Object.keys(captured!).filter((name) => name.toUpperCase() === 'NODE_OPTIONS')).toEqual([]);
      expect(Object.keys(captured!).length).toBeGreaterThan(0);
      for (const name of names) expect(process.env[name]).toBe('--require=./fixture-preload.cjs');
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});

// A controllable fake child in the same spirit as stuckWrapper: real EventEmitter
// stdout/stderr so tests can drive exact data/exit/close ordering that a real
// process cannot guarantee. Only used for the timing-sensitive capture races
// below; every other capture behavior is exercised against the real fixture.
function fakeCaptureChild(): { child: ChildProcess; stdout: EventEmitter; stderr: EventEmitter } {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), {
    pid: 434343, exitCode: null, signalCode: null, stdin: null, stdout, stderr, kill: () => true,
  });
  process.nextTick(() => child.emit('spawn'));
  return { child: child as unknown as ChildProcess, stdout, stderr };
}

// A job stub whose terminateAndConfirmEmpty stays pending until resolved by the
// test, so the capture path's "await tree confirmation" window can be probed.
function deferredJob(): { job: WindowsJob; resolve: (v: boolean) => void; closes: number; called: boolean } {
  const state = { closes: 0, called: false };
  let resolveFn: (v: boolean) => void = () => {};
  const pending = new Promise<boolean>((res) => { resolveFn = res; });
  const job: WindowsJob = {
    assign: () => true,
    terminateAndConfirmEmpty: async () => { state.called = true; return pending; },
    close: () => { state.closes += 1; },
  };
  return {
    job,
    resolve: resolveFn,
    get closes() { return state.closes; },
    get called() { return state.called; },
  } as unknown as { job: WindowsJob; resolve: (v: boolean) => void; closes: number; called: boolean };
}

// Resolves once the fake child's scheduled 'spawn' event has actually fired,
// so tests can sequence exit/close after production has recorded spawned=true
// (fakeCaptureChild defers 'spawn' to process.nextTick).
function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.once('spawn', () => resolve()));
}

describe('runStudioPlanProcessCapture', () => {
  it('resolves with exactly the binary/chunked stdout Buffer, excluding stderr, after clean exit + close + owned-tree confirmation', async () => {
    const pidFile = nextPidFile();
    const result = await runStudioPlanProcessCapture(node, [script, 'capture-ok', pidFile], opts());
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.equals(Buffer.concat([
      Buffer.from([0, 1, 2, 255, 254]),
      Buffer.from('-chunk-two-'),
    ]))).toBe(true);
    const text = result.stdout.toString('latin1');
    expect(text).not.toContain('separate-stderr-not-in-stdout');
  });

  it('leaves the existing void API resolving undefined, not a capture object', async () => {
    await expect(runStudioPlanProcess(node, [script, 'ok', nextPidFile()], opts())).resolves.toBeUndefined();
  });

  it('rejects with output_overflow and no attached stdout/body when combined stdout+stderr exceed the cap', async () => {
    const pidFile = nextPidFile();
    const run = runStudioPlanProcessCapture(node, [script, 'overflow', pidFile], opts({ maxBuffer: 1_000, timeout: 15_000 }));
    const error = await run.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(StudioPlanProcessError);
    const err = error as StudioPlanProcessError & { stdout?: unknown; body?: unknown };
    expect(err.code).toBe('output_overflow');
    expect(err.stdout).toBeUndefined();
    expect((err as { body?: unknown }).body).toBeUndefined();
    const pids = readPids(pidFile);
    expect(await goneWithin(pids.child)).toBe(true);
    expect(await goneWithin(pids.grandchild)).toBe(true);
  }, 20_000);

  it('rejects nonzero exit with the existing typed error, without exposing stdout/stderr or fixture strings', async () => {
    const error = await runStudioPlanProcessCapture(node, [script, 'fail', nextPidFile()], opts())
      .then(() => null, (e: unknown) => e as StudioPlanProcessError);
    expect(error).toBeInstanceOf(StudioPlanProcessError);
    expect(error!.code).toBe('exit_nonzero');
    expect(error!.message).not.toMatch(/SECRET|private|fixture/);
    expect((error as unknown as { stdout?: unknown }).stdout).toBeUndefined();
  });

  it('rejects on timeout with the existing typed error, without exposing stdout/stderr', async () => {
    const pidFile = nextPidFile();
    const error = await runStudioPlanProcessCapture(node, [script, 'sleep', pidFile], opts({ timeout: 3_000 }))
      .then(() => null, (e: unknown) => e as StudioPlanProcessError);
    expect(error).toBeInstanceOf(StudioPlanProcessError);
    expect(error!.code).toBe('timeout');
    expect((error as unknown as { stdout?: unknown }).stdout).toBeUndefined();
    const pids = readPids(pidFile);
    expect(await goneWithin(pids.child)).toBe(true);
    expect(await goneWithin(pids.grandchild)).toBe(true);
  }, 20_000);

  it('rejects containment_failed, with no capture result, on a clean exit whose tree termination cannot be confirmed', async () => {
    const deps: StudioPlanProcessDeps = {
      ...studioPlanProcessDefaults,
      killTree: async (child: ChildProcess, platform: NodeJS.Platform, job: WindowsJob | null) => {
        await killOwnedTree(child, platform, job);
        return false; // synthetic: kill/confirm ran, confirmation withheld
      },
      closeGraceMs: 500,
    };
    const pidFile = nextPidFile();
    const error = await runStudioPlanProcessCaptureWith(deps, node, [script, 'ok', pidFile], opts())
      .then(() => null, (e: unknown) => e as StudioPlanProcessError);
    expect(error).toBeInstanceOf(StudioPlanProcessError);
    expect(error!.code).toBe('containment_failed');
    expect((error as unknown as { stdout?: unknown }).stdout).toBeUndefined();
  }, 20_000);

  describe('fake-event timing races (see report.md assumptions)', () => {
    it('preserves stdout data emitted after exit(0) but before close', async () => {
      const { child, stdout } = fakeCaptureChild();
      const deps: StudioPlanProcessDeps = {
        ...studioPlanProcessDefaults,
        platform: 'win32',
        createJob: () => ({ assign: () => true, terminateAndConfirmEmpty: async () => true, close: () => {} }),
        spawn: (() => child) as unknown as StudioPlanProcessDeps['spawn'],
        closeGraceMs: 500,
      };
      const run = runStudioPlanProcessCaptureWith(deps, node, [script, 'ok'], opts());
      await waitForSpawn(child);
      stdout.emit('data', Buffer.from('before-exit-'));
      (child as unknown as { exitCode: number }).exitCode = 0;
      child.emit('exit', 0, null);
      // Data that arrives strictly between exit and close must not be dropped.
      stdout.emit('data', Buffer.from('after-exit-before-close'));
      child.emit('close', 0, null);
      const result = await run;
      expect(result.stdout.toString('utf8')).toBe('before-exit-after-exit-before-close');
    });

    it('turns a pending successful finalize into a failure when overflow arrives while awaiting tree confirmation', async () => {
      const { child, stdout } = fakeCaptureChild();
      const helper = deferredJob();
      const { job, resolve } = helper;
      const deps: StudioPlanProcessDeps = {
        ...studioPlanProcessDefaults,
        platform: 'win32',
        createJob: () => job,
        spawn: (() => child) as unknown as StudioPlanProcessDeps['spawn'],
        closeGraceMs: 5_000,
      };
      const run = runStudioPlanProcessCaptureWith(deps, node, [script, 'ok'], opts({ maxBuffer: 32 }));
      await waitForSpawn(child);
      stdout.emit('data', Buffer.from('ok-so-far'));
      (child as unknown as { exitCode: number }).exitCode = 0;
      child.emit('exit', 0, null);
      // Tree confirmation begins on exit; confirm it has been entered before
      // injecting overflow data so the overflow genuinely lands on a pending
      // (not yet started, not yet resolved) successful finalize.
      expect(helper.called).toBe(true);
      stdout.emit('data', Buffer.from('x'.repeat(64)));
      child.emit('close', 0, null);
      resolve(true);
      const error = await run.then(() => null, (e: unknown) => e as StudioPlanProcessError);
      expect(error).toBeInstanceOf(StudioPlanProcessError);
      expect(error!.code).toBe('output_overflow');
      expect((error as unknown as { stdout?: unknown }).stdout).toBeUndefined();
    });

    for (const stream of ['stdout', 'stderr'] as const) {
      it(`rejects with output_overflow and no captured body when only ${stream} exceeds the cap`, async () => {
        const { child, stdout, stderr } = fakeCaptureChild();
        const job: WindowsJob = { assign: () => true, terminateAndConfirmEmpty: async () => true, close: () => {} };
        const deps: StudioPlanProcessDeps = {
          ...studioPlanProcessDefaults,
          platform: 'win32',
          createJob: () => job,
          spawn: (() => child) as unknown as StudioPlanProcessDeps['spawn'],
          closeGraceMs: 500,
        };
        const run = runStudioPlanProcessCaptureWith(deps, node, [script, 'ok'], opts({ maxBuffer: 32 }));
        await waitForSpawn(child);
        const emitter = stream === 'stdout' ? stdout : stderr;
        emitter.emit('data', Buffer.from('x'.repeat(65)));
        (child as unknown as { exitCode: number }).exitCode = 0;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
        const error = await run.then(() => null, (e: unknown) => e as StudioPlanProcessError);
        expect(error).toBeInstanceOf(StudioPlanProcessError);
        expect(error!.code).toBe('output_overflow');
        expect((error as unknown as { stdout?: unknown }).stdout).toBeUndefined();
        expect((error as unknown as { body?: unknown }).body).toBeUndefined();
      });
    }
  });
});

describe.runIf(process.platform === 'win32')('Windows owned job (real host)', () => {
  const realJob = (over: (job: WindowsJob) => Partial<WindowsJob>) => () => {
    const job = createWindowsStudioPlanJob();
    return job && { ...job, ...over(job) };
  };

  it('has native job capability on this host', () => {
    const probe = createWindowsStudioPlanJob();
    expect(probe).not.toBeNull();
    probe?.close();
  });

  it('never launches the planner when job assignment fails', async () => {
    const pidFile = nextPidFile();
    const deps = { ...studioPlanProcessDefaults, createJob: realJob(() => ({ assign: () => false })) };
    const error = await failure(runStudioPlanProcessWith(deps, node, [script, 'sleep', pidFile], opts()));
    expect(error.code).toBe('containment_failed');
    expect(error.terminationUncertain).toBe(false);
    await new Promise((done) => setTimeout(done, 500));
    expect(existsSync(pidFile), 'planner fixture must never have run').toBe(false);
  }, 20_000);

  it('rejects a clean exit 0 whose owned-tree emptiness cannot be confirmed', async () => {
    const pidFile = nextPidFile();
    const createJob = realJob((job) => ({
      terminateAndConfirmEmpty: async (ms: number) => { await job.terminateAndConfirmEmpty(ms); return false; },
    }));
    const deps = { ...studioPlanProcessDefaults, createJob, closeGraceMs: 500 };
    const error = await failure(runStudioPlanProcessWith(deps, node, [script, 'orphan-ignore', pidFile], opts()));
    expect(error.code).toBe('containment_failed');
    expect(error.terminationUncertain).toBe(true);
  }, 20_000);
});
