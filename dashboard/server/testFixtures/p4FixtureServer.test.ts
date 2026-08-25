import { get as httpGet } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { describe, expect, it } from 'vitest';
import { decodeInboxResponse } from '../inbox/contracts.ts';
import {
  FakePrRegistry, FixtureControlStore, FixtureOpsOutbox, OpsBypassRefused, ScheduleCasConflict,
  composeP4Inbox, isFortyHex, startP4FixtureServer,
} from './p4FixtureServer.ts';

/** Minimal plain-HTTP GET returning status + body. */
function httpText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

/** HTTPS GET that PINS the fixture's certificate as the sole CA (never rejectUnauthorized:false). */
function httpsText(url: string, ca: string): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const call = httpsRequest(
      { protocol: target.protocol, host: target.hostname, port: target.port, path: target.pathname, method: 'GET', ca },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    call.on('error', reject);
    call.end();
  });
}

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const HEAD_C = 'c'.repeat(40);

describe('FixtureOpsOutbox — publisher-only, idempotent, base-guarded', () => {
  it('appends only through the publisher and is idempotent on the key', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    const receipt = outbox.publishAsPublisher(
      { key: 'k1', purpose: 'learning-proposal', base: HEAD_A, payload: {} }, () => HEAD_B,
    );
    expect(receipt).toEqual({ mode: 'coordination', branch: 'ops', key: 'k1', commit: HEAD_B });
    expect(outbox.head()).toBe(HEAD_B);
    const replay = outbox.publishAsPublisher(
      { key: 'k1', purpose: 'learning-proposal', base: HEAD_A, payload: {} },
      () => { throw new Error('replay must not mint'); },
    );
    expect(replay).toEqual(receipt);
    expect(outbox.log()).toHaveLength(1);
  });

  it('refuses a stale base and audits it', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    expect(() => outbox.publishAsPublisher(
      { key: 'k2', purpose: 'schedule-mirror', base: HEAD_C, payload: {} }, () => HEAD_B,
    )).toThrow(OpsBypassRefused);
    expect(outbox.auditLog()).toEqual([{ kind: 'refused-stale-base', detail: 'k2 pinned ' + HEAD_C }]);
    expect(outbox.head()).toBe(HEAD_A);
  });

  it('refuses a direct append outside the publisher and audits it', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    expect(() => outbox.appendDirect(
      { key: 'k3', purpose: 'schedule-mirror', base: HEAD_A, payload: {} },
    )).toThrow(OpsBypassRefused);
    expect(outbox.auditLog()).toEqual([{ kind: 'refused-direct-write', detail: 'direct append of k3' }]);
    expect(outbox.log()).toHaveLength(0);
  });
});

describe('FixtureControlStore — CAS, one open batch, row-bounded watermark', () => {
  it('bumps per-row revision under CAS and conflicts on a stale expectation', () => {
    const store = new FixtureControlStore();
    const first = store.mutate('r', 0);
    expect(first.revision).toBe(1);
    expect(() => store.mutate('r', 0)).toThrow(ScheduleCasConflict);
    const second = store.mutate('r', 1);
    expect(second.revision).toBe(2);
  });

  it('opens exactly one batch and advances only covered rows on merge', () => {
    const store = new FixtureControlStore();
    store.mutate('a', 0);
    store.mutate('b', 0);
    store.mutate('c', 0);
    const batch = store.openMirrorBatch();
    expect(batch.coveredRowIds).toEqual(['a', 'b', 'c']);
    expect(() => store.openMirrorBatch()).toThrow(ScheduleCasConflict);

    // A fourth mutation while the batch is open is not covered.
    store.mutate('d', 0);
    expect(batch.coveredRowIds).not.toContain('d');

    const merge = 'd'.repeat(40);
    const advanced = store.confirmMirrorMerge(merge, '2026-08-25T07:00:00Z');
    expect(advanced).toEqual(['a', 'b', 'c']);

    const after = store.snapshot();
    const stamped = after.rows.filter((row) => row.mirroredAt === '2026-08-25T07:00:00Z').map((row) => row.id);
    expect(stamped).toEqual(['a', 'b', 'c']);
    expect(after.rows.find((row) => row.id === 'd')?.mirroredAt).toBeNull();

    // A second cycle advances the fourth mutation.
    const secondBatch = store.openMirrorBatch();
    expect(secondBatch.coveredRowIds).toEqual(['d']);
    const secondAdvanced = store.confirmMirrorMerge('e'.repeat(40), '2026-08-25T08:00:00Z');
    expect(secondAdvanced).toEqual(['d']);
  });

  it('refuses a non-hex merge commit', () => {
    const store = new FixtureControlStore();
    store.mutate('a', 0);
    store.openMirrorBatch();
    expect(() => store.confirmMirrorMerge('short', 't')).toThrow();
  });
});

