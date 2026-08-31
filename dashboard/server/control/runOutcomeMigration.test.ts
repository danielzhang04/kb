import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateRunOutcomes, resolveLegacyRunOutcome, type LegacyRunOutcomeInput } from './runOutcomeMigration.ts';

/*
 * Fixture extraction note: these records were selected from the read-only local
 * control-plane store, sanitized under the fixture provenance rules, and reshaped
 * from v1 `state` to the v2 `lifecycle` field. The outcome resolver deliberately
 * receives only the stored Run plus its empty, same-run evidence collections.
 */
const here = dirname(fileURLToPath(import.meta.url));
const iso = '2026-08-20T10:00:00.000Z';

interface FixtureStoredRun {
  subject: string;
  runRef: string;
  lifecycle: { kind: LegacyRunOutcomeInput['lifecycle'] };
  updatedAt: string;
  version: number;
  archiveOperationKey?: string | null;
}

function fixtureInput(row: FixtureStoredRun, location: string): LegacyRunOutcomeInput {
  return {
    runRef: row.runRef, subject: row.subject, location, lifecycle: row.lifecycle.kind,
    updatedAt: row.updatedAt, version: row.version, archiveOperationKey: row.archiveOperationKey ?? null,
    humanRequests: [], events: [], mutationReceipts: [], auditRows: [],
  };
}

function input(overrides: Partial<LegacyRunOutcomeInput> = {}): LegacyRunOutcomeInput {
  return {
    runRef: 'run-1', subject: 'operator', location: 'runs[0]', lifecycle: 'succeeded', updatedAt: iso, version: 4,
    archiveOperationKey: null, humanRequests: [], events: [], mutationReceipts: [], auditRows: [], ...overrides,
  };
}

