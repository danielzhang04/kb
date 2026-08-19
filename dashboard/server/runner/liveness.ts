/**
 * Reply-liveness for the platform-selected background runner.
 *
 * Windows retains its read-only Task Scheduler probe. Linux reads the
 * detached runner's PID/start-time record and rejects recycled PIDs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  processStartTime,
  runnerForOwner,
  runnerStatePath,
  taskForOwner,
} from './trigger.ts';
import type { RunnerState } from './trigger.ts';

export type Consumer = 'dashboard-bridge' | 'scheduled-task' | 'runner-process' | 'none';

export interface OwnerLiveness {
  consumer: Consumer;
  online: boolean;
  detail: string;
}

export type SchtasksRunner = (task: string) => string;
export type RunnerStateReader = (owner: string) => RunnerState | null;
export type ProcessStartTimeReader = (pid: number) => number | null;

interface CacheEntry {
  value: OwnerLiveness;
  expiresAt: number;
}
export type LivenessCache = Map<string, CacheEntry>;

export interface LivenessDeps {
  /** Windows Task Scheduler read seam. */
  run?: SchtasksRunner;
  /** Linux runner-state and /proc seams. */
  readState?: RunnerStateReader;
  processStartTime?: ProcessStartTimeReader;
  cache?: LivenessCache;
  ttlMs?: number;
  now?: () => number;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

const DEFAULT_CACHE: LivenessCache = new Map();
const DEFAULT_TTL_MS = 30_000;
const SCHTASKS_TIMEOUT_MS = 2_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function defaultSchtasksRunner(task: string): string {
  return execFileSync('schtasks.exe', ['/Query', '/TN', task, '/FO', 'LIST', '/V'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: SCHTASKS_TIMEOUT_MS,
  });
}

function parseSchtasksStatus(out: string): string {
  for (const line of out.split(/\r?\n/)) {
    const match = /^\s*Status:\s*(.+?)\s*$/i.exec(line);
    if (match) return match[1];
  }
  return '';
}

function defaultStateReader(env: Record<string, string | undefined>): RunnerStateReader {
  return (owner) => {
    try {
      const state = JSON.parse(readFileSync(runnerStatePath(owner, env), 'utf8')) as Partial<RunnerState>;
      return Number.isInteger(state.pid) && Number.isInteger(state.startTime)
        ? { pid: state.pid!, startTime: state.startTime! }
        : null;
    } catch {
      return null;
    }
  };
}

function scheduledTaskLiveness(owner: string, deps: LivenessDeps): OwnerLiveness {
  const ownerLabel = owner || 'this card';
  const task = taskForOwner(owner, deps.env);
  if (!task) return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };

  const cache = deps.cache ?? DEFAULT_CACHE;
  const now = (deps.now ?? (() => Date.now()))();
  const cached = cache.get(task);
  if (cached && cached.expiresAt > now) return cached.value;

  const run = deps.run ?? defaultSchtasksRunner;
  let value: OwnerLiveness;
  try {
    const status = parseSchtasksStatus(run(task));
    const online = status === 'Running' || status === 'Ready';
    value = {
      consumer: 'scheduled-task',
      online,
      detail: online
        ? `scheduled task ${task} is ${status}`
        : `scheduled task ${task} is not scheduled to run${status ? ` (status: ${status})` : ''}`,
    };
  } catch {
    value = { consumer: 'scheduled-task', online: false, detail: `schtasks query for ${task} failed` };
  }
  cache.set(task, { value, expiresAt: now + (deps.ttlMs ?? DEFAULT_TTL_MS) });
  return value;
}

function runnerProcessLiveness(owner: string, deps: LivenessDeps): OwnerLiveness {
  const ownerLabel = owner || 'this card';
  const runner = runnerForOwner(owner);
  if (!runner) return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };

  const cache = deps.cache ?? DEFAULT_CACHE;
  const cacheKey = `linux:${runner.id}`;
  const now = (deps.now ?? (() => Date.now()))();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const state = (deps.readState ?? defaultStateReader(deps.env ?? process.env))(owner);
  const actualStartTime = state ? (deps.processStartTime ?? processStartTime)(state.pid) : null;
  const online = state !== null && actualStartTime === state.startTime;
  const value: OwnerLiveness = online
    ? { consumer: 'runner-process', online: true, detail: `runner ${runner.id} is running (pid ${state.pid})` }
    : { consumer: 'runner-process', online: false, detail: `runner ${runner.id} is not running` };
  cache.set(cacheKey, { value, expiresAt: now + (deps.ttlMs ?? DEFAULT_TTL_MS) });
  return value;
}

export function ownerLiveness(
  owner: string,
  card: { meta: Record<string, unknown> },
  deps: LivenessDeps = {},
): OwnerLiveness {
  if (text(card.meta['execution-controller']) === 'dashboard') {
    return {
      consumer: 'dashboard-bridge',
      online: false,
      detail: 'dashboard bridge will consume on Wave A activation (pending)',
    };
  }

  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') return scheduledTaskLiveness(owner, deps);
  if (platform === 'linux') return runnerProcessLiveness(owner, deps);
  const ownerLabel = owner || 'this card';
  return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };
}
