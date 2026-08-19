/**
 * Wave-1 U5 — the autonomy-ladder panel: what each worker has actually EARNED, recomputed from the
 * grade ledger on every read, next to what its agent file DECLARES.
 *
 * READ-ONLY — and the claim is about the whole CALL GRAPH, not just this file. Two things make it true:
 *
 *   1. This module imports only read entry points from `node:fs` (`existsSync`, `readFileSync`) — never
 *      `writeFileSync` / `appendFileSync` / `promises.writeFile` / `unlinkSync` — and it never shells a
 *      subprocess, so the python WRITERS (`scripts/trust.py` writes `dashboards/trust.md`) are never
 *      invoked; only their logic is ported.
 *   2. Its dependencies are injected read-only. `indexRepo` / `buildRoster` default to
 *      `defaultNamingRegistry()`, whose `displayFor` → `shortRef` PERSISTS a new ordinal through
 *      `mkdirSync` + `openSync` + `writeFileSync` (`server/naming.ts:70-97`) — a real write, outside the
 *      repo, on the first sight of any agent or card. So this module injects {@link EphemeralNamingRegistry}
 *      instead: same display/short-ref contract, ordinals held in memory, nothing persisted.
 *
 * `autonomyLadder.test.ts` pins BOTH with a tripwire that mocks `node:fs`, `node:fs/promises` and
 * `node:child_process` (every write/spawn entry point throws while armed) over a fixture that carries
 * `agents/` and a `queue/` card — i.e. the shape that actually exercises `displayFor` — plus an mtime
 * snapshot of the grade shard around a full build AND a real route call. Displaying the ladder must
 * never promote anyone: promotion stays with `scripts/promotion.py` on the dispatch path.
 *
 * ── The port, and its drift guard ────────────────────────────────────────────────────────────────
 * The verdict logic below is a LINE-FOR-LINE port of the pure core of `scripts/promotion.py`:
 *   • `TIERS`               ← promotion.py:61-65   (`_TIERS`)
 *   • `belowFloor`          ← promotion.py:97-104  (`_below_floor`)
 *   • `belowBar`            ← promotion.py:107-116 (`_below_bar`)
 *   • `streakIsAutonomous`  ← promotion.py:119-133 (`_streak_is_autonomous`)
 *   • `status`              ← promotion.py:140-154 (`status`)
 *   • `isFrozen`            ← promotion.py:177-178 (`is_frozen`)
 *   • `allowedGraders` / `readTrustedGrades` ← promotion.py:181-219
 * and the per-key track record is a port of `scripts/trust.py:compute_trust` (trust.py:31-41 for the
 * tier-aware helpers, trust.py:61-87 for the row math) with its `write=False` posture made permanent.
 * The python remains the authority: it gates real dispatch, this only renders. If either file moves,
 * `autonomyLadder.test.ts` re-expresses `tests/test_promotion.py::test_status_bar_floor_window`
 * fixture-for-fixture, so a divergence reds a test instead of quietly showing a different answer than
 * the fleet is acting on.
 *
 * ── Declared vs earned ───────────────────────────────────────────────────────────────────────────
 * `declaredCeiling` (the `autonomy-tier` string U3 reads out of `agents/<id>.md`) is ADVISORY — a
 * human's stated ceiling. The earned verdict is FACT — recomputed from trusted grade rows. They are
 * kept in structurally separate fields and are never merged, min'd, or reconciled here: a worker can
 * declare T3 and have earned nothing, and the panel must show exactly that.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexRepo } from '../planeA/indexer.ts';
import { readKindRows } from '../planeA/ledgers.ts';
import { buildRoster } from '../agents/roster.ts';
import { NamingRegistry } from '../naming.ts';
import type { EntityKind } from '../naming.ts';
import { parseYaml } from '../routing/yaml.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';

/** The two autonomy verdicts this projection can report (`acts-alone` is a dispatch-side class, not a
 *  ladder state, so it is deliberately absent here). */
export type AutonomyVerdict = 'autonomous' | 'queues-for-me';

