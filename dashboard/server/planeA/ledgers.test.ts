import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rollupLedgers, sliceLedgers } from './ledgers.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('rollupLedgers', () => {
  it('rolls up dispatch+cost TSV using only columns that exist', () => {
    const roll = rollupLedgers(REPO_A);

    // dispatch ledger: header `cadence\tcard\tdate\tproject`
    expect(roll.dispatch.count).toBe(2);
    expect(roll.dispatch.cards).toBe(2);
    expect(roll.dispatch.byProject).toEqual({ kb: 1, 'faceless-youtube': 1 });

    // cost ledger: header `model\tstep\tusd` — surface per-model step counts + model mix
    expect(roll.cost.stepCount).toBe(3);
    expect(roll.cost.perModelSteps).toEqual({ 'claude-sonnet-5': 2, 'claude-opus-4': 1 });
    // model mix = share of steps per model
    expect(roll.cost.modelMix['claude-sonnet-5']).toBeCloseTo(2 / 3, 5);
    expect(roll.cost.modelMix['claude-opus-4']).toBeCloseTo(1 / 3, 5);

    // USD exists in the data but is SUPPRESSED in the usage view — never surfaced as a figure
    expect(roll.cost.usdPresent).toBe(true);
    expect(roll.cost).not.toHaveProperty('usd');
    expect(roll.cost).not.toHaveProperty('spend');
    expect(roll.cost).not.toHaveProperty('usdTotal');
  });

  it('empty grades/ and activity/ produce an empty-but-valid rollup', () => {
    const roll = rollupLedgers(REPO_A);
    // the fixture's grades/ and activity/ hold only a .gitkeep — no fabricated rows, no throw
    expect(roll.grades.count).toBe(0);
    expect(roll.grades.rows).toEqual([]);
    expect(roll.activity.count).toBe(0);
    expect(roll.activity.rows).toEqual([]);
  });

  it('tolerates a repo with no ledgers/ directory at all', () => {
    const empty = mkdtempSync(join(tmpdir(), 'planeA-noledgers-'));
    const roll = rollupLedgers(empty);
    expect(roll.dispatch.count).toBe(0);
    expect(roll.cost.stepCount).toBe(0);
    expect(roll.cost.usdPresent).toBe(false);
    expect(roll.grades.count).toBe(0);
    expect(roll.activity.count).toBe(0);
  });
});

describe('sliceLedgers', () => {
  it('slices usage by day and by writer using the ledger filename (<writer>-<date>.tsv)', () => {
    const slices = sliceLedgers(REPO_A);

    // Fixture has dispatcher-2026-07-16.tsv in both dispatch/ (2 rows) and cost/ (3 rows).
    expect(slices.byDay).toHaveLength(1);
    const day = slices.byDay[0];
    expect(day.key).toBe('2026-07-16');
    expect(day.dispatches).toBe(2);
    expect(day.cards).toBe(2);
    expect(day.steps).toBe(3);
    expect(day.perModelSteps).toEqual({ 'claude-sonnet-5': 2, 'claude-opus-4': 1 });
    expect(day.byProject).toEqual({ kb: 1, 'faceless-youtube': 1 });

    expect(slices.byWriter).toHaveLength(1);
    const writer = slices.byWriter[0];
    expect(writer.key).toBe('dispatcher');
    expect(writer.steps).toBe(3);
    expect(writer.dispatches).toBe(2);

    // USD exists in the data but no slice carries a dollar figure.
    expect(slices.usdPresent).toBe(true);
    for (const slice of [...slices.byDay, ...slices.byWriter]) {
      expect(slice).not.toHaveProperty('usd');
      expect(slice).not.toHaveProperty('spend');
    }
  });

  it('is empty-safe with no ledgers/ directory', () => {
    const empty = mkdtempSync(join(tmpdir(), 'planeA-noslices-'));
    expect(sliceLedgers(empty)).toEqual({ byDay: [], byWriter: [], usdPresent: false });
  });
});
