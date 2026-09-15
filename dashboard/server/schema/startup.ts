import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_QUEUE_DIRS, parseValidatedCardTolerant } from '../planeA/cards.ts';
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

/** Result of a boot-time repository scan: how many queue cards were skipped rather than fatal. */
export interface RepositoryDataSummary {
  skippedCards: number;
}

export function assertSupportedRepositoryData(
  repoRoot: string,
  platformRoot: string = defaultPlatformRoot(),
): RepositoryDataSummary {
  try {
    assertSchemaInfrastructure(platformRoot);
  } catch (error) {
    throw new Error(`schema infrastructure error at ${platformRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let skippedCards = 0;
  for (const path of queueCardFiles(repoRoot)) {
    let unknownKeys: string[];
    try {
      ({ unknownKeys } = parseValidatedCardTolerant(readFileSync(path, 'utf8'), platformRoot));
    } catch (error) {
      // A card that fails to parse (unsupported frontmatter shape, unsupported schema-version, or a
      // schema-validation error) must NOT abort boot — the shared ops branch is written by many tools
      // and one foreign/malformed card must not crash the whole platform's start. Skipped and warned
      // once per card; never fatal. Runtime claim/execute stays strict on parseValidatedCard
      // (write/routes.ts, write/cardRouting.ts, control/publication.ts, planeA/indexer.ts).
      console.warn(`startup: card ${path} skipped at boot (unparseable frontmatter): ${error instanceof Error ? error.message : String(error)}`);
      skippedCards += 1;
      continue;
    }
    // Unknown top-level keys (a not-yet-merged arc's extra metadata on the shared ops branch) are
    // tolerated at boot — the platform reads only the fields it knows. Logged, never fatal: one
    // foreign card must not crash the whole platform's start. Runtime claim/execute stays strict.
    if (unknownKeys.length > 0) {
      console.warn(`startup: card ${path} carries unknown frontmatter keys (ignored): ${unknownKeys.join(', ')}`);
    }
  }
  const orgs = join(repoRoot, 'orgs');
  if (existsSync(orgs)) {
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
  if (skippedCards > 0) {
    console.warn(`startup: ${skippedCards} card(s) skipped at boot`);
  }
  return { skippedCards };
}
