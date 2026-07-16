/**
 * MCP connections registry projection. In this repo, a project's MCP wiring is expressed as the
 * `mcp__<server>__<tool>` permission entries in `orgs/<project>/.claude/settings.json`
 * (`permissions.allow`). There is no `.mcp.json` / `mcpServers` block — the allow-list IS the record
 * of which MCP servers/tools a project may use. We derive per-project server→tools from those tokens.
 *
 * MCP permission token grammar: `mcp__<server>__<tool>`, split on the double-underscore separator.
 * Server names themselves may contain single underscores (e.g. `claude_ai_Google_Drive`).
 * Non-`mcp__` permissions (Bash, Read, …) are ignored. Missing dirs/files → empty-but-valid index.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface McpConnection {
  project: string;
  server: string;
  tools: string[];
}

export interface ConnectionsIndex {
  count: number;
  items: McpConnection[];
  byProject: Record<string, McpConnection[]>;
}

/** Parse an `mcp__server__tool` token into `{ server, tool }`, or null if not an MCP token. */
function parseMcpToken(token: string): { server: string; tool: string } | null {
  if (!token.startsWith('mcp__')) return null;
  const parts = token.split('__');
  // ['mcp', <server>, <tool...>] — server is parts[1], tool is the remainder rejoined.
  if (parts.length < 3 || parts[1] === '') return null;
  return { server: parts[1], tool: parts.slice(2).join('__') };
}

/** Read the `permissions.allow` array from a settings.json, tolerating malformed/missing files. */
function readAllowList(settingsPath: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      permissions?: { allow?: unknown };
    };
    const allow = parsed.permissions?.allow;
    return Array.isArray(allow) ? allow.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Build the MCP connections for one project from its allow-list. */
function connectionsForProject(project: string, allow: string[]): McpConnection[] {
  const byServer = new Map<string, Set<string>>();
  for (const token of allow) {
    const parsed = parseMcpToken(token);
    if (!parsed) continue;
    if (!byServer.has(parsed.server)) byServer.set(parsed.server, new Set());
    byServer.get(parsed.server)!.add(parsed.tool);
  }
  return [...byServer.entries()]
    .map(([server, tools]) => ({ project, server, tools: [...tools].sort() }))
    .sort((a, b) => a.server.localeCompare(b.server));
}

/** Derive per-project MCP connections from every `orgs/<project>/.claude/settings.json`. */
export function indexConnections(repoRoot: string): ConnectionsIndex {
  const orgsDir = join(repoRoot, 'orgs');
  const byProject: Record<string, McpConnection[]> = {};
  const items: McpConnection[] = [];

  if (existsSync(orgsDir)) {
    for (const project of readdirSync(orgsDir)) {
      const projDir = join(orgsDir, project);
      if (!statSync(projDir).isDirectory()) continue;
      const settingsPath = join(projDir, '.claude', 'settings.json');
      if (!existsSync(settingsPath)) continue;
      const conns = connectionsForProject(project, readAllowList(settingsPath));
      if (conns.length === 0) continue;
      byProject[project] = conns;
      items.push(...conns);
    }
  }

  return { count: items.length, items, byProject };
}
