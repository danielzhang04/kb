/**
 * G3 reply-liveness — after an operator reply/resolve is COMMITTED, derive whether any consumer is
 * actually online for the card's owner, so non-consumption becomes VISIBLE instead of silently hanging.
 *
 * This changes NOTHING about the write: it is a read-only probe computed after the commit, wrapped by the
 * route in a `try` that can never turn a committed 200 into a 500. Three outcomes, in order:
 *   (a) `execution-controller: dashboard` — the Wave A bridge will consume this card once activated. It is
 *       not online yet, so `online:false` with an honest "pending activation" detail.
 *   (b) a registered background runner (via the CLOSED `taskForOwner` map) — query Windows Task Scheduler
 *       READ-ONLY (`schtasks /Query`), short hard timeout + TTL cache so a slow schtasks can NEVER block
 *       the respond route; any fault degrades to `online:false` rather than throwing.
 *   (c) neither — no known consumer for this owner.
 *
 * The schtasks read never involves a credential. The task name is only ever chosen by `taskForOwner`'s
 * closed owner->task map, never from arbitrary owner text.
 */
import { execFileSync } from 'node:child_process';
import { taskForOwner } from './trigger.ts';

export type Consumer = 'dashboard-bridge' | 'scheduled-task' | 'none';

export interface OwnerLiveness {
  consumer: Consumer;
  /** Whether a live consumer is believed to be online RIGHT NOW. `false` for the dashboard bridge until
   *  Wave A activation, and for any owner with no registered/running runner. */
  online: boolean;
  detail: string;
}

/** Reads Windows Task Scheduler for one task and returns its raw `schtasks /Query /FO LIST /V` stdout, or
 *  throws (task absent / timeout / non-win32). Injected in tests; default shells the real read-only query. */
export type SchtasksRunner = (task: string) => string;

interface CacheEntry {
  value: OwnerLiveness;
  expiresAt: number;
}
export type LivenessCache = Map<string, CacheEntry>;

export interface LivenessDeps {
  /** Injected schtasks reader; default shells `schtasks.exe /Query` with a 2s hard timeout. */
  run?: SchtasksRunner;
  /** TTL cache keyed by task name — reused across calls so schtasks is not re-queried per respond. */
  cache?: LivenessCache;
  ttlMs?: number;
  now?: () => number;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

/** Process-lifetime fallback cache when the caller does not supply one. Route callers pass a per-context
 *  cache so tests never collide; unit tests pass their own. */
const DEFAULT_CACHE: LivenessCache = new Map();
const DEFAULT_TTL_MS = 30_000;
/** Hard timeout: schtasks must never block the respond route. execFileSync kills the child after this. */
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

/** Pull the first `Status:` value out of a `schtasks /FO LIST /V` dump (`Ready` / `Running` / `Disabled`…). */
function parseSchtasksStatus(out: string): string {
  for (const line of out.split(/\r?\n/)) {
    const match = /^\s*Status:\s*(.+?)\s*$/i.exec(line);
    if (match) return match[1];
  }
  return '';
}

/**
 * Derive the liveness of `owner`'s consumer for one card. Pure over its injected `run`/`now`/`platform`
 * and `cache`, so it is hermetically unit-testable with no real schtasks. Never throws for an offline or
 * unknown owner — it returns an honest `online:false` outcome instead.
 */
export function ownerLiveness(owner: string, card: { meta: Record<string, unknown> }, deps: LivenessDeps = {}): OwnerLiveness {
  // (a) A dashboard-executed card is consumed by the Wave A bridge — real, but not online until activation.
  if (text(card.meta['execution-controller']) === 'dashboard') {
    return { consumer: 'dashboard-bridge', online: false, detail: 'dashboard bridge will consume on Wave A activation (pending)' };
  }

  const ownerLabel = owner || 'this card';
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    // schtasks is Windows-only; off Windows we cannot probe, so report no known consumer honestly.
    return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };
  }

  const task = taskForOwner(owner, deps.env);
  if (!task) {
    return { consumer: 'none', online: false, detail: `no runner is registered for ${ownerLabel}` };
  }

  // (b) A registered background runner — probe Task Scheduler read-only, TTL-cached by task.
  const cache = deps.cache ?? DEFAULT_CACHE;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
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
    // gh/schtasks absent, timed out, or the task is unregistered — never block or throw; report offline.
    value = { consumer: 'scheduled-task', online: false, detail: `schtasks query for ${task} failed` };
  }
  cache.set(task, { value, expiresAt: now + ttlMs });
  return value;
}
