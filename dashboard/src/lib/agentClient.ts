/**
 * Read-only detail contract for one declared agent. The roster intentionally stays compact; this
 * endpoint supplies the declaration-backed facts that only make sense after the operator opens an
 * agent. Every field is optional so a partially populated declaration remains an honest UI state.
 *
 * The browser never reads repository files directly. Paths and text come from the server's bounded,
 * safe projection of `agents/<id>.md` and the registry relationships it can prove.
 */
export interface AgentCodebaseFact {
  project: string;
  path: string | null;
  relationship?: string | null;
}

export interface AgentWorkflowFact {
  ref: string;
  title: string | null;
  path: string | null;
  relationship: string | null;
}

export interface AgentRunFact {
  summary: string | null;
  runner: string | null;
  command: string | null;
}

export interface AgentDetailDto {
  id: string;
  declaration: {
    path: string;
    source: string | null;
    instructions: string | null;
  } | null;
  codebases: AgentCodebaseFact[];
  workflows: AgentWorkflowFact[];
  howItRuns: AgentRunFact | null;
}

/** Read the server's safe, declaration-backed projection for one agent. */
export async function fetchAgentDetail(agentId: string, fetchImpl: typeof fetch = fetch): Promise<AgentDetailDto> {
  const response = await fetchImpl(`/api/agents/${encodeURIComponent(agentId)}`);
  if (!response.ok) throw new Error(`agent detail request failed (${response.status})`);
  return await response.json() as AgentDetailDto;
}
