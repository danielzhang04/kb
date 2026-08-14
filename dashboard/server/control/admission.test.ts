import { describe, expect, it } from 'vitest';
import { admit } from './admission.ts';

describe('outbox degraded-mode admission', () => {
  it('degrades on count or age and blocks only new work', () => {
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    expect(admit('new-work', degraded)).toEqual({ ok: false, status: 503, reason: 'outbox-degraded' });
    for (const kind of ['settlement', 'reply', 'stop', 'lock', 'read'] as const) expect(admit(kind, degraded)).toEqual({ ok: true });
  });

  it('admits paid continuations while degraded only below the hard spool ceiling', () => {
    const hardSpoolCeiling = 1_000;
    const status = (pending: number) => ({ pending, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] });
    expect(admit('paid-continuation', status(hardSpoolCeiling - 1))).toEqual({ ok: true });
    expect(admit('paid-continuation', status(hardSpoolCeiling))).toEqual({
      ok: false, status: 503, reason: 'outbox-degraded',
    });
  });
});
