import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { renameWithRetrySync } from '../atomicRename.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import {
  PublishedCoordinationCommitError,
  createPreparedCoordinationCommit,
  defaultGitRunner,
  publishPreparedCoordinationCommit,
  type GitRunner,
} from '../write/branch.ts';
import { assertFleetRunnable, type PreambleRunner } from '../write/preambleGate.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import { createAtomicJsonDocument, type AtomicJsonDocument } from './atomicJsonDocument.ts';

const RECEIPT_SCHEMA_VERSION = 1;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA1_RE = /^[a-f0-9]{40}$/;
const SAFE_SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EXACT_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const COST_HEADER = ['billing', 'card_id', 'model', 'usd'] as const;

export interface FleetLedgerRow {
  readonly cardId: string;
  readonly model: string;
  readonly costUsdMicros: number;
}

export interface LedgerSettlementInput {
  readonly subject: string;
  readonly runRef: string;
  readonly rows: readonly FleetLedgerRow[];
}

export interface PreparedFleetLedgerSettlement {
  readonly receiptKey: string;
  readonly input: LedgerSettlementInput;
}

type ReceiptPhase = 'intent' | 'rows-appended' | 'committed' | 'publication-uncertain' | 'completed';

interface FleetLedgerReceipt {
  receiptKey: string;
  input: LedgerSettlementInput;
  day: string;
  shardPath: string;
  sidecarPath: string;
  postimage: string | null;
  phase: ReceiptPhase;
  commit: string | null;
}

interface FleetLedgerReceiptDocument {
  schemaVersion: 1;
  receipts: Record<string, FleetLedgerReceipt>;
  runs: Record<string, string>;
}

export class FleetLedgerReceiptError extends Error {}

function canonicalInput(input: LedgerSettlementInput): string {
  return JSON.stringify(input);
}

function runIdentity(input: LedgerSettlementInput): string {
  return createHash('sha256').update(JSON.stringify({ subject: input.subject, runRef: input.runRef })).digest('hex');
}

function assertText(value: unknown, label: string, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new FleetLedgerReceiptError(`${label} is invalid`);
  }
}

function isExactDay(value: unknown): value is string {
  if (typeof value !== 'string' || !EXACT_DAY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeInput(input: LedgerSettlementInput): LedgerSettlementInput {
  if (!SAFE_SUBJECT_RE.test(input.subject) || input.subject.includes('--fleet-')) {
    throw new FleetLedgerReceiptError('fleet ledger subject is invalid');
  }
  assertText(input.runRef, 'fleet ledger run reference', 256);
  if (!Array.isArray(input.rows)) throw new FleetLedgerReceiptError('fleet ledger rows are invalid');
  const rows = input.rows.map((row) => {
    assertText(row.cardId, 'fleet ledger card identity', 512);
    assertText(row.model, 'fleet ledger model', 256);
    if (!Number.isSafeInteger(row.costUsdMicros) || row.costUsdMicros < 0) {
      throw new FleetLedgerReceiptError('fleet ledger cost is invalid');
    }
    return Object.freeze({ cardId: row.cardId, model: row.model, costUsdMicros: row.costUsdMicros });
  }).sort((left, right) => left.cardId.localeCompare(right.cardId)
    || left.model.localeCompare(right.model)
    || left.costUsdMicros - right.costUsdMicros);
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.cardId === rows[index]!.cardId) {
      throw new FleetLedgerReceiptError('fleet ledger row identity is duplicated');
    }
  }
  return Object.freeze({ subject: input.subject, runRef: input.runRef, rows: Object.freeze(rows) });
}

