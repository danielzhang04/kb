import { describe, expect, it, vi } from 'vitest';
import {
  ManagedSessionBroker,
  type BrokerConsumption,
  type BrokerMutation,
  type BrokerPersistence,
  type ManagedSessionAdapter,
} from './broker.ts';

function persistenceHarness() {
  let active = false;
  let revision = 0;
  const queued: string[] = [];
  const receipts = new Map<string, { revision: number; instructions: string[] }>();
  const persistence: BrokerPersistence = {
    reserveStart: vi.fn(() => {
      if (active) return { status: 'already-active' as const, revision };
      active = true;
      revision += 1;
      return { status: 'reserved' as const, revision };
    }),
    appendEvent: vi.fn(),
    completeSession: vi.fn(() => {
      active = false;
      revision += 1;
      return { status: 'applied', revision } as BrokerMutation;
    }),
    requestStop: vi.fn(() => {
      if (!active) return { status: 'inactive', revision } as BrokerMutation;
      return { status: 'applied', revision } as BrokerMutation;
    }),
    enqueueSteering: vi.fn((input) => {
      const prior = receipts.get(input.idempotencyKey);
      if (prior) return { status: 'duplicate', revision: prior.revision } as BrokerMutation;
      if (!active) return { status: 'inactive', revision } as BrokerMutation;
      if (input.expectedRevision !== revision) return { status: 'conflict', revision } as BrokerMutation;
      queued.push(input.instruction);
      revision += 1;
      receipts.set(input.idempotencyKey, { revision, instructions: [] });
      return { status: 'applied', revision } as BrokerMutation;
    }),
    consumeSteering: vi.fn((input) => {
      const prior = receipts.get(input.idempotencyKey);
      if (prior) return { status: 'duplicate', ...prior } as BrokerConsumption;
      if (!active) return { status: 'inactive', revision, instructions: [] } as BrokerConsumption;
      if (input.expectedRevision !== revision) return { status: 'conflict', revision, instructions: [] } as BrokerConsumption;
      const instructions = queued.splice(0);
      revision += 1;
      receipts.set(input.idempotencyKey, { revision, instructions });
      return { status: 'applied', revision, instructions } as BrokerConsumption;
    }),
    interruptResidue: vi.fn(() => {
      if (!active) return { status: 'inactive', revision } as BrokerMutation;
      active = false;
      revision += 1;
      return { status: 'applied', revision } as BrokerMutation;
    }),
  };
  return { persistence, queued, receipts, isActive: () => active, revision: () => revision };
}

function harness(options: { adapter?: ManagedSessionAdapter } = {}) {
  let observer: Parameters<ManagedSessionAdapter['start']>[1] | null = null;
  const stop = vi.fn();
  const adapter: ManagedSessionAdapter = options.adapter ?? {
    start: vi.fn((_spec, next) => { observer = next; return { stop }; }),
  };
  const durable = persistenceHarness();
  let ids = 0;
  const broker = new ManagedSessionBroker(adapter, durable.persistence, { newId: () => String(++ids) });
  const spec = {
    runRef: 'run-1', sessionRef: 'session-1', role: 'manager' as const,
    profileId: 'claude-manager-plan', approvedPrompt: 'approved plan',
  };
  return { broker, adapter, stop, spec, ...durable, getObserver: () => observer! };
}

