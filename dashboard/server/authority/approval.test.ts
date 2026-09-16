import { describe, expect, it } from 'vitest';
import { canonicalApprovalPayload, verifyApproval, APPROVAL_SCHEMA } from './approval.ts';

const NOW = Date.parse('2026-09-16T19:40:00Z');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function payload(over: Record<string, unknown> = {}) {
  return canonicalApprovalPayload({
    schema: APPROVAL_SCHEMA,
    route: 'POST /api/control/runs/:runRef/reconcile-publication',
    entityRef: 'run-abc',
    actor: 'daniel',
    issuedAt: iso(NOW),
    expiresAt: iso(NOW + 600_000),
    nonce: 'a'.repeat(32),
    ...over,
  } as never);
}

/**
 * `canonicalApprovalPayload` deliberately picks only its seven named fields (spec §4.2's canonical
 * form), so an `over` merged into `payload()`'s input object can never smuggle an eighth key onto the
 * wire — that is the whole point of a fixed serializer. To exercise check #4's "exactly seven keys, no
 * others" refusal, this builds the wire string by hand instead of going through the picker.
 */
function payloadWithExtraKey(): string {
  return JSON.stringify({
    schema: APPROVAL_SCHEMA,
    route: 'POST /api/control/runs/:runRef/reconcile-publication',
    entityRef: 'run-abc',
    actor: 'daniel',
    issuedAt: iso(NOW),
    expiresAt: iso(NOW + 600_000),
    nonce: 'a'.repeat(32),
    extra: 'x',
  });
}

function input(over: Record<string, unknown> = {}) {
  return {
    approval: { payload: payload(), signature: 'sig' },
    expectedRoute: 'POST /api/control/runs/:runRef/reconcile-publication',
    expectedEntityRef: 'run-abc',
    allowedSigners: '/etc/kb/allowed',
    verifier: { verify: async () => true },
    nonces: { claim: () => 'fresh' as const },
    now: () => NOW,
    ...over,
  };
}

describe('verifyApproval', () => {
  it('accepts a well-formed, signed, fresh approval', async () => {
    expect(await verifyApproval(input() as never)).toEqual({ ok: true });
  });
  it('503s with no allowed-signers configured', async () => {
    expect(await verifyApproval(input({ allowedSigners: '' }) as never))
      .toEqual({ ok: false, status: 503, error: 'approval-unavailable' });
  });
  it('403 approval-required with no approval object', async () => {
    expect(await verifyApproval(input({ approval: undefined }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-required' });
  });
  it('403 approval-required when the approval object carries the wrong keys', async () => {
    expect(await verifyApproval(input({ approval: { payload: payload(), signature: 'sig', extra: 1 } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-required' });
    expect(await verifyApproval(input({ approval: { payload: payload() } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-required' });
  });
  it('403 approval-invalid on a wrong route', async () => {
    expect(await verifyApproval(input({ expectedRoute: 'POST /api/schedules' }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on a wrong entityRef', async () => {
    expect(await verifyApproval(input({ expectedEntityRef: 'run-other' }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on a wrong schema, wrong actor, or bad nonce shape', async () => {
    for (const over of [{ schema: 'other' }, { actor: 'boss' }, { nonce: 'zz' }]) {
      expect(await verifyApproval(input({ approval: { payload: payload(over), signature: 'sig' } }) as never))
        .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
    }
  });
  it('403 approval-invalid on a payload carrying an extra key', async () => {
    expect(await verifyApproval(input({ approval: { payload: payloadWithExtraKey(), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on a window wider than 15 minutes', async () => {
    expect(await verifyApproval(input({ approval: { payload: payload({ expiresAt: iso(NOW + 16 * 60_000) }), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on an issuedAt beyond the skew allowance', async () => {
    expect(await verifyApproval(input({ approval: { payload: payload({ issuedAt: iso(NOW + 120_000), expiresAt: iso(NOW + 300_000) }), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-expired past expiresAt', async () => {
    expect(await verifyApproval(input({ now: () => NOW + 700_000 }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-expired' });
  });
  it('403 approval-invalid when the signature does not verify', async () => {
    expect(await verifyApproval(input({ verifier: { verify: async () => false } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('409 approval-replayed on a used nonce', async () => {
    expect(await verifyApproval(input({ nonces: { claim: () => 'replayed' as const } }) as never))
      .toEqual({ ok: false, status: 409, error: 'approval-replayed' });
  });
  it('does not claim the nonce when the signature fails', async () => {
    let claims = 0;
    await verifyApproval(input({
      verifier: { verify: async () => false },
      nonces: { claim: () => { claims += 1; return 'fresh' as const; } },
    }) as never);
    expect(claims).toBe(0);
  });
  it('refuses an oversized payload or signature', async () => {
    expect(await verifyApproval(input({ approval: { payload: 'x'.repeat(2049), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
    expect(await verifyApproval(input({ approval: { payload: payload(), signature: 'x'.repeat(8193) } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
});
