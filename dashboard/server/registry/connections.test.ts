import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexConnections } from './connections.ts';

const REGISTRY_A = fileURLToPath(new URL('../__fixtures__/registry-a/', import.meta.url));

describe('indexConnections', () => {
  it('derives per-project MCP servers from .claude/settings.json permission allow-lists', () => {
    const idx = indexConnections(REGISTRY_A);

    const demo = idx.byProject.demo;
    expect(demo).toBeDefined();
    const drive = demo.find((c) => c.server === 'claude_ai_Google_Drive');
    expect(drive?.tools.sort()).toEqual(['read_file_content', 'search_files']);

    const ctx7 = demo.find((c) => c.server === 'plugin_context7_context7');
    expect(ctx7?.tools).toEqual(['query-docs']);

    // non-mcp permissions (e.g. Bash) are ignored entirely
    expect(demo.some((c) => c.server.includes('Bash'))).toBe(false);
    expect(idx.count).toBe(2);
  });

  it('returns an empty-but-valid index when no project settings exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'registry-noconns-'));
    const idx = indexConnections(empty);
    expect(idx.count).toBe(0);
    expect(idx.items).toEqual([]);
    expect(idx.byProject).toEqual({});
  });
});
