export type ResourceClass = 'control' | 'agents' | 'render' | 'pty' | 'git';

export type ResourceSnapshot = Record<ResourceClass, { limit: number; active: number; queued: number }>;

export interface ResourceLimiter {
  run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T>;
  snapshot(): ResourceSnapshot;
  closeAndCancel(reason: string): number;
  open(): void;
  queuedCount(): number;
  accepting(): boolean;
}

const DEFAULTS: Record<ResourceClass, number> = { control: 4, agents: 2, render: 1, pty: 4, git: 1 };

export class ExecutionAdmissionClosedError extends Error {
  readonly name = 'ExecutionAdmissionClosedError';
  readonly reason: string;

  constructor(reason: string) {
    super(`execution admission is closed: ${reason}`);
    this.reason = reason;
  }
}

export function createResourceLimiter(overrides: Partial<Record<ResourceClass, number>> = {}): ResourceLimiter {
  const limits = { ...DEFAULTS, ...overrides };
  for (const [kind, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${kind} concurrency must be a positive integer`);
    }
  }

  type Waiter = { resolve: () => void; reject: (error: Error) => void };
  const state = Object.fromEntries(
    Object.keys(limits).map((kind) => [kind, { active: 0, queue: [] as Waiter[] }]),
  ) as Record<ResourceClass, { active: number; queue: Waiter[] }>;
  let admission: { accepting: true } | { accepting: false; reason: string } = { accepting: true };

  async function acquire(kind: ResourceClass): Promise<void> {
    if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
    const slot = state[kind];
    if (slot.active < limits[kind]) {
      slot.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => slot.queue.push({ resolve, reject }));
  }

  function release(kind: ResourceClass): void {
    const slot = state[kind];
    const next = admission.accepting ? slot.queue.shift() : undefined;
    if (next) next.resolve();
    else slot.active -= 1;
  }

  async function run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T> {
    await acquire(kind);
    try {
      if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
      return await operation();
    } finally {
      release(kind);
    }
  }

  return {
    run,
    snapshot: () => Object.fromEntries(
      (Object.keys(limits) as ResourceClass[]).map((kind) => [kind, {
        limit: limits[kind],
        active: state[kind].active,
        queued: state[kind].queue.length,
      }]),
    ) as ResourceSnapshot,
    closeAndCancel(reason) {
      if (!reason || /[\r\n]/.test(reason)) throw new Error('admission close reason is invalid');
      admission = { accepting: false, reason };
      let cancelled = 0;
      for (const slot of Object.values(state)) {
        while (slot.queue.length) {
          slot.queue.shift()!.reject(new ExecutionAdmissionClosedError(reason));
          cancelled += 1;
        }
      }
      return cancelled;
    },
    open() {
      if (Object.values(state).some((slot) => slot.active || slot.queue.length)) {
        throw new Error('cannot reopen a non-drained limiter');
      }
      admission = { accepting: true };
    },
    queuedCount: () => Object.values(state).reduce((total, slot) => total + slot.queue.length, 0),
    accepting: () => admission.accepting,
  };
}

export const runtimeResourceLimiter = createResourceLimiter();
