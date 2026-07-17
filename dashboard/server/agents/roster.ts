/**
 * The Agents-view roster, server side.
 *
 * `listAgents` (R2.2) is the card-ownership projection: one row per non-null card `owner`, annotated
 * with EFFECTIVE runtime/model/provenance from the R2.1 projection (`effectiveForAgent`). It is pure
 * and still backs `/api/routing`.
 *
 * `buildRoster` closes the read-API gap: the FULL roster is the union of card owners, ledger writers
 * (derived from `ledgers/<kind>/<writer>-<date>.tsv` filenames), and the `routines/roles/` catalog —
 * so an agent that only shows up in the ledgers (or is idle) still appears, with its role + ledger
 * activity. Reads the filesystem; degrades gracefully on a sparse checkout (missing dirs → empty).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { parseLedgerName } from '../planeA/ledgers.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { effectiveForAgent } from '../routing/effective.ts';
import type { Effective } from '../routing/effective.ts';

export interface AgentRosterRow {
  id: string;
  working: boolean;
  /** The card the agent is actively working, if any. */
  current: { action: string; id: string } | null;
  projects: string[];
  cardCount: number;
  /** Effective routing for this agent (agent-scope override -> policy role_default -> safe default). */
  effective: Effective;
}

/** Normalise a card's `project` field (string | string[]) into a flat list. */
function projectsOf(card: ParsedCard): string[] {
  const p = card.meta.project;
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string' && x !== '');
  return typeof p === 'string' && p !== '' ? [p] : [];
}

/**
 * Build the roster from the Plane-A snapshot: group every card by its non-null owner, then annotate
 * each agent with status/current-card/projects/count and its effective routing. Sorted working-first,
 * then id-alphabetical (same ordering as the client `deriveRoster`).
 */
