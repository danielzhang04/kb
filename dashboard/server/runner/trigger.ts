/**
 * Immediate pickup signal for already-provisioned background runners.
 *
 * The dashboard never executes a card itself. On Windows it asks the existing
 * Task Scheduler boundary to start the registered worker. On Linux the
 * capability is intentionally disabled for this cutover, but the additive
 * detached-spawn implementation is present for the deferred activation arc.
 */
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import { resolvePython } from '../runtime/python.ts';

export const CODEX_RUNNER_ID = 'kb-codex-runner';

export interface RunnerState {
  pid: number;
  startTime: number;
}

export interface RunnerDefinition {
  id: string;
  script: string;
}

export type RunnerTriggerResult =
  | { status: 'triggered'; owner: string; task: string }
  | { status: 'unbound'; owner: string; detail: string }
  | { status: 'unavailable'; owner: string; detail: string }
  | { status: 'failed'; owner: string; detail: string };

export type RunnerTrigger = (owner: string) => RunnerTriggerResult;

export interface DetachedChild {
  pid?: number;
  unref(): void;
}

export interface TriggerDeps {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  /** Windows Task Scheduler invocation seam. */
  run?: (file: string, args: string[]) => void;
  cwd?: string;
  /** Linux detached-spawn seam. */
  spawn?: (
    file: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: 'ignore' },
  ) => DetachedChild;
  processStartTime?: (pid: number) => number | null;
  writeState?: (owner: string, state: RunnerState) => void;
}

/** Closed owner-to-task mapping. A browser can never select an arbitrary scheduled task. */
export function taskForOwner(
  owner: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (owner !== 'codex-worker') return null;
  return env.DASHBOARD_CODEX_RUNNER_TASK?.trim() || CODEX_RUNNER_ID;
}

/** Closed owner-to-runner mapping. A browser can never select an arbitrary program. */
export function runnerForOwner(owner: string, repoRoot = process.cwd()): RunnerDefinition | null {
  if (owner !== 'codex-worker') return null;
  return { id: CODEX_RUNNER_ID, script: join(repoRoot, 'scripts', 'agent_runner.sh') };
}

/** State lives below main's exact DASHBOARD_STATE_ROOT contract. */
export function runnerStatePath(
  owner: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveDashboardStateRoot(env), 'runner', `${owner}.json`);
}

/** Linux /proc process start time (stat field 22), in clock ticks. */
export function processStartTime(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return Number.parseInt(fields[19] ?? '', 10) || null;
  } catch {
    return null;
  }
}

/** Atomically publish a mode-0600 Linux runner PID/start-time record. */
export function writeRunnerState(
  owner: string,
  state: RunnerState,
  env: Record<string, string | undefined> = process.env,
): void {
  const path = runnerStatePath(owner, env);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

function triggerWindows(owner: string, deps: TriggerDeps): RunnerTriggerResult {
  const task = taskForOwner(owner, deps.env);
  if (!task) return { status: 'unbound', owner, detail: `no background runner is registered for ${owner}` };
  const run = deps.run ?? ((file: string, args: string[]): void => {
    execFileSync(file, args, { encoding: 'utf-8', windowsHide: true, timeout: 10_000 });
  });
  try {
    run('schtasks.exe', ['/Run', '/TN', task]);
    return { status: 'triggered', owner, task };
  } catch (err) {
    return { status: 'failed', owner, detail: err instanceof Error ? err.message : String(err) };
  }
}

function triggerLinux(owner: string, deps: TriggerDeps): RunnerTriggerResult {
  const cwd = deps.cwd ?? process.cwd();
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env, ...deps.env };
  const python = resolvePython('linux');
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    KB_PYTHON: inheritedEnv.KB_PYTHON?.trim() || python.command,
  };
  const repoRoot = env.DASHBOARD_REPO_ROOT?.trim() || resolve(cwd, '..');
  const runner = runnerForOwner(owner, repoRoot);
  if (!runner) return { status: 'unbound', owner, detail: `no background runner is registered for ${owner}` };
  const spawn = deps.spawn ?? ((file, args, options) => nodeSpawn(file, args, options));
  try {
    const child = spawn('/bin/sh', [runner.script, '--agent', owner, '--repo-root', repoRoot], {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: 'ignore',
    });
    if (!child.pid) return { status: 'failed', owner, detail: `${runner.id} did not return a pid` };
    const startTime = (deps.processStartTime ?? processStartTime)(child.pid);
    if (startTime === null) {
      return { status: 'failed', owner, detail: `could not read start time for runner pid ${child.pid}` };
    }
    (deps.writeState ?? ((runnerOwner, state) => writeRunnerState(runnerOwner, state, env)))(
      owner,
      { pid: child.pid, startTime },
    );
    child.unref();
    return { status: 'triggered', owner, task: runner.id };
  } catch (err) {
    return { status: 'failed', owner, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function triggerRunner(owner: string, deps: TriggerDeps = {}): RunnerTriggerResult {
  if (!owner) return { status: 'unbound', owner, detail: 'run has no assigned owner' };
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') return triggerWindows(owner, deps);
  if (platform === 'linux') return triggerLinux(owner, deps);
  return { status: 'unavailable', owner, detail: `background runner trigger is unavailable on ${platform}` };
}
