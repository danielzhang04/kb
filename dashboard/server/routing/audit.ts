/**
 * R2.4 — routing-audit read surface (read-only). Surfaces two things a human needs to spot a mis-route
 * or a stale pin:
 *   1. R1.4's routed-vs-ran mismatches, from the `activity` ledger rows `record_routing_audit` writes
 *      (`event == "routed-vs-ran"`), empty-safe when the ledger has none.
 *   2. Each live override entry's provenance (`set-by`/`set-at`/`expires`) with an `expired` /
 *      `expiringSoon` flag so a stale pin is visible.
 * Pure projection over the activity ledger + the override file. No writes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOverride } from './policy.ts';
import type { OverrideDoc } from './policy.ts';

export interface RoutedVsRan {
  cardId: string;
  routedRuntime: string;
  routedModel: string;
  ranModel: string;
  /** "runtime" (load-bearing divergence, also woke a card) or "model" (advisory model-id drift). */
  kind: string;
}

export interface OverrideProvenance {
  scope: string;
  key: string;
  runtime: string | null;
  model: string | null;
  expires: string | null;
  setBy: string | null;
  setAt: string | null;
  expired: boolean;
  /** True when a non-null `expires` is within the next 24h (or already past). */
  expiringSoon: boolean;
}

export interface RoutingAudit {
  mismatches: RoutedVsRan[];
  overrides: OverrideProvenance[];
}

/** Parse a TSV file into header-keyed rows (mirrors planeA/ledgers.ts). Empty/header-only -> []. */
function parseTsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
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

/** Read the routed-vs-ran rows across every `ledgers/activity/*.tsv` shard. */
function readRoutedVsRan(repoRoot: string): RoutedVsRan[] {
  const dir = join(repoRoot, 'ledgers', 'activity');
  if (!existsSync(dir)) return [];
  const out: RoutedVsRan[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsv')) continue;
    for (const row of parseTsv(join(dir, name))) {
      if (row.event !== 'routed-vs-ran') continue;
      out.push({
        cardId: row.card_id ?? '',
        routedRuntime: row.routed_runtime ?? '',
        routedModel: row.routed_model ?? '',
        ranModel: row.ran_model ?? '',
        kind: row.kind ?? 'model',
      });
    }
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Map override entries to provenance rows, flagging expiry against `nowMs`. */
function overrideProvenance(override: OverrideDoc, nowMs: number): OverrideProvenance[] {
  return override.overrides.map((e) => {
    const expires = e.expires ? String(e.expires) : null;
    let expired = false;
    let expiringSoon = false;
    if (expires) {
      const ms = Date.parse(expires.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(expires) ? expires : `${expires}Z`);
      if (!Number.isNaN(ms)) {
        expired = ms <= nowMs;
        expiringSoon = ms <= nowMs + DAY_MS;
      }
    }
    return {
      scope: String(e.scope ?? ''),
      key: String(e.key ?? ''),
      runtime: e.runtime != null ? String(e.runtime) : null,
      model: e.model != null ? String(e.model) : null,
      expires,
      setBy: e['set-by'] != null ? String(e['set-by']) : null,
      setAt: e['set-at'] != null ? String(e['set-at']) : null,
      expired,
      expiringSoon,
    };
  });
}

/** Read the full routing-audit projection: routed-vs-ran mismatches + override provenance/expiry. */
export function readRoutingAudit(repoRoot: string, nowMs: number = Date.now()): RoutingAudit {
  return {
    mismatches: readRoutedVsRan(repoRoot),
    overrides: overrideProvenance(loadOverride(repoRoot), nowMs),
  };
}
