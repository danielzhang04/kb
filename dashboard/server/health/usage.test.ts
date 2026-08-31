import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildUsagePanel } from './usage.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

describe('buildUsagePanel', () => {
  it('preserves the exact usage projection at its Health owner', () => {
    const result = buildUsagePanel(REPO_A);

    expect(result).toMatchObject({
      label: 'usage',
      stepCount: 3,
      dispatchCount: 2,
      cards: 2,
      perModelSteps: { 'claude-sonnet-5': 2, 'claude-opus-4': 1 },
    });
    expect(result.models.map(({ model, steps }) => ({ model, steps }))).toEqual([
      { model: 'claude-sonnet-5', steps: 2 },
      { model: 'claude-opus-4', steps: 1 },
    ]);
  });
});
