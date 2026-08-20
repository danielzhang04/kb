/**
 * D3.5 — the read-only layer-panel HTTP routes. Both `/api/panels/*` endpoints expose their pure
 * projection over the repo fixture; no write surface.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerPanels } from './routes.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('registerPanels', () => {
  it('GET /api/panels/usage returns the usage rollup with USD suppressed', async () => {
    const app = Fastify({ logger: false });
    registerPanels(app, REPO_A);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/panels/usage' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.label).toBe('usage');
    expect(body.stepCount).toBe(3);
    expect(body).not.toHaveProperty('usd');
    expect(body).not.toHaveProperty('spend');

    await app.close();
  });

  it('GET /api/panels/autonomy-ladder returns the recomputed ladder (declared kept apart from earned)', async () => {
    const app = Fastify({ logger: false });
    registerPanels(app, REPO_A);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/panels/autonomy-ladder' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      label: string;
      frozen: boolean;
      trustedGraderCount: number;
      gradeRowCount: number;
      ledgerRowCount: number;
      keys: unknown[];
      workers: { worker: string; declaredCeiling: string | null; earned: unknown[] }[];
    };
    expect(body.label).toBe('autonomy-ladder');
    expect(body.frozen).toBe(false);
    // The fixture's grades ledger holds only `.gitkeep` (the live shape today) → nothing is earned.
    expect(body.gradeRowCount).toBe(0);
    expect(body.ledgerRowCount).toBe(0); // an empty ledger, not an untrusted-grader situation
    expect(body.keys).toEqual([]);
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers.every((w) => Array.isArray(w.earned) && 'declaredCeiling' in w)).toBe(true);

    await app.close();
  });

  it('GET /api/panels/health returns the liveness panel (agents + org cadences)', async () => {
    const app = Fastify({ logger: false });
    registerPanels(app, REPO_A);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/panels/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { asOf: string; agents: unknown[]; orgs: { project: string }[] };
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.orgs.map((o) => o.project)).toContain('demo');

    await app.close();
  });
});
