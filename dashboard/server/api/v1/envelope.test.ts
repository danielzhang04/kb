import { describe, expect, it } from 'vitest';
import { buildAction } from './contracts.ts';
import { v1Error, v1Success } from './envelope.ts';

describe('v1 success envelope (design:420 verbatim)', () => {
  it('carries apiVersion/kind/data/meta and omits non-meaningful meta fields', () => {
    const env = v1Success('run', { runRef: 'run-1' }, { etag: 'run:run-1:1' });
    expect(env.apiVersion).toBe('v1');
    expect(env.kind).toBe('run');
    expect(env.meta).toEqual({ etag: 'run:run-1:1' });
    expect('watermark' in env.meta).toBe(false);
    expect('nextCursor' in env.meta).toBe(false);
    expect('actions' in env).toBe(false);
  });
  it('emits an empty meta object when nothing is meaningful', () => {
    const env = v1Success('health', { ok: true });
    expect(env.meta).toEqual({});
    expect(JSON.stringify(env)).not.toContain('etag');
    expect(JSON.stringify(env)).not.toContain('revision');
  });
  it('includes actions only when non-empty', () => {
    const action = buildAction('self', '/api/v1/runs/run-1', 'GET');
    expect(v1Success('run', {}, { actions: [action] }).actions).toEqual([action]);
    expect('actions' in v1Success('run', {}, { actions: [] })).toBe(false);
  });
  it('carries a watermark and nextCursor when a list kind supplies them', () => {
    const env = v1Success('runs', [], { watermark: 'w', nextCursor: 'c.sig' });
    expect(env.meta).toEqual({ watermark: 'w', nextCursor: 'c.sig' });
    expect('etag' in env.meta).toBe(false);
  });
});

describe('v1 error envelope (design:420 verbatim)', () => {
  it('carries the error triple and omits absent meta', () => {
    const env = v1Error('cursor-stale', 'restart the stream', true);
    expect(env).toEqual({ apiVersion: 'v1', error: { code: 'cursor-stale', message: 'restart the stream', retryable: true }, meta: {} });
  });
  it('carries currentEtag/currentWatermark on a 412', () => {
    const env = v1Error('etag-mismatch', 'stale', false, { currentEtag: 'run:run-1:2' });
    expect(env.meta).toEqual({ currentEtag: 'run:run-1:2' });
    expect('currentWatermark' in env.meta).toBe(false);
  });
});
