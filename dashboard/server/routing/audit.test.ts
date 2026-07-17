import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRoutingAudit } from './audit.ts';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'routing-audit-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function writeActivity(name: string, header: string[], rows: string[][]): void {
  const dir = join(repo, 'ledgers', 'activity');
  mkdirSync(dir, { recursive: true });
  const text = [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
  writeFileSync(join(dir, name), `${text}\n`, 'utf-8');
}

function writeOverride(text: string): void {
  mkdirSync(join(repo, 'queue'), { recursive: true });
  writeFileSync(join(repo, 'queue', 'routing-override.yaml'), text, 'utf-8');
}

describe('readRoutingAudit', () => {
  it('reads routed-vs-ran mismatch rows from the activity ledger', () => {
    writeActivity(
      'auditor-2026-07-17.tsv',
      ['card_id', 'date', 'event', 'kind', 'ran_model', 'routed_model', 'routed_runtime'],
      [
        ['c-rt', '2026-07-17', 'routed-vs-ran', 'runtime', 'gpt-5-codex', 'claude-opus-4-8', 'claude'],
        ['c-md', '2026-07-17', 'routed-vs-ran', 'model', 'claude-sonnet-5', 'claude-opus-4-8', 'claude'],
        ['x', '2026-07-17', 'something-else', '', '', '', ''],
      ],
    );
    const audit = readRoutingAudit(repo);
    expect(audit.mismatches).toHaveLength(2);
    expect(audit.mismatches[0]).toEqual({
      cardId: 'c-rt',
      routedRuntime: 'claude',
      routedModel: 'claude-opus-4-8',
      ranModel: 'gpt-5-codex',
      kind: 'runtime',
    });
  });

  it('is empty-safe when there is no activity ledger and no override', () => {
    expect(readRoutingAudit(repo)).toEqual({ mismatches: [], overrides: [] });
  });

  it('flags override entries at/near expiry (surfaces a stale pin)', () => {
    writeOverride(`version: 1
overrides:
  - scope: agent
    key: worker-desktop
    model: claude-opus-4-8
    expires: 2000-01-01T00:00:00Z
    set-by: daniel@webauthn
    set-at: 1999-12-31T00:00:00Z
  - scope: card
    key: card-9
    model: claude-sonnet-5
    expires: null
`);
    // now is well after the 2000 expiry.
    const nowMs = Date.parse('2026-07-17T00:00:00Z');
    const audit = readRoutingAudit(repo, nowMs);
    expect(audit.overrides).toHaveLength(2);
    const expiredEntry = audit.overrides.find((o) => o.key === 'worker-desktop')!;
    expect(expiredEntry.expired).toBe(true);
    expect(expiredEntry.expiringSoon).toBe(true);
    expect(expiredEntry.setBy).toBe('daniel@webauthn');
    const liveEntry = audit.overrides.find((o) => o.key === 'card-9')!;
    expect(liveEntry.expired).toBe(false);
    expect(liveEntry.expires).toBeNull();
  });

  it('flags an entry expiring within 24h as expiringSoon but not yet expired', () => {
    const nowMs = Date.parse('2026-07-17T00:00:00Z');
    writeOverride(`version: 1
overrides:
  - scope: agent
    key: w
    model: claude-opus-4-8
    expires: 2026-07-17T06:00:00Z
`);
    const o = readRoutingAudit(repo, nowMs).overrides[0];
    expect(o.expired).toBe(false);
    expect(o.expiringSoon).toBe(true);
  });
});
