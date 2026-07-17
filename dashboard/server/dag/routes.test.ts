/**
 * D3.4 — the read-only pipeline DAG HTTP route. `GET /api/dag` exposes `buildDag(indexRepo())` over the
 * live index. Pure read; no write surface.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerDag } from './routes.ts';
import type { Dag } from './graph.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('registerDag', () => {
  it('GET /api/dag returns a { nodes, edges } graph over the fixture queue', async () => {
    const app = Fastify({ logger: false });
    registerDag(app, REPO_A);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/dag' });
    expect(res.statusCode).toBe(200);
    const dag = res.json() as Dag;

    // The fixture has seven cards across the queue buckets → seven nodes.
    expect(dag.nodes).toHaveLength(7);
    // Every fixture card has `depends-on: []`, so there are no edges.
    expect(dag.edges).toHaveLength(0);
    // Node data carries the render fields.
    const node = dag.nodes[0];
    expect(node.data).toHaveProperty('summary');
    expect(node.data).toHaveProperty('state');
    expect(node.data).toHaveProperty('blocked');

    await app.close();
  });
});
