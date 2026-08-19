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
import { existsSync, readdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { CardProjection, ParsedCard } from '../planeA/cards.ts';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { parseYaml, type YamlValue } from '../routing/yaml.ts';
import { parseLedgerName } from '../planeA/ledgers.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { effectiveForAgent, RoutingError } from '../routing/effective.ts';
import type { Effective, AgentDeclarationRouting } from '../routing/effective.ts';
import { defaultNamingRegistry } from '../naming.ts';
import type { NamingRegistry } from '../naming.ts';

export interface AgentRosterRow {
  id: string;
  working: boolean;
  /** The card the agent is actively working, if any — carrying that card's display identity so the
   *  Agents table names it instead of printing its raw id. */
  current: { action: string; id: string; displayName: string; shortRef: number } | null;
  projects: string[];
  cardCount: number;
  /** Effective routing for this agent: its own `agents/<id>.md` declaration -> agent-scope override ->
   *  the policy row for its DECLARED role -> safe default. */
  effective: Effective;
}

/** The declarations `listAgents`/`buildRoster` resolve routing against, keyed by agent id. */
export type AgentDeclarationMap = ReadonlyMap<string, AgentDeclarationRouting>;

const NO_DECLARATIONS: AgentDeclarationMap = new Map();

/**
 * One agent's effective routing, never fatal to the roster. The resolver is deliberately FAIL-LOUD when a
 * declaration names a model its runtime does not know; the roster is a read projection that must never
 * crash (a single bad `agents/<id>.md` cannot be allowed to 500 the whole Agents view), so that one case
 * drops ONLY the unusable pair — the declared role is kept, and the agent shows the policy answer for its
 * role. Every other failure mode is left to propagate, unchanged from before.
 */
function agentEffective(
  id: string,
  policy: PolicyDoc,
  override: OverrideDoc,
  declaration: AgentDeclarationRouting | null,
): Effective {
  try {
    return effectiveForAgent(id, policy, override, declaration);
  } catch (err) {
    if (!(err instanceof RoutingError) || declaration === null) throw err;
    if (declaration.runtime == null && declaration.model == null) throw err;
    return effectiveForAgent(id, policy, override, { role: declaration.role ?? null, runtime: null, model: null });
  }
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
 *
 * `declarations` supplies each agent's own `agents/<id>.md` routing frontmatter (role/runtime/model) so
 * the effective routing is the agent's REAL one. Still pure — the caller does the reading (`buildRoster`
 * already scans the declarations; `routing/routes.ts` passes `readDeclaredAgents(repoRoot)`). Omitting it
 * resolves every agent from policy alone, which is the honest answer only when no declaration exists.
 */
export function listAgents(
  index: PlaneAIndex,
  policy: PolicyDoc,
  override: OverrideDoc,
  declarations: AgentDeclarationMap = NO_DECLARATIONS,
): AgentRosterRow[] {
  const byOwner = new Map<string, CardProjection[]>();
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
        ? {
            action: String(workingCard.meta.action),
            id: String(workingCard.meta.id),
            displayName: workingCard.displayName,
            shortRef: workingCard.shortRef,
          }
        : null,
      projects,
      cardCount: cards.length,
      effective: agentEffective(id, policy, override, declarations.get(id) ?? null),
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
  /** Server-owned display identity (`server/naming.ts`). An agent's id IS its human name, so the
   *  registry is handed that id as the title; the ordinal is what makes it nameable ("agent #4"). */
  displayName: string;
  shortRef: number;
  /** The role this agent occupies (matched against `routines/roles/*`), or null when unknown. */
  role: string | null;
  working: boolean;
  current: AgentRosterRow['current'];
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
  /** Declared tools from the agent file (advisory metadata), or null. */
  tools?: string[] | null;
  /** Declared knowledge sources from the agent file (advisory metadata), or null. */
  knowledgeSource?: string[] | null;
  /** Declared autonomy tier from the agent file (advisory metadata), or null. */
  autonomyTier?: string | null;
  /** Declared skills from the agent file (advisory metadata), or null. */
  skills?: string[] | null;
  /** Declared replacement relationship from the agent file (advisory metadata), or null. */
  whatItReplaces?: string | null;
  /** Declared predecessor relationships from the agent file (advisory metadata), or null. */
  buildsOn?: string[] | null;
  /** The declaration's default server-owned execution profile id, or null for a legacy declaration. */
  defaultProfile?: string | null;
  /** The declaration's permitted execution profile ids, or null for a legacy declaration. */
  allowedProfiles?: string[] | null;
  /** One-line human description from the agent file, or null. */
  description: string | null;
  /** Declaration revision. Legacy definitions are v1. */
  version?: number;
  /** Advisory input/output schema descriptions from the declaration, or null when absent. */
  io?: AgentIo | null;
  /** Advisory budget/retry/escalation defaults from the declaration, or null when absent. */
  defaults?: AgentDefaults | null;
  /** A declaration file was found for this id but could not safely be used. */
  declarationProblem?: string | null;
}

/** A declared agent parsed from `agents/<id>.md` frontmatter (C7.3). */
export interface DeclaredAgent {
  id: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  tools?: string[] | null;
  knowledgeSource?: string[] | null;
  autonomyTier?: string | null;
  skills?: string[] | null;
  whatItReplaces?: string | null;
  buildsOn?: string[] | null;
  /** Optional complete execution-profile contract. Legacy declarations carry null for both fields. */
  defaultProfile: string | null;
  allowedProfiles: string[] | null;
  runnerBound: boolean;
  description: string | null;
  version?: number;
  io?: AgentIo | null;
  defaults?: AgentDefaults | null;
  /** Declared project relationships are display metadata, never routing authority. */
  projects: string[];
}

export interface AgentIo {
  inputs: YamlValue | null;
  outputs: YamlValue | null;
}

export interface AgentDefaults {
  budgetUsd: string | number | null;
  maxRetries: string | number | null;
  escalation: string | number | null;
}

export type ExecutionAssignmentRole = 'manager' | 'worker';

/**
 * Legacy declaration roles describe an agent's organizational function, while executable profiles use
 * the closed manager/worker vocabulary. Normalize only at the execution-eligibility boundary: display
 * and canonical declaration data retain the authored role, and unknown roles remain ineligible.
 */
export function executionAssignmentRole(role: string | null): ExecutionAssignmentRole | null {
  if (role === 'manage' || role === 'manager') return 'manager';
  if (role === 'work' || role === 'worker' || role === 'inspect' || role === 'scout' || role === 'consolidate') {
    return 'worker';
  }
  return null;
}

/** The inspectable, server-owned view of one `agents/<id>.md` declaration. */
export interface DeclaredAgentDetail extends DeclaredAgent {
  /** Canonical repo-relative declaration source, always `agents/<filename>.md`. */
  source: string;
  /** Markdown after the declaration's YAML frontmatter. */
  instructionMarkdown: string;
  /** SHA-256 of the exact declaration source read by the server. */
  sourceHash: string;
  /** Existing repo-contained paths explicitly named by the declaration. Names only; never contents. */
  codebasePaths: string[];
  /** Safe declared project ids unioned with project ids inferred from declared codebase paths. */
  projects: string[];
  /** Declared paths under an org workflow directory. */
  workflowPaths: string[];
}

/** Safe, bounded diagnostic for a declaration which was discovered but cannot be used. */
export interface AgentDeclarationProblem {
  /** Filename stem, never an authored frontmatter id from malformed content. */
  id: string;
  source: string;
  problem:
    | 'symlink-refused'
    | 'not-a-file'
    | 'oversized'
    | 'malformed-frontmatter'
    | 'unreadable'
    | 'unsafe-id'
    | 'id-mismatch'
    | 'duplicate-id'
    | 'invalid-profile-config';
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
const MAX_AGENT_FILE_BYTES = 64 * 1024;

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Return true only for an existing path that resolves inside this repo. */
export function isContainedRepoPath(repoRoot: string, path: string): boolean {
  if (path === '' || isAbsolute(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || !SAFE_PATH_SEGMENT.test(part))) return false;
  try {
    const root = realpathSync(repoRoot);
    const candidate = realpathSync(resolve(repoRoot, path));
    const rel = relative(root, candidate);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
  } catch {
    return false;
  }
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

interface AgentDeclarationDirectory {
  repoRoot: string;
  agentsDir: string;
}

function containedRealPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}

/**
 * Establish the only directory trusted for declaration reads. `agents` must be a real, direct
 * child of the repository's canonical root; a symlink/junction cannot redirect reads elsewhere.
 */
function declarationDirectory(repoRoot: string): AgentDeclarationDirectory | null {
  try {
    const root = realpathSync(repoRoot);
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory()) return null;
    const candidate = resolve(root, 'agents');
    if (!existsSync(candidate)) return null;
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    const agentsDir = realpathSync(candidate);
    if (!containedRealPath(root, agentsDir) || relative(root, agentsDir) !== 'agents') return null;
    return { repoRoot: root, agentsDir };
  } catch {
    return null;
  }
}

interface ParsedAgentCandidate {
  name: string;
  stem: string;
  source: string;
  text: string;
  parsed: { meta: Record<string, unknown>; body: string };
  claimedId: string;
}

interface AgentDeclarationScan {
  details: Map<string, DeclaredAgentDetail>;
  problems: Map<string, AgentDeclarationProblem>;
}

interface DeclaredProfileConfig {
  defaultProfile: string | null;
  allowedProfiles: string[] | null;
}

/**
 * Execution-profile contracts are all-or-nothing advisory declaration metadata. This scanner does not
 * resolve them against live routing policy; it only accepts a bounded, unambiguous declaration shape so
 * a later binding layer can make that policy decision from canonical state.
 */
function declaredProfileConfig(meta: Record<string, unknown>): DeclaredProfileConfig | null {
  const rawDefault = meta['default-profile'];
  const rawAllowed = meta['allowed-profiles'];
  if (rawDefault === undefined && rawAllowed === undefined) return { defaultProfile: null, allowedProfiles: null };
  if (typeof rawDefault !== 'string' || !SAFE_PROFILE_ID.test(rawDefault) || !Array.isArray(rawAllowed) || rawAllowed.length === 0) {
    return null;
  }
  if (!rawAllowed.every((profile): profile is string => typeof profile === 'string' && SAFE_PROFILE_ID.test(profile))) return null;
  const allowedProfiles = [...rawAllowed];
  if (new Set(allowedProfiles).size !== allowedProfiles.length || !allowedProfiles.includes(rawDefault)) return null;
  return { defaultProfile: rawDefault, allowedProfiles };
}

/** Frontmatter supports the established `projects: [project-a, project-b]` declaration shape. */
function projectIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((item): item is string => typeof item === 'string' && SAFE_PROJECT_ID.test(item)))].sort();
}

