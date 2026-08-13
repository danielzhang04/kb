import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseValidatedCard } from '../planeA/cards.ts';
import { workflowProfileIds } from '../control/environment.ts';
import { parseWorkflowDef } from '../workflows/defs.ts';

function markdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

export function assertSupportedRepositoryData(repoRoot: string): void {
  for (const path of markdownFiles(join(repoRoot, 'queue'))) {
    try { parseValidatedCard(readFileSync(path, 'utf8')); }
    catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const orgs = join(repoRoot, 'orgs');
  if (!existsSync(orgs)) return;
  for (const org of readdirSync(orgs, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const workflows = join(orgs, org.name, 'workflows');
    if (!existsSync(workflows)) continue;
    for (const entry of readdirSync(workflows, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(workflows, entry.name);
      const parsed = parseWorkflowDef(readFileSync(path, 'utf8'), { knownProfiles: workflowProfileIds() });
      if (!parsed.ok) throw new Error(`${path}: ${parsed.detail}`);
    }
  }
}
