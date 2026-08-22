import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadOverride, loadPolicy } from '../routing/policy.ts';
import { buildAutonomyLadderPanel } from './autonomyLadder.ts';
import { registerGradesHistoryPanel } from './gradesHistory.ts';

export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register only the retained P1 panel-era readers. */
export function registerPanels(
  app: FastifyInstance,
  repoRoot: string = resolveRepoRoot(),
): void {
  app.get('/api/panels/autonomy-ladder', async () => (
    buildAutonomyLadderPanel(repoRoot, loadPolicy(repoRoot), loadOverride(repoRoot))
  ));
  registerGradesHistoryPanel(app, repoRoot);
}
