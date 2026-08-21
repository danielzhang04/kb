export const ENTITY_LAYOUT_KEY = 'kb.dashboard.entity-layout.v1';

export type EntityLayout = 'grid' | 'list';
export type EntityLayoutKind = 'agents' | 'workflows';

type EntityLayouts = Record<EntityLayoutKind, EntityLayout>;

const DEFAULT_LAYOUTS: EntityLayouts = { agents: 'grid', workflows: 'grid' };

function isLayout(value: unknown): value is EntityLayout {
  return value === 'grid' || value === 'list';
}

export function readEntityLayouts(storage: Pick<Storage, 'getItem'> = localStorage): EntityLayouts {
  try {
    const parsed = JSON.parse(storage.getItem(ENTITY_LAYOUT_KEY) ?? '{}') as Record<string, unknown>;
    return {
      agents: isLayout(parsed.agents) ? parsed.agents : 'grid',
      workflows: isLayout(parsed.workflows) ? parsed.workflows : 'grid',
    };
  } catch {
    return { ...DEFAULT_LAYOUTS };
  }
}

export function readEntityLayout(kind: EntityLayoutKind): EntityLayout {
  return readEntityLayouts()[kind];
}

export function persistEntityLayout(
  kind: EntityLayoutKind,
  layout: EntityLayout,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(ENTITY_LAYOUT_KEY, JSON.stringify({ ...readEntityLayouts(storage), [kind]: layout }));
  } catch {
    // Storage is optional chrome; the component's in-memory selection remains usable.
  }
}
