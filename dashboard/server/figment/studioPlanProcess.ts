import { spawn, type ChildProcess } from 'node:child_process';
import { createWindowsStudioPlanJob, type WindowsJob } from './windowsStudioPlanJob.ts';

// Bounded runner for the trusted Figment studio planner subprocess. On every
// terminal path (normal exit included) the whole owned tree is killed and
// confirmed empty BEFORE the promise settles. Windows: a stdin-gated node
// wrapper is assigned to an owned Job Object before it receives the planner
// packet, so the planner and all its CreateProcess descendants are job members
// from birth; no job, no launch. POSIX: an owned detached process group; this
// assumes the trusted planner never calls setsid/setpgid to leave the group
// (containment, not a sandbox; no cgroup layer). When
// tree termination cannot be confirmed the error carries
// `terminationUncertain: true` so the caller keeps its allocation and stops
// accepting requests.

export type StudioPlanProcessOptions = {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
};

export type StudioPlanProcessFailure =
  | 'invalid_options'
  | 'spawn_failed'
  | 'exit_nonzero'
  | 'timeout'
  | 'output_overflow'
  | 'containment_failed';

export class StudioPlanProcessError extends Error {
  readonly code: StudioPlanProcessFailure;
  readonly terminationUncertain: boolean;
  constructor(code: StudioPlanProcessFailure, terminationUncertain: boolean) {
    // Fixed message: never raw stderr, argv, or filesystem paths.
    super(`studio planner process failed: ${code}`);
    this.name = 'StudioPlanProcessError';
    this.code = code;
    this.terminationUncertain = terminationUncertain;
  }
}

export const JOB_CONFIRM_DEADLINE_MS = 5_000;
export const CLOSE_GRACE_MS = 2_000;
const POSIX_PROBE_MS = 2_000;
/** Wrapper exit code meaning "the planner itself failed to spawn". */
export const WRAPPER_SPAWN_FAILED_EXIT = 0x5e_ed_0f;

// Harmless Windows wrapper: blocks on stdin until the runner has assigned it
// to the owned job, then spawns the planner (argv/cwd/shell:false preserved,
// output inherited onto the runner's pipes) and mirrors its exit code. It never
// sets detached/breakaway. Stdin EOF without a valid packet launches nothing.
export const WINDOWS_WRAPPER_SOURCE = `
const { spawn } = require('node:child_process');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let p;
  try { p = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { process.exit(${WRAPPER_SPAWN_FAILED_EXIT}); }
  if (!p || typeof p.command !== 'string' || !Array.isArray(p.args)) process.exit(${WRAPPER_SPAWN_FAILED_EXIT});
  let c;
  try {
    c = spawn(p.command, p.args, { cwd: p.cwd, shell: false, windowsHide: p.windowsHide === true, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch { process.exit(${WRAPPER_SPAWN_FAILED_EXIT}); }
  let started = false;
  c.once('spawn', () => { started = true; });
  c.once('error', () => { if (!started) process.exit(${WRAPPER_SPAWN_FAILED_EXIT}); });
  c.once('exit', (code) => process.exit(code === null ? 1 : code));
});
`;

/** Resolves true only when the whole tree is confirmed terminated. */
export type KillTree = (child: ChildProcess, platform: NodeJS.Platform, job: WindowsJob | null) => Promise<boolean>;

export type StudioPlanProcessDeps = {
  platform: NodeJS.Platform;
  spawn: typeof spawn;
  killTree: KillTree;
  closeGraceMs: number;
  /** Windows only: owned job factory; null means no containment, so no launch. */
  createJob: () => WindowsJob | null;
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function parentLive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export const killOwnedTree: KillTree = async (child, platform, job) => {
  const pid = child.pid;
  if (pid === undefined) return false;
  if (platform === 'win32') {
    // Only the owned job reaches descendants whose parent already exited.
    if (!job) return false;
    const ok = await job.terminateAndConfirmEmpty(JOB_CONFIRM_DEADLINE_MS);
    if (parentLive(child)) child.kill('SIGKILL');
    return ok;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* group may already be gone; probed below */ }
  const deadline = Date.now() + POSIX_PROBE_MS;
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) return true;
    await sleep(50);
  }
  return !groupAlive(pid);
};

export const studioPlanProcessDefaults: StudioPlanProcessDeps = {
  platform: process.platform,
  spawn,
  killTree: killOwnedTree,
  closeGraceMs: CLOSE_GRACE_MS,
  createJob: createWindowsStudioPlanJob,
};

/**
 * Inherited environment for the Windows gate wrapper, minus NODE_OPTIONS (any
 * case): a `--require`/`--import` preload would run code in the wrapper before
 * it is assigned to the job. Everything else stays normal inherited config;
 * values are never inspected or logged. The caller's env is not mutated.
 */
export function gateEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = {};
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() !== 'NODE_OPTIONS') copy[name] = env[name];
  }
  return copy;
}

