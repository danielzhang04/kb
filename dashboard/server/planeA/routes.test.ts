/**
 * D0.9 — the Plane-A snapshot HTTP route. The Control landing's fleet strip / org-STATE panes need
 * the whole in-memory index at once (the SSE bus only carries lightweight deltas), so `/api/index`
 * exposes `indexRepo()` read-only over HTTP. Pure read; no write surface.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerPlaneA } from './routes.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('registerPlaneA', () => {
  it('GET /api/index returns the Plane-A snapshot (cards grouped, ledger rollups, org STATEs)', async () => {
    const app = Fastify({ logger: false });
    registerPlaneA(app, REPO_A);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/index' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cards: Record<string, Array<{ updatedAt?: string }>>;
      ledgers: { cost: { stepCount: number; modelMix: Record<string, number> } };
      orgStates: { project: string }[];
    };

    // Cards grouped by state (the fixture has one card in `working`).
    expect(body.cards.working).toHaveLength(1);
    expect(body.cards.working[0]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Ledger rollup carried through (fixture cost ledger has 3 step rows).
    expect(body.ledgers.cost.stepCount).toBe(3);
    // Org STATEs carried through.
    expect(body.orgStates.map((s) => s.project)).toContain('demo');

    await app.close();
  });
});
