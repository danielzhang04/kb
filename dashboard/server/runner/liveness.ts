/** Read the detached runner's PID/start-time record without trusting a recycled PID. */
import { readFileSync } from 'node:fs';
import { runnerForOwner, runnerStatePath, processStartTime } from './trigger.ts';
import type { RunnerState } from './trigger.ts';

export type Consumer = 'dashboard-bridge' | 'runner-process' | 'none';

export interface OwnerLiveness {
  consumer: Consumer;
  online: boolean;
  detail: string;
}

interface CacheEntry { value: OwnerLiveness; expiresAt: number; }
export type LivenessCache = Map<string, CacheEntry>;
export type RunnerStateReader = (owner: string) => RunnerState | null;
export type ProcessStartTimeReader = (pid: number) => number | null;

export interface LivenessDeps {
  readState?: RunnerStateReader;
  processStartTime?: ProcessStartTimeReader;
  cache?: LivenessCache;
  ttlMs?: number;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

const DEFAULT_CACHE: LivenessCache = new Map();
const DEFAULT_TTL_MS = 30_000;

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

export function ownerLiveness(owner: string, card: { meta: Record<string, unknown> }, deps: LivenessDeps = {}): OwnerLiveness {
  if (String(card.meta['execution-controller'] ?? '') === 'dashboard') {
    return { consumer: 'dashboard-bridge', online: false, detail: 'dashboard bridge will consume on Wave A activation (pending)' };
  }

  const runner = runnerForOwner(owner);
  const ownerLabel = owner || 'this card';
  if (!runner) return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };

  const cache = deps.cache ?? DEFAULT_CACHE;
  const now = (deps.now ?? (() => Date.now()))();
  const cached = cache.get(runner.id);
  if (cached && cached.expiresAt > now) return cached.value;

  const state = (deps.readState ?? defaultStateReader(deps.env ?? process.env))(owner);
  const actualStartTime = state ? (deps.processStartTime ?? processStartTime)(state.pid) : null;
  const online = state !== null && actualStartTime === state.startTime;
  const value: OwnerLiveness = online
    ? { consumer: 'runner-process', online: true, detail: `runner ${runner.id} is running (pid ${state.pid})` }
    : { consumer: 'runner-process', online: false, detail: `runner ${runner.id} is not running` };
  cache.set(runner.id, { value, expiresAt: now + (deps.ttlMs ?? DEFAULT_TTL_MS) });
  return value;
}
