/**
 * D2.5 — target-classified branch routing for the governed-save path.
 *
 * The dashboard's runtime writes fall into two classes that route differently (plan §"Runtime write
 * classification", binding on this path):
 *   - **Coordination artifacts** — `queue/**`, `ledgers/**`, `traces/**`, and the audit log — go to
 *     `ops` via `git pull --rebase origin ops` -> add -> commit -> push, retrying a
 *     rejected push after re-reading state (CLAUDE.md: "a rejected push means: re-read state,
 *     reconcile, retry").
 *   - **Durable content** — `skills/**`, `docs/**`, KB markdown, dashboard code — goes to a work
 *     branch -> PR to `main`. NEVER a direct push to `ops`, NEVER a direct push to `main`.
 *
 * Mislabeling a skill/doc edit as a coordination write (pushing it to `ops`) skips the durable-content
 * review path and fights the `sync_skills` pre-commit hook — so `classifyTarget` is a pure, total
 * function over the relpath with no ambiguous middle ground.
 *
 * Both git and the (separate) PR-open step are shelled through injectable runners so tests are
 * hermetic — they never touch the real repo, a real remote, or the `gh` CLI. The default git runner
 * does NOT disable hooks (unlike the read-only `kb/browser.ts` runner) and never passes `--no-verify`,
 * so a `skills/**` commit still runs the active `.githooks/pre-commit` `sync_skills.py` check — a
 * drifted `.claude/skills` mirror fails the commit (and therefore the save) rather than being bypassed.
 */

import { PUBLISHER_PERMITTED_SUBCOMMANDS, createAsyncGitRunner, createAsyncPrOpener, withOpsTransaction } from './asyncGit.ts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { lstat, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { BATCH_ID_PATTERN, CANONICAL_UTC_SECOND, PROPOSAL_FRONTMATTER_KEYS } from '../learnings/contracts.ts';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import type { RepositoryPin } from '../runtime/repoPin.ts';
import type { ScheduleSnapshot } from '../schedules/contracts.ts';
import { HEARTBEAT_SEED_PATHS, seedScheduleId } from '../schedules/seedImport.ts';
import { pushOpsWithReconcile } from './opsPushRetry.ts';
import type { AsyncPrResult } from './asyncGit.ts';
import type { OpsGitRunner } from './asyncGit.ts';
import {
  LEARNING_RECORD_PREFIX,
  OPS_BRANCH,
  decodeDurablePathManifest,
  derivedDurableBranch,
  isCommitSha,
  isLearningRecordPath,
  purposeMode,
  scheduleMirrorOperationKey,
  sha256Hex,
  type DurablePathManifest,
  type PinnedAsyncPrResult,
  type RouteDurableReceipt,
} from './durableManifest.ts';
import { buildGovernedSaveManifest } from './durableManifestService.ts';
import {
  recoverUnspooledCoordinationCommits,
  type CoordinationPublication,
} from './outbox.ts';

export type Target = 'durable' | 'coordination';

/** Runtime write classes that route to `ops` (pull-rebase-push), never a work-branch PR. */
const COORDINATION_PREFIXES = [
  'queue/',
  'ledgers/',
  'traces/',
  'memory/',
  'dashboards/',
  'handoffs/',
] as const;
const PROJECT_STATE = /^orgs\/[^/]+\/STATE\.md$/;

/** Normalize a relpath to forward-slash, no leading slash, for prefix comparisons. */
function normalize(relpath: string): string {
  return relpath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Classify a relpath as `'durable'` (skills/**, docs/**, KB markdown, dashboard code — work branch ->
 * PR to main) or `'coordination'` (queue/**, ledgers/**, traces/**, the audit log under ledgers/audit/,
 * coordination paths — ops pull-rebase-push). Total: everything not explicitly coordination is
 * durable content, per the plan's binary classification.
 */
export function isCoordinationPath(relpath: string): boolean {
  const norm = normalize(relpath);
  return COORDINATION_PREFIXES.some((prefix) => norm.startsWith(prefix)) || PROJECT_STATE.test(norm);
}

export function classifyTarget(relpath: string): Target {
  return isCoordinationPath(relpath) ? 'coordination' : 'durable';
}

/** A git invocation runner. `args` is the full argv AFTER `git`. Injected for hermetic tests. Widened
 *  to allow a `Promise` (the async default) while still accepting synchronous test fakes. Structurally
 *  identical to `asyncGit.ts#OpsGitRunner`. */
export type GitRunner = OpsGitRunner;

/** Default runner: the shared async git runner (spawn, off the event loop, 60s kill-timeout). Hooks
 *  stay ACTIVE (no `core.hooksPath=` override) and `--no-verify` is never passed — the `sync_skills`
 *  pre-commit hook must be able to run and block. */
export const defaultGitRunner: GitRunner = createAsyncGitRunner({ requireTransaction: true });

/** A PR-open request: reviewed by Daniel, never auto-merged by the governed-save path itself. */
export interface PrRequest {
  base: string;
  head: string;
  title: string;
  body?: string;
  /** The composition-time repository pin, passed through as `gh --repo <owner>/<repo>` [P4-C35]. */
  repo?: { readonly owner: string; readonly repo: string };
}

/** Opens a PR — a distinct capability from `GitRunner` (no git push targets `main` directly; a PR is
 *  how durable content reaches it). Injected for hermetic tests. Widened to allow a `Promise`. */
export type PrOpener = (repoRoot: string, req: PrRequest) => AsyncPrResult | void | Promise<AsyncPrResult | void>;

/** Default opener: the shared async `gh pr create` runner (spawn, off the event loop, 60s kill-timeout).
 *  Never invoked for coordination writes. */
export const defaultPrOpener: PrOpener = createAsyncPrOpener({ requireTransaction: true });

/** The work branch durable-content saves land on absent an explicit override — this worker's branch. */
export const DEFAULT_WORK_BRANCH = 'claude/m1-dashboard';

/** Branches durable content may NEVER be pushed to directly. `main` receives durable content only via a
 *  reviewed PR; `ops` receives ONLY coordination artifacts through the pull-rebase-push path — never a
 *  governedSave durable push. This is the design invariant (design §"write path", CLAUDE.md branch rules). */
const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'ops']);

/** Thrown when a durable push would target a protected branch — the defense-in-depth denylist so even a
 *  future caller that reintroduces a client-controlled branch can't push durable content to main/ops. */
export class ProtectedBranchError extends Error {
  constructor(branch: string) {
    super(`refusing to push durable content directly to protected branch '${branch}'`);
    this.name = 'ProtectedBranchError';
  }
}

/** Thrown when a coordination write is attempted from any checkout other than the local `ops` branch.
 *  A later `git push origin ops` pushes the local `ops` ref, not an unrelated checked-out HEAD. */
export class CoordinationCheckoutError extends Error {
  constructor(branch: string) {
    super(`refusing coordination write: checked-out branch is '${branch || '(unknown)'}', expected 'ops'`);
    this.name = 'CoordinationCheckoutError';
  }
}

/** Refuse to absorb a previous failed operation's staged residue into a governed commit. */
export class DirtyIndexError extends Error {
  constructor(paths: string[]) {
    super(`refusing governed commit with pre-existing staged paths: ${paths.join(', ')}`);
    this.name = 'DirtyIndexError';
  }
}

/** A restart tried to publish history other than the one exact, already-created coordination commit. */
export class PreparedCoordinationCommitError extends Error {
  constructor(detail: string) {
    super(`refusing prepared coordination publication: ${detail}`);
    this.name = 'PreparedCoordinationCommitError';
  }
}

/**
 * Parse a git `-z`/NUL-delimited porcelain payload into its non-empty entries. This folds ONLY the
 * split-transform of the former `(await runGit(...)).split('\0').filter(len>0)` idiom — the `runGit`
 * call with its exact argv stays at every call site (tests assert the argv). Callers that need the
 * normalized, sorted path set append `.map(normalize).sort()` as before.
 */
function splitZ(raw: string): string[] {
  return raw.split('\0').filter((entry) => entry.length > 0);
}

async function assertCleanIndex(repoRoot: string, runGit: GitRunner): Promise<void> {
  const paths = splitZ(await runGit(repoRoot, ['diff', '--cached', '--name-only', '-z']));
  if (paths.length > 0) throw new DirtyIndexError(paths);
}

/**
 * Query the real checkout through the injected runner and fail closed unless it is exactly `ops`.
 *
 * Exported because it is a precondition of PULLING, not merely of committing: `pull --rebase origin ops`
 * on a checkout that is no longer `ops` rebases an unrelated HEAD, and a conflict there leaves this
 * SHARED checkout mid-rebase for the next writer (the 2026-07-30 jam class). Every reconciling pull —
 * including the ones `opsPushRetry.ts` issues for callers outside this module — must be guarded by it.
 */
