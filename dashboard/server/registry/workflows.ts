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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkflowRunRequest } from '../write/workflowRun.ts';
import type { WorkflowRunRequest } from '../write/workflowRun.ts';

export interface WorkflowEntry {
  id: string;
  path: string;
  /** Human-facing name from the file's `name:` frontmatter, or the id when none is declared. */
  name: string;
  /** Lifecycle status from the file's `status:` frontmatter, or `registered` when none is declared. */
  status: string;
  /** Present only for a strict embedded workflow-v1 definition. Legacy prose remains registered but inert. */
  definition?: WorkflowRunRequest;
}

export interface WorkflowsIndex {
  present: boolean;
  items: WorkflowEntry[];
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Read `name` / `status` from a workflow file's leading `---` frontmatter block. Tolerant: a file with
 * no frontmatter (or no such keys) yields `{ name: null, status: null }` — never a throw. The body is
 * never interpreted (registry files are inert data, like cards).
 */
function readWorkflowMeta(filePath: string): { name: string | null; status: string | null; definition?: WorkflowRunRequest } {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return { name: null, status: null };
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fm = m?.[1] ?? '';
  const field = (key: string): string | null => {
    const r = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi').exec(fm);
    const v = r ? stripQuotes(r[1].trim()) : null;
    return v === null || v === '' ? null : v;
  };
  let definition: WorkflowRunRequest | undefined;
  const fence = /```workflow-v1\s*\r?\n([\s\S]*?)\r?\n```/.exec(text);
  if (fence) {
    try {
      const checked = validateWorkflowRunRequest(JSON.parse(fence[1]));
      if (checked.ok) definition = checked.value;
    } catch {
      /* malformed definitions remain visible but are never marked runnable */
    }
  }
  return { name: field('name'), status: field('status'), definition };
}

/** List `wf_*.md` entries under `repoRoot/workflows/`, or the empty-state marker if the dir is absent. */
export function indexWorkflows(repoRoot: string): WorkflowsIndex {
  const dir = join(repoRoot, 'workflows');
  if (!existsSync(dir)) return { present: false, items: [] };

  const items: WorkflowEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('wf_') || !name.endsWith('.md')) continue;
    const id = name.replace(/\.md$/, '');
    const meta = readWorkflowMeta(join(dir, name));
    items.push({
      id,
      path: `workflows/${name}`,
      name: meta.name ?? id,
      status: meta.status ?? 'registered',
      ...(meta.definition ? { definition: meta.definition } : {}),
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { present: true, items };
}
