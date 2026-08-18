/**
 * U6 — `GET /api/trace/:sessionId` over an injected fixture root (Fastify `inject`, the
 * `panels/routes.test.ts` idiom): the envelope shape, the nested-project-dir lookup, and the
 * path-safety rejections that keep a session id from reaching outside the configured root.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerTraceRead } from './routes.ts';

const REAL_SLICE = fileURLToPath(new URL('./__fixtures__/real-run-slice.jsonl', import.meta.url));

const tmpDirs: string[] = [];
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

/** A root holding `flat-session.jsonl` at the top level and the real slice one dir deeper. */
async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'trace-routes-'));
  tmpDirs.push(root);
  await writeFile(
    join(root, 'flat-session.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-18T10:00:00.000Z',
      message: { model: 'claude-opus-5', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] },
    }) + '\n',
    'utf8',
  );
  const nested = join(root, 'C--Users-someone-project');
  await mkdir(nested, { recursive: true });
  await copyFile(REAL_SLICE, join(nested, 'deep-session.jsonl'));
  return root;
}

async function appFor(root: string) {
  const app = Fastify({ logger: false });
  registerTraceRead(app, root);
  await app.ready();
  return app;
}

describe('registerTraceRead', () => {
  it('GET /api/trace/:sessionId returns the envelope for a session at the root', async () => {
    const app = await appFor(await fixtureRoot());
    const res = await app.inject({ method: 'GET', url: '/api/trace/flat-session' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; stepCount: number; steps: Array<Record<string, unknown>> };
    expect(body.sessionId).toBe('flat-session');
    expect(body.stepCount).toBe(1);
    expect(body.steps[0].name).toBe('Read');
    expect(body.steps[0]).not.toHaveProperty('input');
    await app.close();
  });

  it('finds a session one project-directory deep and reports its real steps', async () => {
    const app = await appFor(await fixtureRoot());
    const res = await app.inject({ method: 'GET', url: '/api/trace/deep-session' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; steps: Array<{ name: string; isError?: boolean }> };
    expect(body.sessionId).toBe('deep-session');
    expect(body.steps.map((s) => s.name)).toEqual(['Glob', 'Glob', 'Write']);
    expect(body.steps[2].isError).toBe(true);
    await app.close();
  });

  it('404s an unknown session id', async () => {
    const app = await appFor(await fixtureRoot());
    const res = await app.inject({ method: 'GET', url: '/api/trace/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('session-not-found');
    await app.close();
  });

  it('400s a traversal-shaped session id without touching the filesystem', async () => {
    const app = await appFor(await fixtureRoot());
    // Pinned to 400 EXACTLY. Fastify decodes the percent-escapes before the handler sees the param, so
    // each of these reaches the id guard and is refused there. Accepting 404 as well would let a decode
    // regression (an id that slips past the charset check and merely fails to resolve) pass unnoticed.
    for (const id of ['..%2F..%2Fetc%2Fpasswd', '.hidden', '%2Fetc%2Fpasswd', 'a%2Fb', '..%5C..%5Cwin.ini']) {
      const res = await app.inject({ method: 'GET', url: `/api/trace/${id}` });
      expect(res.statusCode, `id ${id}`).toBe(400);
      expect((res.json() as { error: string }).error).toBe('bad-session-id');
    }
    // A BARE `..` never reaches the handler at all: the router normalises `/api/trace/..` to `/api/`,
    // which matches no route. Pinned to 404 exactly for the same reason — so a change in either layer
    // (normalisation OR the id guard) reds this test instead of silently swapping which one refuses.
    const dotdot = await app.inject({ method: 'GET', url: '/api/trace/..' });
    expect(dotdot.statusCode).toBe(404);
    await app.close();
  });

  it('exposes GET only — no write verb is routed', async () => {
    const app = await appFor(await fixtureRoot());
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/trace/flat-session' });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});
