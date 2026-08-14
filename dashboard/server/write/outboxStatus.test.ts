import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outboxStatus } from './outboxStatus.ts';

const COMMIT = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);

function fixtureManifest(overrides: Record<string, unknown> = {}): string {
  const spool = mkdtempSync(join(tmpdir(), 'outbox-status-'));
  const ready = join(spool, 'ready');
  mkdirSync(ready);
  const manifest = {
    bundleSha256: 'c'.repeat(64),
    commit: COMMIT,
    createdAt: '2026-08-11T12:00:00.000Z',
    id: COMMIT,
    parent: PARENT,
    paths: ['memory/worker.md'],
    schema: 'kb.ops-outbox/v1',
    ...overrides,
  };
  writeFileSync(join(ready, `${COMMIT}.json`), `${JSON.stringify(manifest)}\n`, 'utf8');
  return spool;
}

describe('outboxStatus', () => {
  it('degrades on count or oldest pending age', () => {
    const spool = fixtureManifest();
    expect(outboxStatus(spool, { maxPending: 1, now: () => Date.parse('2026-08-11T12:00:01.000Z') }))
      .toMatchObject({ pending: 1, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] });
    expect(outboxStatus(spool, { maxAgeMs: 1_000, now: () => Date.parse('2026-08-11T12:00:01.000Z') }))
      .toMatchObject({ pending: 1, oldestAgeMs: 1_000, degraded: true, reasons: ['oldest-age-limit'] });
  });

  it.each(['not-a-time', '2026-08-11', '2026-08-11T12:00:00+01:00'])('fails closed on malformed/noncanonical createdAt %s', (createdAt) => {
    const spool = fixtureManifest({ createdAt });
    expect(outboxStatus(spool)).toMatchObject({ degraded: true, reasons: ['manifest-invalid'] });
  });
});
