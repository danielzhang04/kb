import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitFleetCostRow } from './queueBridge.ts';
import {
  beginFleetLedgerSettlement,
  createFleetLedgerReceiptStore,
  prepareFleetLedgerSettlement,
  reconcileFleetLedgerReceipt,
  type FleetLedgerEffectRow,
  type FleetLedgerReceiptDeps,
} from './fleetLedgerReceipt.ts';
import {
  PublishedCoordinationCommitError,
  createPreparedCoordinationCommit,
  publishPreparedCoordinationCommit,
  type GitRunner,
} from '../write/branch.ts';

const roots: string[] = [];
const runnable = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const stopped = () => ({ exitCode: 2, stdout: 'PREAMBLE FAIL: STOP file present', stderr: '' });

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

function fixture(autocrlf = false): { repoRoot: string; stateRoot: string; runGit: GitRunner } {
  const repoRoot = temp('fleet-ledger-repo-');
  const stateRoot = temp('fleet-ledger-state-');
  const remote = temp('fleet-ledger-remote-');
  execFileSync('git', ['init', '--bare'], { cwd: remote, windowsHide: true });
  git(repoRoot, ['init', '-b', 'ops']);
  git(repoRoot, ['config', 'user.name', 'fixture']);
  git(repoRoot, ['config', 'user.email', 'fixture@example.invalid']);
  git(repoRoot, ['config', 'core.autocrlf', autocrlf ? 'true' : 'false']);
  writeFileSync(join(repoRoot, 'base.txt'), 'base\n');
  git(repoRoot, ['add', 'base.txt']);
  git(repoRoot, ['commit', '-m', 'base']);
  git(repoRoot, ['remote', 'add', 'origin', remote]);
  git(repoRoot, ['push', '-u', 'origin', 'ops']);
  return { repoRoot, stateRoot, runGit: git };
}

