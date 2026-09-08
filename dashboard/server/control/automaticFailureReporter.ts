import type { ControlPlaneStore } from './storeTypes.ts';

type Awaitable<T> = T | PromiseLike<T>;

export type AutomaticExecutionSurface =
  | 'approved-launch'
  | 'manager-successor'
  | 'post-ack-execution'
  | 'automatic-resume';

export type AutomaticFailureLogger = (line: string) => unknown;

const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function logNeverThrow(log: AutomaticFailureLogger, line: string): void {
  try {
    void Promise.resolve(log(line)).catch(() => undefined);
  } catch {
    // The logger is the last available surface. Its failure must not create another rejection.
  }
}

function safeRunRef(runRef: string): string {
  return SAFE_REF_RE.test(runRef) ? runRef : 'invalid-run-ref';
}

/**
 * Own one intentionally detached automatic-execution promise through all of its callbacks.
 * Reporter throws/rejections get one bounded, metadata-only log attempt; logger failure is terminally
 * swallowed here rather than by a process-wide `unhandledRejection` handler.
 */
export function superviseDetachedAutomaticExecution<T>(
  operation: PromiseLike<T>,
  options: {
    surface: AutomaticExecutionSurface;
    runRef: string;
    onFulfilled?: (value: T) => Awaitable<void>;
    onRejected: (reason: unknown) => Awaitable<void>;
    log?: AutomaticFailureLogger;
  },
): void {
  const log = options.log ?? ((line: string) => { console.error(line); });
  const runRef = safeRunRef(options.runRef);
  let fallbackAttempted = false;
  const fallback = async (): Promise<void> => {
    if (fallbackAttempted) return;
    fallbackAttempted = true;
    try {
      await log(`[automatic-execution:${options.surface}] detached reporter failed for run ${runRef}`);
    } catch {
      // At most one fallback attempt. There is nowhere safer to report a failed logger.
    }
  };
  const invoke = async (reporter: () => Awaitable<void>): Promise<void> => {
    try {
      await reporter();
    } catch {
      await fallback();
    }
  };

  void Promise.resolve(operation).then(
    (value) => invoke(() => options.onFulfilled?.(value)),
    (reason: unknown) => invoke(() => options.onRejected(reason)),
  ).catch(() => fallback());
}

/** Surface a launch failure as an intervention without allowing its store/logger seams to throw. */
export function surfaceAutomaticExecutionFailure(
  store: Pick<ControlPlaneStore, 'createHumanRequest'>,
  subject: string,
  runRef: string,
  error: unknown,
  log: AutomaticFailureLogger = (line) => { console.error(line); },
): void {
  try {
    const result = store.createHumanRequest(subject, runRef, {
      kind: 'intervention', title: 'Automatic execution needs intervention',
      prompt: error instanceof Error ? error.message : 'automatic execution adapter failed',
    });
    if (!result.ok) {
      logNeverThrow(log, `[automatic-execution:approved-launch] detached reporter failed for run ${safeRunRef(runRef)}`);
    }
  } catch {
    logNeverThrow(log, `[automatic-execution:approved-launch] detached reporter failed for run ${safeRunRef(runRef)}`);
  }
}
