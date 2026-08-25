import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTION_METHODS, ACTION_RELS, ContractDecodeError, MAX_CLAIM_WAIT_MS, NODE_REFUSAL_CODES,
  NODE_REFUSAL_STATUS, REPORT_KINDS, aggregateWatermark, buildAction, decodeClaimRequest,
  decodeRenewRequest, decodeReportRequest, evaluateAggregatePrecondition, evaluateItemPrecondition,
  hostVersion, itemEtag, leaseRevision, runEtag, scheduleCollectionWatermark, scheduleItemEtag,
  sourceRevisionWatermark,
} from './contracts.ts';
import type {
  AggregateWatermark, ItemEtag, RunEtag, ScheduleCollectionWatermark, ScheduleItemEtag,
} from './contracts.ts';

const vectors = JSON.parse(readFileSync(
  new URL('../../../../tests/fixtures/dashboard-v3-p6-contract-vectors.json', import.meta.url), 'utf8',
)) as { readonly constants: Record<string, string> };
const HASH = vectors.constants.hashA!;

describe('branded revision domains (§3.4:203) — string forms', () => {
  it('constructs each domain in its pinned string form', () => {
    expect(runEtag('run-1', 3)).toBe('run:run-1:3');
    expect(scheduleItemEtag('s1', 2)).toBe('schedule:s1:2');
    expect(scheduleCollectionWatermark(7)).toBe('schedules:7');
    expect(hostVersion('vm', 4)).toBe('host:vm:4');
    expect(leaseRevision('run-1', 1)).toBe('lease:run-1:1');
    expect(itemEtag(HASH)).toBe(HASH);
    expect(sourceRevisionWatermark(HASH)).toBe(HASH);
    expect(aggregateWatermark(HASH)).toBe(HASH);
  });
  it('validates the grammar of each constructor', () => {
    expect(() => runEtag('bad ref', 1)).toThrow(ContractDecodeError);
    expect(() => leaseRevision('run-1', 0)).toThrow(ContractDecodeError);
    expect(() => itemEtag('short')).toThrow(ContractDecodeError);
  });
});

describe('preconditions: 428 (absent) vs 412 (stale) are different failures (P6-C45)', () => {
  it('an absent item precondition is 428 precondition-required', () => {
    expect(evaluateItemPrecondition(undefined, runEtag('run-1', 1)))
      .toEqual({ ok: false, status: 428, code: 'precondition-required', retryable: false });
  });
  it('a stale item precondition is 412 with the current etag', () => {
    expect(evaluateItemPrecondition(runEtag('run-1', 1), runEtag('run-1', 2)))
      .toEqual({ ok: false, status: 412, code: 'etag-mismatch', retryable: false, current: 'run:run-1:2' });
  });
  it('a matching precondition passes', () => {
    expect(evaluateItemPrecondition(runEtag('run-1', 2), runEtag('run-1', 2))).toEqual({ ok: true });
  });
  it('a Health watermark is 428 when nothing is presented and 412 watermark-not-a-precondition when it is', () => {
    expect(evaluateAggregatePrecondition(undefined))
      .toEqual({ ok: false, status: 428, code: 'precondition-required', retryable: false });
    expect(evaluateAggregatePrecondition(aggregateWatermark(HASH)))
      .toEqual({ ok: false, status: 412, code: 'watermark-not-a-precondition', retryable: false });
  });
});

describe('closed actions union (design:431)', () => {
  it('freezes the rel and method lists (no merge verb)', () => {
    expect(ACTION_RELS).toContain('claim');
    expect([...ACTION_METHODS]).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    expect(ACTION_METHODS as readonly string[]).not.toContain('MERGE');
  });
  it('builds a pinned /api/v1 href', () => {
    expect(buildAction('renew', '/api/v1/runs/run-1/leases/renew', 'POST'))
      .toEqual({ rel: 'renew', href: '/api/v1/runs/run-1/leases/renew', method: 'POST' });
  });
  it('rejects executable paths, commands, credentials, schemes, and traversal', () => {
    for (const href of [
      'https://evil.example/api/v1/x', '/api/v1/../etc/passwd', '/etc/passwd', '/api/v1/x?token=secret',
      '/api/v1/x y', 'file:///api/v1/x', '/api/v1//double',
    ]) {
      expect(() => buildAction('self', href, 'GET')).toThrow(ContractDecodeError);
    }
  });
});

