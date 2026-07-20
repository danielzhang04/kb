/**
 * Immediate pickup signal for already-provisioned background runners.
 *
 * This does not execute a card inside the dashboard process and it never opens a
 * Terminal tab. It asks the existing Windows Task Scheduler boundary to start the
 * registered worker now; that worker independently re-runs STOP/preamble, billing,
 * runtime, ownership, and git-isolation gates before doing any work.
 */
import { execFileSync } from 'node:child_process';

export type RunnerTriggerResult =
  | { status: 'triggered'; owner: string; task: string }
  | { status: 'unbound'; owner: string; detail: string }
  | { status: 'unavailable'; owner: string; detail: string }
  | { status: 'failed'; owner: string; detail: string };

export type RunnerTrigger = (owner: string) => RunnerTriggerResult;

export interface TriggerDeps {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  run?: (file: string, args: string[]) => void;
}

/** Closed owner→task mapping. A browser can never select an arbitrary scheduled task. */
export function taskForOwner(
  owner: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (owner !== 'codex-worker') return null;
  return env.DASHBOARD_CODEX_RUNNER_TASK?.trim() || 'kb-codex-runner';
}

export function triggerRunner(owner: string, deps: TriggerDeps = {}): RunnerTriggerResult {
  if (!owner) return { status: 'unbound', owner, detail: 'run has no assigned owner' };
  const task = taskForOwner(owner, deps.env);
  if (!task) return { status: 'unbound', owner, detail: `no background runner is registered for ${owner}` };
  if ((deps.platform ?? process.platform) !== 'win32') {
    return { status: 'unavailable', owner, detail: 'Windows Task Scheduler trigger is unavailable on this host' };
  }

  const run =
    deps.run ??
    ((file: string, args: string[]): void => {
      execFileSync(file, args, { encoding: 'utf-8', windowsHide: true, timeout: 10_000 });
    });
  try {
    run('schtasks.exe', ['/Run', '/TN', task]);
    return { status: 'triggered', owner, task };
  } catch (err) {
    return {
      status: 'failed',
      owner,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
