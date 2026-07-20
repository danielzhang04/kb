import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexWorkflows } from './workflows.ts';

const REGISTRY_A = fileURLToPath(new URL('../__fixtures__/registry-a/', import.meta.url));

describe('indexWorkflows (render-if-present)', () => {
  it('returns an empty-state marker when no workflows/ dir exists', () => {
    // the real repo — and fixture registry-a — have NO workflows/ registry dir
    const idx = indexWorkflows(REGISTRY_A);
    expect(idx).toEqual({ present: false, items: [] });
  });

  it('lists wf_*.md entries when a workflows/ dir is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'registry-workflows-'));
    const wfDir = join(root, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'wf_build.md'), '# build workflow\n');
    writeFileSync(join(wfDir, 'wf_review.md'), '# review workflow\n');
    writeFileSync(join(wfDir, 'README.md'), 'not a workflow entry\n'); // must be ignored

    const idx = indexWorkflows(root);
    expect(idx.present).toBe(true);
    expect(idx.items.map((w) => w.id).sort()).toEqual(['wf_build', 'wf_review']);
  });

  it('surfaces name + status from frontmatter, defaulting when absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'registry-workflows-meta-'));
    const wfDir = join(root, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(
      join(wfDir, 'wf_ship.md'),
      '---\nname: Ship review\nstatus: active\n---\n# ship\n',
    );
    // No frontmatter → name falls back to the id, status to `registered`.
    writeFileSync(join(wfDir, 'wf_bare.md'), '# just a heading\n');

    const idx = indexWorkflows(root);
    const ship = idx.items.find((w) => w.id === 'wf_ship')!;
    expect(ship.name).toBe('Ship review');
    expect(ship.status).toBe('active');

    const bare = idx.items.find((w) => w.id === 'wf_bare')!;
    expect(bare.name).toBe('wf_bare');
    expect(bare.status).toBe('registered');
  });

  it('exposes only a strict workflow-v1 fence as runnable data', () => {
    const root = mkdtempSync(join(tmpdir(), 'registry-workflows-v1-'));
    const wfDir = join(root, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const definition = {
      name: 'wf_ship', project: 'kb', workflowDefinitionId: 'wf_ship',
      stages: [{ id: 'build', action: 'build', target: '.', workOrder: 'Build it', riskTier: 'T2', owner: 'codex-worker', dependsOn: [] }],
    };
    writeFileSync(join(wfDir, 'wf_ship.md'), `---\nname: Ship\n---\n\n\`\`\`workflow-v1\n${JSON.stringify(definition)}\n\`\`\`\n`);
    writeFileSync(join(wfDir, 'wf_prose.md'), '# prose only');

    const idx = indexWorkflows(root);
    expect(idx.items.find((w) => w.id === 'wf_ship')?.definition).toEqual(definition);
    expect(idx.items.find((w) => w.id === 'wf_prose')?.definition).toBeUndefined();
  });
});