describe('claim/renew/report DTOs (§3.5)', () => {
  it('claim accepts only {waitMs} up to 25000', () => {
    expect(decodeClaimRequest({ waitMs: 25000 })).toEqual({ waitMs: 25000 });
    expect(MAX_CLAIM_WAIT_MS).toBe(25000);
    expect(() => decodeClaimRequest({ waitMs: 25001 })).toThrow(ContractDecodeError);
    expect(() => decodeClaimRequest({ waitMs: 0, extra: 1 })).toThrow(ContractDecodeError);
  });
  it('renew takes only {expectedLeaseRevision}', () => {
    expect(decodeRenewRequest({ expectedLeaseRevision: 3 })).toEqual({ expectedLeaseRevision: 3 });
    expect(() => decodeRenewRequest({ expectedLeaseRevision: 0 })).toThrow(ContractDecodeError);
  });
  it('report freezes its five kinds and accepts a clean append', () => {
    expect([...REPORT_KINDS]).toEqual(['started', 'event', 'gate-opened', 'completed', 'failed']);
    expect(decodeReportRequest({ expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { note: 'x' } }))
      .toEqual({ expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { note: 'x' } });
  });
  it('report rejects a decision/assertion field at the top level and inside payload', () => {
    expect(() => decodeReportRequest(
      { expectedLeaseRevision: 1, sequence: 1, kind: 'gate-opened', payload: {}, decision: 'approve' },
    )).toThrow(ContractDecodeError);
    expect(() => decodeReportRequest(
      { expectedLeaseRevision: 1, sequence: 1, kind: 'gate-opened', payload: { decision: 'approve' } },
    )).toThrow(ContractDecodeError);
    expect(() => decodeReportRequest(
      { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { assertion: 'x' } },
    )).toThrow(ContractDecodeError);
  });
});

describe('node-identity refusal-code union (§3.3)', () => {
  it('maps every code to its HTTP status', () => {
    expect(NODE_REFUSAL_STATUS['untrusted-peer']).toBe(401);
    expect(NODE_REFUSAL_STATUS['host-map-unavailable']).toBe(503);
    expect(NODE_REFUSAL_STATUS['node-attribution-unavailable']).toBe(503);
    for (const code of NODE_REFUSAL_CODES) {
      expect([401, 403, 503]).toContain(NODE_REFUSAL_STATUS[code]);
    }
  });
});

describe('compile negatives (verified by tsc --noEmit)', () => {
  it('a Run ETag is not assignable to a schedule watermark', () => {
    const run: RunEtag = runEtag('run-1', 1);
    // @ts-expect-error - RunEtag and ScheduleCollectionWatermark are mutually unassignable (§3.4).
    const wm: ScheduleCollectionWatermark = run;
    expect(typeof wm).toBe('string');
  });
  it('a schedule item ETag is not a Run ETag', () => {
    const s: ScheduleItemEtag = scheduleItemEtag('s1', 1);
    // @ts-expect-error - ScheduleItemEtag is not a RunEtag.
    const r: RunEtag = s;
    expect(typeof r).toBe('string');
  });
  it('a Health aggregate watermark cannot be used as a mutation precondition', () => {
    const wm: AggregateWatermark = aggregateWatermark(HASH);
    const current: ItemEtag = itemEtag(HASH);
    // @ts-expect-error - AggregateWatermark is not a MutationPrecondition (P6-C45).
    evaluateItemPrecondition(wm, current);
    expect(typeof wm).toBe('string');
  });
  it('the claim request carries no caller-supplied capabilityHash', () => {
    // @ts-expect-error - the claim DTO is exactly {waitMs}; a caller cannot supply capabilityHash (§3.1).
    const claim: import('./contracts.ts').ClaimRequest = { waitMs: 10, capabilityHash: 'x' };
    expect(claim.waitMs).toBe(10);
  });
});
