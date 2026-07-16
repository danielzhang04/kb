/**
 * Workflows registry projection — RENDER-IF-PRESENT.
 *
 * There is NO `workflows/` registry directory in the live repo today (the design assumed one). This
 * indexer must therefore degrade cleanly: when `repoRoot/workflows/` is absent it returns
 * `{ present: false, items: [] }` with NO throw, and the SPA renders an explicit "no workflows
 * registered yet" empty state. When the dir exists, it lists `wf_*.md` entries.
 *
 * NOTE: this is the repo-root Plane-A `workflows/` registry — a different thing from the Plane-B
 * transcript-side `workflows/scripts/` dir. Do not conflate them.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkflowEntry {
  id: string;
  path: string;
}

export interface WorkflowsIndex {
  present: boolean;
  items: WorkflowEntry[];
}

/** List `wf_*.md` entries under `repoRoot/workflows/`, or the empty-state marker if the dir is absent. */
export function indexWorkflows(repoRoot: string): WorkflowsIndex {
  const dir = join(repoRoot, 'workflows');
  if (!existsSync(dir)) return { present: false, items: [] };

  const items: WorkflowEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('wf_') || !name.endsWith('.md')) continue;
    items.push({ id: name.replace(/\.md$/, ''), path: `workflows/${name}` });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { present: true, items };
}
