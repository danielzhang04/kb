export type AdmissionKind = 'new-work' | 'settlement' | 'reply' | 'stop' | 'lock' | 'read';

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
  return kind === 'new-work' && status.degraded
    ? { ok: false, status: 503, reason: 'outbox-degraded' }
    : { ok: true };
}