/**
 * Advisory list fields preserve authored string order while safely dropping malformed entries
 * (non-strings and, matching `strFieldOrNull`'s '' rejection, empty strings) and deduping repeats.
 * Only the inline `key: [a, b]` frontmatter syntax parses here — YAML block-list syntax (`key:` on
 * its own line followed by `- item` lines) throws in the shared frontmatter parser and marks the
 * whole declaration malformed-frontmatter, dropping it entirely. This is a pre-existing parser
 * constraint, not specific to this function; the six new list fields inherit it, same as
 * `projects` / `allowed-profiles`.
 */
function listField(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item === 'string' && item !== '' && !seen.has(item)) {
      seen.add(item);
      values.push(item);
    }
  }
  return values;
}

function recordValue(value: unknown): Record<string, YamlValue> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, YamlValue>;
  }
  // The long-established card reader deliberately treats flow maps as strings.
  // Decode only this new advisory shape so legacy declaration parsing stays identical.
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    const parsed = parseYaml(`value: ${value}`);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const nested = (parsed as Record<string, YamlValue>).value;
      if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) return nested as Record<string, YamlValue>;
    }
  }
  return null;
}

function declaredVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function declaredIo(value: unknown): AgentIo | null {
  const io = recordValue(value);
  return io ? { inputs: io.inputs ?? null, outputs: io.outputs ?? null } : null;
}

