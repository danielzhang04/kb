import { mkdtempSync, mkdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  buildGradesHistory,
  GRADES_HISTORY_LIMIT,
  GRADES_HISTORY_MAX_SHARD_BYTES,
  GRADES_HISTORY_SHARD_LIMIT,
  registerGradesHistoryPanel,
  SAFE_AGENT_ID,
  selectGradesHistoryShards,
} from './gradesHistory.ts';

const readPaths = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      readPaths.push(String(args[0]));
      return actual.readFileSync(...args);
    },
  };
});

const HEADER = 'ts\tworker\tproject\ttask_type\ttier\tscore\tpass\trubric_version\tinspector_id\tcard_id';

function grade(overrides: Partial<Record<string, string>> = {}): string {
  const row = {
    ts: '2026-08-19T09:00:00+00:00', worker: 'codex-worker', project: 'kb-ops', task_type: 'dashboard',
    tier: 'T1', score: '93', pass: 'true', rubric_version: '1', inspector_id: 'inspector', card_id: 'task-c',
    ...overrides,
  };
  return [row.ts, row.worker, row.project, row.task_type, row.tier, row.score, row.pass, row.rubric_version, row.inspector_id, row.card_id].join('\t');
}

function repo(shards: string[][]): string {
  const root = mkdtempSync(join(tmpdir(), 'grades-history-'));
  const dir = join(root, 'ledgers', 'grades');
  mkdirSync(dir, { recursive: true });
  shards.forEach((rows, index) => writeFileSync(join(dir, `inspector-2026-08-${String(index + 1).padStart(2, '0')}.tsv`), `${HEADER}\n${rows.join('\n')}\n`));
  return root;
}

