import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseActor } from './actor.ts';
import { buildApp } from '../index.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';

describe('parseActor', () => {
  it('accepts the three shapes', () => {
    expect(parseActor('daniel')).toBe('daniel');
    expect(parseActor('boss')).toBe('boss');
    expect(parseActor('worker:sonnet-01')).toBe('worker:sonnet-01');
    expect(parseActor('worker:a.b_c-d')).toBe('worker:a.b_c-d');
  });
  it('is total: anything else is unknown', () => {
    for (const bad of [undefined, '', '  ', 'DANIEL', 'worker:', 'worker:-x', 'worker:' + 'a'.repeat(64),
      'operator', 'daniel; drop', ['boss', 'daniel'] as unknown as string, 'worker:a b']) {
      expect(parseActor(bad as never)).toBe('unknown');
    }
  });
});

// --- Authority-invariance: the header is a record, never an authority input --------------------------

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const TEST_SESSION_CONFIG = { secret: Buffer.from('authority-actor-test-secret-0001'), ttlMs: 60_000 };
const TEST_ORIGINS = ['http://localhost'];

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function buildRealApp(): FastifyInstance {
  const app = buildApp({
    repoRoot: REPO_A,
    sessionConfig: TEST_SESSION_CONFIG,
    allowedOrigins: TEST_ORIGINS,
    validateData: false,
    controlStore: createInMemoryControlPlaneStore(),
  });
  openApps.push(app);
  return app;
}

describe('the X-KB-Actor header never changes what a request is allowed to do', () => {
  it('no actor header changes any status, on an open route or a signed one', async () => {
    const app = buildRealApp();
    for (const path of [
      '/api/control/runs/run-x/archive',              // open (policy.test.ts)
      '/api/control/runs/run-x/reconcile-publication', // signed (policy.test.ts)
    ]) {
      const statuses = await Promise.all([
        { 'x-kb-actor': 'daniel' }, { 'x-kb-actor': 'boss' }, { 'x-kb-actor': 'worker:x' }, {},
      ].map(async (headers) => (await app.inject({
        method: 'POST', url: path, headers: { origin: 'http://localhost', ...headers }, payload: {},
      })).statusCode));
      expect(new Set(statuses).size).toBe(1);
    }
  });
});
