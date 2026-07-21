import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';

const CONFIG = { secret: Buffer.from('workflow-route-test-secret-01234567'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost';

describe('POST /api/write/workflow-runs', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('is explicitly retired behind the normal origin and session gates', async () => {
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: process.cwd(),
      sessionConfig: CONFIG,
      allowedOrigins: [ORIGIN],
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    }));

    const unauthenticated = await app.inject({
      method: 'POST', url: '/api/write/workflow-runs',
      headers: { origin: ORIGIN, host: 'localhost', 'content-type': 'application/json' }, payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST', url: '/api/write/workflow-runs',
      headers: {
        origin: ORIGIN, host: 'localhost', 'content-type': 'application/json',
        authorization: `Bearer ${mintSession('operator', CONFIG).token}`,
      },
      payload: { project: 'kb-ops', stages: [] },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: 'workflow-runs-retired' });
  });
});