function advisoryDefault(value: unknown): string | number | null {
  if (typeof value === 'number') return value;
  // The dashboard's compact YAML reader intentionally leaves decimal literals
  // as strings; normalize this advisory numeric subset to match Python YAML.
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return Number(value);
  return typeof value === 'string' ? value : null;
}

function declaredDefaults(value: unknown): AgentDefaults | null {
  const defaults = recordValue(value);
  return defaults ? {
    budgetUsd: advisoryDefault(defaults.budget_usd),
    maxRetries: advisoryDefault(defaults.max_retries),
    escalation: advisoryDefault(defaults.escalation),
  } : null;
}

/**
 * Agent declarations inherit the card parser's strict flat shape.  The new
 * `io` / `defaults` fields may additionally use YAML block maps; the fallback
 * is limited to those two top-level keys so old malformed fields stay invalid.
 */
function parseAgentFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  try {
    const parsed = parseCardFrontmatter(text);
    const meta = { ...parsed.meta } as Record<string, unknown>;
    // Keep the established strict parser as the admission gate, then recover
    // only the typed extension fields from the YAML subset parser. This makes
    // bare `version: 3` an integer while quoted `version: "3"` stays a string
    // and therefore gets the legacy v1 default, matching Python exactly.
    const head = text.replace(/^---\r?\n/, '');
    const fenceIdx = head.search(/\r?\n---\r?\n/);
    const extensions = fenceIdx === -1 ? null : parseYaml(head.slice(0, fenceIdx));
    if (typeof extensions === 'object' && extensions !== null && !Array.isArray(extensions)) {
      for (const key of ['version', 'io', 'defaults']) {
        if (Object.hasOwn(extensions, key)) meta[key] = (extensions as Record<string, YamlValue>)[key];
      }
    }
    return { meta, body: parsed.body };
  } catch (err) {
    if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) throw err;
    const head = text.replace(/^---\r?\n/, '');
    const fenceIdx = head.search(/\r?\n---\r?\n/);
    if (fenceIdx === -1) throw err;
    const frontmatter = head.slice(0, fenceIdx);
    let topLevel: string | null = null;
    for (const line of frontmatter.split(/\r?\n/)) {
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (!/^\s/.test(line)) {
        const key = /^([^:\s][^:]*):/.exec(line);
        if (!key || line.startsWith('-')) throw err;
        topLevel = key[1].trim();
      } else if (topLevel !== 'io' && topLevel !== 'defaults') {
        throw err;
      }
    }
    const parsed = parseYaml(frontmatter);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw err;
    const body = head.slice(fenceIdx).replace(/^\r?\n---\r?\n/, '').replace(/^\r?\n+/, '');
    return { meta: parsed as Record<string, unknown>, body };
  }
}

