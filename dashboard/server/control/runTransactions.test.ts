import { describe, expect, it } from 'vitest';
import { RunControlTransactions, withControlDeadline } from './runTransactions.ts';

describe('RunControlTransactions', () => {
  it('serializes controls for one subject/run in FIFO order', async () => {
    const transactions = new RunControlTransactions();
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = transactions.run('alice', 'run-1', async () => {
      calls.push('first:start');
      await held;
      calls.push('first:end');
    });
    await Promise.resolve();
    const second = transactions.run('alice', 'run-1', async () => {
      calls.push('second');
    });
    await Promise.resolve();
    expect(calls).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not block unrelated runs and releases a failed run transaction', async () => {
    const transactions = new RunControlTransactions();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = transactions.run('alice', 'run-1', async () => held);
    await Promise.resolve();
    await expect(transactions.run('alice', 'run-2', async () => 'other')).resolves.toBe('other');
    release();
    await first;
    await expect(transactions.run('alice', 'run-1', async () => {
      throw new Error('failed');
    })).rejects.toThrow('failed');
    await expect(transactions.run('alice', 'run-1', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('bounds an acknowledgement deadline and clears it on success', async () => {
    await expect(withControlDeadline(Promise.resolve('ok'), 100, 'timed out')).resolves.toBe('ok');
    await expect(withControlDeadline(new Promise<never>(() => {}), 5, 'timed out')).rejects.toThrow('timed out');
  });
});