export async function assertCoordinationCheckout(repoRoot: string, runGit: GitRunner): Promise<void> {
  const branch = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (branch !== 'ops') throw new CoordinationCheckoutError(branch);
}

/**
 * True when `branch` resolves to a protected branch (`main`/`ops`) — case-insensitively and regardless
 * of a `refs/heads/` prefix, backslashes, leading slashes, or surrounding whitespace. The denylist the
 * durable route asserts against, and the route layer's hard-reject predicate for a client-smuggled ref.
 */
export function isProtectedBranch(branch: string): boolean {
  const norm = branch
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^refs\/heads\//i, '')
    .trim()
    .toLowerCase();
  return PROTECTED_BRANCHES.has(norm);
}

export interface RouteOptions {
  runGit?: GitRunner;
  openPr?: PrOpener;
  /** Work branch for durable-content routing. Defaults to {@link DEFAULT_WORK_BRANCH}. */
  workBranch?: string;
  message?: string;
  /** Extra push attempts (each preceded by a reconciling `pull --rebase`) after the first — coordination
   *  route only, per CLAUDE.md's "rejected push -> re-read state, reconcile, retry". */
  maxRetryPushes?: number;
  /** Extra coordination relpaths staged into the SAME commit as the primary relpath (MED-3: an audit row
   *  committed atomically with the change it records — one commit, one push). Coordination route only. */
  alsoStage?: string[];
  /** Re-run caller-specific authorization after a rejected push pulls a newer canonical ops head. */
  onReconciled?: () => void | Promise<void>;
  /** Coordination publication mode. Desktop defaults to direct remote publication. */
  publication?: CoordinationPublication;
  /** Durable local spool root used only when {@link publication} is `outbox`. */
  outboxRoot?: string;
  /** Batch context proving a `learning-implementation` manifest's record set and rendered state. */
  learningBatch?: LearningBatchAssertion;
  /** Proven-merge context for a `learning-record-retire` manifest. */
  retire?: RetireAssertion;
  /** Filesystem probe for the symlink/reparse wall. Injected for hermetic tests. */
  lstatPath?: PathFactsProbe;
  /** Reads a staged path's bytes for the record-state wall. Injected for hermetic tests. */
  readPathBytes?: (absolute: string) => Promise<string>;
  /** Removes a record path for the retire purpose. Injected for hermetic tests. */
  unlinkPath?: (absolute: string) => Promise<void>;
  /** Restores a record path's captured bytes when a retire fails after its deletions. */
  writePathBytes?: (absolute: string, contents: string) => Promise<void>;
  /** Operation-key receipt store for exact replay / changed-manifest conflict. */
  receipts?: RouteReceiptStore;
  /** The composition-time repository pin [P4-C35]. Required for the four P4 purposes. */
  repoPin?: RepositoryPin;
  /** Recovery lookup when a PR open TIMES OUT: returns every PR already open for the head branch. */
  locatePr?: (repoRoot: string, branch: string) => Promise<readonly LocatedPr[]>;
  /** Runs inside the transaction after the index is proved clean and before `add`. */
  beforeStage?: () => Promise<void>;
}

/** A PR found by the timeout recovery: only an OPEN PR whose base is `main` may be adopted. */
export interface LocatedPr extends PinnedAsyncPrResult {
  readonly state: string;
  readonly base: string;
}

export type PathFactsProbe = (absolute: string) => Promise<{
  exists: boolean; isFile: boolean; isSymbolicLink: boolean;
}>;

/** The `learning-implementation` batch the publisher validates its staged set against [P4-C13]. */
export interface LearningBatchAssertion {
  readonly batchId: string;
  readonly implementedAt: string;
  readonly targetPaths: readonly string[];
  readonly recordPaths: readonly string[];
}

/** A retire publishes only against a proven merge; `merged` is a literal `true`, re-checked at run time. */
export interface RetireAssertion {
  readonly batchId: string;
  readonly recordPaths: readonly string[];
  readonly mergeCommit: string;
  readonly merged: true;
}

export interface StoredRouteReceipt {
  readonly manifestSha256: string;
  readonly receipt: RoutePublicationReceipt;
}


export interface RouteReceiptStore {
  get(operationKey: string): StoredRouteReceipt | undefined;
  put(operationKey: string, value: StoredRouteReceipt): void;
}

/** At most this many operation keys are retained; the least-recently-used entry is evicted first. */
export const MAX_PERSISTED_ROUTE_RECEIPTS = 1000;
const ROUTE_RECEIPT_FILENAME = 'durable-receipts.json';

/** `<stateRoot>/control/durable-receipts.json` — the durable replay ledger of the P4 purposes. */
export function routeReceiptStorePath(stateRoot: string): string {
  return join(stateRoot, 'control', ROUTE_RECEIPT_FILENAME);
}

/**
 * The durable replay store (§3.2 replay/409 rule). A process-local `Map` republished every operation
 * key after a daemon restart, so the store is a small fsync'd JSON ledger loaded on first use and
 * rewritten atomically (temp file -> fsync -> rename -> fsync of the directory) on every put. Insertion
 * order is the LRU order: a `get` that hits re-inserts, and the oldest key is evicted past the bound.
 *
 * Only the four P4 purposes are keyed here. `governed-save` and `workflow-amendment` stay on the replay
 * mechanisms their own callers already own, which §3.2 preserves verbatim — "existing callers retain
 * their existing work branch / their existing request key prefixed by purpose".
 */
export function createPersistentRouteReceipts(stateRoot: string): RouteReceiptStore {
  const path = routeReceiptStorePath(stateRoot);
  let entries: Map<string, StoredRouteReceipt> | null = null;

  const load = (): Map<string, StoredRouteReceipt> => {
    if (entries) return entries;
    const loaded = new Map<string, StoredRouteReceipt>();
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const rows = (parsed as { receipts?: unknown })?.receipts;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const entry = row as { operationKey?: unknown; manifestSha256?: unknown; receipt?: unknown };
          if (typeof entry.operationKey !== 'string' || typeof entry.manifestSha256 !== 'string') continue;
          if (entry.receipt === null || typeof entry.receipt !== 'object') continue;
          loaded.set(entry.operationKey, {
            manifestSha256: entry.manifestSha256,
            receipt: entry.receipt as RoutePublicationReceipt,
          });
        }
      }
    } catch {
      // A missing or unreadable ledger is an EMPTY ledger: replay protection degrades to the pre-W2
      // behaviour rather than refusing every publication.
    }
    entries = loaded;
    return loaded;
  };

  const persist = (map: Map<string, StoredRouteReceipt>): void => {
    const rows = [...map.entries()].map(([operationKey, value]) => ({ operationKey, ...value }));
    const body = JSON.stringify({ schema: 'kb.durable-receipts/v1', receipts: rows });
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, body, 'utf8');
    const handle = openSync(temp, 'r+');
    try { fsyncSync(handle); } finally { closeSync(handle); }
    renameSync(temp, path);
  };

  return {
    get: (key) => {
      const map = load();
      const found = map.get(key);
      if (found) { map.delete(key); map.set(key, found); }
      return found;
    },
    put: (key, value) => {
      const map = load();
      map.delete(key);
      map.set(key, value);
      while (map.size > MAX_PERSISTED_ROUTE_RECEIPTS) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
      persist(map);
    },
  };
}

let processRouteReceipts: RouteReceiptStore | null = null;

/** The process-wide default receipt store: persistent, under the dashboard state root. */
export const defaultRouteReceipts: RouteReceiptStore = {
  get: (key) => {
    processRouteReceipts ??= createPersistentRouteReceipts(resolveDashboardStateRoot());
    return processRouteReceipts.get(key);
  },
  put: (key, value) => {
    processRouteReceipts ??= createPersistentRouteReceipts(resolveDashboardStateRoot());
    processRouteReceipts.put(key, value);
  },
};

/** Exact `operationKey` replay under a CHANGED canonical manifest — never a silent second write. */
export class DurableReplayConflictError extends Error {
  readonly status = 409;
  constructor(operationKey: string) {
    super(`operation key '${operationKey}' already published a different manifest`);
    this.name = 'DurableReplayConflictError';
  }
}

/** A manifest whose purpose contract, path wall, or base commit does not hold. Nothing is staged. */
export class ManifestContractError extends Error {
  constructor(detail: string) {
    super(`refusing durable publication: ${detail}`);
    this.name = 'ManifestContractError';
  }
}

/** Canonical manifest bytes: fixed key order, so a changed body under one key is detectable. */
export function canonicalManifestSha256(manifest: DurablePathManifest): string {
  return sha256Hex(JSON.stringify([
    manifest.schema, manifest.operationKey, manifest.purpose, manifest.baseCommit, [...manifest.relpaths],
  ]));
}

