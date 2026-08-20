/**
 * U9 — the read-only model-audit route over an injected fixture log (Fastify `inject`, the
 * `contextLifecycle/routes.test.ts` idiom): the parse, the ordering, the honest missing-log answer,
 * and the GET-only surface.
 *
 * The fixture below is a REAL log: `__fixtures__/model-audit.jsonl` is written by the committed hooks
 * themselves, so this parser is pinned against the writer's actual output rather than against a
 * hand-written guess at it. `tests/test_model_verify.py::test_committed_route_fixture_matches_the_writer`
 * re-runs the hooks from the Python side and fails if the committed bytes have drifted; regenerate
 * with `REWRITE=1 py -3 -m pytest tests/test_model_verify.py -k route_fixture`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { parseAuditRows, registerModelAudit, resolveAuditPath } from './routes.ts';
import type { ModelAuditResponse } from './routes.ts';

const HOOK_WRITTEN_FIXTURE = fileURLToPath(new URL('./__fixtures__/model-audit.jsonl', import.meta.url));

const tmpDirs: string[] = [];
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function fixtureLog(contents?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modelaudit-routes-'));
  tmpDirs.push(root);
  const file = join(root, 'model-audit.jsonl');
  await writeFile(file, contents ?? readFileSync(HOOK_WRITTEN_FIXTURE, 'utf8'), 'utf8');
  return file;
}

async function appFor(auditPath: string) {
  const app = Fastify({ logger: false });
  registerModelAudit(app, auditPath);
  await app.ready();
  return app;
}

async function get(auditPath: string): Promise<{ status: number; body: ModelAuditResponse }> {
  const app = await appFor(auditPath);
  const res = await app.inject({ method: 'GET', url: '/api/model-audit' });
  await app.close();
  return { status: res.statusCode, body: res.json() as ModelAuditResponse };
}

describe('registerModelAudit', () => {
  it('parses the rows the committed hooks actually write', async () => {
    const { status, body } = await get(await fixtureLog());
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.totalRows).toBe(3);
    // Most recent first.
    expect(body.rows.map((r) => r.event)).toEqual(['SubagentStop', 'PreToolUse', 'PreToolUse']);
    const stop = body.rows[0];
    expect(stop.observed_model).toBe('claude-haiku-4-5');
    expect(stop.observed_models).toEqual(['claude-haiku-4-5']);
    expect(stop.requested_model).toBe('opus');
    expect(stop.verdict).toBe('mismatch');
    // The canonical dispatch tool name, as the hooks actually record it.
    expect(body.rows[1].tool).toBe('Agent');
    expect(body.rows[1].verdict).toBe('unknown');
    expect(body.rows[2].verdict).toBe('allowed');
  });

  it('reports the file mtime, because the rows deliberately carry no clock', async () => {
    const { body } = await get(await fixtureLog());
    expect(body.modifiedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(body.modifiedAt!))).toBe(false);
    // No row invents a timestamp — that is what makes the hooks byte-testable.
    for (const row of body.rows) {
      expect(Object.keys(row)).not.toContain('ts');
      expect(Object.keys(row)).not.toContain('timestamp');
    }
  });

  it('reports a missing log as unavailable rather than an error — the inert-hooks state', async () => {
    const { status, body } = await get(join(await mkdtemp(join(tmpdir(), 'modelaudit-none-')), 'nope.jsonl'));
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, modifiedAt: null, rows: [], totalRows: 0 });
  });

  it('reports a directory in the log path as unavailable rather than crashing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelaudit-dir-'));
    tmpDirs.push(root);
    await mkdir(join(root, 'model-audit.jsonl'));
    const { status, body } = await get(join(root, 'model-audit.jsonl'));
    expect(status).toBe(200);
    expect(body.available).toBe(false);
  });

  it('skips a torn trailing line instead of failing the whole read', async () => {
    const { body } = await get(await fixtureLog('{"event":"PreToolUse","verdict":"allowed"}\n{"event":"Pre'));
    expect(body.available).toBe(true);
    expect(body.totalRows).toBe(1);
    expect(body.rows[0].verdict).toBe('allowed');
  });

  it('ignores blank lines and non-object rows', async () => {
    const { body } = await get(await fixtureLog('\n{"event":"PreToolUse"}\n\n[1,2]\n"a string"\n'));
    expect(body.totalRows).toBe(1);
  });

  it('caps the rows it ships while still reporting the true total', async () => {
    const many = Array.from({ length: 620 }, (_, i) => JSON.stringify({ event: 'PreToolUse', description: `d${i}` }));
    const { body } = await get(await fixtureLog(many.join('\n')));
    expect(body.totalRows).toBe(620);
    expect(body.rows).toHaveLength(500);
    // The cap keeps the NEWEST rows — a truncated tail would hide the run in progress.
    expect(body.rows[0].description).toBe('d619');
  });

  it('exposes GET only — there is no write surface on an audit log', async () => {
    const app = await appFor(await fixtureLog());
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/model-audit' });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  it('resolves the default path beside the context stores, and honours both env overrides', () => {
    expect(resolveAuditPath({ KB_MODEL_AUDIT_PATH: 'C:/custom/log.jsonl' } as NodeJS.ProcessEnv)).toBe(
      'C:/custom/log.jsonl',
    );
    expect(resolveAuditPath({ KB_CONTEXT_STORE_DIR: join('C:', 'store') } as NodeJS.ProcessEnv)).toBe(
      join('C:', 'store', 'model-audit.jsonl'),
    );
    expect(resolveAuditPath({ DASHBOARD_STATE_ROOT: '/var/lib/kb/state' } as NodeJS.ProcessEnv)).toBe(
      join('/var/lib/kb/state', 'context-lifecycle', 'model-audit.jsonl'),
    );
    expect(resolveAuditPath({ LOCALAPPDATA: join('C:', 'local') } as NodeJS.ProcessEnv)).toBe(
      join('C:', 'local', 'kb-context-lifecycle', 'model-audit.jsonl'),
    );
  });

  it('parseAuditRows is total — it never throws on arbitrary text', () => {
    expect(parseAuditRows('')).toEqual([]);
    expect(parseAuditRows('not json at all\n{{{')).toEqual([]);
    expect(parseAuditRows('{"a":1}\r\n{"b":2}\r\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
