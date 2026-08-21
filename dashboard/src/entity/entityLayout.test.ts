import { describe, expect, it } from 'vitest';
import { ENTITY_LAYOUT_KEY, persistEntityLayout, readEntityLayouts } from './entityLayout';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => key === ENTITY_LAYOUT_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === ENTITY_LAYOUT_KEY) value = next; },
    value: () => value,
  };
}

describe('entity layout persistence', () => {
  it('defaults both destinations to grid and rejects malformed or unknown values', () => {
    expect(readEntityLayouts(memoryStorage())).toEqual({ agents: 'grid', workflows: 'grid' });
    expect(readEntityLayouts(memoryStorage('{bad json'))).toEqual({ agents: 'grid', workflows: 'grid' });
    expect(readEntityLayouts(memoryStorage(JSON.stringify({ agents: 'tiles', workflows: 4 }))))
      .toEqual({ agents: 'grid', workflows: 'grid' });
  });

  it('persists separate agents and workflows values under the shared key', () => {
    const storage = memoryStorage();
    persistEntityLayout('agents', 'list', storage);
    persistEntityLayout('workflows', 'grid', storage);
    expect(JSON.parse(storage.value() ?? '{}')).toEqual({ agents: 'list', workflows: 'grid' });
    persistEntityLayout('workflows', 'list', storage);
    expect(readEntityLayouts(storage)).toEqual({ agents: 'list', workflows: 'list' });
  });
});