describe('migrateRunOutcomeV1', () => {
  it('uses a matching auto-close response for a terminal time and rejects later evidence', () => {
    const responseAt = '2026-08-20T09:59:00.000Z';
    expect(resolveLegacyRunOutcome(input({ humanRequests: [{
      requestRef: 'request-1', runRef: 'run-1', updatedAt: responseAt,
      response: { requestRevision: 1, decision: 'auto-closed', respondedBy: 'operator', response: null, idempotencyKey: 'auto-close:terminal:succeeded:run-1:request-1', respondedAt: responseAt },
    }] }))).toEqual({ ok: true, value: { terminalOutcome: 'ok', completedAt: responseAt, archivedFrom: null } });
    expect(resolveLegacyRunOutcome(input({ events: [{ createdAt: '2026-08-20T10:01:00.000Z' }] }))).toMatchObject({ ok: false, reason: 'terminal-order-unproven' });
  });

  it('rejects post-terminal mutation receipts and auto-close time travel', () => {
    expect(resolveLegacyRunOutcome(input({
      mutationReceipts: [{ createdAt: '2026-08-20T10:01:00.000Z' }],
    }))).toMatchObject({ ok: false, reason: 'terminal-order-unproven' });
    expect(resolveLegacyRunOutcome(input({ humanRequests: [{
      requestRef: 'request-1', runRef: 'run-1', updatedAt: '2026-08-20T10:01:00.000Z',
      response: { requestRevision: 1, decision: 'auto-closed', respondedBy: 'operator', response: null, idempotencyKey: 'auto-close:terminal:succeeded:run-1:request-1', respondedAt: '2026-08-20T10:01:00.000Z' },
    }] }))).toMatchObject({ ok: false, reason: 'terminal-order-unproven' });
    expect(resolveLegacyRunOutcome(input({ humanRequests: [{
      requestRef: 'request-1', runRef: 'run-1', updatedAt: iso,
      response: { requestRevision: 1, decision: 'auto-closed', respondedBy: 'operator', response: null,
        idempotencyKey: 'auto-close:terminal:failed:run-1:request-1', respondedAt: iso },
    }] }))).toMatchObject({ ok: false, reason: 'terminal-order-unproven' });
  });

  it('requires exactly one archive authorization and preserves archive provenance hierarchy', () => {
    const archive = {
      ts: iso, action: 'control-run-archive-authorize', target: 'run-1', result: 'authorized:archive-1',
      detail: { runOwnerSubject: 'operator', runVersion: 3, runState: 'waiting-human' },
    };
    expect(resolveLegacyRunOutcome(input({ lifecycle: 'archived', archiveOperationKey: 'archive-1', auditRows: [archive] }))).toEqual({ ok: true, value: { terminalOutcome: 'abandoned', completedAt: iso, archivedFrom: 'waiting-human' } });
    expect(resolveLegacyRunOutcome(input({
      lifecycle: 'archived', archiveOperationKey: 'archive-1', subject: 'foreign-subject', auditRows: [archive],
    }))).toEqual({ ok: false, reason: 'archive-audit-required', candidates: [] });
    expect(resolveLegacyRunOutcome(input({ lifecycle: 'archived', archiveOperationKey: 'archive-1', auditRows: [archive, archive] }))).toMatchObject({ ok: false, reason: 'archive-audit-ambiguous' });
    expect(resolveLegacyRunOutcome(input({ lifecycle: 'archived', archiveOperationKey: 'archive-1', auditRows: [] }))).toMatchObject({ ok: false, reason: 'archive-audit-required' });
    expect(resolveLegacyRunOutcome(input({
      lifecycle: 'archived', archiveOperationKey: 'archive-1',
      auditRows: [{ ...archive, detail: { ...archive.detail, runState: 'succeeded' } }],
    }))).toMatchObject({ ok: false, reason: 'terminal-order-unproven' });
  });

  it('accepts only P2 outcome fields that agree with recomputation and rejects invalid timestamps', () => {
    const agreeing = input({ existing: { terminalOutcome: 'ok', completedAt: iso, archivedFrom: null } });
    const disagreeing = input({ existing: { terminalOutcome: 'failed', completedAt: iso, archivedFrom: null } });
    expect(resolveLegacyRunOutcome(agreeing)).toEqual({ ok: true, value: agreeing.existing });
    expect(resolveLegacyRunOutcome(disagreeing)).toEqual({ ok: false, reason: 'outcome-mismatch', candidates: [] });
    expect(resolveLegacyRunOutcome(input({ updatedAt: 'not-a-timestamp' }))).toEqual({ ok: false, reason: 'invalid-timestamp', candidates: [] });
  });

  it('walks quarantine locations, accepts only agreeing P2 fields, and bounds errors', () => {
    const topLevel = JSON.parse(readFileSync(join(here, '__fixtures__', 'dv3', 'v2-run-outcomes-real-sanitized.json'), 'utf8')) as { provenance: { sourcePath: string; sourceSha256: string }; version: number; runs: FixtureStoredRun[] };
    const quarantine = JSON.parse(readFileSync(join(here, '__fixtures__', 'dv3', 'v2-quarantine-real-sanitized.json'), 'utf8')) as { provenance: { sourcePath: string; sourceSha256: string; note: string }; version: number; quarantine: Array<{ run: FixtureStoredRun }> };
    expect(topLevel.provenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(quarantine.provenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(topLevel.provenance.sourcePath).toBe('%LOCALAPPDATA%/kb-dashboard/control/control-plane.json');
    expect(quarantine.provenance.note).toMatch(/no quarantine rows/);
    expect([topLevel.version, quarantine.version]).toEqual([2, 2]);
    const source = [
      fixtureInput(topLevel.runs[0], 'runs[0]'), fixtureInput(quarantine.quarantine[0].run, 'quarantine[0].run'),
      input({ runRef: 'run-z', lifecycle: 'archived', archiveOperationKey: null }),
      input({ runRef: 'run-a', lifecycle: 'archived', archiveOperationKey: null }),
    ];
    const clone = JSON.parse(JSON.stringify(source));
    const migrated = migrateRunOutcomes(source, 1);
    expect(migrated.items).toMatchObject([
      { location: 'runs[0]', value: { terminalOutcome: 'ok' } },
      { location: 'quarantine[0].run', value: { terminalOutcome: 'failed' } },
    ]);
    expect(migrated.report).toMatchObject({ migration: 'migrateRunOutcomeV1', total: 4, migrated: 2, truncated: true });
    expect(migrated.report.errors).toEqual([{ runRef: 'run-a', location: 'runs[0]', fieldsSeen: ['archiveOperationKey', 'lifecycle', 'updatedAt'], candidates: [], reasons: ['archive-audit-required'] }]);
    expect(source).toEqual(clone);
  });

  it('does not mutate success or abort inputs', () => {
    const success = input();
    const successClone = JSON.parse(JSON.stringify(success));
    expect(resolveLegacyRunOutcome(success)).toMatchObject({ ok: true });
    expect(success).toEqual(successClone);

    const abort = input({ lifecycle: 'archived', archiveOperationKey: null });
    const abortClone = JSON.parse(JSON.stringify(abort));
    expect(resolveLegacyRunOutcome(abort)).toEqual({ ok: false, reason: 'archive-audit-required', candidates: [] });
    expect(abort).toEqual(abortClone);
  });
});