const defaultLstatPath: PathFactsProbe = async (absolute) => {
  try {
    const stats = await lstat(absolute);
    return { exists: true, isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink() };
  } catch {
    return { exists: false, isFile: false, isSymbolicLink: false };
  }
};

/** Resolve a relpath under the repository, refusing any escape. Callers pass validated relpaths. */
function resolveInside(repoRoot: string, relpath: string): string {
  const root = resolve(repoRoot);
  const absolute = resolve(root, relpath);
  const inside = relative(root, absolute);
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    throw new ManifestContractError(`path escapes the repository: ${relpath}`);
  }
  return absolute;
}

/**
 * Parse ONLY the leading `---` frontmatter block of a learning record into its closed key set.
 *
 * A whole-file line scan is not a state check: `## Evidence` is miner-derived, attacker-influenced text
 * the constitution treats as INERT DATA, so a body line reading `status: implemented` must never satisfy
 * the wall. The block therefore has to open on the first byte, every key must be one of W0's
 * `PROPOSAL_FRONTMATTER_KEYS`, duplicates are refused, and parsing STOPS at the closing fence.
 */
export function parseRecordFrontmatter(bytes: string): Map<string, string> {
  const lines = bytes.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new ManifestContractError('record does not open with a frontmatter block');
  const parsed = new Map<string, string>();
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '---') return parsed;
    const match = /^([a-z][a-z-]*):[ \t]*(.*)$/.exec(line);
    if (match === null) throw new ManifestContractError('record frontmatter carries a non key/value line');
    const key = match[1]!;
    if (!(PROPOSAL_FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new ManifestContractError(`record frontmatter carries an unknown key ${JSON.stringify(key)}`);
    }
    if (parsed.has(key)) throw new ManifestContractError(`record frontmatter repeats ${JSON.stringify(key)}`);
    parsed.set(key, match[2]!.trim());
  }
  throw new ManifestContractError('record frontmatter block is unterminated');
}

/** The batch's rendered state, read from the FRONTMATTER only and validated against W0's patterns. */
function assertRecordRenderedAtBatch(
  bytes: string,
  batch: LearningBatchAssertion,
  recordPath: string,
): void {
  const front = parseRecordFrontmatter(bytes);
  const status = front.get('status');
  const batchId = front.get('batch-id');
  const implementedAt = front.get('implemented-at');
  if (status !== 'implemented'
    || batchId !== batch.batchId || !BATCH_ID_PATTERN.test(batchId)
    || implementedAt !== batch.implementedAt || !CANONICAL_UTC_SECOND.test(implementedAt)) {
    throw new ManifestContractError(`record is not rendered at this batch's implemented state: ${recordPath}`);
  }
}

/**
 * Re-derive the record state from the STAGED bytes (`git show :<path>`) after `add`, inside the same
 * transaction. The worktree read above proves what was on disk when the wall ran; only this proves what
 * is about to become history, closing the read -> `add` window.
 */
async function assertStagedRecordState(
  repoRoot: string,
  manifest: DurablePathManifest,
  options: RouteOptions,
  runGit: GitRunner,
): Promise<void> {
  if (manifest.purpose !== 'learning-implementation') return;
  const batch = options.learningBatch!;
  for (const recordPath of batch.recordPaths) {
    const staged = await runGit(repoRoot, ['show', `:${recordPath}`]);
    assertRecordRenderedAtBatch(staged, batch, recordPath);
  }
}

/**
 * Purpose-exact staged-path rules (§3.2). Structural/purpose path legality is already proved by
 * `decodeDurablePathManifest`; this layer adds the BATCH-scoped rules the decoder cannot know.
 */
async function assertPurposeContract(
  repoRoot: string,
  manifest: DurablePathManifest,
  options: RouteOptions,
): Promise<void> {
  const readBytes = options.readPathBytes ?? (async (absolute: string) => readFile(absolute, 'utf8'));
  if (manifest.purpose === 'learning-implementation') {
    const batch = options.learningBatch;
    if (!batch) throw new ManifestContractError('learning-implementation requires its batch context');
    if (manifest.operationKey !== `learning-implementation:${batch.batchId}`) {
      throw new ManifestContractError('operation key does not name this batch');
    }
    const targets = new Set(batch.targetPaths);
    const records = new Set(batch.recordPaths);
    for (const relpath of manifest.relpaths) {
      if (relpath.startsWith('docs/proposals/') && !records.has(relpath)) {
        throw new ManifestContractError(`docs/proposals path outside this batch: ${relpath}`);
      }
      if (!targets.has(relpath) && !records.has(relpath)) {
        throw new ManifestContractError(`path is neither a validated target nor a batch record: ${relpath}`);
      }
    }
    for (const required of [...targets, ...records]) {
      if (!manifest.relpaths.includes(required)) {
        throw new ManifestContractError(`batch path missing from the manifest: ${required}`);
      }
    }
    for (const recordPath of batch.recordPaths) {
      assertRecordRenderedAtBatch(await readBytes(resolveInside(repoRoot, recordPath)), batch, recordPath);
    }
    return;
  }
  if (manifest.purpose === 'learning-record-retire') {
    const retire = options.retire;
    if (!retire) throw new ManifestContractError('learning-record-retire requires its proven-merge context');
    if (retire.merged !== true) throw new ManifestContractError('retire requires a proven merge of the batch PR');
    if (!isCommitSha(retire.mergeCommit)) throw new ManifestContractError('retire requires a 40-hex merge commit');
    if (manifest.operationKey !== `learning-record-retire:${retire.batchId}:${retire.mergeCommit}`) {
      throw new ManifestContractError('operation key does not name this batch and merge commit');
    }
    const records = new Set(retire.recordPaths);
    if (records.size !== manifest.relpaths.length || manifest.relpaths.some((relpath) => !records.has(relpath))) {
      throw new ManifestContractError('a retire stages exactly the batch record paths');
    }
    return;
  }
  if (manifest.purpose === 'schedule-mirror') {
    const batch = options.learningBatch;
    // The mirror publishes one batch of HEARTBEAT mirrors; its key must name that batch, exactly as
    // both learning purposes' keys do — otherwise the replay ledger is keyed on an unverified string.
    if (!batch) throw new ManifestContractError('schedule-mirror requires its batch context');
    if (manifest.operationKey !== scheduleMirrorOperationKey(batch.batchId)) {
      throw new ManifestContractError('operation key does not name this batch');
    }
    return;
  }
  if (manifest.purpose === 'learning-proposal') {
    for (const relpath of manifest.relpaths) {
      if (!isLearningRecordPath(relpath)) {
        throw new ManifestContractError(`learning-proposal stages only ${LEARNING_RECORD_PREFIX}** records`);
      }
    }
  }
}

/**
 * The symlink/reparse wall over every staged path — over EVERY COMPONENT of every staged path, so a
 * junction on `agents/` or `docs/proposals/learnings/` refuses just as a swapped leaf does. Run inside
 * the ops transaction immediately before `add`; {@link assertNoStagedLinkModes} re-checks after it.
 */
async function assertNoReparseSwap(
  repoRoot: string,
  manifest: DurablePathManifest,
  options: RouteOptions,
): Promise<void> {
  const probe = options.lstatPath ?? defaultLstatPath;
  for (const relpath of manifest.relpaths) {
    const absolute = resolveInside(repoRoot, relpath);
    const components = relpath.split('/');
    let prefix = resolve(repoRoot);
    for (let index = 0; index < components.length; index += 1) {
      prefix = resolve(prefix, components[index]!);
      const facts = await probe(prefix);
      if (facts.isSymbolicLink) {
        throw new ManifestContractError(`symlink or reparse point at ${components.slice(0, index + 1).join('/')}`);
      }
    }
    const facts = await probe(absolute);
    if (manifest.purpose === 'learning-record-retire' && (!facts.exists || !facts.isFile)) {
      throw new ManifestContractError(`retire requires an existing regular file at ${relpath}`);
    }
  }
}

/**
 * The post-`add` half of the reparse wall: a link swapped in between the component walk and `add` is
 * staged as a git symlink entry (mode 120000) at the SAME path, which the exact-set check cannot see.
 * `ls-files -s` reads the mode git actually recorded, so the swap fails before any commit exists.
 */
async function assertNoStagedLinkModes(
  repoRoot: string,
  manifest: DurablePathManifest,
  runGit: GitRunner,
): Promise<void> {
  const raw = await runGit(repoRoot, ['ls-files', '-s', '-z', '--', ...manifest.relpaths]);
  for (const entry of raw.split('\0')) {
    if (entry.length === 0) continue;
    const mode = entry.slice(0, entry.indexOf(' '));
    if (mode === '120000' || mode === '160000') {
      throw new ManifestContractError(`staged entry is a ${mode === '120000' ? 'symlink' : 'gitlink'}: ${entry}`);
    }
  }
}

