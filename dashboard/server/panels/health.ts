/**
 * D3.5 — Sentinel (health) panel: read-only agent liveness over the existing Plane-A projection.
 *
 * NO new write path. Liveness is DERIVED, not stored:
 *   - the roster (`agents/roster.ts`, itself the union of queue owners ∪ ledger writers ∪ declared
 *     agents) gives each agent its working-card state and last-observed ledger date;
 *   - the org STATE `## Blocked` sections (`planeA/states.ts`) give the per-project blocked flag;
 *   - the declared HEARTBEAT cadences (root `HEARTBEAT.md` + each `orgs/<project>/HEARTBEAT.md`) give the
 *     expected cadence catalogue.
 *
 * Liveness is a pure function of the last ledger date against an injectable `asOf` (defaults to today) and
 * a staleness window — so this panel invents no signal the ledgers/STATE do not already carry, and its
 * tests are deterministic. Server-only (reads the filesystem); degrades gracefully on a sparse checkout.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { indexRepo } from '../planeA/indexer.ts';
import { buildRoster } from '../agents/roster.ts';
import type { AgentRosterEntry } from '../agents/roster.ts';
import { readOrgStates } from '../planeA/states.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';

/** Label used for the root, system-level heartbeat (`HEARTBEAT.md` at the repo root). */
export const SYSTEM_PROJECT = 'system';

/** One declared cadence from a HEARTBEAT.md `cadences:` block. Only the scalar metadata is captured;
 *  the `prompt: |` block scalar body is intentionally never read into a field. */
export interface HeartbeatCadence {
  /** `system` for the root heartbeat, otherwise the `orgs/<project>` directory name. */
  project: string;
  name: string;
  schedule: string | null;
  tier: string | null;
  riskTier: string | null;
}

/**
 * Agent liveness bucket:
 *   - `working` — owns a working card right now (the most-live signal);
 *   - `active`  — not working, but wrote a ledger within the staleness window of `asOf`;
 *   - `stale`   — has past ledger activity, but older than the window;
 *   - `idle`    — no ledger activity ever observed (e.g. a declared-only agent).
 */
export type LivenessStatus = 'working' | 'active' | 'stale' | 'idle';

export interface AgentHealth {
  id: string;
  role: string | null;
  status: LivenessStatus;
  /** `working` or `active`. A convenience flag for the panel's live count / dot colour. */
  live: boolean;
  working: boolean;
  /** Most recent `YYYY-MM-DD` the agent wrote any ledger, or null. */
  lastActive: string | null;
}

export interface OrgHealth {
  project: string;
  /** The org STATE `## Now` section, verbatim. */
  now: string;
  /** True when the `## Blocked` section carries a real block (not an empty / "(nothing blocked)" placeholder). */
  blocked: boolean;
  cadences: HeartbeatCadence[];
}

export interface HealthPanel {
  /** The reference date liveness was computed against (`YYYY-MM-DD`). */
  asOf: string;
  stalenessDays: number;
  agents: AgentHealth[];
  orgs: OrgHealth[];
  /** Root, system-level cadences (not attributable to a single project org). */
  systemCadences: HeartbeatCadence[];
  /** Total declared cadences across system + all orgs. */
  cadenceCount: number;
  /** Number of agents whose status is `working` or `active`. */
  liveCount: number;
}

