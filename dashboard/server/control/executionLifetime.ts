import type { ExecutionOutcome } from './execution.ts';

export class ExecutionWithdrawnError extends Error {
  constructor() {
    super('execution lifetime has been withdrawn');
    this.name = 'ExecutionWithdrawnError';
  }
}

export interface ExecutionLifetime {
  readonly withdrawn: Promise<void>;
  revoke(): void;
  assertCurrent(): void;
  track<T>(label: string, issued: Promise<T>): Promise<T>;
  pending(): readonly string[];
}

export type AutomaticExecutionSettlement =
  | { kind: 'boundary'; outcome: ExecutionOutcome }
  | { kind: 'withdrawn' };

export function createExecutionLifetime(): ExecutionLifetime {
  let revoked = false;
  let resolveWithdrawn: (() => void) | undefined;
  const withdrawn = new Promise<void>((resolve) => { resolveWithdrawn = resolve; });
  const pending = new Map<number, string>();
  let nextPendingId = 0;

  return {
    withdrawn,

    revoke() {
      if (revoked) return;
      revoked = true;
      resolveWithdrawn?.();
    },

    assertCurrent() {
      if (revoked) throw new ExecutionWithdrawnError();
    },

    track<T>(label: string, issued: Promise<T>): Promise<T> {
      const pendingId = nextPendingId;
      nextPendingId += 1;
      pending.set(pendingId, label);
      const tracked = issued.then(
        (value) => {
          pending.delete(pendingId);
          return value;
        },
        (error) => {
          pending.delete(pendingId);
          throw error;
        },
      );
      // `tracked` preserves the issued promise's result for callers, while this observer prevents an
      // ignored returned promise from becoming an unhandled rejection.
      void tracked.catch(() => undefined);
      return tracked;
    },

    pending() {
      return [...pending.values()];
    },
  };
}