/** Pure, synchronous identity preparation. It reads neither time nor persistence. */
export function prepareFleetLedgerSettlement(input: LedgerSettlementInput): PreparedFleetLedgerSettlement {
  const normalized = normalizeInput(input);
  const receiptKey = createHash('sha256').update(canonicalInput(normalized)).digest('hex');
  return Object.freeze({ receiptKey, input: normalized });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function assertReceiptDocument(value: unknown): asserts value is FleetLedgerReceiptDocument {
  if (!value || typeof value !== 'object') throw new FleetLedgerReceiptError('fleet ledger receipt document is invalid');
  const doc = value as Record<string, unknown>;
  if (!hasExactKeys(doc, ['schemaVersion', 'receipts', 'runs']) || doc.schemaVersion !== RECEIPT_SCHEMA_VERSION
    || !doc.receipts || typeof doc.receipts !== 'object' || Array.isArray(doc.receipts)
    || !doc.runs || typeof doc.runs !== 'object' || Array.isArray(doc.runs)) {
    throw new FleetLedgerReceiptError('fleet ledger receipt document is invalid');
  }
  const expectedRuns = new Map<string, string>();
  for (const [key, raw] of Object.entries(doc.receipts as Record<string, unknown>)) {
    if (!SHA256_RE.test(key) || !raw || typeof raw !== 'object') throw new FleetLedgerReceiptError('fleet ledger receipt is invalid');
    const receipt = raw as Record<string, unknown>;
    if (!hasExactKeys(receipt, ['receiptKey', 'input', 'day', 'shardPath', 'sidecarPath', 'postimage', 'phase', 'commit'])
      || receipt.receiptKey !== key || !isExactDay(receipt.day)
      || typeof receipt.shardPath !== 'string' || typeof receipt.sidecarPath !== 'string'
      || (receipt.postimage !== null && (typeof receipt.postimage !== 'string' || !SHA256_RE.test(receipt.postimage)))
      || !['intent', 'rows-appended', 'committed', 'publication-uncertain', 'completed'].includes(String(receipt.phase))
      || (receipt.commit !== null && (typeof receipt.commit !== 'string' || !SHA1_RE.test(receipt.commit)))) {
      throw new FleetLedgerReceiptError('fleet ledger receipt is invalid');
    }
    const prepared = prepareFleetLedgerSettlement(receipt.input as LedgerSettlementInput);
    if (prepared.receiptKey !== key || canonicalInput(prepared.input) !== canonicalInput(receipt.input as LedgerSettlementInput)) {
      throw new FleetLedgerReceiptError('fleet ledger receipt input is invalid');
    }
    const paths = receiptPaths(prepared.input, key, receipt.day as string);
    if (receipt.shardPath !== paths.shardPath || receipt.sidecarPath !== paths.sidecarPath) {
      throw new FleetLedgerReceiptError('fleet ledger receipt paths are invalid');
    }
    const phase = receipt.phase as ReceiptPhase;
    const hasPostimage = typeof receipt.postimage === 'string';
    const hasCommit = typeof receipt.commit === 'string';
    if ((phase === 'intent' && (hasPostimage || hasCommit))
      || (phase === 'rows-appended' && (!hasPostimage || hasCommit))
      || (['committed', 'publication-uncertain', 'completed'].includes(phase) && (!hasPostimage || !hasCommit))) {
      throw new FleetLedgerReceiptError('fleet ledger receipt phase is invalid');
    }
    const identity = runIdentity(prepared.input);
    if (expectedRuns.has(identity)) throw new FleetLedgerReceiptError('fleet ledger run index is ambiguous');
    expectedRuns.set(identity, key);
  }
  for (const [identity, key] of Object.entries(doc.runs as Record<string, unknown>)) {
    if (!SHA256_RE.test(identity) || typeof key !== 'string' || expectedRuns.get(identity) !== key) {
      throw new FleetLedgerReceiptError('fleet ledger run index is invalid');
    }
  }
  if (Object.keys(doc.runs as object).length !== expectedRuns.size) {
    throw new FleetLedgerReceiptError('fleet ledger run index is incomplete');
  }
}

export class FleetLedgerReceiptStore {
  readonly document: AtomicJsonDocument<FleetLedgerReceiptDocument>;
  constructor(stateRoot: string) {
    this.document = createAtomicJsonDocument({
      path: join(stateRoot, 'control', 'fleet-ledger-receipts.json'),
      empty: () => ({ schemaVersion: RECEIPT_SCHEMA_VERSION, receipts: {}, runs: {} }),
      validate: assertReceiptDocument,
      error: (message) => new FleetLedgerReceiptError(message),
      maxBytes: MAX_RECEIPT_BYTES,
    });
  }
  read(receiptKey: string): Readonly<FleetLedgerReceipt> | null {
    const receipt = this.document.read().receipts[receiptKey];
    return receipt ? structuredClone(receipt) : null;
  }
}

export function createFleetLedgerReceiptStore(options: { stateRoot: string }): FleetLedgerReceiptStore {
  return new FleetLedgerReceiptStore(options.stateRoot);
}

export interface FleetLedgerEffectRow {
  subject: string;
  cardId: string;
  model: string;
  usd: number;
  day: string;
}

export interface FleetLedgerReceiptDeps {
  receipts: FleetLedgerReceiptStore;
  repoRoot: string;
  appendRow: (row: FleetLedgerEffectRow) => string;
  runPreamble?: PreambleRunner;
  runGit?: GitRunner;
  publication?: CoordinationPublication;
  outboxRoot?: string;
  now?: () => Date;
  createCommit?: typeof createPreparedCoordinationCommit;
  publishCommit?: typeof publishPreparedCoordinationCommit;
}

function exactDay(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function receiptPaths(input: LedgerSettlementInput, key: string, day: string): { shardPath: string; sidecarPath: string } {
  return {
    shardPath: `ledgers/cost/${input.subject}--fleet-${key}-${day}.tsv`,
    sidecarPath: `ledgers/fleet-receipts/${key}.json`,
  };
}

function sidecarBytes(receipt: FleetLedgerReceipt): string {
  return `${JSON.stringify({
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptKey: receipt.receiptKey,
    input: receipt.input,
    day: receipt.day,
    paths: [receipt.shardPath, receipt.sidecarPath],
    postimage: receipt.postimage,
  })}\n`;
}

function writeAtomic(path: string, bytes: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameWithRetrySync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function parseTsvLine(line: string): string[] | null {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote) {
      if (char !== '\t') return null;
      cells.push(cell);
      cell = '';
      closedQuote = false;
    } else if (char === '\t') {
      cells.push(cell);
      cell = '';
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === '"') return null;
    else cell += char;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells;
}

function inspectShard(repoRoot: string, receipt: FleetLedgerReceipt): { kind: 'prefix'; count: number } | { kind: 'drift' } {
  const path = join(repoRoot, ...receipt.shardPath.split('/'));
  if (!existsSync(path) || statSync(path).size === 0) return { kind: 'prefix', count: 0 };
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== COST_HEADER.join('\t')) return { kind: 'drift' };
  const rows = lines.slice(1);
  if (rows.length > receipt.input.rows.length) return { kind: 'drift' };
  for (let index = 0; index < rows.length; index += 1) {
    const expected = receipt.input.rows[index]!;
    const cells = parseTsvLine(rows[index]!);
    if (!cells || cells.length !== 4 || cells[0] !== 'subscription' || cells[1] !== expected.cardId
      || cells[2] !== expected.model || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(cells[3]!)
      || Number(cells[3]) !== expected.costUsdMicros / 1_000_000) {
      return { kind: 'drift' };
    }
  }
  return { kind: 'prefix', count: rows.length };
}

async function checkoutState(repoRoot: string, runGit: GitRunner): Promise<{ clean: boolean; paths: string[]; head: string | null }> {
  const dirty = await runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const paths = dirty.split('\0').filter(Boolean).map((entry) => entry.slice(3).replace(/\\/g, '/')).sort();
  return { clean: dirty.length === 0, paths, head: SHA1_RE.test(head) ? head : null };
}

async function proveCommit(repoRoot: string, runGit: GitRunner, receipt: FleetLedgerReceipt, commit: string): Promise<boolean> {
  if (!SHA1_RE.test(commit) || !receipt.postimage) return false;
  try {
    const parents = (await runGit(repoRoot, ['rev-list', '--parents', '-n', '1', commit])).trim().split(/\s+/);
    if (parents.length !== 2 || parents[0] !== commit) return false;
    const changed = (await runGit(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]))
      .split('\0').filter(Boolean).map((path) => path.replace(/\\/g, '/')).sort();
    const expectedPaths = [receipt.shardPath, receipt.sidecarPath].sort();
    if (JSON.stringify(changed) !== JSON.stringify(expectedPaths)) return false;
    const shard = await runGit(repoRoot, ['show', `${commit}:${receipt.shardPath}`]);
    const sidecar = await runGit(repoRoot, ['show', `${commit}:${receipt.sidecarPath}`]);
    return createHash('sha256').update(shard).digest('hex') === receipt.postimage
      && sidecar === sidecarBytes(receipt);
  } catch {
    return false;
  }
}

