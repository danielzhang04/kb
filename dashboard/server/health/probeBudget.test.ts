import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import {
  DAEMON_MACHINE_SECTION_BUDGET_MS, PROBE_BUDGETS_MS, PROBE_UNAVAILABLE_REASONS,
  decodeDaemonRow, decodeDeployRow, decodeMachineRow, decodeReleaseRow, isProbeUnavailableReason,
  probeBudgetMs,
} from './probeBudget.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface RowVectors { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] }
interface ContractVectors {
  readonly healthRows: {
    readonly machine: RowVectors; readonly daemon: RowVectors;
    readonly release: RowVectors; readonly deploy: RowVectors;
  };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p5-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('probe-budget table (§3.5)', () => {
  it('freezes the per-probe ceilings', () => {
    expect(PROBE_BUDGETS_MS).toEqual({
      cpu: 250, memory: 250, uptime: 250, disk: 750, release: 1000, daemon: 1500, deploy: 250,
    });
    expect(DAEMON_MACHINE_SECTION_BUDGET_MS).toBe(2500);
    // No per-probe ceiling exceeds the section ceiling.
    for (const ms of Object.values(PROBE_BUDGETS_MS)) expect(ms).toBeLessThanOrEqual(DAEMON_MACHINE_SECTION_BUDGET_MS);
  });

  it('resolves each probe kind and throws on an unknown one', () => {
    expect(probeBudgetMs('disk')).toBe(750);
    expect(probeBudgetMs('daemon')).toBe(1500);
    // @ts-expect-error - 'network' is not a ProbeKind.
    expect(() => probeBudgetMs('network')).toThrow(ContractDecodeError);
  });

  it('closes the unavailable-reason union', () => {
    expect([...PROBE_UNAVAILABLE_REASONS]).toEqual(['timeout', 'unavailable', 'invalid']);
    expect(isProbeUnavailableReason('timeout')).toBe(true);
    expect(isProbeUnavailableReason('boom')).toBe(false);
  });
});

describe('machine rows', () => {
  for (const vector of vectors.healthRows.machine.valid) {
    it(`decodes ${vector.name}`, () => expect(decodeMachineRow(vector.value)).toEqual(vector.value));
  }
  for (const vector of vectors.healthRows.machine.invalid) {
    it(`refuses ${vector.name}`, () => expect(() => decodeMachineRow(vector.value)).toThrow(ContractDecodeError));
  }
});

describe('daemon rows', () => {
  for (const vector of vectors.healthRows.daemon.valid) {
    it(`decodes ${vector.name}`, () => expect(decodeDaemonRow(vector.value)).toEqual(vector.value));
  }
  for (const vector of vectors.healthRows.daemon.invalid) {
    it(`refuses ${vector.name}`, () => expect(() => decodeDaemonRow(vector.value)).toThrow(ContractDecodeError));
  }
});

describe('release rows', () => {
  for (const vector of vectors.healthRows.release.valid) {
    it(`decodes ${vector.name}`, () => expect(decodeReleaseRow(vector.value)).toEqual(vector.value));
  }
  for (const vector of vectors.healthRows.release.invalid) {
    it(`refuses ${vector.name}`, () => expect(() => decodeReleaseRow(vector.value)).toThrow(ContractDecodeError));
  }
});

describe('deploy rows', () => {
  for (const vector of vectors.healthRows.deploy.valid) {
    it(`decodes ${vector.name}`, () => expect(decodeDeployRow(vector.value)).toEqual(vector.value));
  }
  for (const vector of vectors.healthRows.deploy.invalid) {
    it(`refuses ${vector.name}`, () => expect(() => decodeDeployRow(vector.value)).toThrow(ContractDecodeError));
  }

  it('the deploy row is display-only: its value carries no control verb', () => {
    const row = decodeDeployRow(vectors.healthRows.deploy.valid[0]!.value);
    expect(Object.keys(row.value).sort()).toEqual(['deploymentRef', 'error', 'previousCommit', 'state', 'targetCommit']);
  });
});
