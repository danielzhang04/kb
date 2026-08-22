import type { EntityDetail, EntityList } from '../../server/entities/contracts.ts';
import { fetchEntityDetail, fetchEntityList } from './entityClient';

export type AgentListDto = EntityList;
export type AgentDetailDto = EntityDetail;

/** Agents use the shared P2 entity service; there is no roster or system-worker compatibility read. */
export function fetchAgentList(fetchImpl: typeof fetch = fetch): Promise<AgentListDto> {
  return fetchEntityList('agents', fetchImpl);
}

export function fetchAgentDetail(agentId: string, fetchImpl: typeof fetch = fetch): Promise<AgentDetailDto> {
  return fetchEntityDetail('agents', agentId, fetchImpl);
}
