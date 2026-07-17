/**
 * D3.5 — Quartermaster (usage) panel: read-only usage rollup over the EXISTING ledger projection.
 *
 * Reuses `planeA/ledgers.ts` (`rollupLedgers` + `sliceLedgers`) — it does NOT re-read or re-parse the
 * TSVs. The cost ledger's only quantitative columns are `step` and `usd` (there are no token or
 * wall-clock columns), so this panel surfaces per-model step counts, model mix, and card/dispatch counts,
 * and DELIBERATELY suppresses the USD figure: only a boolean `usdPresent` flag survives — never a dollar
 * amount — mirroring `CostRollup` and the Ledgers/Control views. It fabricates no dimension the ledger
 * does not carry.
 */
import { rollupLedgers, sliceLedgers } from '../planeA/ledgers.ts';
import type { LedgerSlice } from '../planeA/ledgers.ts';

/** One per-model usage row: mono model identifier, its step count, and its share of steps (0..1). */
export interface UsageModelRow {
  model: string;
  steps: number;
  mix: number;
}

export interface UsagePanel {
  /** Panel label — this is a USAGE view, never a spend view. */
  label: 'usage';
  stepCount: number;
  perModelSteps: Record<string, number>;
  modelMix: Record<string, number>;
  /** Per-model rows, busiest first (steps desc, then model id) — ready to render. */
  models: UsageModelRow[];
  dispatchCount: number;
  cards: number;
  byProject: Record<string, number>;
  /** Per-writer usage slices (from the ledger filename), busiest first. USD suppressed, as everywhere. */
  byWriter: LedgerSlice[];
  /** Per-day usage slices, newest first. USD suppressed. */
  byDay: LedgerSlice[];
  /** Whether the cost ledger carries a `usd` column at all — SUPPRESSED as a figure, surfaced only as a flag. */
  usdPresent: boolean;
}

/** Build the Quartermaster usage panel by re-projecting the existing ledger rollup + slices. Pure read. */
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
    usdPresent: roll.cost.usdPresent,
  };
}
