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

/**
 * One sliced usage cell — either a per-DAY slice (`key` = `YYYY-MM-DD`) or a per-WRITER slice
 * (`key` = the agent id). The date and writer are NOT columns in the ledger rows; they live in the
 * ledger filename (`ledgers/<kind>/<writer>-<YYYY-MM-DD>.tsv`), so slicing reads the filename, not a
 * fabricated row dimension. USD is deliberately absent here, exactly as in `CostRollup`.
 */
export interface LedgerSlice {
  key: string;
  dispatches: number;
  cards: number;
  steps: number;
  perModelSteps: Record<string, number>;
  byProject: Record<string, number>;
}

export interface LedgerSlices {
  /** Per-day slices, newest date first. */
  byDay: LedgerSlice[];
  /** Per-writer/agent slices, busiest first (steps, then dispatches, then id). */
  byWriter: LedgerSlice[];
  /** Whether the cost ledger carries a `usd` column at all — SUPPRESSED from every slice, as usual. */
  usdPresent: boolean;
}

/** Ledger filename convention: `<writer>-<YYYY-MM-DD>.tsv`. The `<writer>` segment may itself
 *  contain hyphens (e.g. `worker-desktop-2026-07-16.tsv`), so the date anchor is matched greedily-last. */
const LEDGER_NAME_RE = /^(.+)-(\d{4}-\d{2}-\d{2})\.tsv$/;

/** Parse a ledger filename into `{ writer, date }`, or null when it doesn't follow the convention. */
export function parseLedgerName(name: string): { writer: string; date: string } | null {
  const m = LEDGER_NAME_RE.exec(name);
  return m ? { writer: m[1], date: m[2] } : null;
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

/** One ledger file with its filename-derived `{ writer, date }` and its parsed rows. */
interface LedgerFile {
  writer: string;
  date: string;
  rows: Record<string, string>[];
}

/** Read every conventionally-named `<writer>-<date>.tsv` under `ledgers/<kind>/`. Missing dir → []. */
function readKindFiles(repoRoot: string, kind: string): LedgerFile[] {
  const dir = join(repoRoot, 'ledgers', kind);
  if (!existsSync(dir)) return [];
  const out: LedgerFile[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsv')) continue;
    const parsed = parseLedgerName(name);
    if (!parsed) continue; // filename lacks the <writer>-<date> convention → not sliceable
    out.push({ writer: parsed.writer, date: parsed.date, rows: parseTsv(join(dir, name)) });
  }
  return out;
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

/**
 * Slice the dispatch + cost ledgers by DAY and by WRITER. The date and writer are read from each
 * ledger filename (`<writer>-<YYYY-MM-DD>.tsv`) — cost rows carry no date/writer columns, so this is
 * the only honest source for those two dimensions. Files that don't follow the naming convention are
 * skipped (they cannot be attributed). USD stays SUPPRESSED — no slice carries a dollar figure.
 */
export function sliceLedgers(repoRoot: string): LedgerSlices {
  const dispatchFiles = readKindFiles(repoRoot, 'dispatch');
  const costFiles = readKindFiles(repoRoot, 'cost');

  const byDay = new Map<string, LedgerSlice>();
  const byWriter = new Map<string, LedgerSlice>();
  const ensure = (map: Map<string, LedgerSlice>, key: string): LedgerSlice => {
    let slice = map.get(key);
    if (!slice) {
      slice = { key, dispatches: 0, cards: 0, steps: 0, perModelSteps: {}, byProject: {} };
      map.set(key, slice);
    }
    return slice;
  };

  for (const file of dispatchFiles) {
    for (const slice of [ensure(byDay, file.date), ensure(byWriter, file.writer)]) {
      slice.dispatches += file.rows.length;
      slice.cards += file.rows.length;
      for (const row of file.rows) {
        const project = row.project ?? '';
        if (project) slice.byProject[project] = (slice.byProject[project] ?? 0) + 1;
      }
    }
  }

  let usdPresent = false;
  for (const file of costFiles) {
    for (const slice of [ensure(byDay, file.date), ensure(byWriter, file.writer)]) {
      slice.steps += file.rows.length;
      for (const row of file.rows) {
        const model = row.model ?? '';
        if (model) slice.perModelSteps[model] = (slice.perModelSteps[model] ?? 0) + 1;
        if ('usd' in row && row.usd !== '') usdPresent = true;
      }
    }
  }

  const byDaySorted = [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key));
  const byWriterSorted = [...byWriter.values()].sort(
    (a, b) => b.steps - a.steps || b.dispatches - a.dispatches || a.key.localeCompare(b.key),
  );
  return { byDay: byDaySorted, byWriter: byWriterSorted, usdPresent };
}
