/**
 * Grades history is a read-only per-identity evidence view.  It intentionally does not import the
 * promotion policy: eval-suite rows are shown as evidence, while promotion remains scripts/promotion.py's
 * sole concern.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Matches the declared-agent identifier boundary used by the roster reader. */
export const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVAL_TASK_TYPE = /^eval:([a-z0-9][a-z0-9-]{0,63}):(.+)$/;

/** A history is deliberately capped both in candidate shards and returned rows. */
export const GRADES_HISTORY_SHARD_LIMIT = 20;
export const GRADES_HISTORY_LIMIT = 100;
/** Grade shards are append-only evidence, not an unbounded request payload. */
export const GRADES_HISTORY_MAX_SHARD_BYTES = 256 * 1024;
/** This exact ledger schema is pinned: positional parsing must not guess at changed columns. */
const GRADES_HISTORY_HEADER = 'ts\tworker\tproject\ttask_type\ttier\tscore\tpass\trubric_version\tinspector_id\tcard_id';

export type GradeHistorySource = 'eval' | 'task';

interface GradeHistoryRow {
  date: string;
  grade: string;
  passed: boolean | null;
  source: GradeHistorySource;
  cardId: string;
}

export interface GradesHistory {
  label: 'grades-history';
  agent: string;
  rows: GradeHistoryRow[];
  /** Malformed data rows encountered before the response cap was reached. */
  skipped: number;
}

interface GradeShard {
  path: string;
  name: string;
  date: string;
}

interface GradesDirectory {
  directory: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function passed(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'pass', 'passed'].includes(normalized)) return true;
  if (['false', '0', 'no', 'fail', 'failed'].includes(normalized)) return false;
  return null;
}

function containedRealPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}

/** Establish the only ledger directory trusted for grade-history reads. */
function gradesDirectory(repoRoot: string): GradesDirectory | null {
  try {
    const root = realpathSync(repoRoot);
    if (!lstatSync(root).isDirectory()) return null;
    const ledgers = resolve(root, 'ledgers');
    const ledgerStat = lstatSync(ledgers);
    if (ledgerStat.isSymbolicLink() || !ledgerStat.isDirectory()) return null;
    const candidate = resolve(ledgers, 'grades');
    const candidateStat = lstatSync(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) return null;
    const directory = realpathSync(candidate);
    if (!containedRealPath(root, directory) || relative(root, directory) !== join('ledgers', 'grades')) return null;
    return { directory };
  } catch {
    return null;
  }
}

function shardDate(name: string): string | null {
  return /^.+-(\d{4}-\d{2}-\d{2})\.tsv$/.exec(name)?.[1] ?? null;
}

/**
 * Select, validate, and size-bound candidate shards before opening any of them. Ledger filenames include
 * their date, so selecting newest-first does not require reading historical content just to sort it.
 */
export function selectGradesHistoryShards(
  repoRoot: string,
  limit: number = GRADES_HISTORY_SHARD_LIMIT,
): GradeShard[] {
  const trusted = gradesDirectory(repoRoot);
  if (!trusted) return [];
  const shards: GradeShard[] = [];
  let names: string[];
  try {
    names = readdirSync(trusted.directory);
  } catch {
    return [];
  }
  for (const name of names) {
    const date = shardDate(name);
    if (date === null) continue;
    const path = join(trusted.directory, name);
    try {
      const listed = lstatSync(path);
      if (listed.isSymbolicLink() || !listed.isFile()) continue;
      const resolved = realpathSync(path);
      if (!containedRealPath(trusted.directory, resolved) || relative(trusted.directory, resolved) !== name) continue;
      // Check the cap before readFileSync: an oversized shard is absent from this bounded projection.
      const stat = statSync(resolved);
      if (stat.isFile() && stat.size <= GRADES_HISTORY_MAX_SHARD_BYTES) shards.push({ path: resolved, name, date });
    } catch {
      // A concurrent removal is absent from this projection.
    }
  }
  return shards
    .sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name))
    .slice(0, limit);
}