function validOptions(options: StudioPlanProcessOptions): boolean {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  return positive(options.timeout) && positive(options.maxBuffer) && typeof options.cwd === 'string';
}

/** Test seam: same runner with injected platform/spawn/killTree/grace. */
export function runStudioPlanProcessWith(
  deps: StudioPlanProcessDeps,
  command: string,
  args: readonly string[],
  options: StudioPlanProcessOptions,
): Promise<void> {
  if (!validOptions(options)) return Promise.reject(new StudioPlanProcessError('invalid_options', false));
  const win = deps.platform === 'win32';
  return new Promise<void>((resolve, reject) => {
    let job: WindowsJob | null = null;
    if (win) {
      try { job = deps.createJob(); } catch { job = null; }
      // No owned job: refuse before anything is launched.
      if (!job) { reject(new StudioPlanProcessError('containment_failed', false)); return; }
    }
    let child: ChildProcess;
    try {
      child = win
        ? deps.spawn(process.execPath, ['-e', WINDOWS_WRAPPER_SOURCE], {
          cwd: options.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: gateEnv(process.env),
        })
        : deps.spawn(command, [...args], {
          cwd: options.cwd,
          shell: false,
          windowsHide: options.windowsHide,
          stdio: ['ignore', 'pipe', 'pipe'],
          // POSIX: own a process group so the whole tree can be signalled.
          detached: true,
        });
    } catch {
      job?.close();
      reject(new StudioPlanProcessError('spawn_failed', false));
      return;
    }
    let settled = false;
    let spawned = false;
    let terminating = false;
    let closed = false;
    let bytes = 0;
    const closeWaiters: Array<() => void> = [];
    const settle = (error?: StudioPlanProcessError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Closing the only handle: KILL_ON_JOB_CLOSE backstops any member left.
      job?.close();
      if (error) reject(error); else resolve();
    };
    const waitClosed = (ms: number) => new Promise<boolean>((done) => {
      if (closed) { done(true); return; }
      const grace = setTimeout(() => done(false), ms);
      closeWaiters.push(() => { clearTimeout(grace); done(true); });
    });
    // Every terminal path: kill + confirm the owned tree empty, then settle.
    // `failure === null` is a clean exit 0, which still cannot resolve while
    // any owned descendant may survive.
    const finalize = async (failure: StudioPlanProcessFailure | null) => {
      if (terminating || settled) return;
      terminating = true;
      clearTimeout(timer);
      let confirmed = false;
      try { confirmed = await deps.killTree(child, deps.platform, job); } catch { confirmed = false; }
      const closedInTime = await waitClosed(deps.closeGraceMs);
      if (!closedInTime) {
        // A surviving holder keeps the pipes open; release our ends and report it.
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      const uncertain = !(confirmed && closedInTime);
      if (failure === null) settle(uncertain ? new StudioPlanProcessError('containment_failed', true) : undefined);
      else settle(new StudioPlanProcessError(failure, uncertain));
    };
    // Wrapper spawned but never contained: it has launched nothing (still
    // blocked on stdin). Kill it and confirm it closed within the grace bound.
    const refuseUncontained = async () => {
      if (terminating || settled) return;
      terminating = true;
      clearTimeout(timer);
      child.stdin?.destroy();
      if (parentLive(child)) child.kill('SIGKILL');
      const closedInTime = await waitClosed(deps.closeGraceMs);
      settle(new StudioPlanProcessError('containment_failed', !closedInTime));
    };
    const timer = setTimeout(() => { void finalize('timeout'); }, options.timeout);
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxBuffer) void finalize('output_overflow');
    };
    // Keep draining (and discarding) so a held pipe cannot stall termination.
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.stdin?.on('error', () => { /* wrapper gone; its exit drives finalize */ });
    child.once('spawn', () => {
      spawned = true;
      if (!job || terminating) return;
      // Assign BEFORE the packet: nothing real runs outside the job.
      let contained = false;
      try { contained = child.pid !== undefined && parentLive(child) && job.assign(child.pid); } catch { contained = false; }
      if (!contained) { void refuseUncontained(); return; }
      child.stdin?.end(JSON.stringify({ command, args: [...args], cwd: options.cwd, windowsHide: options.windowsHide }));
    });
    child.on('error', () => {
      if (!spawned && !terminating) settle(new StudioPlanProcessError('spawn_failed', false));
    });
    child.once('exit', (code: number | null) => {
      if (terminating || !spawned) return;
      if (code === 0) { void finalize(null); return; }
      void finalize(win && code === WRAPPER_SPAWN_FAILED_EXIT ? 'spawn_failed' : 'exit_nonzero');
    });
    child.once('close', () => {
      closed = true;
      for (const wake of closeWaiters.splice(0)) wake();
    });
  });
}

export function runStudioPlanProcess(
  command: string,
  args: readonly string[],
  options: StudioPlanProcessOptions,
): Promise<void> {
  return runStudioPlanProcessWith(studioPlanProcessDefaults, command, args, options);
}