/** The exact cached path set after `add` must equal the manifest — never a superset or a subset. */
async function assertStagedSetMatches(
  repoRoot: string,
  manifest: DurablePathManifest,
  runGit: GitRunner,
): Promise<void> {
  const raw = await runGit(repoRoot, ['diff', '--cached', '--name-status', '-z']);
  const tokens = splitZ(raw);
  const staged: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index]!.trim();
    // git's real `-z` name-status grammar emits THREE tokens for a rename/copy (`R100\0src\0dst\0`);
    // `diff.renames` is on by default. Walking in strict pairs desyncs status from path for every
    // later entry, so the grammar is consumed properly here — and any rename/copy is itself a refusal:
    // a P4 publication stages a fixed manifest of paths and never moves one.
    if (/^[RC]/.test(status)) {
      const source = tokens[index + 1];
      const destination = tokens[index + 2];
      if (source === undefined || destination === undefined) {
        throw new ManifestContractError('cached name-status output is truncated');
      }
      throw new ManifestContractError(`a durable publication never renames or copies: ${status} ${source} -> ${destination}`);
    }
    const path = tokens[index + 1];
    if (path === undefined) throw new ManifestContractError('cached name-status output is truncated');
    staged.push({ status, path });
    index += 2;
  }
  const stagedPaths = staged.map((entry) => entry.path).sort();
  const expected = [...manifest.relpaths].sort();
  if (stagedPaths.length !== expected.length || stagedPaths.some((path, index) => path !== expected[index])) {
    throw new ManifestContractError(`staged set ${JSON.stringify(stagedPaths)} does not equal the manifest ${JSON.stringify(expected)}`);
  }
  if (manifest.purpose === 'learning-record-retire' && staged.some((entry) => entry.status !== 'D')) {
    throw new ManifestContractError('a retire stages only deletions');
  }
}

/**
 * Prepare an `ops` coordination write by proving that the checkout itself is exactly `ops`, then
 * reconciling it before the first local mutation. Pulling `origin ops` does not switch branches, and
 * pushing `origin ops` does not push an arbitrary checked-out HEAD. Detached HEAD and every work branch
 * therefore fail closed; this function never auto-checks out a branch.
 * Kept separate from {@link commitPreparedCoordination} for writes (such as card launch) whose
 * authoritative schema operation must happen only after the pull, while still committing an exact
 * multi-path set atomically afterwards.
 */
export async function prepareCoordination(
  repoRoot: string,
  runGit: GitRunner = defaultGitRunner,
  publication: CoordinationPublication = 'direct',
  outboxRoot = '/var/lib/kb/state/outbox',
): Promise<void> {
  // Reentrant: a caller that already holds the ops-transaction span joins it; a careless future caller
  // that forgot the span lock at least serializes this individual step.
  return withOpsTransaction(async () => {
    await assertCoordinationCheckout(repoRoot, runGit);
    if (publication === 'outbox') {
      await assertCleanIndex(repoRoot, runGit);
      await recoverUnspooledCoordinationCommits({
        repoRoot,
        spoolRoot: outboxRoot,
        runGit,
        isCoordinationPath,
      });
      return;
    }
    await runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
  });
}

function defaultMessage(relpath: string): string {
  return `chore(dashboard): governed save ${relpath}`;
}

/**
 * Read the current HEAD commit so a caller can pin a manifest to the base it actually compiled against.
 * A `rev-parse` that does not answer 40-hex THROWS: silently downgrading a degraded checkout to the
 * unpinned sentinel is exactly the base-swap hole §3.2's "wrong `baseCommit`" clause exists to close.
 */
export async function resolveBaseCommit(repoRoot: string, runGit: GitRunner): Promise<string> {
  const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  if (!isCommitSha(head)) throw new ManifestContractError(`cannot resolve a base commit: rev-parse HEAD answered ${JSON.stringify(head)}`);
  return head;
}

/**
 * The base commit the two PRE-EXISTING purposes pin when they publish whatever their work branch is at.
 * It is a legal 40-hex value so the manifest still decodes, and the base-equality check skips it. The
 * four P4 purposes REFUSE it outright (see {@link routeDurable}) — they always carry a real, attested
 * base, and a sentinel that disables the base check must never be reachable from one of them.
 */
export const UNPINNED_BASE_COMMIT = '0'.repeat(40);

/** The four purposes P4 introduces; each is pinned, replay-keyed, and merge/base-verified here. */
const P4_PURPOSES: readonly DurablePathManifest['purpose'][] = [
  'learning-proposal', 'learning-implementation', 'learning-record-retire', 'schedule-mirror',
];

/** The purposes whose head branch is DERIVED, never accepted from a caller (§3.2). */
const DERIVED_BRANCH_PURPOSES: readonly DurablePathManifest['purpose'][] = [
  'learning-implementation', 'schedule-mirror',
];

/**
 * The publication receipt. Every P4 purpose returns the closed `RouteDurableReceipt` of §3.2 [P4-C32];
 * the two pre-existing PR purposes return the same `'pr'` shape carrying the not-yet-required
 * `AsyncPrResult`, which W6.1 collapses into the closed union when it makes the fields required.
 */
export type RoutePublicationReceipt =
  | (Extract<RouteDurableReceipt, { mode: 'pr' }>)
  | (Extract<RouteDurableReceipt, { mode: 'coordination' }> & { readonly pushed: boolean })
  | { readonly mode: 'pr'; readonly branch: string; readonly pr: AsyncPrResult };

function prReceipt(branch: string, pr: PinnedAsyncPrResult | AsyncPrResult): RoutePublicationReceipt {
  return { mode: 'pr', branch, pr: pr as AsyncPrResult };
}

/**
 * `pushed` is the honest half of a coordination receipt: the outbox arm returns a LOCAL, unpushed sha
 * that a caller must not present as published `ops` history. Direct publication sets it `true` only
 * after `pushOpsWithReconcile` returns.
 */
function coordinationReceipt(commit: string, pushed: boolean): RoutePublicationReceipt {
  return { mode: 'coordination', branch: OPS_BRANCH, commit, pushed };
}

/** Every purpose's PR title/commit message, absent a caller-supplied one. */
function manifestMessage(manifest: DurablePathManifest): string {
  return `chore(dashboard): ${manifest.purpose} ${manifest.relpaths.join(' ')}`;
}

/**
 * EVERY PR purpose now requires the pinned `{owner,repo,number,url}`: a malformed `gh` output is a
 * FAILURE, never a half-known PR (§3.2 "malformed `gh` output is failure"). W6.1 [P4-C16] made
 * `AsyncPrResult` fully required across the consumers, and closed the last hole by making the two
 * legacy purposes (`governed-save`, `workflow-amendment`) strict too — a `workflows/routes.ts` receipt
 * can no longer store a `pr` typed `{owner,repo,number,url}` that is `{}` at runtime. No caller
 * tolerates a null/partial PR on the `pr` publication path, so there is no non-strict arm and no `as`
 * cast: an unpinned result throws for every purpose.
 */
function pinPrResult(result: AsyncPrResult | void, branch: string): PinnedAsyncPrResult {
  // A PR opener still returns `void` when it opens nothing, so the working value is a PARTIAL until the
  // four fields are proven present here.
  const pr: Partial<AsyncPrResult> = result ?? {};
  const pinned = typeof pr.owner === 'string' && pr.owner.length > 0
    && typeof pr.repo === 'string' && pr.repo.length > 0
    && typeof pr.number === 'number' && Number.isInteger(pr.number) && pr.number > 0
    && typeof pr.url === 'string' && pr.url.length > 0;
  if (pinned) return { owner: pr.owner!, repo: pr.repo!, number: pr.number!, url: pr.url! };
  throw new ManifestContractError(`PR result for '${branch}' is not the pinned {owner,repo,number,url}`);
}

/**
 * The publisher's own capability wall: inside `routeDurable` the injected runner may issue ONLY the
 * subcommands of {@link PUBLISHER_PERMITTED_SUBCOMMANDS}. A future edit that reaches for `worktree
 * remove`, `checkout`, or `update-ref` through this seam fails loudly in its own tests [P4-C21].
 */
function guardPublisherGit(runGit: GitRunner): GitRunner {
  return async (repoRoot, args) => {
    const subcommand = args.find((arg) => !arg.startsWith('-')) ?? '';
    if (!PUBLISHER_PERMITTED_SUBCOMMANDS.includes(subcommand)) {
      throw new ManifestContractError(`git '${subcommand}' is outside the publisher's permitted table`);
    }
    return runGit(repoRoot, args);
  };
}

/**
 * The merge proof the publisher performs ITSELF (§3.2 "only against a proven merge commit"). A caller's
 * `merged: true` is an assertion, not evidence: this fetches `origin main` and requires the merge commit
 * to be an ancestor of it. A non-ancestor exits 1; either outcome refuses rather than retiring records
 * against an unmerged (or fabricated) commit.
 */
