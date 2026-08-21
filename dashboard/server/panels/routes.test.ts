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
  it('returns 404 for every retired panel route', async () => {
    const app = Fastify({ logger: false });
    registerPanels(app, REPO_A);
    await app.ready();
    for (const url of ['/api/panels/usage', '/api/panels/health', '/api/panels/atlas', '/api/panels/loop-status']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
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
});
