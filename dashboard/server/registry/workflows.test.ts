import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexWorkflows } from './workflows';

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
});