describe('grades history panel server projection', () => {
  it('maps only the selected identity, distinguishes eval evidence, and orders newest first', () => {
    const root = repo([[
      grade({ ts: '2026-08-18T08:00:00+00:00', card_id: 'older-task' }),
      grade({ ts: '2026-08-19T10:00:00+00:00', worker: 'eval-suite', task_type: 'eval:codex-worker:panel-smoke', card_id: 'panel-smoke', score: '100' }),
      grade({ ts: '2026-08-20T10:00:00+00:00', worker: 'eval-suite', task_type: 'eval:other-worker:panel-smoke', card_id: 'other' }),
      grade({ ts: '2026-08-21T10:00:00+00:00', worker: 'other-worker', card_id: 'other-task' }),
    ]]);

    expect(buildGradesHistory(root, 'codex-worker')).toEqual({
      label: 'grades-history',
      agent: 'codex-worker',
      skipped: 0,
      rows: [
        { date: '2026-08-19T10:00:00+00:00', grade: '100', passed: true, source: 'eval', cardId: 'panel-smoke' },
        { date: '2026-08-18T08:00:00+00:00', grade: '93', passed: true, source: 'task', cardId: 'older-task' },
      ],
    });
  });

  it('selects newest shard filename dates before opening content, then caps the candidate set', () => {
    const root = repo(Array.from({ length: GRADES_HISTORY_SHARD_LIMIT + 3 }, () => [grade()]));
    const dir = join(root, 'ledgers', 'grades');
    const names = Array.from({ length: GRADES_HISTORY_SHARD_LIMIT + 3 }, (_, index) => `inspector-2026-08-${String(index + 1).padStart(2, '0')}.tsv`);
    // Deliberately reverse mtime ordering: filenames, not mutable metadata, determine ledger recency.
    names.forEach((name, index) => utimesSync(join(dir, name), new Date(100_000 - index * 1_000), new Date(100_000 - index * 1_000)));

    const selected = selectGradesHistoryShards(root);
    expect(selected).toHaveLength(GRADES_HISTORY_SHARD_LIMIT);
    expect(selected.map((shard) => shard.name)).toEqual([...names].reverse().slice(0, GRADES_HISTORY_SHARD_LIMIT));
  });

  it('skips an oversized shard without reading it', () => {
    const root = repo([[grade({ card_id: 'bounded' })]]);
    const oversized = join(root, 'ledgers', 'grades', 'inspector-2026-08-02.tsv');
    writeFileSync(oversized, `${HEADER}\n${'x'.repeat(GRADES_HISTORY_MAX_SHARD_BYTES)}\n`);
    readPaths.length = 0;

    expect(buildGradesHistory(root, 'codex-worker').rows.map((row) => row.cardId)).toEqual(['bounded']);
    expect(readPaths).not.toContain(oversized);
  });

  it('rejects ragged rows instead of fabricating a grade record and reports them as skipped', () => {
    const root = repo([[
      grade({ card_id: 'valid' }),
      '2026-08-20T10:00:00+00:00\tcodex-worker',
    ]]);

    expect(buildGradesHistory(root, 'codex-worker')).toEqual({
      label: 'grades-history',
      agent: 'codex-worker',
      skipped: 1,
      rows: [{ date: '2026-08-19T09:00:00+00:00', grade: '93', passed: true, source: 'task', cardId: 'valid' }],
    });
  });

  it('rejects a shard whose header differs from the pinned grades-ledger schema', () => {
    const root = repo([]);
    writeFileSync(
      join(root, 'ledgers', 'grades', 'inspector-2026-08-01.tsv'),
      `${HEADER.replace('\tpass\t', '\tresult\t')}\n${grade({ card_id: 'wrong-schema' })}\n`,
    );

    expect(buildGradesHistory(root, 'codex-worker')).toEqual({
      label: 'grades-history', agent: 'codex-worker', rows: [], skipped: 0,
    });
  });

  it('stops scanning a shard once the response cap is filled', () => {
    const rows = Array.from({ length: GRADES_HISTORY_LIMIT }, (_, index) => grade({ card_id: `kept-${index}` }));
    // This ragged row is older than all returned rows. A whole-file scan would increment `skipped`.
    const root = repo([['2026-08-01T00:00:00+00:00\tcodex-worker', ...rows]]);

    const history = buildGradesHistory(root, 'codex-worker');
    expect(history.rows).toHaveLength(GRADES_HISTORY_LIMIT);
    expect(history.rows[0]?.cardId).toBe(`kept-${GRADES_HISTORY_LIMIT - 1}`);
    expect(history.skipped).toBe(0);
  });

  it('refuses a symlinked shard before it can read outside the grades ledger', () => {
    const root = repo([[grade({ card_id: 'trusted' })]]);
    const outside = mkdtempSync(join(tmpdir(), 'grades-history-outside-'));
    const target = join(outside, 'external.tsv');
    // Create a real external target first, then attempt the symlink. Some Windows hosts forbid it.
    writeFileSync(target, `${HEADER}\n${grade({ card_id: 'external' })}\n`);
    const link = join(root, 'ledgers', 'grades', 'linked-2026-08-20.tsv');
    try {
      symlinkSync(target, link, 'file');
    } catch {
      return;
    }

    expect(buildGradesHistory(root, 'codex-worker').rows.map((row) => row.cardId)).toEqual(['trusted']);
  });

  it('rejects unsafe or missing query ids and leaves the grade shard untouched', async () => {
    const root = repo([[grade()]]);
    const shard = join(root, 'ledgers', 'grades', 'inspector-2026-08-01.tsv');
    const before = statSync(shard).mtimeMs;
    const app = Fastify({ logger: false });
    registerGradesHistoryPanel(app, root);
    await app.ready();
    try {
      expect((await app.inject({ method: 'GET', url: '/api/panels/grades-history?agent=codex-worker' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/panels/grades-history?agent=../../ledgers' })).json()).toEqual({ error: 'invalid-agent' });
      expect((await app.inject({ method: 'GET', url: '/api/panels/grades-history' })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
    expect(statSync(shard).mtimeMs).toBe(before);
    expect(SAFE_AGENT_ID.test('codex-worker')).toBe(true);
    expect(SAFE_AGENT_ID.test('codex_worker')).toBe(false);
  });
});
