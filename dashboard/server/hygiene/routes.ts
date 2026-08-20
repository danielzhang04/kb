/** Hygiene report route. It only serves a pre-generated dry-run report. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveStatePath } from '../../../scripts/hooks/lib/kb_paths.js';
import { resolveRepoRoot } from '../planeA/routes.ts';

export function resolveReportPath(
  repoRoot: string = resolveRepoRoot(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveStatePath('hygiene', join(repoRoot, '.hygiene-report.json'), env, 'report.json')!;
}

/** Register a read-only endpoint; generating a sweep is intentionally outside the daemon. */
export function registerHygiene(
  app: FastifyInstance,
  repoRoot: string = resolveRepoRoot(),
  reportPath: string = resolveReportPath(repoRoot),
): void {
  app.get('/api/hygiene/report', async () => {
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
      return { available: true, report };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, reason: 'not-generated' };
      return { available: false, reason: 'invalid-report' };
    }
  });
}
