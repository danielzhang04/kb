import { ACTIVATION_JOURNAL_PHASES } from '../control/generated/controlPlaneSchema.ts';

export { ACTIVATION_JOURNAL_PHASES };

export type ActivationJournalPhase = typeof ACTIVATION_JOURNAL_PHASES[number];

type ForwardPostStopPhase =
  | 'service-stopped'
  | 'migrated'
  | 'current-swapped'
  | 'restart-issued'
  | 'activation-committed'
  | 'healthy';

type RollbackPostStopPhase =
  | 'rollback-stopped'
  | 'down-migrated'
  | 'rollback-swapped'
  | 'rollback-committed'
  | 'rollback-healthy';

type TerminalRecoveryPhase = 'old-selected' | 'rollback-cancelled' | 'recovery-required';

interface ActivationJournalBase {
  schema: 'kb.activation-journal/v1';
  deploymentRef: string;
  targetCommit: string;
  previousCommit: string;
  updatedAt: string;
}

export type ActiveForwardActivationJournal =
  | (ActivationJournalBase & { phase: 'authorized'; snapshotDigest: null })
  | (ActivationJournalBase & { phase: ForwardPostStopPhase; snapshotDigest: string });

export type ActiveRollbackActivationJournal =
  | (ActivationJournalBase & { phase: 'rollback-authorized'; snapshotDigest: null })
  | (ActivationJournalBase & { phase: RollbackPostStopPhase; snapshotDigest: string });

export type TerminalRecoveryActivationJournal = ActivationJournalBase & {
  phase: TerminalRecoveryPhase;
  snapshotDigest: null;
};

export type ActivationJournal =
  | ActiveForwardActivationJournal
  | ActiveRollbackActivationJournal
  | TerminalRecoveryActivationJournal;

const PHASE_SET = new Set<string>(ACTIVATION_JOURNAL_PHASES);
const NULL_SNAPSHOT_PHASES = new Set<ActivationJournalPhase>([
  'authorized', 'rollback-authorized', 'old-selected', 'rollback-cancelled', 'recovery-required',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const expected = [
    'deploymentRef', 'phase', 'previousCommit', 'schema', 'snapshotDigest', 'targetCommit', 'updatedAt',
  ];
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function parseActivationJournal(value: unknown): ActivationJournal {
  if (!isPlainRecord(value) || !hasExactKeys(value)
    || value.schema !== 'kb.activation-journal/v1'
    || typeof value.deploymentRef !== 'string' || value.deploymentRef.trim().length === 0
    || typeof value.targetCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.targetCommit)
    || typeof value.previousCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.previousCommit)
    || value.targetCommit === value.previousCommit
    || !isCanonicalTimestamp(value.updatedAt)) {
    throw new Error('invalid activation journal');
  }
  if (typeof value.phase !== 'string' || !PHASE_SET.has(value.phase)) {
    throw new Error('invalid activation journal phase');
  }
  const phase = value.phase as ActivationJournalPhase;
  if (NULL_SNAPSHOT_PHASES.has(phase)) {
    if (value.snapshotDigest !== null) throw new Error('invalid activation journal snapshot digest');
  } else if (typeof value.snapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotDigest)) {
    throw new Error('invalid activation journal snapshot digest');
  }
  return structuredClone(value) as unknown as ActivationJournal;
}
