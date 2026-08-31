import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerBrainSearch, type RunBrainQuery } from './routes.ts';

// Hoisted so the vi.mock factory below (which runs before this file's other imports are
// evaluated) can safely reference it. It stands in for the promisified call that
// `defaultRunQuery` actually makes — real `child_process.execFile` carries a
// `util.promisify.custom` implementation (resolving to `{ stdout, stderr }`), which is what
// makes `promisify(execFile)` usable at all; this mock reproduces exactly that so the real
// (non-stubbed) argv-construction code path runs end to end.
const mockExecFile = vi.hoisted(() =>
  vi.fn((_file: string, _args: readonly string[], _options: unknown) =>
    Promise.resolve({ stdout: JSON.stringify({ query: 'ignored', k: 3, results: [] }), stderr: '' })),
);

vi.mock('node:child_process', () => {
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
  const execFile = () => {
    throw new Error('this mock only supports the promisified call path');
  };
  Object.defineProperty(execFile, promisifyCustom, {
    value: (file: string, args: readonly string[], options: unknown) => mockExecFile(file, args, options),
  });
  return { execFile };
});

async function appFor(runQuery: RunBrainQuery) {
  const app = Fastify({ logger: false });
  registerBrainSearch(app, { runQuery });
  await app.ready();
  return app;
}

const SUCCESS = JSON.stringify({
  query: 'find alerts',
  k: 8,
  results: [{
    source_path: 'docs/observability.md', heading_path: ['Observability'], score: 0.9876,
    start_line: 3, end_line: 5, snippet: 'Alerts arrive before a deployment.',
  }],
});

describe('registerBrainSearch', () => {
  it('returns the CLI result through the GET-only search surface', async () => {
    const runQuery = vi.fn(async () => SUCCESS);
    const app = await appFor(runQuery);
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=find%20alerts&k=8' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(JSON.parse(SUCCESS));
    expect(runQuery).toHaveBeenCalledWith('find alerts', 8);
    await app.close();
  });

  it('rejects an absent, blank, oversized, or invalid-k query with 400', async () => {
    const app = await appFor(async () => SUCCESS);
    for (const url of [
      '/api/brain/search',
      '/api/brain/search?q=%20%20%20',
      `/api/brain/search?q=${'a'.repeat(501)}`,
      '/api/brain/search?q=x&k=0',
      '/api/brain/search?q=x&k=21',
      '/api/brain/search?q=x&k=one',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
    await app.close();
  });

  it('reports a missing index as available false without exposing runner output', async () => {
    const error = Object.assign(new Error('private path in stderr'), { code: 2, stderr: 'C:\\secret' });
    const app = await appFor(async () => { throw error; });
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=alerts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, reason: 'index-not-built' });
    expect(res.body).not.toContain('secret');
    await app.close();
  });

  it('reports timeouts and malformed CLI output as unavailable', async () => {
    const timedOut = Object.assign(new Error('timed out'), { code: null });
    const timeoutApp = await appFor(async () => { throw timedOut; });
    expect((await timeoutApp.inject({ method: 'GET', url: '/api/brain/search?q=alerts' })).json())
      .toEqual({ available: false, reason: 'query-failed' });
    await timeoutApp.close();

    const malformedApp = await appFor(async () => 'not json');
    expect((await malformedApp.inject({ method: 'GET', url: '/api/brain/search?q=alerts' })).json())
      .toEqual({ available: false, reason: 'query-failed' });
    await malformedApp.close();
  });

  it('does not route write verbs', async () => {
    const app = await appFor(async () => SUCCESS);
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      expect((await app.inject({ method, url: '/api/brain/search?q=alerts' })).statusCode).toBe(404);
    }
    await app.close();
  });

  it('passes through the model/created_at/chunk_count fields the CLI echoes from the manifest', async () => {
    const withManifest = JSON.stringify({
      query: 'find alerts', k: 8, results: [],
      model: 'sentence-transformers/all-MiniLM-L6-v2', created_at: '2026-08-18T08:17:26Z', chunk_count: 4400,
    });
    const app = await appFor(async () => withManifest);
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=find%20alerts' });

    expect(res.json()).toEqual(JSON.parse(withManifest));
    await app.close();
  });

  it('treats a success-exit {"error": ...} JSON payload as unavailable, not a result set', async () => {
    const app = await appFor(async () => JSON.stringify({ error: 'index-format-error' }));
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=alerts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, reason: 'index-format-error' });
    await app.close();
  });

  it('reads the {"error": ...} reason off a failed process\'s stdout, not just its exit code', async () => {
    // brain_query.py --json now emits {"error": "..."} on stdout even on a non-zero exit;
    // that JSON is the source of truth for the reason, independent of the exit code number.
    const error = Object.assign(new Error('non-zero exit'), {
      code: 9,
      stdout: JSON.stringify({ error: 'model-mismatch' }),
      stderr: 'Index was built with a different model',
    });
    const app = await appFor(async () => { throw error; });
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=alerts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, reason: 'model-mismatch' });
    await app.close();
  });

  it('falls back to the exit-code mapping when stdout is not the {"error": ...} JSON shape', async () => {
    const error = Object.assign(new Error('private path in stderr'), { code: 2, stdout: 'not json', stderr: 'C:\\secret' });
    const app = await appFor(async () => { throw error; });
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=alerts' });

    expect(res.json()).toEqual({ available: false, reason: 'index-not-built' });
    await app.close();
  });
});

describe('defaultRunQuery (the real, non-stubbed argv construction)', () => {
  it('builds argv with flags before "--" and the raw query as the sole positional after it', async () => {
    mockExecFile.mockClear();
    const app = Fastify({ logger: false });
    registerBrainSearch(app, { repoRoot: 'C:\\repo', platform: 'win32' });
    await app.ready();

    // A dash-leading query is exactly the case the "--" separator exists to protect: without
    // it, argparse would parse "-rf" as an unknown flag instead of the query text.
    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=-rf&k=3' });

    expect(res.statusCode).toBe(200);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [file, args, options] = mockExecFile.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
    expect(file).toBe('py');
    expect(args).toEqual(['-3', '-m', 'scripts.brain.brain_query', '--k', '3', '--json', '--', '-rf']);
    expect(args.indexOf('--')).toBe(args.length - 2);
    expect(args.at(-1)).toBe('-rf');
    expect(options.cwd).toBe('C:\\repo');
    await app.close();
  });

  it('uses python3 without Windows launcher arguments on Linux', async () => {
    mockExecFile.mockClear();
    const app = Fastify({ logger: false });
    registerBrainSearch(app, { repoRoot: '/var/lib/kb/ops', platform: 'linux' });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/brain/search?q=alerts&k=3' });

    expect(res.statusCode).toBe(200);
    const [file, args, options] = mockExecFile.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
    expect(file).toBe('python3');
    expect(args).toEqual(['-m', 'scripts.brain.brain_query', '--k', '3', '--json', '--', 'alerts']);
    expect(options.cwd).toBe('/var/lib/kb/ops');
    await app.close();
  });
});