async function assertProvenMerge(repoRoot: string, retire: RetireAssertion, runGit: GitRunner): Promise<void> {
  try {
    await runGit(repoRoot, ['fetch', 'origin', 'main']);
    await runGit(repoRoot, ['merge-base', '--is-ancestor', retire.mergeCommit, 'origin/main']);
  } catch (error) {
    throw new ManifestContractError(
      `merge commit ${retire.mergeCommit} is not proven merged into origin/main: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete the retire's record files and return the restore that puts the checkout back byte-for-byte.
 * The bytes are captured BEFORE the first unlink, so a failure anywhere later in the transaction —
 * a staged-set mismatch, a non-`D` status, a rejected push — leaves no deletion behind on the shared
 * coordination checkout.
 */
async function applyRetireDeletions(
  repoRoot: string,
  manifest: DurablePathManifest,
  options: RouteOptions,
): Promise<() => Promise<void>> {
  const readBytes = options.readPathBytes ?? (async (absolute: string) => readFile(absolute, 'utf8'));
  const writeBytes = options.writePathBytes ?? (async (absolute: string, contents: string) => { await writeFile(absolute, contents, 'utf8'); });
  const unlinkPath = options.unlinkPath ?? (async (absolute: string) => { await unlink(absolute); });
  const captured: Array<{ absolute: string; bytes: string }> = [];
  for (const relpath of manifest.relpaths) {
    const absolute = resolveInside(repoRoot, relpath);
    captured.push({ absolute, bytes: await readBytes(absolute) });
  }
  const restored: Array<{ absolute: string; bytes: string }> = [];
  for (const entry of captured) {
    await unlinkPath(entry.absolute);
    restored.push(entry);
  }
  return async () => {
    for (const entry of restored) {
      try { await writeBytes(entry.absolute, entry.bytes); } catch { /* restore is best-effort per path; the original failure still propagates */ }
    }
  };
}

/** Only a timeout/kill-class failure can leave a PR opened-but-unreported; nothing else may recover. */
function isTimeoutClassError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|ETIMEDOUT|was killed/i.test(message);
}

/** A `gh`-reported PR identity must match the composition-time repository pin, or it is not ours. */
function assertPinnedToRepository(
  pr: PinnedAsyncPrResult | AsyncPrResult,
  pin: RepositoryPin | null,
  strict: boolean,
): void {
  if (!pin) {
    if (strict) throw new ManifestContractError('a P4 publication requires the composition-time repository pin');
    return;
  }
  if (pr.owner !== pin.owner || pr.repo !== pin.repo) {
    throw new ManifestContractError(`PR belongs to ${pr.owner}/${pr.repo}, not the pinned ${pin.owner}/${pin.repo}`);
  }
}

/**
 * THE ONE DURABLE PUBLISHER (§3.2). Every purpose — governed save, workflow amendment, the three
 * learning purposes, and the schedule mirror — reaches disk through this function and nowhere else.
 *
 * PR mode stages the exact manifest, commits locally (hooks active), pushes HEAD onto the head-branch
 * ref on `origin` — NEVER `ops`, NEVER `main` — and opens a PR to `main`, returning the pinned
 * `{owner,repo,number,url}`. Coordination mode ( `learning-proposal`, `learning-record-retire`) reuses
 * the existing `prepareCoordination`/`commitPreparedCoordination` path on `ops` [P4-C41] and returns
 * the pushed `ops` commit. The receipt is the closed union of §3.2, so a caller can never read a PR
 * field off a coordination push [P4-C32].
 *
 * The head branch of the two derived purposes is DERIVED from the operation key, never accepted.
 */
export async function routeDurable(
  repoRoot: string,
  input: DurablePathManifest,
  options: RouteOptions = {},
): Promise<RoutePublicationReceipt> {
  const manifest = decodeDurablePathManifest(input);
  const unguarded = options.runGit ?? defaultGitRunner;
  const runGit = guardPublisherGit(unguarded);
  const openPr = options.openPr ?? defaultPrOpener;
  const receipts = options.receipts ?? defaultRouteReceipts;
  const message = options.message ?? manifestMessage(manifest);
  const manifestSha256 = canonicalManifestSha256(manifest);
  const pin = options.repoPin ?? null;

  // The unpinned sentinel disables the base-equality check, so it belongs ONLY to the two pre-existing
  // purposes that publish whatever their work branch is at. A P4 manifest carrying it is a base-swap
  // bypass (§3.2 "Before staging any byte ... reject ... wrong baseCommit"), refused before any git runs.
  if (P4_PURPOSES.includes(manifest.purpose) && manifest.baseCommit === UNPINNED_BASE_COMMIT) {
    throw new ManifestContractError(`purpose ${manifest.purpose} requires a real attested base commit`);
  }

  // Exact `operationKey` replay returns the original receipt; a changed manifest under that key is 409.
  // The two pre-existing purposes keep the replay stores their own callers already own (the workflow
  // amendment store, the governed-save request path), so only the four P4 purposes are keyed here.
  const replayable = manifest.purpose !== 'governed-save' && manifest.purpose !== 'workflow-amendment';
  const prior = replayable ? receipts.get(manifest.operationKey) : undefined;
  if (prior) {
    if (prior.manifestSha256 !== manifestSha256) throw new DurableReplayConflictError(manifest.operationKey);
    return prior.receipt;
  }

  if (purposeMode(manifest.purpose) === 'coordination') {
    // ONE span for the whole coordination publication: the reparse wall, the purpose contract, the
    // retire deletions, and the staged-set proof all sit inside the lock the writers share, so no other
    // ops writer — and no swapped path — can slip between validation and `add`. `withOpsTransaction` is
    // reentrant, so the nested prepare/commit steps join this span instead of opening their own.
    return withOpsTransaction(async () => {
      await prepareCoordination(repoRoot, unguarded, options.publication ?? 'direct', options.outboxRoot);
      // A coordination manifest pins the ops HEAD it was compiled against, and `prepareCoordination`
      // has just reconciled that checkout: a manifest built against a stale head is refused here rather
      // than committed on top of history its author never saw.
      const opsHead = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
      if (!isCommitSha(opsHead)) {
        throw new ManifestContractError(`ops checkout HEAD is unreadable (${JSON.stringify(opsHead)})`);
      }
      if (opsHead !== manifest.baseCommit) {
        throw new ManifestContractError(`ops checkout is at ${opsHead}, manifest pins ${manifest.baseCommit}`);
      }
      await assertPurposeContract(repoRoot, manifest, options);
      await assertNoReparseSwap(repoRoot, manifest, options);
      if (manifest.purpose === 'learning-record-retire') {
        await assertProvenMerge(repoRoot, options.retire!, runGit);
      }
      // The retire's deletions happen INSIDE the transaction, after the index is proved clean, with the
      // original bytes captured first: any later failure restores the shared ops checkout to a
      // byte-identical tree instead of leaving records deleted for every other writer (M3).
      let restoreRetire: (() => Promise<void>) | null = null;
      let commit: string;
      try {
        commit = await commitPreparedCoordination(repoRoot, manifest, {
          ...options,
          message,
          beforeStage: manifest.purpose === 'learning-record-retire'
            ? async () => { restoreRetire = await applyRetireDeletions(repoRoot, manifest, options); }
            : undefined,
        });
      } catch (error) {
        if (restoreRetire) await (restoreRetire as () => Promise<void>)();
        throw error;
      }
      const pushedRemotely = (options.publication ?? 'direct') !== 'outbox';
      const receipt = coordinationReceipt(commit, pushedRemotely);
      if (replayable) receipts.put(manifest.operationKey, { manifestSha256, receipt });
      return receipt;
    });
  }

  // Only the two NEW PR purposes DERIVE their head branch from the operation key; the pre-existing
  // governed-save/workflow-amendment callers retain their explicitly configured work branch (§3.2).
  const derived = DERIVED_BRANCH_PURPOSES.includes(manifest.purpose) ? derivedDurableBranch(manifest) : null;
  const branch = derived ?? options.workBranch ?? DEFAULT_WORK_BRANCH;

  // Defense-in-depth denylist: refuse to push durable content to main/ops regardless of caller, BEFORE
  // any local staging/commit — so even a future caller that reintroduces a client-controlled branch
  // cannot direct-push durable content past the PR-review gate.
  if (isProtectedBranch(branch)) {
    throw new ProtectedBranchError(branch);
  }

  // Same checkout as the coordination writers — its stage/commit must not interleave with theirs.
  return withOpsTransaction(async () => {
    let staged = false;
    let committed = false;
    let pushed = false;
    let prKnown = false;
    let tip: string | null = null;
    try {
      const checkedOut = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (checkedOut !== branch) throw new Error(`refusing durable write: checked-out branch is '${checkedOut || '(detached)'}', expected '${branch}'`);
      if (manifest.baseCommit !== UNPINNED_BASE_COMMIT) {
        const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
        // An unreadable or non-sha HEAD is a REFUSAL, never a pass: the base check must not fail open
        // on a degraded checkout, which is precisely where a base swap would hide.
        if (!isCommitSha(head)) {
          throw new ManifestContractError(`checkout HEAD is unreadable (${JSON.stringify(head)}); manifest pins ${manifest.baseCommit}`);
        }
        if (head !== manifest.baseCommit) {
          throw new ManifestContractError(`checkout is at ${head}, manifest pins ${manifest.baseCommit}`);
        }
      }
      // Inside the lock, immediately before `add`: no TOCTOU window spans the lock acquisition.
      await assertPurposeContract(repoRoot, manifest, options);
      await assertNoReparseSwap(repoRoot, manifest, options);
      await assertCleanIndex(repoRoot, runGit);
      await runGit(repoRoot, ['add', '--', ...manifest.relpaths]);
      staged = true;
      // The cached set must equal the manifest EXACTLY before anything is committed, no entry may have
      // been staged as a link, and the record state is re-derived from the STAGED bytes.
      await assertStagedSetMatches(repoRoot, manifest, runGit);
      await assertNoStagedLinkModes(repoRoot, manifest, runGit);
      await assertStagedRecordState(repoRoot, manifest, options, runGit);
      // The index was proved clean before staging these paths. Commit that bounded
      // index so pre-commit may add generated runtime mirrors atomically.
      await runGit(repoRoot, ['commit', '-m', message]);
      committed = true;
      if (manifest.baseCommit !== UNPINNED_BASE_COMMIT) {
        tip = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim() || null;
      }
      // Push local HEAD onto the head-branch ref, regardless of the locally checked-out branch name —
      // never a bare `push origin main`/`push origin ops`.
      await runGit(repoRoot, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
      pushed = true;
      let pr: PinnedAsyncPrResult | AsyncPrResult;
      try {
        // `--repo <owner>/<repo>` pins the invocation to the composition-time repository, so a `gh`
        // resolving a fork or a mis-set `remote.origin.url` cannot open the PR somewhere else.
        pr = pinPrResult(
          await openPr(repoRoot, { base: 'main', head: branch, title: message, ...(pin ? { repo: pin } : {}) }),
          branch,
        );
      } catch (openError) {
        // ONLY a timeout-class failure is recoverable: any other error (auth, validation, a rejected
        // head) means the open did not race us, and querying for "a PR that must already exist" would
        // adopt an unrelated one. A timed-out open queries the operation-key branch and accepts EXACTLY
        // one OPEN PR targeting `main`; ambiguity fails and escalates without deleting anything.
        if (!options.locatePr || !isTimeoutClassError(openError)) throw openError;
        const located = await options.locatePr(repoRoot, branch);
        const usable = located.filter((candidate) => candidate.state === 'OPEN' && candidate.base === 'main');
        if (usable.length !== 1) throw openError;
        pr = { owner: usable[0]!.owner, repo: usable[0]!.repo, number: usable[0]!.number, url: usable[0]!.url };
      }
      assertPinnedToRepository(pr, pin, replayable);
      prKnown = true;
      const receipt = prReceipt(branch, pr);
      if (replayable) receipts.put(manifest.operationKey, { manifestSha256, receipt });
      return receipt;
    } catch (error) {
      if (staged && !committed) {
        // The index was clean before this route started, so unstage both the
        // requested paths and anything a failed hook may have generated.
        try { await runGit(repoRoot, ['reset', 'HEAD', '--', '.']); } catch { /* preserve original failure */ }
      }
      // A later failure RECORDS its boundary and never retries a subset of the manifest.
      throw new DurableRouteError(error, { committed, pushed, prKnown, branch, tip });
    }
  });
}

/** Reports whether a durable route crossed its commit or remote-push boundary before failing. */
export class DurableRouteError extends Error {
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly prKnown: boolean;
  readonly branch: string | null;
  readonly tip: string | null;
  constructor(cause: unknown, state: {
    committed: boolean; pushed: boolean; prKnown?: boolean; branch?: string | null; tip?: string | null;
  }) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DurableRouteError';
    this.committed = state.committed;
    this.pushed = state.pushed;
    this.prKnown = state.prKnown ?? false;
    this.branch = state.branch ?? null;
    this.tip = state.tip ?? null;
  }
}

/**
 * Prepared coordination commit: re-prove that the checkout is still `ops`, then add exact relpaths ->
 * commit -> push, reconciling and retrying a push that LOST A RACE with another ops writer (bounded, via
 * `opsPushRetry.ts`; any other push failure rethrows on the spot). The second check closes the gap
 * between prepare and a caller's local write: an external branch switch fails before staging.
 * `audit/log.ts#commitAuditToOps` — the same rule applied generically to any coordination relpath.
 *
 * A caller whose commit is only valid under the canonical head it was compiled against passes
 * `onReconciled` to re-prove that after each reconcile (see `control/launch.ts`), rather than disabling
 * the retry — a disabled retry turns every lost race into a human intervention.
 */
export async function commitPreparedCoordination(
  repoRoot: string,
  target: string | DurablePathManifest,
  options: RouteOptions = {},
): Promise<string> {
  const manifest = typeof target === 'string' ? null : target;
  const relpath = typeof target === 'string' ? target : target.relpaths[0]!;
  const runGit = options.runGit ?? defaultGitRunner;
  const message = options.message ?? (manifest ? manifestMessage(manifest) : defaultMessage(relpath));
  const maxRetryPushes = options.maxRetryPushes ?? 3;

  return withOpsTransaction(async () => {
  const stagePaths = manifest ? [...manifest.relpaths] : [relpath, ...(options.alsoStage ?? [])];
  await assertCoordinationCheckout(repoRoot, runGit);
  if ((options.publication ?? 'direct') === 'outbox') {
    // A coordination-mode learning record is a legitimate `ops` write even though it is not one of the
    // classifier's coordination prefixes (§3.2 purpose table) — the outbox spools it like any other.
    const offending = stagePaths.filter((path) => !isCoordinationPath(path) && !isLearningRecordPath(path));
    if (offending.length > 0) {
      throw new PreparedCoordinationCommitError(
        `outbox refuses a non-coordination path: ${offending.join(', ')}`,
      );
    }
    await recoverUnspooledCoordinationCommits({
      repoRoot,
      spoolRoot: options.outboxRoot ?? '/var/lib/kb/state/outbox',
      runGit,
      isCoordinationPath,
    });
  }
  await assertCleanIndex(repoRoot, runGit);
  // The retire's deletions land HERE — inside the transaction, after the clean-index proof — so the
  // shared ops checkout is never mutated outside the lock (M3). The caller owns the restore.
  if (options.beforeStage) await options.beforeStage();
  await runGit(repoRoot, ['add', '--', ...stagePaths]);
  // A manifest publication proves its exact cached set (and, for a retire, that every entry is a
  // deletion) before any history exists. Validation failure creates no commit.
  if (manifest) {
    await assertStagedSetMatches(repoRoot, manifest, runGit);
    await assertNoStagedLinkModes(repoRoot, manifest, runGit);
  }
  await runGit(repoRoot, ['commit', '-m', message, '--only', '--', ...stagePaths]);

  if ((options.publication ?? 'direct') === 'outbox') {
    const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
    if (!isCommitSha(head)) {
      throw new PreparedCoordinationCommitError('local coordination commit identity is invalid');
    }
    await recoverUnspooledCoordinationCommits({
      repoRoot,
      spoolRoot: options.outboxRoot ?? '/var/lib/kb/state/outbox',
      runGit,
      isCoordinationPath,
    });
    return head;
  }

  await pushOpsWithReconcile({
    repoRoot,
    runGit,
    maxRetryPushes,
    // The checkout is re-proved `ops` before each reconciling pull: an external branch switch between
    // the failed push and the retry must fail closed rather than rebase an unrelated HEAD.
    beforeReconcile: () => assertCoordinationCheckout(repoRoot, runGit),
    onReconciled: options.onReconciled,
  });
  // Only a manifest publication needs the published identity for its receipt; a legacy string caller
  // ignores the return and must not pay for an extra revision read.
  if (!manifest) return '';
  const published = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  if (!isCommitSha(published)) {
    throw new PreparedCoordinationCommitError('published coordination commit identity is invalid');
  }
  return published;
  });
}

export interface CreatePreparedCoordinationCommitOptions {
  runGit?: GitRunner;
  message: string;
  /** Test/fault boundary after exact staging and before commit. */
  afterStage?: () => void;
}

/**
 * Create one exact local coordination commit without fetching, rebasing, or pushing.  This is the
 * mutation half of a strict two-phase publication: callers must hand the returned commit to
 * {@link publishPreparedCoordinationCommit}, whose remote-range proof is the only publication path.
 */
export async function createPreparedCoordinationCommit(
  repoRoot: string,
  relpaths: string[],
  options: CreatePreparedCoordinationCommitOptions,
): Promise<string> {
  const runGit = options.runGit ?? defaultGitRunner;
  const expectedPaths = [...new Set(relpaths.map(normalize))].sort();
  if (expectedPaths.length === 0 || expectedPaths.some((path) => classifyTarget(path) !== 'coordination')) {
    throw new PreparedCoordinationCommitError('the exact non-empty local commit path set must contain coordination artifacts only');
  }
  return withOpsTransaction(async () => {
    await assertCoordinationCheckout(repoRoot, runGit);
    let staged = splitZ(await runGit(repoRoot, ['diff', '--cached', '--name-only', '--no-renames', '-z']))
      .map(normalize).sort();
    if (staged.length > 0 && JSON.stringify(staged) !== JSON.stringify(expectedPaths)) {
      throw new DirtyIndexError(staged);
    }
    if (staged.length === 0) {
      await runGit(repoRoot, ['add', '--', ...expectedPaths]);
      staged = splitZ(await runGit(repoRoot, ['diff', '--cached', '--name-only', '--no-renames', '-z']))
        .map(normalize).sort();
    }
    if (JSON.stringify(staged) !== JSON.stringify(expectedPaths)) {
      throw new PreparedCoordinationCommitError('local settlement staging did not match the exact path set');
    }
    options.afterStage?.();
    await runGit(repoRoot, ['commit', '-m', options.message, '--only', '--', ...expectedPaths]);
    await assertCleanIndex(repoRoot, runGit);
    const commit = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
    if (!isCommitSha(commit)) {
      throw new PreparedCoordinationCommitError('local settlement commit identity is invalid');
    }
    return commit;
  });
}

export interface PublishPreparedCoordinationCommitOptions {
  runGit?: GitRunner;
  /** The complete, exact path set the prepared commit is allowed to contain. */
  relpaths: string[];
  /** Re-prove caller authorization after every remote/rebase boundary. */
  assertAuthorized?: () => void;
  /** Re-prove exact committed content, not merely the changed-path envelope. */
  validateCommit?: (commit: string) => void | Promise<void>;
  maxRetryPushes?: number;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

/**
 * Reports a prepared commit whose `git push` exited 0 while the publish call did not complete: the
 * commit may already be durable on origin/ops, so local history was NOT rewound and this is not a
 * refusal. Mirrors {@link DurableRouteError}'s posture — carry the boundary that was crossed, let the
 * caller phrase it for its own surface. Re-invoking the caller's operation finalizes it.
 */
export class PublishedCoordinationCommitError extends Error {
  readonly published = true;
  readonly commit: string;
  // No TS parameter property here: the daemon runs under Node strip-only mode, which rejects them.
  constructor(commit: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PublishedCoordinationCommitError';
    this.commit = commit;
  }
}

async function isAncestor(runGit: GitRunner, repoRoot: string, commit: string, descendant: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ['merge-base', '--is-ancestor', commit, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Undo an exact prepared commit that this publish call refused BEFORE telling the remote about it.
 *
 * CONSTRAINT this exists to satisfy: the coordination checkout is SHARED, and its other writers
 * (`commitPreparedCoordination`) publish with a bare `git push origin ops`, which pushes whatever
 * local ops history they find. A prepared commit left behind by a refused publish would therefore be
 * published later by an unrelated save, carrying content no proof ever accepted. The two-phase
 * contract is only sound if a refusal leaves no unpublished prepared commit behind.
 *
 * The authoritative safety rule lives at the CALL SITE, not here: once `git push` has exited 0 this
 * is never called at all, because `refs/remotes/origin/ops` is a cached view that a failed confirming
 * fetch leaves stale — trusting it there would rewind history the remote had already accepted. The
 * checks below are the remaining ownership proof: a clean working tree (a dirty checkout belongs to
 * another writer and is never discarded), the commit is still HEAD, it carries exactly the caller's
 * path set, and the last known remote state does not already reach it. Any failure here is swallowed —
 * the refusal being reported is the error that matters.
 */
async function rollbackUnpublishedPreparedCommit(
  repoRoot: string,
  runGit: GitRunner,
  commit: string,
  expectedPaths: string[],
): Promise<void> {
  try {
    const dirty = splitZ(await runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    if (dirty.length > 0) return;
    if ((await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim() !== commit) return;
    const paths = splitZ(await runGit(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]))
      .map(normalize).sort();
    if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) return;
    const remote = (await runGit(repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
    if (isCommitSha(remote) && await isAncestor(runGit, repoRoot, commit, remote)) return;
    const parent = (await runGit(repoRoot, ['rev-parse', `${commit}^`])).trim();
    if (!isCommitSha(parent)) return;
    await runGit(repoRoot, ['reset', '--hard', parent]);
  } catch { /* never mask the refusal that triggered this rollback */ }
}

/**
 * Restart-only continuation for a coordination transaction that committed locally but crashed before
 * its push was durably observed.  Unlike the normal retry path, this function never pulls, rebases, or
 * creates a commit.  It publishes only an exact clean `ops` HEAD whose changed-path set is caller-fixed,
 * A concurrent remote advance is handled with the repository's bounded rebase discipline, but the
 * rebased commit is accepted only after both its exact path envelope and caller-supplied exact-content
 * proof pass again.
 *
 * Failure has exactly two shapes, and the boundary between them is `git push` exiting 0:
 * - BEFORE that, a refusal rolls the prepared commit back ({@link rollbackUnpublishedPreparedCommit})
 *   so it can never be published later by another writer pushing ops wholesale;
 * - AFTER it, nothing is ever rewound and the failure is raised as {@link PublishedCoordinationCommitError},
 *   because a confirming fetch or authorization re-check that fails leaves durability UNKNOWN, and
 *   calling that a refusal would report the opposite of what may have happened.
 */
export async function publishPreparedCoordinationCommit(
  repoRoot: string,
  expectedCommit: string,
  options: PublishPreparedCoordinationCommitOptions,
): Promise<string> {
  if (!isCommitSha(expectedCommit)) {
    throw new PreparedCoordinationCommitError('expectedCommit must be a full lowercase SHA-1');
  }
  const runGit = options.runGit ?? defaultGitRunner;
  const maxRetryPushes = options.maxRetryPushes ?? 3;
  const expectedPaths = [...new Set(options.relpaths.map(normalize))].sort();
  if (expectedPaths.length === 0 || expectedPaths.some((path) => classifyTarget(path) !== 'coordination')) {
    throw new PreparedCoordinationCommitError('the exact non-empty path set must contain coordination artifacts only');
  }

  return withOpsTransaction(async () => {
    let reconciliationCommit = expectedCommit;
    // The one-way door: set the instant a push exits 0, and never unset. Everything downstream reads
    // it as "the remote may already have our objects", which forbids rewinding local ops history.
    let pushed = false;
    let outboxBoundary = false;
    try {
      await assertCoordinationCheckout(repoRoot, runGit);
      await assertCleanIndex(repoRoot, runGit);
      const dirty = splitZ(await runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
      if (dirty.length > 0) throw new PreparedCoordinationCommitError(`working tree has ${dirty.length} changed entr${dirty.length === 1 ? 'y' : 'ies'}`);
      const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
      if (head !== expectedCommit) throw new PreparedCoordinationCommitError('local ops HEAD is not the prepared commit');
      const actualPaths = splitZ(await runGit(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', expectedCommit]))
        .map(normalize).sort();
      if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new PreparedCoordinationCommitError('prepared commit changed an unexpected path set');
      }
      await options.validateCommit?.(expectedCommit);

      if ((options.publication ?? 'direct') === 'outbox') {
        options.assertAuthorized?.();
        // Recovery may publish the manifest before its final anchor update. From this point onward the
        // prepared commit must remain reachable at HEAD so restart can finish; it is never rolled back.
        outboxBoundary = true;
        try {
          await recoverUnspooledCoordinationCommits({
            repoRoot,
            spoolRoot: options.outboxRoot ?? '/var/lib/kb/state/outbox',
            runGit,
            isCoordinationPath,
          });
        } catch (error) {
          throw new PublishedCoordinationCommitError(expectedCommit, error);
        }
        return expectedCommit;
      }

      for (let attempt = 0; attempt <= maxRetryPushes; attempt += 1) {
        await runGit(repoRoot, ['fetch', 'origin', 'ops']);
        options.assertAuthorized?.();
        const remote = (await runGit(repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
        if (await isAncestor(runGit, repoRoot, reconciliationCommit, remote)) {
          return reconciliationCommit; // push completed earlier (including a lost transport response)
        }

        let rebased = false;
        if (!(await isAncestor(runGit, repoRoot, remote, reconciliationCommit))) {
          // An unrelated coordination writer advanced ops after our local commit. Rebase the one exact
          // bounded commit, then revalidate its path set. On conflict, abort so restart never inherits a
          // half-open rebase.
          try {
            await runGit(repoRoot, ['rebase', remote]);
            options.assertAuthorized?.();
          } catch (error) {
            try { await runGit(repoRoot, ['rebase', '--abort']); } catch { /* preserve the rebase error */ }
            throw error;
          }
          reconciliationCommit = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
          const rebasedPaths = splitZ(await runGit(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', reconciliationCommit]))
            .map(normalize).sort();
          if (JSON.stringify(rebasedPaths) !== JSON.stringify(expectedPaths)) {
            throw new PreparedCoordinationCommitError('rebased commit changed an unexpected path set');
          }
          await options.validateCommit?.(reconciliationCommit);
          rebased = true;
        }
        const unpublished = (await runGit(repoRoot, ['rev-list', '--count', `${remote}..${reconciliationCommit}`])).trim();
        if (unpublished !== '1') {
          throw new PreparedCoordinationCommitError('prepared settlement is not the sole unpublished commit');
        }
        if (rebased) {
          const parent = (await runGit(repoRoot, ['rev-parse', `${reconciliationCommit}^`])).trim();
          if (parent !== remote) throw new PreparedCoordinationCommitError('rebased settlement is not exactly one commit atop origin/ops');
        }
        try {
          await runGit(repoRoot, [
            'push', 'origin', `${reconciliationCommit}:refs/heads/ops`,
            `--force-with-lease=refs/heads/ops:${remote}`,
          ]);
        } catch (error) {
          // Deliberately no authorization re-check here: the next attempt re-proves it at the top of
          // the loop before any further git action, so a transient re-check can neither mask the push
          // failure nor escape the bounded retry by throwing out of this handler.
          if (attempt === maxRetryPushes) throw error;
          continue;
        }
        pushed = true;

        // Past this line the remote has accepted our objects. Do not trust a successful process exit
        // alone — fetch and prove the exact object is reachable from the canonical remote ref — but a
        // failure of that proof means UNKNOWN, not refused, so it is raised as the published class.
        let reachable: boolean;
        try {
          options.assertAuthorized?.();
          await runGit(repoRoot, ['fetch', 'origin', 'ops']);
          options.assertAuthorized?.();
          const published = (await runGit(repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
          reachable = await isAncestor(runGit, repoRoot, reconciliationCommit, published);
        } catch (error) {
          throw new PublishedCoordinationCommitError(reconciliationCommit, error);
        }
        if (reachable) return reconciliationCommit;
        if (attempt === maxRetryPushes) {
          throw new PreparedCoordinationCommitError('prepared commit was not reachable on origin/ops after push');
        }
      }
      throw new PreparedCoordinationCommitError('prepared commit was not observed on origin/ops');
    } catch (error) {
      // A refusal must never strand local ops history for the next writer to push blind — but once a
      // push has exited 0 the remote may already hold the commit, so nothing is ever rewound.
      if (!pushed && !outboxBoundary) {
        await rollbackUnpublishedPreparedCommit(repoRoot, runGit, reconciliationCommit, expectedPaths);
      }
      throw error;
    }
  });
}

export async function routeCoordination(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<void> {
  const runGit = options.runGit ?? defaultGitRunner;
  // One span: prepare and commit must not interleave with any other ops transaction.
  return withOpsTransaction(async () => {
    await prepareCoordination(repoRoot, runGit, options.publication, options.outboxRoot);
    await commitPreparedCoordination(repoRoot, relpath, { ...options, runGit });
  });
}

/** Publisher-owned discovery of legacy Schedule marker candidates under coordination directories. */
export async function discoverLegacyScheduleMarkers(
  repoRoot: string,
  snapshot: ScheduleSnapshot,
): Promise<Array<{ marker: string; scheduleId: string; digest: string }>> {
  const root = resolve(repoRoot);
  const coordinationRoot = resolve(root, 'queue');
  let directories;
  try { directories = await readdir(coordinationRoot, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const markers: Array<{ marker: string; scheduleId: string; digest: string }> = [];
  for (const directory of directories.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
    const directoryPath = resolve(coordinationRoot, directory.name);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('pause-marker-migration-invalid');
      const path = resolve(directoryPath, entry.name);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('pause-marker-migration-invalid');
      const candidates = HEARTBEAT_SEED_PATHS
        .map((heartbeatPath) => seedScheduleId(heartbeatPath, entry.name))
        .filter((id) => snapshot.schedules.some((schedule) => schedule.id === id));
      if (candidates.length === 0) continue;
      if (candidates.length !== 1) throw new Error('pause-marker-schedule-ambiguous');
      markers.push({
        marker: relative(root, path).replaceAll('\\', '/'),
        scheduleId: candidates[0],
        digest: createHash('sha256').update(await readFile(path)).digest('hex'),
      });
    }
  }
  return markers;
}

interface VerifiedScheduleMarkerRemovalOptions {
  /** Test seam; production uses the coordination publisher's prepare phase. */
  prepare?: (repoRoot: string) => Promise<void>;
  /** Test seam; production commits the exact removed coordination path. */
  commit?: (repoRoot: string, marker: string) => Promise<void>;
  /** Fault seam proving a crash after unlink is resumable. */
  afterUnlink?: () => Promise<void>;
}

/**
 * Publisher-owned retirement of an opaque legacy Schedule coordination marker. The open descriptor is
 * no-follow, the descriptor/path identity and digest are re-proved immediately before unlink, and an
 * already-missing path is the resumable state left by a crash between unlink and publication.
 */
export async function publishVerifiedScheduleMarkerRemoval(
  repoRoot: string,
  marker: string,
  expectedDigest: string,
  options: VerifiedScheduleMarkerRemovalOptions = {},
): Promise<void> {
  const normalized = normalize(marker);
  if (!isCoordinationPath(normalized) || normalized.split('/').includes('..')
    || !/^[0-9a-f]{64}$/.test(expectedDigest)) throw new Error('pause-marker-migration-invalid');
  const root = resolve(repoRoot);
  const absolute = resolve(root, ...normalized.split('/'));
  const bounded = relative(root, absolute);
  if (bounded === '' || bounded === '..' || bounded.startsWith('../') || bounded.startsWith('..\\')) {
    throw new Error('pause-marker-migration-invalid');
  }
  const prepare = options.prepare ?? (async (targetRoot) => prepareCoordination(targetRoot));
  const commit = options.commit ?? (async (targetRoot, targetMarker) =>
    commitPreparedCoordination(targetRoot, targetMarker));

  await withOpsTransaction(async () => {
    let pathStat;
    try {
      pathStat = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await commit(root, normalized);
        return;
      }
      throw error;
    }
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('pause-marker-migration-invalid');
    await prepare(root);
    let handle;
    try {
      handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      const bytes = await handle.readFile();
      const descriptorStat = await handle.stat();
      const immediateStat = await lstat(absolute);
      if (!immediateStat.isFile() || immediateStat.isSymbolicLink()
        || immediateStat.dev !== descriptorStat.dev || immediateStat.ino !== descriptorStat.ino) {
        throw new Error('pause-marker-migration-invalid');
      }
      if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
        throw new Error('pause-marker-digest-changed');
      }
      await unlink(absolute);
    } finally {
      await handle?.close();
    }
    await options.afterUnlink?.();
    await commit(root, normalized);
  });
}

/**
 * Classify `relpath` and route it via the matching branch rule. Returns the classification so the
 * caller (`governedSave.ts`) can report it. Throws whatever the underlying git/PR call throws — a
 * rejected/blocked commit (e.g. the `sync_skills` hook failing on drift) fails the save; it is never
 * caught-and-retried with `--no-verify`.
 */
export async function routeWrite(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<Target> {
  const target = classifyTarget(relpath);
  if (target === 'durable') {
    // The governed-save caller keeps its existing request key, prefixed by purpose (§3.2), and pins the
    // base commit its checkout is actually at. `withOpsTransaction` is reentrant: `routeDurable` joins.
    // Fail closed on a protected work branch BEFORE any git runs, exactly as before the manifest change.
    if (options.workBranch && isProtectedBranch(options.workBranch)) throw new ProtectedBranchError(options.workBranch);
    await routeDurable(repoRoot, buildGovernedSaveManifest({
      operationKey: options.message ?? relpath,
      // A governed save publishes whatever its work branch is at; it pins no attested base, so the
      // publisher's base-equality check is skipped for it (the two derived purposes always pin).
      baseCommit: UNPINNED_BASE_COMMIT,
      relpaths: [relpath],
    }), { ...options, message: options.message ?? defaultMessage(relpath) });
  } else {
    await routeCoordination(repoRoot, relpath, options);
  }
  return target;
}
