/**
 * Per-run FIFO serialization for lifecycle controls.
 *
 * Runtime cancellation and Manager recovery must not hold the fleet-wide ops/Git writer lock, but
 * controls for the same logical run cannot interleave with canonical activation. This process-local
 * lock narrows that exclusion to one subject/run pair; durable store CAS remains the cross-process
 * authority.
 */
export class RunControlTransactions {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(subject: string, runRef: string, operation: () => Promise<T>): Promise<T> {
    const key = `${subject}\0${runRef}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

/** Bound one runtime-control acknowledgement without cancelling the underlying operation implicitly. */
export function withControlDeadline<T>(promise: Promise<T>, timeoutMs: number, detail: string): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new Error('runtime-control deadline is invalid'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(detail)), timeoutMs);
    timer.unref?.();
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