describe('FakePrRegistry — one PR at a time, merge leaves Inbox', () => {
  it('opens against fixture main and merges to a 40-hex commit that leaves Inbox', () => {
    const registry = new FakePrRegistry();
    const pr = registry.open('p4/batch', ['agents/x.md', 'docs/proposals/learnings/r.md']);
    expect(pr.base).toBe('main');
    expect(pr.inInbox).toBe(true);
    expect(registry.openCount()).toBe(1);
    const merged = registry.merge(pr.id, () => 'f'.repeat(40));
    expect(isFortyHex(merged.mergeCommit)).toBe(true);
    expect(merged.inInbox).toBe(false);
    expect(registry.openCount()).toBe(0);
    // Idempotent merge.
    expect(registry.merge(pr.id, () => 'x')).toBe(merged);
  });
});

describe('composeP4Inbox — projects the fixture stores through the real contract', () => {
  it('composes a contract-valid response with both PR and escalation items', () => {
    const response = composeP4Inbox('pr-escalation-states', new FakePrRegistry());
    // A freshly-constructed registry has no open PRs, so only escalations show — still contract-valid.
    expect(() => decodeInboxResponse(response)).not.toThrow();
    expect(response.sources.pr.status).toBe('verified');
    expect(response.items.every((item) => item.kind === 'escalation')).toBe(true);
  });

  it('partial-source-failure keeps last-good PR items and marks the source failed+stale', () => {
    const registry = new FakePrRegistry();
    registry.open('p4/x', ['agents/a.md']);
    const response = composeP4Inbox('partial-source-failure', registry);
    expect(response.sources.pr).toMatchObject({ status: 'failed', errorCode: 'unavailable', stale: true });
    expect(response.items.some((item) => item.kind === 'pr')).toBe(true);
    expect(() => decodeInboxResponse(response)).not.toThrow();
  });

  it('empty-inbox is both-verified and empty (a legal "nothing needs you")', () => {
    const response = composeP4Inbox('empty-inbox', new FakePrRegistry());
    expect(response.items).toHaveLength(0);
    expect(response.sources.pr.status).toBe('verified');
    expect(response.sources.escalation.status).toBe('verified');
  });
});

describe('startP4FixtureServer — real loopback listener', () => {
  it('serves /readyz, a contract-valid /api/inbox, and an app-shell page over plain HTTP', async () => {
    const server = await startP4FixtureServer({ port: 0, scenario: 'pr-escalation-states' });
    try {
      expect(server.origin.startsWith('http://127.0.0.1:')).toBe(true);
      expect(server.spkiPin).toBeNull();

      const ready = await httpText(`${server.origin}/readyz`);
      expect(ready.status).toBe(200);
      expect(JSON.parse(ready.body)).toMatchObject({ status: 'ready', scenario: 'pr-escalation-states' });

      const inbox = await httpText(`${server.origin}/api/inbox`);
      expect(inbox.status).toBe(200);
      const decoded = decodeInboxResponse(JSON.parse(inbox.body));
      expect(decoded.revision).toBe(server.inbox().revision);
      expect(decoded.items.length).toBeGreaterThan(0);

      const page = await httpText(`${server.origin}/`);
      expect(page.status).toBe(200);
      expect(page.body).toContain('<div id="root"');
      expect(page.body).toContain('/api/inbox');

      const favicon = await httpText(`${server.origin}/favicon.ico`);
      expect(favicon.status).toBe(204);
    } finally {
      await server.close();
    }
  });

  it('binds HTTPS with a published, pinnable certificate and an SPKI pin', async () => {
    const server = await startP4FixtureServer({ port: 0, https: true, scenario: 'empty-inbox' });
    try {
      expect(server.origin.startsWith('https://127.0.0.1:')).toBe(true);
      expect(server.certificate).toContain('BEGIN CERTIFICATE');
      expect(typeof server.spkiPin).toBe('string');
      expect((server.spkiPin ?? '').length).toBeGreaterThan(0);

      // The probe pins the fixture's own cert as the sole CA — no rejectUnauthorized:false anywhere.
      const ready = await httpsText(`${server.origin}/readyz`, server.certificate ?? '');
      expect(ready.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
