export type AdmissionKind = 'new-work' | 'paid-continuation' | 'settlement' | 'reply' | 'stop' | 'lock' | 'read';

/** Absolute safety bound for settlement work that must continue through ordinary degraded mode. */
export const HARD_SPOOL_CEILING = 1_000;

export interface OutboxStatus {
  pending: number;
  oldestAgeMs: number;
  degraded: boolean;
  reasons: string[];
}

export type AdmissionDecision =
  | { ok: true }
  | { ok: false; status: 503; reason: 'outbox-degraded' };

export function admit(kind: AdmissionKind, status: OutboxStatus): AdmissionDecision {
  if (kind === 'paid-continuation') {
    return status.pending >= HARD_SPOOL_CEILING
      ? { ok: false, status: 503, reason: 'outbox-degraded' }
      : { ok: true };
  }
  return kind === 'new-work' && status.degraded
    ? { ok: false, status: 503, reason: 'outbox-degraded' }
    : { ok: true };
}
