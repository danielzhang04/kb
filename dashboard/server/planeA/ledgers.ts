/**
 * Plane-A ledger rollups. Ledgers are TSV files `ledgers/<kind>/<agent>-<YYYY-MM-DD>.tsv`.
 *
 * Verified column reality (do not fabricate dimensions the ledger lacks):
 *   - dispatch header: `cadence\tcard\tdate\tproject`
 *   - cost header:     `model\tstep\tusd`   (the ONLY quantitative columns are `step` and `usd`;
 *                      there are no token or wall-clock columns)
 *   - grades/ and activity/ are currently EMPTY (only `.gitkeep`) — the rollup renders with no data.
 *
 * The "usage not spend" view surfaces per-model step counts, card/dispatch counts, and model mix,
 * and SUPPRESSES the USD figure — USD exists in the data, it is simply never surfaced here (we do
 * not claim the data is non-monetary, and we do not fabricate tokens/wall-clock).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DispatchRollup {
  count: number;
  cards: number;
  byProject: Record<string, number>;
}

export interface CostRollup {
  stepCount: number;
  perModelSteps: Record<string, number>;
  modelMix: Record<string, number>;
  usdPresent: boolean;
}

export interface RawKindRollup {
  count: number;
  rows: Record<string, string>[];
}

export interface LedgerRollup {
  dispatch: DispatchRollup;
  cost: CostRollup;
  grades: RawKindRollup;
  activity: RawKindRollup;
}

/** Parse a TSV file into an array of header-keyed row objects. Empty / header-only files → []. */
function parseTsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    return row;
  });
}

/** Read every `*.tsv` under `ledgers/<kind>/` and concatenate their rows. Missing dir → []. */
function readKindRows(repoRoot: string, kind: string): Record<string, string>[] {
  const dir = join(repoRoot, 'ledgers', kind);
  if (!existsSync(dir)) return [];
  const rows: Record<string, string>[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsv')) continue; // skip .gitkeep and non-ledger files
    rows.push(...parseTsv(join(dir, name)));
  }
  return rows;
}

export function rollupLedgers(repoRoot: string): LedgerRollup {
  const dispatchRows = readKindRows(repoRoot, 'dispatch');
  const costRows = readKindRows(repoRoot, 'cost');

  const byProject: Record<string, number> = {};
  for (const row of dispatchRows) {
    const project = row.project ?? '';
    if (project) byProject[project] = (byProject[project] ?? 0) + 1;
  }

  const perModelSteps: Record<string, number> = {};
  let usdPresent = false;
  for (const row of costRows) {
    const model = row.model ?? '';
    if (model) perModelSteps[model] = (perModelSteps[model] ?? 0) + 1;
    if ('usd' in row && row.usd !== '') usdPresent = true;
  }

  const stepCount = costRows.length;
  const modelMix: Record<string, number> = {};
  if (stepCount > 0) {
    for (const [model, n] of Object.entries(perModelSteps)) {
      modelMix[model] = n / stepCount;
    }
  }

  const gradesRows = readKindRows(repoRoot, 'grades');
  const activityRows = readKindRows(repoRoot, 'activity');

  return {
    dispatch: {
      count: dispatchRows.length,
      cards: dispatchRows.length,
      byProject,
    },
    cost: {
      stepCount,
      perModelSteps,
      modelMix,
      usdPresent,
    },
    grades: { count: gradesRows.length, rows: gradesRows },
    activity: { count: activityRows.length, rows: activityRows },
  };
}