function directAppend(repoRoot: string): (row: FleetLedgerEffectRow) => string {
  return (row) => {
    const receiptKey = row.subject.slice(row.subject.lastIndexOf('--fleet-') + 8);
    const path = `ledgers/cost/${row.subject}-${row.day}.tsv`;
    const absolute = join(repoRoot, ...path.split('/'));
    mkdirSync(join(repoRoot, 'ledgers', 'cost'), { recursive: true });
    if (!readFileOrNull(absolute)) writeFileSync(absolute, 'billing\tcard_id\tmodel\tusd\n');
    const cell = (value: string | number): string => {
      const text = String(value);
      return /["\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    appendFileSync(absolute, ['subscription', row.cardId, row.model, row.usd].map(cell).join('\t') + '\n');
    expect(receiptKey).toMatch(/^[a-f0-9]{64}$/);
    return path;
  };
}

function readFileOrNull(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function prepared(runRef = 'run-1', costUsdMicros = 0) {
  return prepareFleetLedgerSettlement({
    subject: 'dashboard-engine',
    runRef,
    rows: [
      { cardId: 'wf-b', model: 'model-"quoted"', costUsdMicros: 1 },
      { cardId: 'wf-a', model: 'model-a', costUsdMicros },
    ],
  });
}

function oneRowPrepared(runRef: string, model: string, costUsdMicros: number) {
  return prepareFleetLedgerSettlement({
    subject: 'dashboard-engine',
    runRef,
    rows: [{ cardId: 'wf-a', model, costUsdMicros }],
  });
}

function shardPath(receiptKey: string): string {
  return `ledgers/cost/dashboard-engine--fleet-${receiptKey}-2026-09-08.tsv`;
}

function deps(options: ReturnType<typeof fixture>): FleetLedgerReceiptDeps {
  return {
    receipts: createFleetLedgerReceiptStore({ stateRoot: options.stateRoot }),
    repoRoot: options.repoRoot,
    runPreamble: runnable,
    runGit: options.runGit,
    now: () => new Date('2026-09-08T19:00:00Z'),
    appendRow: directAppend(options.repoRoot),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('fleet ledger receipt protocol', () => {
  it('prepares one deterministic sorted identity and refuses duplicate card identities', () => {
    const first = prepared();
    const second = prepareFleetLedgerSettlement({
      subject: first.input.subject,
      runRef: first.input.runRef,
      rows: [...first.input.rows].reverse(),
    });
    expect(second).toEqual(first);
    expect(() => prepareFleetLedgerSettlement({
      subject: 'dashboard-engine', runRef: 'run', rows: [
        { cardId: 'same', model: 'a', costUsdMicros: 0 },
        { cardId: 'same', model: 'b', costUsdMicros: 0 },
      ],
    })).toThrow('row identity is duplicated');
  });

  it('uses the real emitFleetCostRow -> ledger.py seam and settles a quoted model plus Python float spellings', async () => {
    const options = fixture(true);
    const store = createFleetLedgerReceiptStore({ stateRoot: options.stateRoot });
    const input = prepared();
    const result = await beginFleetLedgerSettlement({
      ...deps(options),
      receipts: store,
      appendRow: (row) => emitFleetCostRow({ repoRoot: options.repoRoot }, row),
    }, input);
    expect(result).toBe('settled');
    const receipt = store.read(input.receiptKey)!;
    expect(receipt.phase).toBe('completed');
    expect(readFileSync(join(options.repoRoot, ...receipt.shardPath.split('/')), 'utf8')).toContain('1e-06');
    expect(await beginFleetLedgerSettlement({ ...deps(options), receipts: store }, input)).toBe('settled');
    expect(readFileSync(join(options.repoRoot, ...receipt.shardPath.split('/')), 'utf8').split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  });

  it('checkpoints intent before append and reconciles only a landed row prefix', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-prefix');
    const append = directAppend(options.repoRoot);
    let calls = 0;
    d.appendRow = (row) => {
      const path = append(row);
      calls += 1;
      if (calls === 1) throw undefined;
      return path;
    };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    expect(d.receipts.read(input.receiptKey)?.phase).toBe('intent');
    d.appendRow = append;
    expect(await reconcileFleetLedgerReceipt(d, input)).toBe('settled');
    expect(calls).toBe(1);
  });

  it('returns required for a malformed shard tail without append, commit, or publication', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-drift');
    const append = directAppend(options.repoRoot);
    d.appendRow = (row) => { const path = append(row); appendFileSync(join(options.repoRoot, ...path.split('/')), 'extra\trow\n'); throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    const createCommit = vi.fn(createPreparedCoordinationCommit);
    const publishCommit = vi.fn(publishPreparedCoordinationCommit);
    expect(await reconcileFleetLedgerReceipt({ ...d, appendRow: vi.fn(), createCommit, publishCommit }, input)).toBe('required');
    expect(createCommit).not.toHaveBeenCalled();
    expect(publishCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['a quoted field with bytes after its closing quote', 'run-malformed-quote', 'foobar', 0, 'subscription\twf-a\t"foo"bar\t0\n'],
    ['a hexadecimal zero cost', 'run-hex-cost', 'model-a', 0, 'subscription\twf-a\tmodel-a\t0x0\n'],
  ])('rejects %s before append, commit, or publication', async (_label, runRef, model, costUsdMicros, malformedRow) => {
    const options = fixture();
    const d = deps(options);
    const input = oneRowPrepared(runRef, model, costUsdMicros);
    const relative = shardPath(input.receiptKey);
    mkdirSync(join(options.repoRoot, 'ledgers', 'cost'), { recursive: true });
    writeFileSync(join(options.repoRoot, ...relative.split('/')), `billing\tcard_id\tmodel\tusd\n${malformedRow}`);
    const appendRow = vi.fn();
    const createCommit = vi.fn(createPreparedCoordinationCommit);
    const publishCommit = vi.fn(publishPreparedCoordinationCommit);
    expect(await beginFleetLedgerSettlement({ ...d, appendRow, createCommit, publishCommit }, input)).toBe('required');
    expect(appendRow).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(publishCommit).not.toHaveBeenCalled();
    expect(d.receipts.read(input.receiptKey)).toMatchObject({ phase: 'intent', postimage: null });
  });

  it('keeps intent readable when an existing sidecar conflicts, then settles after sidecar repair without another append', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-sidecar-conflict');
    const append = directAppend(options.repoRoot);
    let appendCount = 0;
    d.appendRow = (row) => {
      const path = append(row);
      appendCount += 1;
      if (appendCount === input.input.rows.length) {
        const sidecar = join(options.repoRoot, 'ledgers', 'fleet-receipts', `${input.receiptKey}.json`);
        mkdirSync(join(options.repoRoot, 'ledgers', 'fleet-receipts'), { recursive: true });
        writeFileSync(sidecar, '{"drift":true}\n');
      }
      return path;
    };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    expect(d.receipts.read(input.receiptKey)).toMatchObject({ phase: 'intent', postimage: null });
    rmSync(join(options.repoRoot, 'ledgers', 'fleet-receipts', `${input.receiptKey}.json`));
    d.appendRow = (row) => { appendCount += 1; return append(row); };
    expect(await reconcileFleetLedgerReceipt(d, input)).toBe('settled');
    expect(appendCount).toBe(input.input.rows.length);
  });

  it('fails closed when one subject/run is presented with a different immutable snapshot', async () => {
    const options = fixture();
    const d = deps(options);
    const first = prepared('run-conflict');
    d.appendRow = () => { throw undefined; };
    expect(await beginFleetLedgerSettlement(d, first)).toBe('required');
    const conflict = prepared('run-conflict', 9);
    const appendRow = vi.fn();
    expect(await beginFleetLedgerSettlement({ ...d, appendRow }, conflict)).toBe('required');
    expect(appendRow).not.toHaveBeenCalled();
  });

  it('runs the preamble before receipt lookup and leaves an existing receipt unchanged when stopped', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-stopped');
    d.appendRow = () => { throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    const before = d.receipts.read(input.receiptKey);
    const appendRow = vi.fn();
    const runGit = vi.fn(options.runGit);
    expect(await reconcileFleetLedgerReceipt({ ...d, runPreamble: stopped, appendRow, runGit }, input)).toBe('required');
    expect(d.receipts.read(input.receiptKey)).toEqual(before);
    expect(appendRow).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
  });

  it('treats an after-landed falsey intent checkpoint failure as required and issues no later effect', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-checkpoint-throw');
    const original = d.receipts.document.mutateCheckpointed.bind(d.receipts.document);
    let first = true;
    d.receipts.document.mutateCheckpointed = (callback) => original((document, checkpoint) => callback(document, () => {
      checkpoint();
      if (first) { first = false; throw undefined; }
    }));
    const appendRow = vi.fn(d.appendRow);
    expect(await beginFleetLedgerSettlement({ ...d, appendRow }, input)).toBe('required');
    expect(appendRow).not.toHaveBeenCalled();
    expect(d.receipts.read(input.receiptKey)?.phase).toBe('intent');
    d.receipts.document.mutateCheckpointed = original;
    expect(await reconcileFleetLedgerReceipt(d, input)).toBe('settled');
  });

  it('fails closed on a poisoned durable path before append or Git', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-poisoned-document');
    d.appendRow = () => { throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    const statePath = join(options.stateRoot, 'control', 'fleet-ledger-receipts.json');
    const document = JSON.parse(readFileSync(statePath, 'utf8'));
    document.receipts[input.receiptKey].shardPath = '../../outside.tsv';
    writeFileSync(statePath, `${JSON.stringify(document)}\n`);
    const appendRow = vi.fn();
    const runGit = vi.fn(options.runGit);
    const reopened = createFleetLedgerReceiptStore({ stateRoot: options.stateRoot });
    expect(await reconcileFleetLedgerReceipt({ ...d, receipts: reopened, appendRow, runGit }, input)).toBe('required');
    expect(appendRow).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
  });

  it('fails closed when the durable receipt document exceeds its bound', () => {
    const stateRoot = temp('fleet-ledger-oversize-');
    const path = join(stateRoot, 'control', 'fleet-ledger-receipts.json');
    mkdirSync(join(stateRoot, 'control'), { recursive: true });
    writeFileSync(path, 'x'.repeat(4 * 1024 * 1024 + 1));
    expect(() => createFleetLedgerReceiptStore({ stateRoot }).read('a'.repeat(64))).toThrow('exceeds its limit');
  });

  it('serializes two store instances that share one state root', async () => {
    const options = fixture();
    const first = createFleetLedgerReceiptStore({ stateRoot: options.stateRoot });
    const second = createFleetLedgerReceiptStore({ stateRoot: options.stateRoot });
    let release!: () => void;
    const held = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    let entered = false;
    const holding = first.document.mutateCheckpointed(async (_document, checkpoint) => {
      checkpoint();
      await held;
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    const waiting = second.document.mutate(() => { entered = true; });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(entered).toBe(false);
    release();
    await Promise.all([holding, waiting]);
    expect(entered).toBe(true);
  });

  it('adopts a proven local commit when commit creation landed before its receipt checkpoint', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-landed-commit');
    d.createCommit = async (...args) => { await createPreparedCoordinationCommit(...args); throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    expect(d.receipts.read(input.receiptKey)?.phase).toBe('rows-appended');
    const createCommit = vi.fn(createPreparedCoordinationCommit);
    expect(await reconcileFleetLedgerReceipt({ ...d, createCommit }, input)).toBe('settled');
    expect(createCommit).not.toHaveBeenCalled();
  });

  it('requires manual reconciliation for a clean mismatching candidate and creates no replacement commit', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-bad-candidate');
    d.createCommit = async (...args) => { await createPreparedCoordinationCommit(...args); throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    const sidecar = d.receipts.read(input.receiptKey)!.sidecarPath;
    writeFileSync(join(options.repoRoot, ...sidecar.split('/')), 'changed\n');
    git(options.repoRoot, ['add', sidecar]);
    git(options.repoRoot, ['commit', '-m', 'mutate candidate']);
    const createCommit = vi.fn(createPreparedCoordinationCommit);
    const publishCommit = vi.fn(publishPreparedCoordinationCommit);
    expect(await reconcileFleetLedgerReceipt({ ...d, createCommit, publishCommit }, input)).toBe('required');
    expect(createCommit).not.toHaveBeenCalled();
    expect(publishCommit).not.toHaveBeenCalled();
  });

  it('adopts only an exact clean replacement HEAD and checkpoints it before a later publisher call', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-rebased-head');
    let replacement = '';
    d.publishCommit = async (repoRoot) => {
      const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']).trim();
      const parent = git(repoRoot, ['rev-parse', 'HEAD^']).trim();
      replacement = execFileSync('git', ['commit-tree', tree, '-p', parent, '-m', 'rebased candidate'], { cwd: repoRoot, input: '', encoding: 'utf8' }).trim();
      git(repoRoot, ['reset', '--hard', replacement]);
      throw undefined;
    };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    expect(d.receipts.read(input.receiptKey)?.commit).not.toBe(replacement);
    let observed = '';
    const publishCommit: typeof publishPreparedCoordinationCommit = async (_root, commit) => { observed = d.receipts.read(input.receiptKey)!.commit!; return commit; };
    expect(await reconcileFleetLedgerReceipt({ ...d, publishCommit }, input)).toBe('settled');
    expect(observed).toBe(replacement);
  });

  it('refuses publication from committed state while the checkout is dirty', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-dirty');
    d.publishCommit = async () => { throw undefined; };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    writeFileSync(join(options.repoRoot, 'unrelated.txt'), 'dirty\n');
    const publishCommit = vi.fn(publishPreparedCoordinationCommit);
    expect(await reconcileFleetLedgerReceipt({ ...d, publishCommit }, input)).toBe('required');
    expect(publishCommit).not.toHaveBeenCalled();
  });

  it('never replaces the checkpointed commit with an unproven SHA from a publication error', async () => {
    const options = fixture();
    const d = deps(options);
    const input = prepared('run-wrong-publication-sha');
    d.publishCommit = async (_root, commit) => {
      throw new PublishedCoordinationCommitError(commit === 'b'.repeat(40) ? 'c'.repeat(40) : 'b'.repeat(40), undefined);
    };
    expect(await beginFleetLedgerSettlement(d, input)).toBe('required');
    const receipt = d.receipts.read(input.receiptKey)!;
    expect(receipt.phase).toBe('committed');
    expect(receipt.commit).not.toBe('b'.repeat(40));
    expect(receipt.commit).not.toBe('c'.repeat(40));
  });
});
