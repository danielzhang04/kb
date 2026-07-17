import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readOrgStates } from './states.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('readOrgStates', () => {
  it('parses Now/Next/Blocked sections from orgs/*/STATE.md', () => {
    const states = readOrgStates(REPO_A);
    expect(states).toHaveLength(1);

    const demo = states.find((s) => s.project === 'demo');
    expect(demo).toBeDefined();
    expect(demo?.now).toContain('Building the Plane-A indexer.');
    expect(demo?.next).toContain('Wire the SSE hub.');
    expect(demo?.blocked).toContain('nothing blocked');
  });

  it('returns an empty list when no orgs/ dir exists', () => {
    const states = readOrgStates(fileURLToPath(new URL('../__fixtures__/', import.meta.url)) + 'does-not-exist');
    expect(states).toEqual([]);
  });
});