export const AUTONOMOUS = 'autonomous';
export const QUEUES_FOR_ME = 'queues-for-me';
export const EVAL_WORKER = 'eval-suite';
const RESERVED_EVAL_KEYS = ['task_type', 'card_id', 'kind'] as const;

/** A grade row as it arrives from `ledgers/grades/*.tsv` (all cells strings) or from a typed test. */
export type GradeRow = Record<string, unknown>;

export interface TierConfig {
  /** Graded runs required in the current streak. */
  window: number;
  /** A run scoring below this, inside the last `window`, blocks autonomy. */
  bar: number;
  /** Below this RESETS the streak (null for T3, whose floor is "any failure"). */
  floor: number | null;
  floorKind: 'score' | 'fail';
}

/** promotion.py:61-65 — the binding per-tier promotion parameters (governance/risk-tiers.md). */
export const TIERS: Record<string, TierConfig> = {
  T1: { window: 10, bar: 90, floor: 80, floorKind: 'score' },
  T2: { window: 20, bar: 95, floor: 90, floorKind: 'score' },
  T3: { window: 40, bar: 98, floor: null, floorKind: 'fail' },
};

/**
 * A `NamingRegistry` that assigns short-refs IN MEMORY and never persists them.
 *
 * `NamingRegistry.shortRef` writes `naming.json` (mkdirSync + openSync + writeFileSync) the first time
 * it sees an id, and `indexRepo` / `buildRoster` call `displayFor` for every card and agent — so using
 * the default registry would make this read-only panel write to disk on the very first request. The
 * override is the public `shortRef` only: `displayFor` (and therefore the display contract the roster
 * depends on) is inherited unchanged, and the private `load`/`save` are never reached. `server/naming.ts`
 * is NOT edited — the no-persist behaviour is composed here, at the one call site that needs it.
 *
 * The ordinals this hands out are per-request and are NOT the fleet-wide ordinals humans see elsewhere.
 * That is fine and deliberate: nothing in this panel's DTO surfaces `shortRef`; it only needs the
 * roster's `id` and `autonomyTier`. Displaying a short-ref here would require the persisted registry —
 * i.e. a write — which is exactly what this panel refuses to do.
 */
export class EphemeralNamingRegistry extends NamingRegistry {
  private readonly ordinals = new Map<string, number>();

  constructor() {
    // Path is inert: every method that would touch it is overridden or unreachable.
    super('<ephemeral-naming-registry-never-read-or-written>');
  }

  override shortRef(kind: EntityKind, id: string): number {
    const key = `${kind}\0${id}`;
    const existing = this.ordinals.get(key);
    if (existing !== undefined) return existing;
    let next = 1;
    for (const [k, ordinal] of this.ordinals) {
      if (k.startsWith(`${kind}\0`)) next = Math.max(next, ordinal + 1);
    }
    this.ordinals.set(key, next);
    return next;
  }
}

/**
 * String order by CODE POINT, matching Python's `sorted(..., key=str)` on the `ts` column. JS
 * `localeCompare` is locale-aware and would order malformed/punctuated timestamps differently from
 * `scripts/promotion.py`, which is precisely the drift this port must not have.
 */
function compareTs(a: GradeRow, b: GradeRow): number {
  const x = String(a.ts ?? '');
  const y = String(b.ts ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}

/** promotion.py:78-82 — `float(value)`, with None on anything unparseable (an empty cell included). */
function scoreOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** promotion.py:85-90 — fail-closed truthiness: only an explicit true-ish token counts as a pass. */
function passed(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'pass', 'passed'].includes(String(value).trim().toLowerCase());
}

/** promotion.py:93-94 — the full promotion key. */
function rowKey(row: GradeRow): string {
  return JSON.stringify([row.worker ?? null, row.project ?? null, row.task_type ?? null, row.tier ?? null]);
}

/** promotion.py:_is_reserved_eval_row — eval evidence is never promotion evidence. */
export function isReservedEvalRow(row: GradeRow): boolean {
  if (String(row.worker ?? '') === EVAL_WORKER) return true;
  return RESERVED_EVAL_KEYS.some((key) => String(row[key] ?? '').startsWith('eval:'));
}

