import type { EntityDetail, EntityList } from '../../server/entities/contracts.ts';

export type EntityCollection = 'agents' | 'workflows';
export type EntityRequestScope = 'list' | 'detail';

export class EntityClientFailure extends Error {
  constructor(readonly status: number, readonly scope: EntityRequestScope) {
    super(`entity ${scope} request failed (${status})`);
    this.name = 'EntityClientFailure';
  }
}

async function readEntity<T>(url: string, scope: EntityRequestScope, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new EntityClientFailure(response.status, scope);
  return await response.json() as T;
}

export function fetchEntityList(collection: EntityCollection, fetchImpl: typeof fetch = fetch): Promise<EntityList> {
  return readEntity<EntityList>(`/api/${collection}`, 'list', fetchImpl);
}

export function fetchEntityDetail(collection: EntityCollection, id: string, fetchImpl: typeof fetch = fetch): Promise<EntityDetail> {
  return readEntity<EntityDetail>(`/api/${collection}/${encodeURIComponent(id)}`, 'detail', fetchImpl);
}
