import { expect, it } from 'vitest';
import { ACTIVATION_JOURNAL_PHASES, parseActivationJournal } from './activationJournal.ts';

function validJournal(phase: (typeof ACTIVATION_JOURNAL_PHASES)[number]) {
  const noSnapshot = ['authorized', 'rollback-authorized', 'old-selected', 'rollback-cancelled', 'recovery-required'].includes(phase);
  return {
    schema: 'kb.activation-journal/v1' as const,
    deploymentRef: 'deploy-1',
    targetCommit: 'b'.repeat(40),
    previousCommit: 'a'.repeat(40),
    snapshotDigest: noSnapshot ? null : 'c'.repeat(64),
    phase,
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}

it.each(ACTIVATION_JOURNAL_PHASES)('validates journal phase %s', (phase) => {
  const noSnapshot = ['authorized', 'rollback-authorized', 'old-selected', 'rollback-cancelled', 'recovery-required'].includes(phase);
  const parsed = parseActivationJournal({
    schema: 'kb.activation-journal/v1', deploymentRef: 'deploy-1',
    targetCommit: 'b'.repeat(40), previousCommit: 'a'.repeat(40),
    snapshotDigest: noSnapshot ? null : 'c'.repeat(64),
    phase, updatedAt: '2026-08-20T00:00:00.000Z',
  });
  expect(parsed.phase).toBe(phase);
});

it('rejects an unknown activation-journal phase', () => {
  expect(() => parseActivationJournal({...validJournal('authorized'), phase:'other'}))
    .toThrow(/activation journal phase/);
});
it('requires null before snapshot and sha256 after service stop', () => {
  expect(() => parseActivationJournal({...validJournal('authorized'), snapshotDigest:'c'.repeat(64)}))
    .toThrow(/snapshot digest/);
  expect(() => parseActivationJournal({...validJournal('migrated'), snapshotDigest:null}))
    .toThrow(/snapshot digest/);
});
