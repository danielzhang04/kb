import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_COLLECTIONS, CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_SCHEMA_VERSION, RELEASE_ATTESTATION_KEYS,
  RELEASE_ATTESTATION_SCHEMA, ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION,
  STATE_MIGRATION, STATE_SCHEMA, ROLLBACK_STATE_SCHEMA,
  emptyControlPlaneDocument,
} from './controlPlaneSchema.ts';

describe('generated control-plane schema', () => {
  it('pins v2 and derives release metadata from the migration edge', () => {
    expect(CONTROL_PLANE_SCHEMA_VERSION).toBe(2);
    expect(ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION).toBe(1);
    expect(CONTROL_PLANE_MIGRATIONS).toEqual([
      { from: 1, to: 2, breaking: true, down: 'present' },
    ]);
    expect([STATE_SCHEMA, ROLLBACK_STATE_SCHEMA, STATE_MIGRATION]).toEqual(['2', '1', 'breaking']);
    expect(RELEASE_ATTESTATION_SCHEMA).toBe('kb.release-attestation/v2');
    expect(RELEASE_ATTESTATION_KEYS).toEqual([
      'archive', 'schema', 'sha256', 'sourceCommit', 'stateSchema',
      'rollbackStateSchema', 'stateMigration', 'workflow',
    ]);
    const empty = emptyControlPlaneDocument();
    expect(empty.version).toBe(2);
    expect(empty.documentRevision).toBe(0);
    expect(Object.entries(empty).filter(([, value]) => Array.isArray(value)).map(([key]) => key).sort())
      .toEqual([...CONTROL_PLANE_COLLECTIONS].sort());
  });
});
