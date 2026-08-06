/**
 * Immediate pickup signal for the POSIX runner.
 *
 * The dashboard does not execute a card itself. It starts the closed, owned
 * runner as the current user; that runner repeats every preamble, billing,
 * ownership, and git-isolation check before it can do work.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { posix } from 'node:path';
import { kbStateDir } from '../platform/stateDir.ts';
import { pythonInvocation } from '../platform/python.ts';

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
  | { status: 'failed'; owner: string; detail: string };

export type RunnerTrigger = (owner: string) => RunnerTriggerResult;

export interface DetachedChild {
  pid?: number;
  unref(): void;
}

export interface TriggerDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  spawn?: (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: 'ignore' }) => DetachedChild;
  processStartTime?: (pid: number) => number | null;
  writeState?: (owner: string, state: RunnerState) => void;
}

/** Closed owner-to-runner mapping. A browser can never select an arbitrary program. */
export function runnerForOwner(owner: string, repoRoot = process.cwd()): RunnerDefinition | null {
  if (owner !== 'codex-worker') return null;
  return { id: CODEX_RUNNER_ID, script: posix.resolve(repoRoot, 'scripts', 'agent_runner.sh') };
}

export function runnerStatePath(owner: string, env: Record<string, string | undefined> = process.env): string {
  return posix.resolve(kbStateDir('runner', { env }), `${owner}.json`);
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

export function writeRunnerState(owner: string, state: RunnerState, env: Record<string, string | undefined> = process.env): void {
  const path = runnerStatePath(owner, env);
  const dir = posix.resolve(path, '..');
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

export function triggerRunner(owner: string, deps: TriggerDeps = {}): RunnerTriggerResult {
  if (!owner) return { status: 'unbound', owner, detail: 'run has no assigned owner' };
  const cwd = deps.cwd ?? process.cwd();
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env, ...deps.env };
  const python = pythonInvocation({ env: inheritedEnv });
  const env: NodeJS.ProcessEnv = { ...inheritedEnv, KB_PYTHON: inheritedEnv.KB_PYTHON?.trim() || python.command };
  const repoRoot = env.DASHBOARD_REPO_ROOT?.trim() || posix.resolve(cwd, '..');
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
    if (startTime === null) return { status: 'failed', owner, detail: `could not read start time for runner pid ${child.pid}` };
    (deps.writeState ?? ((runnerOwner, state) => writeRunnerState(runnerOwner, state, env)))(owner, { pid: child.pid, startTime });
    child.unref();
    return { status: 'triggered', owner, task: runner.id };
  } catch (err) {
    return { status: 'failed', owner, detail: err instanceof Error ? err.message : String(err) };
  }
}