/** promotion.py:_promotion_rows — the sole row boundary for this projection. */
export function promotionRows(rows: GradeRow[]): GradeRow[] {
  return rows.filter((row) => !isReservedEvalRow(row));
}

/** promotion.py:97-104 — a below-floor run RESETS the streak. Malformed score ⇒ reset (fail closed). */
export function belowFloor(row: GradeRow, tier: string): boolean {
  const cfg = TIERS[tier];
  if (!cfg) return !passed(row.pass); // trust.py:38-41 — unknown tier: any failure is a floor break
  if (cfg.floorKind === 'fail') return !passed(row.pass);
  const s = scoreOf(row.score);
  if (s === null) return true;
  return s < (cfg.floor as number);
}

/** promotion.py:107-116 — a failed run never counts toward the window, whatever its score. */
export function belowBar(row: GradeRow, tier: string): boolean {
  const cfg = TIERS[tier];
  if (!cfg) return !passed(row.pass); // trust.py:31-35 — unknown tier: only the pass flag is meaningful
  if (!passed(row.pass)) return true;
  const s = scoreOf(row.score);
  if (s === null) return true;
  return s < cfg.bar;
}

/** promotion.py:119-133 — `window` consecutive above-floor runs, none of the last `window` below bar. */
export function streakIsAutonomous(matching: GradeRow[], tier: string): boolean {
  const cfg = TIERS[tier];
  if (!cfg) return false;
  let streak: GradeRow[] = [];
  for (const row of matching) {
    if (belowFloor(row, tier)) streak = [];
    else streak.push(row);
  }
  if (streak.length < cfg.window) return false;
  return !streak.slice(-cfg.window).some((row) => belowBar(row, tier));
}

/**
 * promotion.py:140-154 — the pure primitive. `autonomous` iff NOT frozen, the tier is known, and the
 * trailing streak clears the tier's window/bar. Rows are matched on the full key and ordered by `ts`
 * (lexicographic — the ledger writes sortable ISO timestamps). Trusting the rows it is handed is the
 * caller's job; `readTrustedGrades` below is the filter.
 */
export function status(
  worker: unknown,
  project: unknown,
  taskType: unknown,
  tier: string,
  gradesRows: GradeRow[],
  frozen: boolean,
): AutonomyVerdict {
  if (frozen) return QUEUES_FOR_ME;
  if (!(tier in TIERS)) return QUEUES_FOR_ME;
  if (isReservedEvalRow({ worker, task_type: taskType })) return QUEUES_FOR_ME;
  const key = JSON.stringify([worker ?? null, project ?? null, taskType ?? null, tier ?? null]);
  const matching = promotionRows(gradesRows).filter((r) => rowKey(r) === key).sort(compareTs);
  return streakIsAutonomous(matching, tier) ? AUTONOMOUS : QUEUES_FOR_ME;
}

/** promotion.py:177-178 — the human-placed freeze sentinel (no `.tsv` suffix, so no shard glob sees it). */
export function isFrozen(repoRoot: string): boolean {
  return existsSync(join(repoRoot, 'ledgers', 'grades', 'FROZEN'));
}

/**
 * promotion.py:181-210 — grader ids trusted to author grade rows, from `governance/graders.yaml`.
 * Absent, unreadable, or malformed ⇒ the EMPTY set: no grader is trusted and no grade row can earn
 * autonomy (the trust-anchor invariant). Accepts the same plausible shapes the python does.
 *
 * PARSER NOTE (a known, bounded divergence): python uses real `yaml.safe_load`; this uses the repo's
 * YAML-SUBSET parser (`routing/yaml.ts`), the dashboard carrying no YAML dependency. The subset covers
 * the file's committed shape — a `graders:` block sequence of flat `- id: <string>` maps — and that
 * shape is the constraint to preserve when editing the file. Where they disagree the divergence is NOT
 * uniformly fail-closed: a TAB-INDENTED `graders.yaml` makes `yaml.safe_load` raise (python ⇒ empty set
 * ⇒ nobody trusted), while the subset parser counts a tab as one indent column and parses it happily
 * ⇒ this panel would trust a grader python does not. That is FAIL-OPEN, and it is display-only (this
 * module gates nothing; `promotion.py` still decides real dispatch), but it means the panel can show a
 * more permissive earned verdict than the fleet acts on until `graders.yaml` is space-indented again.
 */
