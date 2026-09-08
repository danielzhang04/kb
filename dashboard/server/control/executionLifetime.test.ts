import { describe, expect, it } from 'vitest';
import {
  createExecutionLifetime,
  ExecutionWithdrawnError,
} from './executionLifetime.ts';

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ExecutionLifetime', () => {
  it('withdraws synchronously and only once', async () => {
    const lifetime = createExecutionLifetime();
    let withdrawals = 0;
    void lifetime.withdrawn.then(() => { withdrawals += 1; });

    lifetime.assertCurrent();
    lifetime.revoke();
    expect(() => lifetime.assertCurrent()).toThrow(ExecutionWithdrawnError);
    lifetime.revoke();
    expect(() => lifetime.assertCurrent()).toThrow('execution lifetime has been withdrawn');

    await lifetime.withdrawn;
    expect(withdrawals).toBe(1);
  });

  it('tracks held promises until each successful settlement', async () => {
    const lifetime = createExecutionLifetime();
    const held = deferred<number>();
    const tracked = lifetime.track('manager:ensure', held.promise);

    expect(lifetime.pending()).toEqual(['manager:ensure']);
    held.resolve(7);
    await expect(tracked).resolves.toBe(7);
    expect(lifetime.pending()).toEqual([]);
  });

  it('propagates error and falsey rejection values while observing each returned chain', async () => {
    const lifetime = createExecutionLifetime();
    const error = new Error('held rejection');
    const rejected = lifetime.track('first', Promise.reject(error));
    const falsey = lifetime.track('second', Promise.reject(undefined));

    await expect(rejected).rejects.toBe(error);
    await expect(falsey).rejects.toBeUndefined();
    expect(lifetime.pending()).toEqual([]);
  });

  it('observes rejected tracked work when its caller ignores the returned chain', async () => {
    const lifetime = createExecutionLifetime();
    void lifetime.track('ignored', Promise.reject('ignored rejection'));

    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(lifetime.pending()).toEqual([]);
  });

  it('keeps multiple promises with the same label as independent barriers', async () => {
    const lifetime = createExecutionLifetime();
    const first = deferred<void>();
    const second = deferred<void>();
    const firstTracked = lifetime.track('ledger:settle', first.promise);
    const secondTracked = lifetime.track('ledger:settle', second.promise);

    expect(lifetime.pending()).toEqual(['ledger:settle', 'ledger:settle']);
    first.resolve();
    await firstTracked;
    expect(lifetime.pending()).toEqual(['ledger:settle']);
    second.resolve();
    await secondTracked;
    expect(lifetime.pending()).toEqual([]);
  });

  it('observes already-issued work after withdrawal without creating a new admission', async () => {
    const lifetime = createExecutionLifetime();
    const held = deferred<string>();
    lifetime.revoke();

    const tracked = lifetime.track('issued-before-cleanup', held.promise);
    expect(lifetime.pending()).toEqual(['issued-before-cleanup']);
    expect(() => lifetime.assertCurrent()).toThrow(ExecutionWithdrawnError);
    held.resolve('settled');
    await expect(tracked).resolves.toBe('settled');
    expect(lifetime.pending()).toEqual([]);
  });

});
