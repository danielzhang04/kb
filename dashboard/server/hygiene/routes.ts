/** Hygiene report route. It only serves a pre-generated dry-run report. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register a read-only endpoint; generating a sweep is intentionally outside the daemon. */
export function registerHygiene(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/hygiene/report', async () => {
    try {
      const report = JSON.parse(await readFile(join(repoRoot, '.hygiene-report.json'), 'utf8')) as unknown;
      return { available: true, report };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, reason: 'not-generated' };
      return { available: false, reason: 'invalid-report' };
    }
  });
}
