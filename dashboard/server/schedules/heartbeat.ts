import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Label used for the root, system-level heartbeat (`HEARTBEAT.md` at the repo root). */
export const SYSTEM_PROJECT = 'system';

/** Scalar metadata for one declared cadence. Prompt bodies are intentionally excluded. */
export interface HeartbeatCadence {
  project: string;
  name: string;
  schedule: string | null;
  tier: string | null;
  riskTier: string | null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function indentOf(line: string): number {
  return /^([ \t]*)/.exec(line)?.[1].length ?? 0;
}

function extractYamlFence(markdown: string): string | null {
  return /```ya?ml\s*\r?\n([\s\S]*?)```/.exec(markdown)?.[1] ?? null;
}

/** Parse the closed scalar cadence metadata from the first YAML fence. */
export function parseCadences(markdown: string, project: string): HeartbeatCadence[] {
  const fence = extractYamlFence(markdown);
  if (!fence) return [];

  const cadences: HeartbeatCadence[] = [];
  let current: HeartbeatCadence | null = null;
  let skipIndent: number | null = null;

  for (const raw of fence.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const indent = indentOf(raw);
    if (skipIndent !== null) {
      if (indent > skipIndent) continue;
      skipIndent = null;
    }
    const line = raw.trim();
    const dashName = /^-\s+name:\s*(.*)$/.exec(line);
    if (dashName) {
      if (current) cadences.push(current);
      current = { project, name: unquote(dashName[1]), schedule: null, tier: null, riskTier: null };
      continue;
    }
    if (!current) continue;

    const keyValue = /^-?\s*([\w-]+):\s*(.*)$/.exec(line);
    if (!keyValue) continue;
    const key = keyValue[1];
    const rawValue = keyValue[2].trim();
    if (rawValue === '|' || rawValue === '>' || rawValue === '|-' || rawValue === '>-') {
      skipIndent = indent;
      continue;
    }
    const value = unquote(rawValue);
    if (key === 'name') current.name = value;
    else if (key === 'schedule') current.schedule = value || null;
    else if (key === 'tier') current.tier = value || null;
    else if (key === 'risk-tier') current.riskTier = value || null;
  }
  if (current) cadences.push(current);
  return cadences.filter((cadence) => cadence.name !== '');
}

/** Read the root system heartbeat followed by every project heartbeat. */
export function readHeartbeatCadences(repoRoot: string): HeartbeatCadence[] {
  const cadences: HeartbeatCadence[] = [];
  const rootHeartbeat = join(repoRoot, 'HEARTBEAT.md');
  if (existsSync(rootHeartbeat)) {
    cadences.push(...parseCadences(readFileSync(rootHeartbeat, 'utf-8'), SYSTEM_PROJECT));
  }

  const orgsDirectory = join(repoRoot, 'orgs');
  if (!existsSync(orgsDirectory)) return cadences;
  for (const project of readdirSync(orgsDirectory)) {
    const projectDirectory = join(orgsDirectory, project);
    if (!statSync(projectDirectory).isDirectory()) continue;
    const projectHeartbeat = join(projectDirectory, 'HEARTBEAT.md');
    if (existsSync(projectHeartbeat)) {
      cadences.push(...parseCadences(readFileSync(projectHeartbeat, 'utf-8'), project));
    }
  }
  return cadences;
}

/** First non-empty Result line, bounded for the Schedules glance. */
export function resultNarration(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Result\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const first = (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim()).find(Boolean);
  if (!first) return null;
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/** Presence-only pause state for a declared, filename-safe cadence id. */
export function isPaused(repoRoot: string, cadence: string): boolean {
  if (cadence === '' || cadence.includes('/') || cadence.includes('\\') || cadence.includes('..')) return false;
  return existsSync(join(repoRoot, 'queue', 'paused', cadence));
}
