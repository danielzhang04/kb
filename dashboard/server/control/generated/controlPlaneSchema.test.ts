import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_JOURNAL_PHASES, CONTROL_PLANE_COLLECTIONS, CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_SCHEMA_VERSION, RELEASE_ATTESTATION_KEYS,
  RELEASE_ATTESTATION_SCHEMA, ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION,
  STATE_MIGRATION, STATE_SCHEMA, ROLLBACK_STATE_SCHEMA,
  emptyControlPlaneDocument,
} from './controlPlaneSchema.ts';

describe('generated control-plane schema', () => {
  it('pins v3 and derives release metadata from the immediate rollback edge', () => {
    expect(CONTROL_PLANE_SCHEMA_VERSION).toBe(3);
    expect(ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION).toBe(2);
    expect(CONTROL_PLANE_MIGRATIONS).toEqual([
      { from: 1, to: 2, breaking: true, down: 'present' },
      { from: 2, to: 3, breaking: true, down: 'present' },
    ]);
    expect([STATE_SCHEMA, ROLLBACK_STATE_SCHEMA, STATE_MIGRATION]).toEqual(['3', '2', 'breaking']);
    expect(RELEASE_ATTESTATION_SCHEMA).toBe('kb.release-attestation/v2');
    expect(RELEASE_ATTESTATION_KEYS).toEqual([
      'archive', 'schema', 'sha256', 'sourceCommit', 'stateSchema',
      'rollbackStateSchema', 'stateMigration', 'workflow',
    ]);
    expect(ACTIVATION_JOURNAL_PHASES).toHaveLength(16);
    expect(ACTIVATION_JOURNAL_PHASES).toEqual([
      'authorized', 'service-stopped', 'migrated', 'current-swapped', 'restart-issued',
      'activation-committed', 'healthy', 'rollback-authorized', 'rollback-stopped',
      'down-migrated', 'rollback-swapped', 'rollback-committed', 'rollback-healthy',
      'old-selected', 'rollback-cancelled', 'recovery-required',
    ]);
    const empty = emptyControlPlaneDocument();
    expect(empty.version).toBe(3);
    expect(empty.documentRevision).toBe(0);
    expect(empty.scheduleCollectionRevision).toBe(0);
    expect(Object.entries(empty).filter(([, value]) => Array.isArray(value)).map(([key]) => key).sort())
      .toEqual([...CONTROL_PLANE_COLLECTIONS].sort());
  });
});