function firstLine(text: string): { value: string; next: number } {
  const newline = text.indexOf('\n');
  const end = newline === -1 ? text.length : newline;
  const value = text.slice(0, end).replace(/\r$/, '');
  return { value, next: newline === -1 ? text.length : newline + 1 };
}

/** Iterate non-empty data lines newest-first without constructing an array for the entire shard. */
function* reverseDataLines(text: string, start: number): Generator<string> {
  let end = text.length;
  while (end > start) {
    const newline = text.lastIndexOf('\n', end - 1);
    const lineStart = Math.max(start, newline + 1);
    const line = text.slice(lineStart, end).replace(/\r$/, '');
    if (line.trim() !== '') yield line;
    end = newline < start ? start : newline;
  }
}

interface ShardScan {
  rows: GradeHistoryRow[];
  skipped: number;
}

/** Read one already-vetted shard, stopping as soon as this response has enough matching rows. */
function scanGradeShard(shard: GradeShard, agent: string, capacity: number): ShardScan {
  if (capacity <= 0) return { rows: [], skipped: 0 };
  try {
    const content = readFileSync(shard.path, 'utf-8');
    const header = firstLine(content);
    if (header.value !== GRADES_HISTORY_HEADER) return { rows: [], skipped: 0 };
    const rows: GradeHistoryRow[] = [];
    let skipped = 0;
    for (const line of reverseDataLines(content, header.next)) {
      const cells = line.split('\t');
      if (cells.length !== GRADES_HISTORY_HEADER.split('\t').length) {
        skipped += 1;
        continue;
      }
      const row = Object.fromEntries(GRADES_HISTORY_HEADER.split('\t').map((column, index) => [column, cells[index]])) as Record<string, string>;
      const source = sourceForAgent(row, agent);
      if (source === null) continue;
      rows.push({
        date: text(row.ts),
        grade: text(row.score),
        passed: passed(text(row.pass)),
        source,
        cardId: text(row.card_id),
      });
      if (rows.length === capacity) break;
    }
    return { rows, skipped };
  } catch {
    return { rows: [], skipped: 0 }; // An unreadable or malformed shard is absent, never a server failure.
  }
}

/** The eval namespace names its tested identity in task_type; normal task grades name it in worker. */
function sourceForAgent(row: Record<string, string>, agent: string): GradeHistorySource | null {
  const taskType = text(row.task_type);
  const evalMatch = EVAL_TASK_TYPE.exec(taskType);
  if (text(row.worker) === 'eval-suite') return evalMatch?.[1] === agent ? 'eval' : null;
  return text(row.worker) === agent ? 'task' : null;
}

/** Build a capped newest-first grade timeline for one safe identity. Pure read; no policy decision. */
export function buildGradesHistory(repoRoot: string, agent: string): GradesHistory {
  const rows: GradeHistoryRow[] = [];
  let skipped = 0;
  for (const shard of selectGradesHistoryShards(repoRoot)) {
    const scanned = scanGradeShard(shard, agent, GRADES_HISTORY_LIMIT - rows.length);
    rows.push(...scanned.rows);
    skipped += scanned.skipped;
    if (rows.length === GRADES_HISTORY_LIMIT) break;
  }
  return {
    label: 'grades-history',
    agent,
    rows,
    skipped,
  };
}

/** Register the one grades-history GET. Authentication is supplied by the shared governed panel scope. */
export function registerGradesHistoryPanel(app: FastifyInstance, repoRoot: string): void {
  app.get('/api/panels/grades-history', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = (req.query && typeof req.query === 'object' ? req.query : {}) as { agent?: unknown };
    const agent = typeof query.agent === 'string' ? query.agent.trim() : '';
    if (!SAFE_AGENT_ID.test(agent)) return reply.code(400).send({ error: 'invalid-agent' });
    return buildGradesHistory(repoRoot, agent);
  });
}