function matchingPrepared(receipt: FleetLedgerReceipt, prepared: PreparedFleetLedgerSettlement): boolean {
  return receipt.receiptKey === prepared.receiptKey && canonicalInput(receipt.input) === canonicalInput(prepared.input);
}

async function executeReceipt(
  deps: FleetLedgerReceiptDeps,
  prepared: PreparedFleetLedgerSettlement,
): Promise<'settled' | 'required'> {
  let verified: PreparedFleetLedgerSettlement;
  try {
    verified = prepareFleetLedgerSettlement(prepared.input);
  } catch {
    return 'required';
  }
  if (verified.receiptKey !== prepared.receiptKey || canonicalInput(verified.input) !== canonicalInput(prepared.input)) {
    return 'required';
  }
  prepared = verified;
  const preamble = assertFleetRunnable(deps.repoRoot, deps.runPreamble);
  if (!preamble.ok) return 'required';
  const runGit = deps.runGit ?? defaultGitRunner;
  const createCommit = deps.createCommit ?? createPreparedCoordinationCommit;
  const publishCommit = deps.publishCommit ?? publishPreparedCoordinationCommit;
  try {
    return await withOpsTransaction(() => deps.receipts.document.mutateCheckpointed(async (document, checkpoint) => {
      const identity = runIdentity(prepared.input);
      const indexed = document.runs[identity];
      if (indexed && indexed !== prepared.receiptKey) return 'required';
      let receipt = document.receipts[prepared.receiptKey];
      if (!receipt) {
        const day = exactDay((deps.now ?? (() => new Date()))());
        if (!isExactDay(day)) return 'required';
        const paths = receiptPaths(prepared.input, prepared.receiptKey, day);
        receipt = {
          receiptKey: prepared.receiptKey,
          input: prepared.input,
          day,
          ...paths,
          postimage: null,
          phase: 'intent',
          commit: null,
        };
        document.receipts[prepared.receiptKey] = receipt;
        document.runs[identity] = prepared.receiptKey;
        checkpoint();
      } else if (!matchingPrepared(receipt, prepared) || document.runs[identity] !== prepared.receiptKey) {
        return 'required';
      }

      if (receipt.phase === 'completed') {
        return receipt.commit && await proveCommit(deps.repoRoot, runGit, receipt, receipt.commit) ? 'settled' : 'required';
      }

      if (receipt.phase === 'intent') {
        const inspection = inspectShard(deps.repoRoot, receipt);
        if (inspection.kind === 'drift') return 'required';
        for (let index = inspection.count; index < receipt.input.rows.length; index += 1) {
          const row = receipt.input.rows[index]!;
          const path = deps.appendRow({
            subject: `${receipt.input.subject}--fleet-${receipt.receiptKey}`,
            cardId: row.cardId,
            model: row.model,
            usd: row.costUsdMicros / 1_000_000,
            day: receipt.day,
          }).replace(/\\/g, '/');
          if (path !== receipt.shardPath) return 'required';
        }
        const complete = inspectShard(deps.repoRoot, receipt);
        if (complete.kind === 'drift' || complete.count !== receipt.input.rows.length) return 'required';
        const shardBytes = readFileSync(join(deps.repoRoot, ...receipt.shardPath.split('/')));
        const postimage = createHash('sha256').update(shardBytes).digest('hex');
        const sidecarPath = join(deps.repoRoot, ...receipt.sidecarPath.split('/'));
        const expectedSidecar = sidecarBytes({ ...receipt, postimage });
        if (existsSync(sidecarPath)) {
          if (readFileSync(sidecarPath, 'utf8') !== expectedSidecar) return 'required';
        } else {
          writeAtomic(sidecarPath, expectedSidecar);
        }
        if (readFileSync(sidecarPath, 'utf8') !== expectedSidecar) return 'required';
        receipt.postimage = postimage;
        receipt.phase = 'rows-appended';
        checkpoint();
      }

      if (receipt.phase === 'rows-appended') {
        const checkout = await checkoutState(deps.repoRoot, runGit);
        if (!checkout.head) return 'required';
        if (checkout.clean) {
          if (!await proveCommit(deps.repoRoot, runGit, receipt, checkout.head)) return 'required';
          receipt.commit = checkout.head;
          receipt.phase = 'committed';
          checkpoint();
        } else {
          const ownedPaths = [receipt.shardPath, receipt.sidecarPath].sort();
          if (JSON.stringify(checkout.paths) !== JSON.stringify(ownedPaths)) return 'required';
          const commit = await createCommit(deps.repoRoot, [receipt.shardPath, receipt.sidecarPath], {
            runGit,
            message: `chore(ledgers): settle fleet cost rows for ${receipt.input.runRef}`,
          });
          if (!SHA1_RE.test(commit) || !await proveCommit(deps.repoRoot, runGit, receipt, commit)) return 'required';
          receipt.commit = commit;
          receipt.phase = 'committed';
          checkpoint();
        }
      }

      if (receipt.phase === 'committed' && receipt.commit) {
        const checkout = await checkoutState(deps.repoRoot, runGit);
        if (!checkout.clean || !checkout.head) return 'required';
        if (checkout.head !== receipt.commit) {
          if (!await proveCommit(deps.repoRoot, runGit, receipt, checkout.head)) return 'required';
          receipt.commit = checkout.head;
          checkpoint();
        }
      }

      if (receipt.phase === 'publication-uncertain') {
        const checkout = await checkoutState(deps.repoRoot, runGit);
        if (!checkout.clean || !checkout.head) return 'required';
      }

      if ((receipt.phase === 'committed' || receipt.phase === 'publication-uncertain') && receipt.commit) {
        try {
          const published = await publishCommit(deps.repoRoot, receipt.commit, {
            runGit,
            relpaths: [receipt.shardPath, receipt.sidecarPath],
            maxRetryPushes: 1,
            publication: deps.publication,
            outboxRoot: deps.outboxRoot,
            validateCommit: async (commit) => {
              if (!await proveCommit(deps.repoRoot, runGit, receipt!, commit)) {
                throw new FleetLedgerReceiptError('fleet ledger commit proof failed');
              }
              if (receipt!.commit !== commit) {
                receipt!.commit = commit;
                receipt!.phase = 'committed';
                checkpoint();
              }
            },
          });
          if (published !== receipt.commit || !await proveCommit(deps.repoRoot, runGit, receipt, published)) return 'required';
        } catch (error) {
          if (error instanceof PublishedCoordinationCommitError) {
            if (error.commit !== receipt.commit) throw error;
            receipt.phase = 'publication-uncertain';
            checkpoint();
          }
          throw error;
        }
        receipt.phase = 'completed';
        checkpoint();
        return 'settled';
      }
      return 'required';
    }));
  } catch {
    return 'required';
  }
}

export function beginFleetLedgerSettlement(
  deps: FleetLedgerReceiptDeps,
  prepared: PreparedFleetLedgerSettlement,
): Promise<'settled' | 'required'> {
  return executeReceipt(deps, prepared);
}

export function reconcileFleetLedgerReceipt(
  deps: FleetLedgerReceiptDeps,
  prepared: PreparedFleetLedgerSettlement,
): Promise<'settled' | 'required'> {
  return executeReceipt(deps, prepared);
}