/** Extract display-only, repo-contained paths from the declaration body. */
function declaredCodebasePaths(repoRoot: string, instructionMarkdown: string): string[] {
  const matcher = /(?:^|[^A-Za-z0-9._-])((?:agents|dashboard|docs|knowledge|ledgers|memory|orgs|queue|routines|scripts|workflows|\.claude)\/[A-Za-z0-9._/-]+)/g;
  const paths = new Set<string>();
  for (const match of instructionMarkdown.matchAll(matcher)) {
    const raw = match[1].replace(/[),.;:]+$/, '').replace(/\/$/, '');
    if (raw !== '' && isContainedRepoPath(repoRoot, raw)) paths.add(raw);
  }
  return [...paths].sort();
}

/** Read each trusted declaration at most once and make ambiguity a diagnostic, never authority. */
function scanAgentDeclarations(repoRoot: string): AgentDeclarationScan {
  const details = new Map<string, DeclaredAgentDetail>();
  const problems = new Map<string, AgentDeclarationProblem>();
  const directory = declarationDirectory(repoRoot);
  if (!directory) return { details, problems };
  let names: string[];
  try {
    names = readdirSync(directory.agentsDir).sort();
  } catch {
    return { details, problems };
  }
  const candidates: ParsedAgentCandidate[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const stem = name.replace(/\.md$/, '');
    const source = `agents/${name}`;
    const full = join(directory.agentsDir, name);
    let stat;
    try {
      stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        problems.set(stem, { id: stem, source, problem: 'symlink-refused' });
        continue;
      }
      if (!stat.isFile()) {
        problems.set(stem, { id: stem, source, problem: 'not-a-file' });
        continue;
      }
      // Verify the child remains the direct canonical child we enumerated before reading it.
      const resolved = realpathSync(full);
      if (!containedRealPath(directory.agentsDir, resolved) || relative(directory.agentsDir, resolved) !== name) {
        problems.set(stem, { id: stem, source, problem: 'symlink-refused' });
        continue;
      }
    } catch {
      problems.set(stem, { id: stem, source, problem: 'unreadable' });
      continue;
    }
    if (stat.size > MAX_AGENT_FILE_BYTES) {
      problems.set(stem, { id: stem, source, problem: 'oversized' });
      continue;
    }
    let text: string;
    let parsed: { meta: Record<string, unknown>; body: string };
    try {
      text = readFileSync(full, 'utf-8');
      parsed = parseAgentFrontmatter(text);
    } catch {
      problems.set(stem, { id: stem, source, problem: 'malformed-frontmatter' });
      continue;
    }
    const rawId = (parsed.meta as Record<string, unknown>).id;
    if (rawId !== undefined && typeof rawId !== 'string') {
      problems.set(stem, { id: stem, source, problem: 'unsafe-id' });
      continue;
    }
    const claimedId = rawId === undefined ? stem : rawId;
    if (!SAFE_AGENT_ID.test(stem) || !SAFE_AGENT_ID.test(claimedId)) {
      problems.set(stem, { id: stem, source, problem: 'unsafe-id' });
      continue;
    }
    candidates.push({ name, stem, source, text, parsed, claimedId });
  }

  const claims = new Map<string, ParsedAgentCandidate[]>();
  for (const candidate of candidates) {
    const entries = claims.get(candidate.claimedId) ?? [];
    entries.push(candidate);
    claims.set(candidate.claimedId, entries);
  }
  for (const candidate of candidates) {
    const sameId = claims.get(candidate.claimedId) ?? [];
    if (sameId.length > 1) {
      problems.set(candidate.stem, { id: candidate.stem, source: candidate.source, problem: 'duplicate-id' });
      continue;
    }
    if (candidate.claimedId !== candidate.stem) {
      problems.set(candidate.stem, { id: candidate.stem, source: candidate.source, problem: 'id-mismatch' });
      continue;
    }
    const meta = candidate.parsed.meta as Record<string, unknown>;
    const profileConfig = declaredProfileConfig(meta);
    if (!profileConfig) {
      problems.set(candidate.stem, { id: candidate.stem, source: candidate.source, problem: 'invalid-profile-config' });
      continue;
    }
    const codebasePaths = declaredCodebasePaths(directory.repoRoot, candidate.parsed.body);
    const inferredProjects = [...new Set(codebasePaths
      .map((path) => /^orgs\/([^/]+)/.exec(path)?.[1])
      .filter((project): project is string => project !== undefined))].sort();
    const projects = [...new Set([...projectIds(meta.projects), ...inferredProjects])].sort();
    details.set(candidate.claimedId, {
      id: candidate.claimedId,
      role: strFieldOrNull(meta.role),
      runtime: strFieldOrNull(meta.runtime),
      model: strFieldOrNull(meta.model),
      tools: listField(meta.tools),
      knowledgeSource: listField(meta['knowledge-source']),
      autonomyTier: strFieldOrNull(meta['autonomy-tier']),
      skills: listField(meta.skills),
      whatItReplaces: strFieldOrNull(meta['what-it-replaces']),
      buildsOn: listField(meta['builds-on']),
      defaultProfile: profileConfig.defaultProfile,
      allowedProfiles: profileConfig.allowedProfiles,
      runnerBound: meta['runner-bound'] === true,
      description: strFieldOrNull(meta.description),
      version: declaredVersion(meta.version),
      io: declaredIo(meta.io),
      defaults: declaredDefaults(meta.defaults),
      source: candidate.source,
      instructionMarkdown: candidate.parsed.body,
      sourceHash: createHash('sha256').update(candidate.text, 'utf8').digest('hex'),
      codebasePaths,
      projects,
      workflowPaths: codebasePaths.filter((path) => /^orgs\/[^/]+\/workflows\//.test(path)),
    });
  }
  return { details, problems };
}

