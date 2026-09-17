import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBudgetOverrideStore } from './budgetOverride.ts';

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), 'kb-budget-override-'));
}

const grant = (over: Record<string, unknown> = {}) => ({
  windowDay: '2026-09-16',
  additionalUsdMicros: 5_000_000,
  grantedAt: '2026-09-16T19:40:00Z',
  actor: 'daniel',
  nonce: 'a'.repeat(32),
  ...over,
});

describe('budget override store', () => {
  it('starts at zero and sums grants for the day', () => {
    const store = createBudgetOverrideStore(temporaryRoot());
    expect(store.additionalUsdMicros('2026-09-16')).toBe(0);
    expect(store.grant(grant())).toBe('granted');
    expect(store.grant(grant({ nonce: 'b'.repeat(32) }))).toBe('granted');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(10_000_000);
    expect(store.additionalUsdMicros('2026-09-17')).toBe(0);
  });

  it('is idempotent on the nonce', () => {
    const store = createBudgetOverrideStore(temporaryRoot());
    expect(store.grant(grant())).toBe('granted');
    expect(store.grant(grant())).toBe('replayed');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(5_000_000);
  });

  it('refuses a grant above the per-grant ceiling', () => {
    const store = createBudgetOverrideStore(temporaryRoot());
    expect(store.grant(grant({ additionalUsdMicros: 20_000_001 }))).toBe('refused');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(0);
  });

  it('refuses a grant that would take the day above 60_000_000', () => {
    const store = createBudgetOverrideStore(temporaryRoot());
    for (let i = 0; i < 3; i += 1) {
      expect(store.grant(grant({ additionalUsdMicros: 20_000_000, nonce: String(i).repeat(32).slice(0, 32) }))).toBe('granted');
    }
    expect(store.additionalUsdMicros('2026-09-16')).toBe(60_000_000);
    expect(store.grant(grant({ additionalUsdMicros: 1, nonce: 'f'.repeat(32) }))).toBe('refused');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(60_000_000);
  });

  it('survives a restart', () => {
    const root = temporaryRoot();
    expect(createBudgetOverrideStore(root).grant(grant())).toBe('granted');
    expect(createBudgetOverrideStore(root).additionalUsdMicros('2026-09-16')).toBe(5_000_000);
  });

  it('stamps grantedAt from its own clock rather than trusting the caller', () => {
    const root = temporaryRoot();
    const store = createBudgetOverrideStore(root, () => new Date('2026-09-16T20:00:00Z'));
    expect(store.grant(grant({ grantedAt: '1999-01-01T00:00:00Z' }))).toBe('granted');
    const onDisk = JSON.parse(readFileSync(join(root, 'authority', 'budget-overrides.json'), 'utf8'));
    expect(onDisk.rows[0].grantedAt).toBe('2026-09-16T20:00:00.000Z');
  });

  it('fails closed on a missing windowDay, a non-positive amount, or an oversafe amount', () => {
    const store = createBudgetOverrideStore(temporaryRoot());
    expect(store.grant(grant({ windowDay: 'not-a-date' }))).toBe('refused');
    expect(store.grant(grant({ additionalUsdMicros: 0 }))).toBe('refused');
    expect(store.grant(grant({ additionalUsdMicros: -1 }))).toBe('refused');
    expect(store.grant(grant({ nonce: 'too-short' }))).toBe('refused');
  });

  it('fails closed on a corrupt document (refused / 0) rather than throwing or granting', () => {
    const root = temporaryRoot();
    const store = createBudgetOverrideStore(root);
    expect(store.grant(grant())).toBe('granted');
    const path = join(root, 'authority', 'budget-overrides.json');
    writeFileSync(path, 'not json', 'utf8');
    expect(createBudgetOverrideStore(root).additionalUsdMicros('2026-09-16')).toBe(0);
    expect(createBudgetOverrideStore(root).grant(grant({ nonce: 'c'.repeat(32) }))).toBe('refused');
  });
});
