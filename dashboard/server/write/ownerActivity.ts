/**
 * Owner-activity reader — the corrected owner-idle clock for the stranded-archiver (redesign 2026-07-21).
 *
 * The held build (`claude/stranded-archiver` @ ced3716) gated abandonment on `ownerLiveness().online`,
 * a G3 schtasks "reply-liveness" badge whose `taskForOwner` map covers ONLY `codex-worker`. Every
 * `claude-*` / `dispatcher-cloud` / `worker-desktop` owner therefore read `online:false` and would have
 * been archived — a missing schtasks task was silently treated as "the agent abandoned this card."
 *
 * This reader answers the RIGHT question: "when did the fleet last observe ANY activity from this owner?"
 * grounded in artifacts these agents actually leave behind:
 *   - `ledgers/dispatch/<owner>-YYYY-MM-DD.tsv`  (dispatcher-cloud's daily shards, and any owner's shards)
 *   - `ledgers/activity/<owner>-YYYY-MM-DD.tsv`  (inspector/grade activity shards)
 *   - `memory/<owner>.md`                        (every agent that follows the Memory rule)
 *   - the most recent commit AUTHORED by the owner on any branch (`git log --all --author`)
 *
 * The single most important inversion vs the held build: if NONE of these resolve (the owner was never
 * observed), `lastActivityMs` is `null` = UNKNOWN, and the archiver treats UNKNOWN as ALIVE (skip) — never
 * as dead. Absence of evidence never authorizes archiving.
 *
 * Every side effect (fs read, git read) is injected so the sweep is hermetically unit-testable with no
 * real filesystem or git. All readers fail soft: an unreadable dir/file/git is "no signal from that
 * source," never a throw — a throwing source must never push an owner toward "dead."
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

/** One resolved activity signal, kept for the dry-run/audit report so a human can see WHY an owner
 *  was judged idle or alive. */
export interface OwnerActivitySource {
  source: string;
  ms: number;
}

export interface OwnerActivity {
  /** Newest observed activity timestamp for the owner, in ms since epoch, or `null` when NOTHING is
   *  observable (owner never seen). `null` => UNKNOWN => the archiver treats the owner as ALIVE and skips. */
  lastActivityMs: number | null;
  /** Every source that resolved a timestamp (newest first). Empty when the owner is unobserved. */
  sources: OwnerActivitySource[];
}

/** `(owner, repoRoot) => OwnerActivity`. Injected into the archiver; the default is {@link defaultOwnerActivity}. */
export type OwnerActivityReader = (owner: string, repoRoot: string) => OwnerActivity;

export interface OwnerActivityDeps {
  /** List a directory's entry names; default {@link readdirSync}. Returns `[]` on any error (missing dir). */
  readDir?: (dir: string) => string[];
  /** File mtime in ms, or `null` when the file is absent/unreadable; default wraps {@link statSync}. */
  statMs?: (filePath: string) => number | null;
  /** Newest commit time (ms) authored by `owner` on any branch, or `null`; default shells `git log`. */
  gitAuthorLastMs?: (owner: string, repoRoot: string) => number | null;
}

/** `ledgers/{dispatch,activity}` shards are named `<agent>-YYYY-MM-DD.tsv` (scripts/ledger.py `_shard`).
 *  We read the owner-scoped shard's DAY from its filename — a content-derived, git-checkout-stable signal
 *  (unlike mtime). Interpreted at that day's 00:00:00Z: a conservative lower bound on the activity time. */
const SHARD_RE = /-(\d{4})-(\d{2})-(\d{2})\.tsv$/;

function defaultReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function defaultStatMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** Read-only, credential-free `git log`. Bounded to one line; any fault (git absent, empty repo, unknown
 *  author) degrades to `null` rather than throwing — a git failure must never make an owner look dead.
 *  NOTE: `--author` is a SUBSTRING (regex) match, so `worker` would match `worker-desktop`'s commits. That
 *  over-match is DELIBERATE: it can only make an owner look MORE recently active (skew toward ALIVE), the
 *  safe fail direction for a gate that would otherwise archive — it never makes a card wrongly-archivable.
 *  The exact-owner-prefix shard match above remains the precise signal. */
function defaultGitAuthorLastMs(owner: string, repoRoot: string): number | null {
  if (!owner) return null;
  try {
    const out = execFileSync(
      'git',
      ['log', '--all', `--author=${owner}`, '-1', '--format=%cI', '--regexp-ignore-case'],
      { cwd: repoRoot, encoding: 'utf-8', windowsHide: true, timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!out) return null;
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Max ms across `<owner>-*.tsv` shard DAYS under `repoRoot/ledgers/<kind>`, or `null` when the owner has
 *  no shard there. The owner prefix is matched EXACTLY (`<owner>-` then a date) so `worker` never picks up
 *  `worker-desktop`'s shards and vice-versa. */
function newestShardDayMs(dir: string, owner: string, readDir: (d: string) => string[]): OwnerActivitySource | null {
  if (!owner) return null;
  let best: number | null = null;
  const prefix = `${owner}-`;
  for (const name of readDir(dir)) {
    if (!name.startsWith(prefix)) continue;
    const m = SHARD_RE.exec(name);
    if (!m) continue;
    // The date must directly follow the `<owner>-` prefix — guards `worker-` vs `worker-desktop-`.
    if (name.slice(prefix.length) !== `${m[1]}-${m[2]}-${m[3]}.tsv`) continue;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isFinite(ms)) continue;
    if (best === null || ms > best) best = ms;
  }
  return best === null ? null : { source: `${dir.split(/[\\/]/).pop()} shard`, ms: best };
}

/**
 * Read every observable activity signal for `owner` and return the newest, or `null` (UNKNOWN) when the
 * owner leaves no observable footprint at all. Pure over its injected `readDir` / `statMs` /
 * `gitAuthorLastMs`, so tests never touch a real fs or git.
 */
export function defaultOwnerActivity(owner: string, repoRoot: string, deps: OwnerActivityDeps = {}): OwnerActivity {
  const readDir = deps.readDir ?? defaultReadDir;
  const statMs = deps.statMs ?? defaultStatMs;
  const gitAuthorLastMs = deps.gitAuthorLastMs ?? defaultGitAuthorLastMs;

  const sources: OwnerActivitySource[] = [];
  const sep = repoRoot.includes('\\') && !repoRoot.includes('/') ? '\\' : '/';
  const join = (...parts: string[]) => parts.join(sep);

  const dispatch = newestShardDayMs(join(repoRoot, 'ledgers', 'dispatch'), owner, readDir);
  if (dispatch) sources.push({ source: 'ledgers/dispatch', ms: dispatch.ms });

  const activity = newestShardDayMs(join(repoRoot, 'ledgers', 'activity'), owner, readDir);
  if (activity) sources.push({ source: 'ledgers/activity', ms: activity.ms });

  if (owner) {
    const memMs = statMs(join(repoRoot, 'memory', `${owner}.md`));
    if (memMs !== null && Number.isFinite(memMs)) sources.push({ source: `memory/${owner}.md`, ms: memMs });
  }

  const gitMs = gitAuthorLastMs(owner, repoRoot);
  if (gitMs !== null && Number.isFinite(gitMs)) sources.push({ source: 'git commit (--author)', ms: gitMs });

  if (sources.length === 0) return { lastActivityMs: null, sources: [] };
  sources.sort((a, b) => b.ms - a.ms);
  return { lastActivityMs: sources[0].ms, sources };
}