/**
 * Read valid agent declarations once, retaining their authored Markdown only for the explicit
 * inspection route. This remains safe on a sparse or hostile checkout: symlinks, oversized files,
 * malformed frontmatter, and paths outside the repo are excluded.
 */
export function readDeclaredAgentDetails(repoRoot: string): Map<string, DeclaredAgentDetail> {
  return scanAgentDeclarations(repoRoot).details;
}

/**
 * Report unusable declaration files without parsing their body into authority. Roster/detail callers
 * can tell an operator why a named declaration is unavailable instead of silently making it vanish.
 */
export function readAgentDeclarationProblems(repoRoot: string): Map<string, AgentDeclarationProblem> {
  return scanAgentDeclarations(repoRoot).problems;
}

/**
 * Resolve a DECLARED agent's authoritative `agents/<id>.md` to an absolute path, or null when the id is
 * not on this server's declared roster.
 *
 * This is the EXACT-MATCH ALLOWLIST that any caller turning an operator-supplied agent id into a path or
 * an argv MUST go through. Nothing here joins the caller's string onto a directory before the check: the
 * id must first match `SAFE_AGENT_ID`, and then must be a key of the scanned declaration map — a map
 * whose entries are already proven to be direct, non-symlink, size-bounded, canonical children of
 * `<repoRoot>/agents` whose filename stem equals the declared id. An unknown, malformed, traversing, or
 * merely-observed id therefore yields null and can never become a spawn argument.
 */
