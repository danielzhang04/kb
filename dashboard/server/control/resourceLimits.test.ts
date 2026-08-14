import { describe, expect, it, vi } from 'vitest';
import { createResourceLimiter } from './resourceLimits.ts';

describe('ResourceLimiter', () => {
  it('limits each resource independently and exposes saturation', async () => {
    const limiter = createResourceLimiter({ control: 2, agents: 1, render: 1, pty: 1, git: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = limiter.run('agents', () => held);
    const secondStarted = vi.fn();
    const second = limiter.run('agents', async () => { secondStarted(); });
    await Promise.resolve();
    expect(secondStarted).not.toHaveBeenCalled();
    expect(limiter.snapshot().agents).toEqual({ limit: 1, active: 1, queued: 1 });
    expect(limiter.snapshot().render).toEqual({ limit: 1, active: 0, queued: 0 });
    await limiter.run('control', async () => undefined);
    release(); await Promise.all([first, second]);
    expect(secondStarted).toHaveBeenCalledOnce();
  });

  it('keeps render and agent queues independent', async () => {
    const limiter = createResourceLimiter({ agents: 1, render: 1 });
    const events: string[] = [];
    let release!: () => void;
    const held = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    await limiter.run('render', async () => { events.push('render'); });
    expect(events).toEqual(['render']);
    release(); await held;
  });

  it('reserves a released slot for the FIFO waiter before a new caller can enter', async () => {
    const limiter = createResourceLimiter({ agents: 1 });
    const events: string[] = [];
    let release!: () => void;
    const first = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    const second = limiter.run('agents', async () => { events.push('second'); });
    await Promise.resolve(); release();
    const third = limiter.run('agents', async () => { events.push('third'); });
    await Promise.all([first, second, third]);
    expect(events).toEqual(['second', 'third']);
  });

  it('sets the PTY resource ceiling to four', () => {
    expect(createResourceLimiter().snapshot().pty.limit).toBe(4);
  });

  it('refuses zero and unbounded resource limits', () => {
    expect(() => createResourceLimiter({ git: 0 })).toThrow('git concurrency must be a positive integer');
    expect(() => createResourceLimiter({ render: Infinity })).toThrow('render concurrency must be a positive integer');
  });

  it('closes admission and rejects all queued work before lock can drain', async () => {
    const limiter = createResourceLimiter({ agents: 1 });
    let release!: () => void;
    const active = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    const queued = limiter.run('agents', async () => undefined);
    await Promise.resolve();
    expect(limiter.closeAndCancel('execution-lock')).toBe(1);
    await expect(queued).rejects.toMatchObject({ name: 'ExecutionAdmissionClosedError', reason: 'execution-lock' });
    await expect(limiter.run('control', async () => undefined)).rejects.toMatchObject({ name: 'ExecutionAdmissionClosedError' });
    expect(limiter.queuedCount()).toBe(0); release(); await active;
    limiter.open(); await expect(limiter.run('control', async () => undefined)).resolves.toBeUndefined();
  });
});