/** Strip a single pair of surrounding quotes from a scalar value. */
function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Number of leading whitespace columns on a line. */
function indentOf(line: string): number {
  const m = /^([ \t]*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Extract the body of the first ```yaml … ``` fenced block, or null when there is none. */
function extractYamlFence(md: string): string | null {
  const m = /```ya?ml\s*\r?\n([\s\S]*?)```/.exec(md);
  return m ? m[1] : null;
}

/**
 * Parse the `cadences:` block sequence out of a HEARTBEAT.md yaml fence WITHOUT a full YAML engine (the
 * repo carries none, and the shared `routing/yaml` subset does not support the `prompt: |` block scalars
 * these files use). Captures each `- name:` item's scalar siblings (`schedule` / `tier` / `risk-tier`)
 * and explicitly SKIPS any block-scalar body so a `Run: foo:` prompt line can never leak in as a field.
 */
export function parseCadences(md: string, project: string): HeartbeatCadence[] {
  const fence = extractYamlFence(md);
  if (!fence) return [];
  const cadences: HeartbeatCadence[] = [];
  let cur: HeartbeatCadence | null = null;
  // When inside a `key: |` block scalar, skip every following line indented deeper than the key.
  let skipIndent: number | null = null;

  for (const raw of fence.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const indent = indentOf(raw);
    if (skipIndent !== null) {
      if (indent > skipIndent) continue; // still inside the block-scalar body
      skipIndent = null;
    }
    const line = raw.trim();

    const dashName = /^-\s+name:\s*(.*)$/.exec(line);
    if (dashName) {
      if (cur) cadences.push(cur);
      cur = { project, name: unquote(dashName[1]), schedule: null, tier: null, riskTier: null };
      continue;
    }
    if (!cur) continue;

    const kv = /^-?\s*([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2].trim();
    if (rawVal === '|' || rawVal === '>' || rawVal === '|-' || rawVal === '>-') {
      skipIndent = indent; // block scalar — its body is skipped, never captured
      continue;
    }
    const val = unquote(rawVal);
    if (key === 'name') cur.name = val;
    else if (key === 'schedule') cur.schedule = val || null;
    else if (key === 'tier') cur.tier = val || null;
    else if (key === 'risk-tier') cur.riskTier = val || null;
  }
  if (cur) cadences.push(cur);
  return cadences.filter((c) => c.name !== '');
}

/**
 * Read the declared cadence catalogue: the root `HEARTBEAT.md` (tagged `system`) plus every
 * `orgs/<project>/HEARTBEAT.md` (tagged with the project dir name). Missing files degrade to [].
 */
export function readHeartbeatCadences(repoRoot: string): HeartbeatCadence[] {
  const out: HeartbeatCadence[] = [];
  const rootHb = join(repoRoot, 'HEARTBEAT.md');
  if (existsSync(rootHb)) out.push(...parseCadences(readFileSync(rootHb, 'utf-8'), SYSTEM_PROJECT));

  const orgsDir = join(repoRoot, 'orgs');
  if (existsSync(orgsDir)) {
    for (const project of readdirSync(orgsDir)) {
      const dir = join(orgsDir, project);
      if (!statSync(dir).isDirectory()) continue;
      const hb = join(dir, 'HEARTBEAT.md');
      if (existsSync(hb)) out.push(...parseCadences(readFileSync(hb, 'utf-8'), project));
    }
  }
  return out;
}

/** True when a `## Blocked` body describes a real block (not an empty / "(nothing blocked)" placeholder). */
function isBlocked(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  return !/^\(?\s*(nothing|none|n\/?a|-|—)\b/i.test(t);
}

/** Whole days from `from` (YYYY-MM-DD) to `to` (YYYY-MM-DD); negative when `to` is in the future of `from`. */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / 86_400_000);
}

/** Classify one roster entry into a liveness bucket relative to `asOf` + the staleness window. */
function livenessOf(entry: AgentRosterEntry, asOf: string, stalenessDays: number): LivenessStatus {
  if (entry.working) return 'working';
  const last = entry.ledger.lastActive;
  if (last === null) return 'idle';
  return dayDiff(asOf, last) <= stalenessDays ? 'active' : 'stale';
}

/**
 * Build the Sentinel health panel. Reuses the roster (queue ∪ ledger ∪ declared) and org STATEs, so this
 * introduces no new source of truth — it only re-projects liveness. `asOf` defaults to today's UTC date;
 * `stalenessDays` (default 2) is the ledger-recency window that separates `active` from `stale`.
 */
export function buildHealthPanel(
  repoRoot: string,
  policy: PolicyDoc,
  override: OverrideDoc,
  options: { asOf?: string; stalenessDays?: number } = {},
): HealthPanel {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const stalenessDays = options.stalenessDays ?? 2;

  const index = indexRepo(repoRoot);
  const roster = buildRoster(index, repoRoot, policy, override);
  const agents: AgentHealth[] = roster.map((e) => {
    const status = livenessOf(e, asOf, stalenessDays);
    return {
      id: e.id,
      role: e.role,
      status,
      live: status === 'working' || status === 'active',
      working: e.working,
      lastActive: e.ledger.lastActive,
    };
  });

  const cadences = readHeartbeatCadences(repoRoot);
  const orgStates = readOrgStates(repoRoot);
  const orgs: OrgHealth[] = orgStates.map((s) => ({
    project: s.project,
    now: s.now,
    blocked: isBlocked(s.blocked),
    cadences: cadences.filter((c) => c.project === s.project),
  }));

  return {
    asOf,
    stalenessDays,
    agents,
    orgs,
    systemCadences: cadences.filter((c) => c.project === SYSTEM_PROJECT),
    cadenceCount: cadences.length,
    liveCount: agents.filter((a) => a.live).length,
  };
}