export function allowedGraders(repoRoot: string): Set<string> {
  const out = new Set<string>();
  const path = join(repoRoot, 'governance', 'graders.yaml');
  if (!existsSync(path)) return out;
  let data: unknown;
  try {
    data = parseYaml(readFileSync(path, 'utf-8'));
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  const graders = (data as Record<string, unknown>).graders;
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v.trim() !== '') out.add(v.trim());
  };
  if (Array.isArray(graders)) {
    for (const g of graders) {
      if (typeof g === 'string') add(g);
      else if (g && typeof g === 'object' && !Array.isArray(g)) {
        const rec = g as Record<string, unknown>;
        add(rec.id ?? rec.inspector_id ?? rec.name);
      }
    }
  } else if (graders && typeof graders === 'object') {
    for (const k of Object.keys(graders as Record<string, unknown>)) add(k);
  }
  return out;
}

/**
 * promotion.py:234-240 — every non-reserved grade row whose `inspector_id` is allow-listed. Empty allow-list ⇒ []
 * (fail closed). Reads the shards through the existing generic ledger reader, so `.gitkeep` and the
 * `FROZEN` sentinel are skipped exactly as the python's `*.tsv` glob skips them.
 */
export function readTrustedGrades(repoRoot: string): GradeRow[] {
  const allowed = allowedGraders(repoRoot);
  if (allowed.size === 0) return [];
  return promotionRows(readKindRows(repoRoot, 'grades').filter(
    (r) => allowed.has(String(r.inspector_id ?? '')),
  ));
}

/** One earned row: a `(worker, project, task_type, tier)` key with its verdict and track record. */
export interface LadderKeyRow {
  worker: string;
  project: string;
  taskType: string;
  tier: string;
  /** The RECOMPUTED verdict (forced to `queues-for-me` while the fleet is frozen). */
  verdict: AutonomyVerdict;
  /** Graded runs in the tier window (trust.py:64-66). */
  runs: number;
  /** Runs in that window at/above the tier bar (trust.py:67). */
  passes: number;
  /** Trailing runs that never dropped below the tier floor (trust.py:68-73). */
  streak: number;
  floorStatus: 'ok' | 'below-floor';
  /** The LATEST run fell below the floor (trust.py:74). */
  demote: boolean;
  /** `passes / runs`, 0 when there are no runs. Convenience for the panel's pass-rate column. */
  passRate: number;
}

/**
 * One worker row. `declaredCeiling` and `earned` are STRUCTURALLY SEPARATE and stay that way: the
 * declared string is advisory metadata, the earned rows are recomputed fact.
 */
export interface LadderWorkerRow {
  worker: string;
  /** `autonomy-tier` from `agents/<id>.md`, or null when undeclared. ADVISORY ONLY. */
  declaredCeiling: string | null;
  /** Every earned key for this worker. `[]` is the honest "no graded data" answer, never a verdict. */
  earned: LadderKeyRow[];
}

export interface AutonomyLadderPanel {
  label: 'autonomy-ladder';
  /** `ledgers/grades/FROZEN` present — every verdict is forced to `queues-for-me`. */
  frozen: boolean;
  /** Allow-listed graders in `governance/graders.yaml`. 0 ⇒ nothing can be earned (fail closed). */
  trustedGraderCount: number;
  /** Trusted grade rows the verdicts were computed from. */
  gradeRowCount: number;
  /** ALL rows in `ledgers/grades/**`, trusted or not. `ledgerRowCount > 0` with `gradeRowCount === 0`
   *  is a materially different situation from an empty ledger — grades exist but no allow-listed
   *  grader authored them — and the panel says which of the two it is looking at. */
  ledgerRowCount: number;
  /** Every worker (roster ∪ graded workers), each with its declared ceiling and earned rows. */
  workers: LadderWorkerRow[];
  /** The same earned rows, flat and sorted — the key-level view. */
  keys: LadderKeyRow[];
}