describe('ManagedSessionBroker start and ownership', () => {
  it('durably reserves one background child and refuses local duplicates', () => {
    const h = harness();
    expect(h.broker.start(h.spec)).toEqual({ ok: true, started: true });
    expect(h.broker.start(h.spec)).toEqual({ ok: true, started: false, reason: 'already-running' });
    expect(h.persistence.reserveStart).toHaveBeenCalledTimes(1);
    expect(h.adapter.start).toHaveBeenCalledTimes(1);
    expect(h.broker.isRunning('session-1')).toBe(true);
    expect(vi.mocked(h.persistence.reserveStart).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(h.adapter.start).mock.invocationCallOrder[0]);
    expect(h.adapter.start).toHaveBeenCalledWith(h.spec, expect.any(Object));
  });

  it('passes only the closed managed-start protocol to persistence and the adapter', () => {
    const h = harness();
    const hostile = {
      ...h.spec,
      cwd: 'C:/outside',
      env: { TOKEN: 'secret' },
      flags: ['--dangerously-skip-permissions'],
    } as typeof h.spec;
    expect(h.broker.start(hostile)).toEqual({ ok: true, started: true });
    expect(h.persistence.reserveStart).toHaveBeenCalledWith({ spec: h.spec, idempotencyKey: 'start:1' });
    expect(h.adapter.start).toHaveBeenCalledWith(h.spec, expect.any(Object));
  });

  it('respects a durable reservation owned by another broker', () => {
    const h = harness();
    h.persistence.reserveStart({ spec: h.spec, idempotencyKey: 'other' });
    expect(h.broker.start(h.spec)).toEqual({ ok: true, started: false, reason: 'already-running' });
    expect(h.adapter.start).not.toHaveBeenCalled();
  });

  it('does not spawn when durable reservation fails', () => {
    const h = harness();
    vi.mocked(h.persistence.reserveStart).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(h.broker.start(h.spec)).toEqual({ ok: false, reason: 'persistence-failed', detail: 'disk unavailable' });
    expect(h.adapter.start).not.toHaveBeenCalled();
    expect(h.broker.isRunning('session-1')).toBe(false);
  });

  it('handles synchronous onExit before adapter.start returns without resurrecting the child', () => {
    let persistence!: BrokerPersistence;
    const stop = vi.fn();
    const adapter: ManagedSessionAdapter = {
      start: vi.fn((_spec, observer) => {
        observer.onExit(0, null);
        return { stop };
      }),
    };
    const h = harness({ adapter });
    persistence = h.persistence;
    expect(h.broker.start(h.spec)).toEqual({ ok: true, started: true });
    expect(h.broker.isRunning('session-1')).toBe(false);
    expect(persistence.completeSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'completed' }));
    expect(h.broker.stop('session-1')).toBe(false);
    expect(stop).not.toHaveBeenCalled();
  });

  it('contains spawn failure and durably marks the reservation failed', () => {
    const adapter: ManagedSessionAdapter = { start: vi.fn(() => { throw new Error('spawn denied'); }) };
    const h = harness({ adapter });
    expect(h.broker.start(h.spec)).toEqual({ ok: false, reason: 'spawn-failed', detail: 'spawn denied' });
    expect(h.persistence.completeSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed', detail: 'spawn denied' }));
    expect(h.broker.isRunning('session-1')).toBe(false);
  });

  it('contains terminal persistence failure after spawn and releases live ownership', () => {
    const h = harness();
    h.broker.start(h.spec);
    vi.mocked(h.persistence.completeSession).mockImplementationOnce(() => { throw new Error('write failed'); });
    expect(() => h.getObserver().onExit(0, null)).not.toThrow();
    expect(h.broker.isRunning('session-1')).toBe(false);
  });
});

describe('ManagedSessionBroker observation and steering', () => {
  it('persists public events and contains observer persistence exceptions', () => {
    const h = harness();
    h.broker.start(h.spec);
    vi.mocked(h.persistence.appendEvent).mockImplementationOnce(() => { throw new Error('event write failed'); });
    expect(() => h.getObserver().onEvent({ kind: 'tool', name: 'Read', status: 'succeeded' })).not.toThrow();
    expect(h.broker.isRunning('session-1')).toBe(true);
    h.getObserver().onEvent({ kind: 'tool', name: 'Write', status: 'succeeded' });
    expect(h.persistence.appendEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      runRef: 'run-1', sessionRef: 'session-1', event: { kind: 'tool', name: 'Write', status: 'succeeded' },
    }));
  });

  it('durably enqueues bounded steering before reporting success', () => {
    const h = harness();
    h.broker.start(h.spec);
    expect(h.broker.queueInstruction('session-1', `  ${'a'.repeat(17_000)}  `, 'steer-1')).toBe(true);
    expect(h.persistence.enqueueSteering).toHaveBeenCalledWith(expect.objectContaining({
      instruction: 'a'.repeat(16_000), expectedRevision: 1, idempotencyKey: 'steer-1',
    }));
    expect(h.queued).toEqual(['a'.repeat(16_000)]);
  });

  it('deduplicates steering and returns the same consumption receipt on checkpoint retry', () => {
    const h = harness();
    h.broker.start(h.spec);
    expect(h.broker.queueInstruction('session-1', 'Review the failing test.', 'steer-1')).toBe(true);
    expect(h.broker.queueInstruction('session-1', 'Review the failing test.', 'steer-1')).toBe(true);
    expect(h.queued).toEqual(['Review the failing test.']);

    expect(h.broker.reachCheckpoint('session-1', 'after-tests', 'checkpoint-1')).toEqual(['Review the failing test.']);
    expect(h.broker.reachCheckpoint('session-1', 'after-tests', 'checkpoint-1')).toEqual(['Review the failing test.']);
    expect(h.broker.reachCheckpoint('session-1', 'after-tests', 'checkpoint-2')).toEqual([]);
  });

  it('does not regress its CAS revision when an older idempotent receipt is retried', () => {
    const h = harness();
    h.broker.start(h.spec);
    expect(h.broker.queueInstruction('session-1', 'first', 'steer-1')).toBe(true);
    expect(h.broker.queueInstruction('session-1', 'second', 'steer-2')).toBe(true);
    expect(h.broker.queueInstruction('session-1', 'first', 'steer-1')).toBe(true);
    expect(h.broker.reachCheckpoint('session-1', 'safe', 'checkpoint')).toEqual(['first', 'second']);
    expect(h.persistence.consumeSteering).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
  });

  it('does not signal or consume when durable steering operations fail or conflict', () => {
    const h = harness();
    h.broker.start(h.spec);
    vi.mocked(h.persistence.enqueueSteering).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(h.broker.queueInstruction('session-1', 'Never became durable.', 'failed')).toBe(false);
    expect(h.queued).toEqual([]);

    vi.mocked(h.persistence.consumeSteering).mockReturnValueOnce({ status: 'conflict', revision: 9, instructions: ['must not leak'] });
    expect(h.broker.reachCheckpoint('session-1', 'safe', 'conflict')).toEqual([]);
  });

  it('bounds operation keys and rejects empty caller-supplied idempotency keys', () => {
    const h = harness();
    h.broker.start(h.spec);
    expect(h.broker.queueInstruction('session-1', 'queued', '  ')).toBe(false);
    expect(h.broker.queueInstruction('session-1', 'queued', 'x'.repeat(300))).toBe(true);
    expect(h.persistence.enqueueSteering).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'x'.repeat(256), instructionRef: `instruction:${'x'.repeat(256)}`,
    }));
    expect(h.broker.reachCheckpoint('session-1', 'safe', '  ')).toEqual([]);
  });
});

