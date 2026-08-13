import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_QUEUE_DIRS, parseValidatedCard } from '../planeA/cards.ts';
import { workflowProfileIds } from '../control/environment.ts';
import { defaultPlatformRoot } from '../runtime/python.ts';
import { parseWorkflowDef } from '../workflows/defs.ts';
import { assertSchemaInfrastructure } from './versions.ts';

function queueCardFiles(repoRoot: string): string[] {
  return CARD_QUEUE_DIRS.flatMap((dir) => {
    const root = join(repoRoot, 'queue', dir);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(root, entry.name));
  });
}

export function assertSupportedRepositoryData(
  repoRoot: string,
  platformRoot: string = defaultPlatformRoot(),
): void {
  try {
    assertSchemaInfrastructure(platformRoot);
  } catch (error) {
    throw new Error(`schema infrastructure error at ${platformRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const path of queueCardFiles(repoRoot)) {
    try { parseValidatedCard(readFileSync(path, 'utf8'), platformRoot); }
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
