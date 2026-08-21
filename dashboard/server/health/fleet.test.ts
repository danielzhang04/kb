import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OverrideDoc, PolicyDoc } from '../routing/policy.ts';
import { buildHealthPanel } from './fleet.ts';

const POLICY: PolicyDoc = {
  version: 1,
  runtimes: {},
  role_default: { runtime: 'claude', model: 'default' },
};
const OVERRIDE: OverrideDoc = { overrides: [] };

describe('buildHealthPanel', () => {
  it('preserves the empty fleet projection at its Health owner', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'fleet-owner-'));
    const result = buildHealthPanel(repoRoot, POLICY, OVERRIDE, { asOf: '2026-08-21' });

    expect(result).toMatchObject({
      asOf: '2026-08-21',
      agents: [],
      orgs: [],
      systemCadences: [],
      cadenceCount: 0,
      liveCount: 0,
    });
  });
});