export function declaredAgentFilePath(repoRoot: string, agentId: unknown): string | null {
  if (typeof agentId !== 'string' || !SAFE_AGENT_ID.test(agentId)) return null;
  const directory = declarationDirectory(repoRoot);
  if (!directory) return null;
  const detail = readDeclaredAgentDetails(repoRoot).get(agentId);
  // Belt-and-braces: the scan already enforces stem === declared id, so `source` is the one filename we
  // are allowed to rebuild. Re-asserting it here keeps the path derivation honest if the scan ever drifts.
  if (!detail || detail.id !== agentId || detail.source !== `agents/${agentId}.md`) return null;
  return join(directory.agentsDir, `${agentId}.md`);
}

export function readDeclaredAgents(repoRoot: string): Map<string, DeclaredAgent> {
  const out = new Map<string, DeclaredAgent>();
  for (const detail of readDeclaredAgentDetails(repoRoot).values()) {
    const id = detail.id;
    out.set(id, {
      id,
      role: detail.role,
      runtime: detail.runtime,
      model: detail.model,
      tools: detail.tools === null || detail.tools === undefined ? null : [...detail.tools],
      knowledgeSource: detail.knowledgeSource === null || detail.knowledgeSource === undefined ? null : [...detail.knowledgeSource],
      autonomyTier: detail.autonomyTier ?? null,
      skills: detail.skills === null || detail.skills === undefined ? null : [...detail.skills],
      whatItReplaces: detail.whatItReplaces ?? null,
      buildsOn: detail.buildsOn === null || detail.buildsOn === undefined ? null : [...detail.buildsOn],
      defaultProfile: detail.defaultProfile,
      allowedProfiles: detail.allowedProfiles === null ? null : [...detail.allowedProfiles],
      runnerBound: detail.runnerBound,
      description: detail.description,
      version: detail.version,
      io: detail.io === null || detail.io === undefined ? null : { inputs: detail.io.inputs, outputs: detail.io.outputs },
      defaults: detail.defaults === null || detail.defaults === undefined ? null : {
        budgetUsd: detail.defaults.budgetUsd,
        maxRetries: detail.defaults.maxRetries,
        escalation: detail.defaults.escalation,
      },
      projects: detail.projects,
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
  naming: NamingRegistry = defaultNamingRegistry(),
): AgentRosterEntry[] {
  const declared = readDeclaredAgents(repoRoot);
  // Declarations are read FIRST: they are rung 1 of the routing precedence, so `listAgents` needs them
  // to compute a truthful effective model for the agents that also own cards.
  const cardRows = listAgents(index, policy, override, declared);
  const byId = new Map(cardRows.map((r) => [r.id, r]));
  const writers = readLedgerWriters(repoRoot);
  const roles = readRoles(repoRoot);
  const declarationProblems = readAgentDeclarationProblems(repoRoot);

  const ids = new Set<string>([...byId.keys(), ...writers.keys(), ...declared.keys(), ...declarationProblems.keys()]);
  const entries: AgentRosterEntry[] = [];
  for (const id of ids) {
    const cr = byId.get(id);
    const dec = declared.get(id);
    const declarationProblem = declarationProblems.get(id)?.problem ?? null;
    const ledger = writers.get(id) ?? EMPTY_ACTIVITY;
    const sources: Array<'queue' | 'ledger'> = [];
    if (cr) sources.push('queue');
    if (writers.has(id)) sources.push('ledger');
    entries.push({
      id,
      ...naming.displayFor('agent', id, id),
      // A declared agent's own frontmatter role annotates the entry; otherwise fall back to a derived match.
      role: dec?.role ?? roleFor(id, roles),
      working: cr?.working ?? false,
      current: cr?.current ?? null,
      projects: [...new Set([...(cr?.projects ?? []), ...(dec?.projects ?? [])])].sort(),
      cardCount: cr?.cardCount ?? 0,
      ledger,
      sources,
      effective: cr?.effective ?? agentEffective(id, policy, override, dec ?? null),
      declared: dec !== undefined,
      runnerBound: dec?.runnerBound ?? false,
      declaredRuntime: dec?.runtime ?? null,
      declaredModel: dec?.model ?? null,
      tools: dec?.tools === null || dec?.tools === undefined ? null : [...dec.tools],
      knowledgeSource: dec?.knowledgeSource === null || dec?.knowledgeSource === undefined ? null : [...dec.knowledgeSource],
      autonomyTier: dec?.autonomyTier ?? null,
      skills: dec?.skills === null || dec?.skills === undefined ? null : [...dec.skills],
      whatItReplaces: dec?.whatItReplaces ?? null,
      buildsOn: dec?.buildsOn === null || dec?.buildsOn === undefined ? null : [...dec.buildsOn],
      defaultProfile: dec?.defaultProfile ?? null,
      allowedProfiles: dec?.allowedProfiles ? [...dec.allowedProfiles] : null,
      description: dec?.description ?? null,
      version: dec?.version ?? 1,
      io: dec?.io === null || dec?.io === undefined ? null : { ...dec.io },
      defaults: dec?.defaults === null || dec?.defaults === undefined ? null : { ...dec.defaults },
      declarationProblem,
    });
  }

  return entries.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