describe('ManagedSessionBroker stop, drain, and recovery', () => {
  it('persists a stop request before signaling and classifies the exit as stopped', () => {
    const h = harness();
    h.broker.start(h.spec);
    const order: string[] = [];
    vi.mocked(h.persistence.requestStop).mockImplementationOnce(() => {
      order.push('persist');
      return { status: 'applied', revision: h.revision() };
    });
    h.stop.mockImplementationOnce(() => { order.push('signal'); });
    expect(h.broker.stop('session-1')).toBe(true);
    expect(order).toEqual(['persist', 'signal']);
    expect(h.broker.stop('session-1')).toBe(false);
    h.getObserver().onExit(null, null);
    expect(h.persistence.completeSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' }));
    expect(h.persistence.requestStop).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
    expect(h.persistence.completeSession).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
  });

  it('does not signal when the stop request cannot be persisted', () => {
    const h = harness();
    h.broker.start(h.spec);
    vi.mocked(h.persistence.requestStop).mockImplementationOnce(() => { throw new Error('write failed'); });
    expect(h.broker.stop('session-1')).toBe(false);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('contains child stop exceptions and permits an idempotent retry', () => {
    const h = harness();
    h.broker.start(h.spec);
    h.stop.mockImplementationOnce(() => { throw new Error('signal failed'); });
    expect(() => h.broker.stop('session-1')).not.toThrow();
    expect(h.broker.stop('session-1')).toBe(true);
    expect(h.persistence.requestStop).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: 'stop:2' }));
    expect(h.persistence.requestStop).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: 'stop:2' }));
  });

  it('drains every child even when one stop signal throws', () => {
    const stops = new Map<string, ReturnType<typeof vi.fn>>();
    const adapter: ManagedSessionAdapter = {
      start: vi.fn((spec) => {
        const stop = vi.fn();
        if (spec.sessionRef === 'session-1') stop.mockImplementationOnce(() => { throw new Error('first failed'); });
        stops.set(spec.sessionRef, stop);
        return { stop };
      }),
    };
    const h = harness({ adapter });
    let revision = 0;
    vi.mocked(h.persistence.reserveStart).mockImplementation(() => ({ status: 'reserved', revision: ++revision }));
    vi.mocked(h.persistence.requestStop).mockImplementation(() => ({ status: 'applied', revision }));
    h.broker.start(h.spec);
    const second = { ...h.spec, sessionRef: 'session-2' };
    h.broker.start(second);
    expect(() => h.broker.drain()).not.toThrow();
    expect(stops.get('session-1')).toHaveBeenCalled();
    expect(stops.get('session-2')).toHaveBeenCalled();
  });

  it('normalizes restart residue idempotently, skips live ownership, and continues after failures', () => {
    const h = harness();
    h.broker.start(h.spec);
    vi.mocked(h.persistence.interruptResidue)
      .mockImplementationOnce(() => { throw new Error('bad record'); })
      .mockReturnValue({ status: 'applied', revision: 7 });
    expect(() => h.broker.recover([
      { runRef: 'run-1', sessionRef: 'old-1' },
      { runRef: 'run-1', sessionRef: 'old-2' },
      { runRef: 'run-1', sessionRef: 'session-1' },
    ])).not.toThrow();
    expect(h.persistence.interruptResidue).toHaveBeenCalledTimes(2);
    expect(h.persistence.interruptResidue).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionRef: 'old-2', idempotencyKey: 'recovery:old-2',
    }));
    h.broker.recover([{ runRef: 'run-1', sessionRef: 'old-2' }]);
    expect(h.persistence.interruptResidue).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionRef: 'old-2', idempotencyKey: 'recovery:old-2',
    }));
  });
});
