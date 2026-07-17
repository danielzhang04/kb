/**
 * D3.5 — Quartermaster (usage) panel. A read-only rollup over the EXISTING ledger projection
 * (`planeA/ledgers.ts`): per-model `step` counts, model mix, and card/dispatch counts. The cost ledger
 * schema has ONLY `model` / `step` / `usd` columns — the panel surfaces steps + mix and DELIBERATELY
 * suppresses the USD figure (only a `usdPresent` flag survives, exactly as `CostRollup` does). It never
 * fabricates a token or wall-clock dimension the ledger does not carry.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildUsagePanel } from './usage.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('buildUsagePanel', () => {
  it('rolls up per-model step counts, model mix, and card/dispatch counts', () => {
    const panel = buildUsagePanel(REPO_A);
    expect(panel.label).toBe('usage');

    // cost ledger header `model\tstep\tusd` — 3 step rows across two models.
    expect(panel.stepCount).toBe(3);
    expect(panel.perModelSteps).toEqual({ 'claude-sonnet-5': 2, 'claude-opus-4': 1 });
    expect(panel.modelMix['claude-sonnet-5']).toBeCloseTo(2 / 3, 5);

    // Sorted model rows (busiest first) carry the mono model identifier + share.
    expect(panel.models.map((m) => m.model)).toEqual(['claude-sonnet-5', 'claude-opus-4']);
    expect(panel.models[0]).toMatchObject({ model: 'claude-sonnet-5', steps: 2 });

    // dispatch ledger header `cadence\tcard\tdate\tproject` — 2 rows.
    expect(panel.dispatchCount).toBe(2);
    expect(panel.cards).toBe(2);
    expect(panel.byProject).toEqual({ kb: 1, 'faceless-youtube': 1 });

    // Per-writer slice reused from sliceLedgers.
    expect(panel.byWriter.map((w) => w.key)).toEqual(['dispatcher']);
  });

  it('SUPPRESSES the USD figure — only a boolean presence flag, never a dollar amount', () => {
    const panel = buildUsagePanel(REPO_A);
    // The usd column exists in the data (flag true) but is never surfaced as a figure.
    expect(panel.usdPresent).toBe(true);
    expect(panel).not.toHaveProperty('usd');
    expect(panel).not.toHaveProperty('spend');
    expect(panel).not.toHaveProperty('usdTotal');
    expect(panel).not.toHaveProperty('cost');
    for (const m of panel.models) {
      expect(m).not.toHaveProperty('usd');
      expect(m).not.toHaveProperty('spend');
    }
  });

  it('NEVER fabricates a token or wall-clock dimension the ledger lacks', () => {
    const panel = buildUsagePanel(REPO_A);
    for (const key of ['tokens', 'tokenCount', 'inputTokens', 'outputTokens', 'wallClock', 'durationMs', 'seconds']) {
      expect(panel).not.toHaveProperty(key);
    }
    for (const m of panel.models) {
      expect(m).not.toHaveProperty('tokens');
      expect(m).not.toHaveProperty('durationMs');
    }
  });

  it('is empty-safe with no ledgers/ directory', () => {
    const empty = mkdtempSync(join(tmpdir(), 'usage-empty-'));
    const panel = buildUsagePanel(empty);
    expect(panel.stepCount).toBe(0);
    expect(panel.models).toEqual([]);
    expect(panel.dispatchCount).toBe(0);
    expect(panel.usdPresent).toBe(false);
  });
});