/** trust.py:61-87 — the per-key track record, computed with `write=False` semantics, permanently. */
function trackRecord(rlist: GradeRow[], tier: string): Omit<LadderKeyRow, 'worker' | 'project' | 'taskType' | 'tier' | 'verdict'> {
  const cfg = TIERS[tier];
  const window = cfg ? cfg.window : rlist.length;
  const windowRows = window ? rlist.slice(-window) : rlist;
  const runs = windowRows.length;
  const passes = windowRows.filter((r) => !belowBar(r, tier)).length;
  let streak = 0;
  for (let i = rlist.length - 1; i >= 0; i -= 1) {
    if (belowFloor(rlist[i], tier)) break;
    streak += 1;
  }
  const demote = rlist.length > 0 ? belowFloor(rlist[rlist.length - 1], tier) : false;
  return {
    runs,
    passes,
    streak,
    floorStatus: demote ? 'below-floor' : 'ok',
    demote,
    passRate: runs > 0 ? passes / runs : 0,
  };
}

/**
 * Build the autonomy-ladder panel. Pure read: trusted grade rows + the FROZEN sentinel + the roster's
 * declared `autonomy-tier`. Workers come from the roster (the same `indexRepo` → `buildRoster` call
 * `panels/health.ts` makes) UNION any worker that appears in the trusted grade rows, so a grader can
 * never make a worker vanish and a roster gap can never hide an earned verdict.
 */
export function buildAutonomyLadderPanel(
  repoRoot: string,
  policy: PolicyDoc = loadPolicy(repoRoot),
  override: OverrideDoc = loadOverride(repoRoot),
): AutonomyLadderPanel {
  const frozen = isFrozen(repoRoot);
  const graderCount = allowedGraders(repoRoot).size;
  const ledgerRowCount = readKindRows(repoRoot, 'grades').length;
  const trusted = readTrustedGrades(repoRoot);

  // Group trusted rows by the full promotion key, ts-ordered inside each group (trust.py:54-62).
  const groups = new Map<string, GradeRow[]>();
  for (const row of trusted) {
    const key = rowKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const keys: LadderKeyRow[] = [];
  for (const [key, rlist] of groups) {
    const [worker, project, taskType, tier] = JSON.parse(key) as (string | null)[];
    const ordered = [...rlist].sort(compareTs);
    keys.push({
      worker: worker ?? '',
      project: project ?? '',
      taskType: taskType ?? '',
      tier: tier ?? '',
      verdict: status(worker, project, taskType, tier ?? '', ordered, frozen),
      ...trackRecord(ordered, tier ?? ''),
    });
  }
  keys.sort(
    (a, b) =>
      a.worker.localeCompare(b.worker) || a.project.localeCompare(b.project) ||
      a.taskType.localeCompare(b.taskType) || a.tier.localeCompare(b.tier),
  );

  // Both calls take the naming registry EXPLICITLY: their default (`defaultNamingRegistry()`) persists
  // ordinals to `naming.json`, which would make this read-only panel write on its first request.
  const naming = new EphemeralNamingRegistry();
  const roster = buildRoster(indexRepo(repoRoot, naming), repoRoot, policy, override, naming);
  const declaredById = new Map(roster.map((e) => [e.id, e.autonomyTier ?? null]));
  const workerIds = [...new Set([...declaredById.keys(), ...keys.map((k) => k.worker)])].filter((id) => id !== '');
  const workers: LadderWorkerRow[] = workerIds
    .sort((a, b) => a.localeCompare(b))
    .map((worker) => ({
      worker,
      declaredCeiling: declaredById.get(worker) ?? null,
      earned: keys.filter((k) => k.worker === worker),
    }));

  return {
    label: 'autonomy-ladder',
    frozen,
    trustedGraderCount: graderCount,
    gradeRowCount: trusted.length,
    ledgerRowCount,
    workers,
    keys,
  };
}
