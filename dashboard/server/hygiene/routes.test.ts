import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerHygiene, resolveReportPath } from './routes.ts';

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hygiene-route-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('registerHygiene', () => {
  it('resolves daemon reports beneath the writable state root', () => {
    expect(resolveReportPath('/var/lib/kb/ops', { DASHBOARD_STATE_ROOT: '/var/lib/kb/state' })).toBe(
      join('/var/lib/kb/state', 'hygiene', 'report.json'),
    );
  });

  it('retains the repo-local report path when the state root is unset', () => {
    expect(resolveReportPath('C:/repo', {})).toBe(join('C:/repo', '.hygiene-report.json'));
  });

  it('honestly reports when no sweep has generated a report', async () => {
    const app = Fastify();
    registerHygiene(app, await fixtureRoot());
    const response = await app.inject({ method: 'GET', url: '/api/hygiene/report' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false, reason: 'not-generated' });
  });

  it('serves the existing fixture report without running a sweep', async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, '.hygiene-report.json'), JSON.stringify({
      generated_at: '2026-08-18T00:00:00Z', root, dryRun: true,
      findings: [{ path: 'old.tmp', kind: 'orphan-temp', size: 4, detail: 'temp', proposal: 'human decides' }],
      summary: { total: 1, by_kind: { 'orphan-temp': 1 } },
    }));
    const app = Fastify();
    registerHygiene(app, root, join(root, '.hygiene-report.json'));
    const response = await app.inject({ method: 'GET', url: '/api/hygiene/report' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: true, report: { dryRun: true, summary: { total: 1 } } });
  });
});
