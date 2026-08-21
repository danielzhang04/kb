/** Read-only Health usage projection over the existing ledger readers. */
import { rollupLedgers, sliceLedgers } from '../planeA/ledgers.ts';
import type { LedgerSlice } from '../planeA/ledgers.ts';

/** One per-model usage row: mono model identifier, its step count, and its share of steps (0..1). */
export interface UsageModelRow {
  model: string;
  steps: number;
  mix: number;
}

export interface UsagePanel {
  /** Stable panel label. */
  label: 'usage';
  stepCount: number;
  perModelSteps: Record<string, number>;
  modelMix: Record<string, number>;
  /** Per-model rows, busiest first (steps desc, then model id) — ready to render. */
  models: UsageModelRow[];
  dispatchCount: number;
  cards: number;
  byProject: Record<string, number>;
  /** Per-writer usage slices (from the ledger filename), busiest first. */
  byWriter: LedgerSlice[];
  /** Per-day usage slices, newest first. */
  byDay: LedgerSlice[];
}

/** Build the Health usage rows by re-projecting the existing ledger rollup and slices. */
export function buildUsagePanel(repoRoot: string): UsagePanel {
  const roll = rollupLedgers(repoRoot);
  const slices = sliceLedgers(repoRoot);

  const models: UsageModelRow[] = Object.entries(roll.cost.perModelSteps)
    .map(([model, steps]) => ({ model, steps, mix: roll.cost.modelMix[model] ?? 0 }))
    .sort((a, b) => b.steps - a.steps || a.model.localeCompare(b.model));

  return {
    label: 'usage',
    stepCount: roll.cost.stepCount,
    perModelSteps: roll.cost.perModelSteps,
    modelMix: roll.cost.modelMix,
    models,
    dispatchCount: roll.dispatch.count,
    cards: roll.dispatch.cards,
    byProject: roll.dispatch.byProject,
    byWriter: slices.byWriter,
    byDay: slices.byDay,
  };
}
