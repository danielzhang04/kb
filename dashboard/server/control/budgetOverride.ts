/**
 * Durable per-window budget override store for the signed `POST /api/control/budget/override` route
 * (spec docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.6, plan T6). A grant
 * ADDS to that window's `maxCostUsdMicros` ceiling only — never attempts or tokens — and is read back
 * through `AccountingPolicy`'s `windowBudgetFor` resolver (`adapters.ts`) at RESERVE time, so a signed
 * override reaches a running daemon without a restart.
 *
 * Deliberately excluded from `adapters.ts`'s accounting-policy hash: `windowBudgetFor` is a function,
 * never part of the `{ maxConcurrency, globalBudget }` object the hash is computed over, so granting an
 * override never invalidates a day's already-open accounting document.
 *
 * `grant` and `additionalUsdMicros` are SYNCHRONOUS — this store is read on the hot `reserve` path and
 * written at most a few times a day by a human-signed approval, so a small synchronous read-modify-write
 * (mirroring `spendGrantProvision.ts`'s token-file write, not `atomicJsonDocument.ts`'s cross-process
 * SQLite-locked `mutate`) is the right shape here; no caller awaits either method.
 *
 * Fail closed everywhere: a missing document reads as empty (no override, not a refusal — this store has
 * never been written yet on a fresh daemon), but an unreadable, oversized, or corrupt document means NO
 * override (`additionalUsdMicros` returns 0) and a grant against it is `'refused'`, never a silent
 * fall-through to "allow".
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { renameWithRetrySync } from '../atomicRename.ts';

const SCHEMA = 'kb.budget-overrides/v1';
/** Per-grant ceiling (plan Global Constraints, spec §4.6): a single approval cannot mint more than this. */
const PER_GRANT_CAP_USD_MICROS = 20_000_000;
/** Per-day SUM ceiling across every grant for one window — 3x the per-grant cap, so a lost signing key
 *  cannot mint an unbounded day even across several separately-signed approvals. */
const PER_DAY_CAP_USD_MICROS = 60_000_000;
/** The document itself is small (one row per override, ever) — this is a generous, fail-closed ceiling
 *  against a corrupted or hostile file, not a sizing target. */
const MAX_DOCUMENT_BYTES = 1_000_000;
const WINDOW_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export interface BudgetOverride {
  /** 'YYYY-MM-DD' (UTC) — the accounting window id this grant widens. */
  windowDay: string;
  /** Positive safe integer, capped at {@link PER_GRANT_CAP_USD_MICROS}. */
  additionalUsdMicros: number;
  /** ISO-8601 Z. The caller's value is advisory only — the store stamps its own at write time. */
  grantedAt: string;
  /** Always `'daniel'` in practice (the approval payload's fixed `actor`), carried through rather than
   *  re-imported from `authority/approval.ts` so this module stays free of that dependency. */
  actor: string;
  /** The verified approval's nonce — ties this durable record to the signed request that authorized it,
   *  and is this store's own idempotency key (a retried request replays instead of double-granting). */
  nonce: string;
}

export type BudgetOverrideGrantOutcome = 'granted' | 'replayed' | 'refused';

export interface BudgetOverrideStore {
  /** Sum of `windowDay`'s granted overrides. 0 when none exist, or on any read failure (fail closed). */
  additionalUsdMicros(windowDay: string): number;
  /** Append one grant; idempotent on `nonce`. Refuses (never throws) on a malformed input, a per-grant or
   *  per-day ceiling breach, or a durable read/write failure. */
  grant(override: BudgetOverride): BudgetOverrideGrantOutcome;
}

interface BudgetOverrideDocument {
  schema: typeof SCHEMA;
  rows: BudgetOverride[];
}

function documentPath(stateRoot: string): string {
  return join(stateRoot, 'authority', 'budget-overrides.json');
}

function isBudgetOverrideShape(value: unknown): value is BudgetOverride {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.windowDay === 'string' && WINDOW_DAY_PATTERN.test(row.windowDay)
    && typeof row.additionalUsdMicros === 'number' && Number.isSafeInteger(row.additionalUsdMicros) && row.additionalUsdMicros > 0
    && typeof row.grantedAt === 'string' && row.grantedAt.length > 0
    && typeof row.actor === 'string' && row.actor.length > 0
    && typeof row.nonce === 'string' && NONCE_PATTERN.test(row.nonce);
}

function isBudgetOverrideDocument(value: unknown): value is BudgetOverrideDocument {
  if (value === null || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return doc.schema === SCHEMA && Array.isArray(doc.rows) && doc.rows.every(isBudgetOverrideShape);
}

/** `null` on anything that is not a clean, in-bounds, schema-valid read. A MISSING file is the one
 *  exception — it reads as an empty document (a daemon that has never granted an override), not a
 *  refusal. */
function readDocument(path: string): BudgetOverrideDocument | null {
  if (!existsSync(path)) return { schema: SCHEMA, rows: [] };
  try {
    if (statSync(path).size > MAX_DOCUMENT_BYTES) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return isBudgetOverrideDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Fresh-temp-file-then-rename, the same idiom every other synchronous durable write in this server uses
 *  (`spendGrantProvision.ts#defaultWriteGrantFile`, `atomicJsonDocument.ts#save`): a partial write is
 *  never observed, and `renameWithRetrySync` absorbs the transient Windows share-violation window a
 *  concurrent reader can open. */
function writeDocument(path: string, document: BudgetOverrideDocument): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  renameWithRetrySync(temp, path);
}

function sumFor(document: BudgetOverrideDocument, windowDay: string): number {
  return document.rows
    .filter((row) => row.windowDay === windowDay)
    .reduce((sum, row) => sum + row.additionalUsdMicros, 0);
}

/** `now` is injectable for tests; production leaves it at `() => new Date()`. Used to stamp `grantedAt`
 *  on the persisted row — the store owns that timestamp rather than trusting the caller's. */
export function createBudgetOverrideStore(stateRoot: string, now: () => Date = () => new Date()): BudgetOverrideStore {
  const path = documentPath(stateRoot);

  return {
    additionalUsdMicros(windowDay) {
      if (!WINDOW_DAY_PATTERN.test(windowDay)) return 0;
      const document = readDocument(path);
      return document === null ? 0 : sumFor(document, windowDay);
    },
    grant(override) {
      if (!isBudgetOverrideShape(override)) return 'refused';
      if (override.additionalUsdMicros > PER_GRANT_CAP_USD_MICROS) return 'refused';
      const document = readDocument(path);
      if (document === null) return 'refused';
      if (document.rows.some((row) => row.nonce === override.nonce)) return 'replayed';
      if (sumFor(document, override.windowDay) + override.additionalUsdMicros > PER_DAY_CAP_USD_MICROS) return 'refused';
      const row: BudgetOverride = {
        windowDay: override.windowDay,
        additionalUsdMicros: override.additionalUsdMicros,
        grantedAt: now().toISOString(),
        actor: override.actor,
        nonce: override.nonce,
      };
      try {
        writeDocument(path, { schema: SCHEMA, rows: [...document.rows, row] });
      } catch {
        return 'refused';
      }
      return 'granted';
    },
  };
}
