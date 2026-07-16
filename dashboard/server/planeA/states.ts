/**
 * Plane-A org state reader. Each project keeps `orgs/<project>/STATE.md` with `## Now`, `## Next`,
 * and `## Blocked` sections. We read those three sections verbatim per project.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface OrgState {
  project: string;
  now: string;
  next: string;
  blocked: string;
}

/** Extract the text of a `## <heading>` section (up to the next `## ` heading or EOF). */
function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

export function readOrgStates(repoRoot: string): OrgState[] {
  const orgsDir = join(repoRoot, 'orgs');
  if (!existsSync(orgsDir)) return [];

  const states: OrgState[] = [];
  for (const project of readdirSync(orgsDir)) {
    const statePath = join(orgsDir, project, 'STATE.md');
    if (!existsSync(statePath) || !statSync(join(orgsDir, project)).isDirectory()) continue;
    const md = readFileSync(statePath, 'utf-8');
    states.push({
      project,
      now: section(md, 'Now'),
      next: section(md, 'Next'),
      blocked: section(md, 'Blocked'),
    });
  }
  return states;
}