export function listAgents(index: PlaneAIndex, policy: PolicyDoc, override: OverrideDoc): AgentRosterRow[] {
  const byOwner = new Map<string, ParsedCard[]>();
  for (const bucket of Object.values(index.cards)) {
    for (const card of bucket) {
      const owner = card.meta.owner;
      if (typeof owner !== 'string' || owner === '') continue;
      const existing = byOwner.get(owner);
      if (existing) existing.push(card);
      else byOwner.set(owner, [card]);
    }
  }

  const rows: AgentRosterRow[] = [];
  for (const [id, cards] of byOwner) {
    const workingCard = cards.find((c) => c.meta.state === 'working') ?? null;
    const projects = [...new Set(cards.flatMap(projectsOf))].sort();
    rows.push({
      id,
      working: workingCard !== null,
      current: workingCard
        ? { action: String(workingCard.meta.action), id: String(workingCard.meta.id) }
        : null,
      projects,
      cardCount: cards.length,
      effective: effectiveForAgent(id, policy, override),
    });
  }

  return rows.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Ledger-derived activity for one writer/agent id (from ledger filenames + row counts). */
export interface AgentLedgerActivity {
  /** dispatch rows written by this agent. */
  dispatches: number;
  /** cost/step rows written by this agent. */
  steps: number;
  /** distinct days this agent wrote any ledger. */
  days: number;
  /** most recent `YYYY-MM-DD` this agent wrote a ledger, or null. */
  lastActive: string | null;
}

/** One roster entry, unioned across queue owners + ledger writers, annotated with role + routing. */
export interface AgentRosterEntry {
  id: string;
  /** The role this agent occupies (matched against `routines/roles/*`), or null when unknown. */
  role: string | null;
  working: boolean;
  current: { action: string; id: string } | null;
  projects: string[];
  cardCount: number;
  ledger: AgentLedgerActivity;
  /** Where this id was observed: any of `queue` (owns cards) and `ledger` (wrote ledgers). */
  sources: Array<'queue' | 'ledger'>;
  effective: Effective;
  /** True when an authoritative `agents/<id>.md` declaration file exists for this id (C7.3). A
   *  declared agent surfaces even when it owns no cards and wrote no ledgers. */
  declared: boolean;
  /** The agent file's HONEST `runner-bound` status flag: false = declared only, no runner claims its
   *  cards yet. Non-declared agents are `false`. Only ever flipped true by a human (never by the registry). */
  runnerBound: boolean;
  /** The declared DEFAULT runtime from the agent file (advisory metadata), or null. Distinct from
   *  `effective.runtime`, which is the resolver-computed live routing. */
  declaredRuntime: string | null;
  /** The declared DEFAULT model from the agent file (advisory metadata), or null. */
  declaredModel: string | null;
  /** One-line human description from the agent file, or null. */
  description: string | null;
}

/** A declared agent parsed from `agents/<id>.md` frontmatter (C7.3). */
export interface DeclaredAgent {
  id: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  runnerBound: boolean;
  description: string | null;
}

const EMPTY_ACTIVITY: AgentLedgerActivity = { dispatches: 0, steps: 0, days: 0, lastActive: null };

/** Count data rows in a TSV (non-blank lines minus the header). Header-only / missing → 0. */
function countRows(path: string): number {
  try {
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
}

/**
 * Scan every ledger kind for `<writer>-<date>.tsv` files and aggregate per-writer activity. dispatch/
 * files feed `dispatches`, cost/ files feed `steps`; all kinds contribute to `days`/`lastActive`.
 * Missing `ledgers/` → an empty map (degrade gracefully; the live checkout may have only .gitkeep).
 */
export function readLedgerWriters(repoRoot: string): Map<string, AgentLedgerActivity> {
  const out = new Map<string, AgentLedgerActivity & { _days: Set<string> }>();
  const ensure = (id: string): AgentLedgerActivity & { _days: Set<string> } => {
    let a = out.get(id);
    if (!a) {
      a = { dispatches: 0, steps: 0, days: 0, lastActive: null, _days: new Set() };
      out.set(id, a);
    }
    return a;
  };

  for (const kind of ['dispatch', 'cost', 'grades', 'activity']) {
    const dir = join(repoRoot, 'ledgers', kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.tsv')) continue;
      const parsed = parseLedgerName(name);
      if (!parsed) continue;
      const a = ensure(parsed.writer);
      const rows = countRows(join(dir, name));
      if (kind === 'dispatch') a.dispatches += rows;
      else if (kind === 'cost') a.steps += rows;
      a._days.add(parsed.date);
      if (a.lastActive === null || parsed.date > a.lastActive) a.lastActive = parsed.date;
    }
  }

  const result = new Map<string, AgentLedgerActivity>();
  for (const [id, a] of out) {
    result.set(id, { dispatches: a.dispatches, steps: a.steps, days: a._days.size, lastActive: a.lastActive });
  }
  return result;
}

/** The role catalog — filenames under `routines/roles/*.md` (e.g. `worker`, `manager`). Missing → []. */
export function readRoles(repoRoot: string): string[] {
  const dir = join(repoRoot, 'routines', 'roles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.replace(/\.md$/, ''))
    .sort();
}

/** Coerce a parsed frontmatter field to a non-empty string, or null (numbers/bools/lists/absent → null). */
function strFieldOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * The declared-agent catalog (C7.3): the fifth, AUTHORITATIVE roster source. Reads `agents/<id>.md`
 * files (YAML frontmatter, same shape as `routines/roles/*.md` and card files) and returns a map keyed by
 * the declared `id` (falling back to the filename stem). Mirrors `readRoles`' conventions: a missing
 * `agents/` dir fails OPEN to an empty map, and a malformed agent file (no/te unterminated frontmatter)
 * is SKIPPED — it must never crash `buildRoster`. Server-only (reads the filesystem); pure.
 */
export function readDeclaredAgents(repoRoot: string): Map<string, DeclaredAgent> {
  const out = new Map<string, DeclaredAgent>();
  const dir = join(repoRoot, 'agents');
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const stem = name.replace(/\.md$/, '');
    let meta: Record<string, unknown>;
    try {
      meta = parseCardFrontmatter(readFileSync(join(dir, name), 'utf-8')).meta as Record<string, unknown>;
    } catch {
      continue; // malformed agent file (no/unterminated frontmatter) → skip, never fatal
    }
    const id = strFieldOrNull(meta.id) ?? stem;
    out.set(id, {
      id,
      role: strFieldOrNull(meta.role),
      runtime: strFieldOrNull(meta.runtime),
      model: strFieldOrNull(meta.model),
      runnerBound: meta['runner-bound'] === true,
      description: strFieldOrNull(meta.description),
    });
  }
  return out;
}

/** Match an agent id to a role: a role name that is a hyphen-token of the id (e.g. `worker-desktop` → `worker`). */
export function roleFor(agentId: string, roles: string[]): string | null {
  const tokens = new Set(agentId.split(/[-_]/));
  for (const role of roles) {
    if (tokens.has(role)) return role;
  }
  // Fall back to a substring match so ids like `dispatcher-cloud` still map when no exact token hits.
  for (const role of roles) {
    if (agentId.includes(role)) return role;
  }
  return null;
}

/**
 * Build the full agent roster: the UNION of queue-card owners (`listAgents`) and ledger writers,
 * each annotated with its role (from `routines/roles/`), ledger activity, provenance `sources`, and
 * effective routing. Agents that only appear in ledgers still surface (idle, 0 cards). Sorted
 * working-first, then id-alphabetical.
 */
export function buildRoster(
  index: PlaneAIndex,
  repoRoot: string,
  policy: PolicyDoc,
  override: OverrideDoc,
): AgentRosterEntry[] {
  const cardRows = listAgents(index, policy, override);
  const byId = new Map(cardRows.map((r) => [r.id, r]));
  const writers = readLedgerWriters(repoRoot);
  const roles = readRoles(repoRoot);
  const declared = readDeclaredAgents(repoRoot);

  const ids = new Set<string>([...byId.keys(), ...writers.keys(), ...declared.keys()]);
  const entries: AgentRosterEntry[] = [];
  for (const id of ids) {
    const cr = byId.get(id);
    const dec = declared.get(id);
    const ledger = writers.get(id) ?? EMPTY_ACTIVITY;
    const sources: Array<'queue' | 'ledger'> = [];
    if (cr) sources.push('queue');
    if (writers.has(id)) sources.push('ledger');
    entries.push({
      id,
      // A declared agent's own frontmatter role annotates the entry; otherwise fall back to a derived match.
      role: dec?.role ?? roleFor(id, roles),
      working: cr?.working ?? false,
      current: cr?.current ?? null,
      projects: cr?.projects ?? [],
      cardCount: cr?.cardCount ?? 0,
      ledger,
      sources,
      effective: cr?.effective ?? effectiveForAgent(id, policy, override),
      declared: dec !== undefined,
      runnerBound: dec?.runnerBound ?? false,
      declaredRuntime: dec?.runtime ?? null,
      declaredModel: dec?.model ?? null,
      description: dec?.description ?? null,
    });
  }

  return entries.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
