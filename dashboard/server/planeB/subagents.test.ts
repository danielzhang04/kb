import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubagentTree } from './subagents.ts';
import type { SubagentNode } from './subagents.ts';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'planeb-subagents-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function jl(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

function findChild(node: SubagentNode, id: string): SubagentNode | undefined {
  return node.children.find((c) => c.id === id);
}

describe('buildSubagentTree (flat meta layout)', () => {
  it('builds spawn tree from flat meta files via toolUseId', async () => {
    const sessionDir = await scratch();
    const subagents = join(sessionDir, 'subagents');
    await mkdir(subagents);

    // Root session spawns A (toolu_T1) and C (toolu_T3).
    // A spawns B (toolu_T2) — A's own transcript owns the toolu_T2 Task tool_use.
    // Agent A: has a Task tool_use with id toolu_T2 in its transcript.
    await writeFile(
      join(subagents, 'agent-aaa1111111111111a.jsonl'),
      jl({
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'tool_use', id: 'toolu_T2', name: 'Task', input: { subagent_type: 'x' } }],
        },
      }),
      'utf8',
    );
    await writeFile(
      join(subagents, 'agent-aaa1111111111111a.meta.json'),
      JSON.stringify({
        agentType: 'general-purpose',
        description: 'agent A',
        toolUseId: 'toolu_T1',
        spawnDepth: 1,
        model: 'opus',
      }),
      'utf8',
    );

    // Agent B: leaf, spawned by A's toolu_T2.
    await writeFile(join(subagents, 'agent-bbb2222222222222b.jsonl'), jl({ type: 'user', message: { content: 'b' } }), 'utf8');
    await writeFile(
      join(subagents, 'agent-bbb2222222222222b.meta.json'),
      JSON.stringify({
        agentType: 'Explore',
        description: 'agent B',
        toolUseId: 'toolu_T2',
        spawnDepth: 2,
        model: 'sonnet',
      }),
      'utf8',
    );

    // Agent C: leaf, spawned by root's toolu_T3.
    await writeFile(join(subagents, 'agent-ccc3333333333333c.jsonl'), jl({ type: 'user', message: { content: 'c' } }), 'utf8');
    await writeFile(
      join(subagents, 'agent-ccc3333333333333c.meta.json'),
      JSON.stringify({
        agentType: 'claude',
        description: 'agent C',
        toolUseId: 'toolu_T3',
        spawnDepth: 1,
        model: 'haiku',
      }),
      'utf8',
    );

    const root = await buildSubagentTree(sessionDir);

    // Root has the two depth-1 agents as direct children.
    expect(root.id).toBe('root');
    const childIds = root.children.map((c) => c.id).sort();
    expect(childIds).toEqual(['aaa1111111111111a', 'ccc3333333333333c']);

    // B nests under A (via A's transcript owning toolu_T2), NOT under root.
    const a = findChild(root, 'aaa1111111111111a')!;
    expect(a.children).toHaveLength(1);
    expect(a.children[0].id).toBe('bbb2222222222222b');
    expect(a.children[0].toolUseId).toBe('toolu_T2');
    expect(a.children[0].spawnDepth).toBe(2);
    expect(a.children[0].agentType).toBe('Explore');

    // C is a leaf under root.
    const c = findChild(root, 'ccc3333333333333c')!;
    expect(c.children).toHaveLength(0);
    expect(c.model).toBe('haiku');

    // Meta fields carried through for A.
    expect(a.agentType).toBe('general-purpose');
    expect(a.toolUseId).toBe('toolu_T1');

    // FLAT layout: subagents/ holds only files, no per-runId subdirectories.
    const entries = await readdir(subagents, { withFileTypes: true });
    expect(entries.every((e) => e.isFile())).toBe(true);
  });

  it('returns an empty root when no subagents dir exists', async () => {
    const sessionDir = await scratch();
    const root = await buildSubagentTree(sessionDir);
    expect(root.id).toBe('root');
    expect(root.children).toHaveLength(0);
  });
});
