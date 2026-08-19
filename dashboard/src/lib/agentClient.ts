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
  governsWorkflow?: boolean;
  stages?: Array<{
    id: string;
    title: string;
    action: string;
    target: string;
    riskTier: string;
    dependsOn: string[];
    review: { subjectStageId: string; maxCreatorReworks: number } | null;
    completionGate: { id: string; kind: 'approval'; requiresReview: 'pass' } | null;
  }>;
}

export interface SystemWorkerDto {
  id: string;
  runtime: string;
  addressable: true;
  dashboardTriggerable: boolean;
  registrationSource: 'runtime-default';
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
    /** Declared default execution profile id, or null for a legacy declaration. */
    defaultProfile: string | null;
    /** Declared execution profile ids this declaration permits, or null for a legacy declaration. */
    allowedProfiles: string[] | null;
    /**
     * The six complex-agent fields U3 added to the declaration scanner. `server/agents/routes.ts` has
     * always put them on the wire; this type simply did not say so, which forced the Agent Management
     * panel to re-declare them locally and left every other reader unable to see them at all.
     *
     * All six are NULLABLE and null is the common case: a declaration that omits a field is the
     * ordinary state, not a degraded one, so no reader may treat null as an error.
     */
    tools: string[] | null;
    knowledgeSource: string[] | null;
    autonomyTier: string | null;
    skills: string[] | null;
    whatItReplaces: string | null;
    buildsOn: string[] | null;
    version?: number;
    io?: { inputs: unknown; outputs: unknown } | null;
    defaults?: { budgetUsd: string | number | null; maxRetries: string | number | null; escalation: string | number | null } | null;
  } | null;
  codebases: AgentCodebaseFact[];
  workflows: AgentWorkflowFact[];
  howItRuns: AgentRunFact | null;
}

/**
 * The server's `AgentDeclarationProblem` as it arrives in a 422 body — an OBJECT naming the file and
 * the fault, never a prose sentence. Mirrored here (not imported) because `server/agents/roster.ts`
 * pulls in `node:fs`, and a runtime edge from the client into it drags the node builtins into the
 * browser bundle (`lib/clientImportGraph.test.ts` is the gate on that).
 */
export interface AgentDeclarationProblemDto {
  id: string;
  source: string;
  problem: string;
}

/**
 * Why a declaration read produced no declaration. The three are NOT interchangeable, and collapsing
 * them into one "failed" is how a UI ends up telling an operator the daemon is down when the truth is
 * that this agent has no `agents/<id>.md`:
 *
 *   `no-declaration` — HTTP 404: the daemon answered correctly; this id has no declaration file.
 *   `invalid`        — HTTP 422: a declaration exists but cannot be used; the server names the fault.
 *   `error`          — anything else (network down, 500, unparseable body): the read genuinely failed.
 */
export type AgentDetailFailureKind = 'no-declaration' | 'invalid' | 'error';

/**
 * A typed failure, thrown instead of the bare `Error` the plain read used to throw.
 *
 * It is an `Error` subclass so every existing `catch` keeps working unchanged; callers that want the
 * status and the server's stated reason narrow with {@link isAgentDetailFailure} rather than
 * re-issuing the request or wrapping `fetch` to spy on it.
 */
export class AgentDetailFailure extends Error {
  readonly kind: AgentDetailFailureKind;
  readonly status: number;
  /** The server's problem object on a 422, else null. Never a sentence — see the DTO above. */
  readonly declarationProblem: AgentDeclarationProblemDto | null;

  constructor(status: number, kind: AgentDetailFailureKind, declarationProblem: AgentDeclarationProblemDto | null) {
    super(`agent detail request failed (${status})`);
    this.name = 'AgentDetailFailure';
    this.status = status;
    this.kind = kind;
    this.declarationProblem = declarationProblem;
  }

  /** `"<source>: <problem>"` when the server named a file, the bare problem when it did not. */
  get problemText(): string | null {
    const problem = this.declarationProblem;
    if (!problem) return null;
    return problem.source ? `${problem.source}: ${problem.problem}` : problem.problem;
  }
}

export function isAgentDetailFailure(error: unknown): error is AgentDetailFailure {
  return error instanceof AgentDetailFailure;
}

function failureKind(status: number): AgentDetailFailureKind {
  if (status === 404) return 'no-declaration';
  if (status === 422) return 'invalid';
  return 'error';
}

/** Read the 422 body's `declaration` problem object, or null when the body is not that shape. */
async function readDeclarationProblem(response: Response): Promise<AgentDeclarationProblemDto | null> {
  try {
    const body = (await response.json()) as { declaration?: unknown } | null;
    const declaration = body?.declaration;
    if (typeof declaration !== 'object' || declaration === null) return null;
    const { id, source, problem } = declaration as Record<string, unknown>;
    if (typeof problem !== 'string') return null;
    return {
      id: typeof id === 'string' ? id : '',
      source: typeof source === 'string' ? source : '',
      problem,
    };
  } catch {
    // A failure body that is not JSON is still a failure — the status carries the meaning.
    return null;
  }
}

/** Read the server's safe, declaration-backed projection for one agent. */
export async function fetchAgentDetail(agentId: string, fetchImpl: typeof fetch = fetch): Promise<AgentDetailDto> {
  const response = await fetchImpl(`/api/agents/${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    throw new AgentDetailFailure(response.status, failureKind(response.status), await readDeclarationProblem(response));
  }
  return await response.json() as AgentDetailDto;
}

export async function fetchSystemWorkers(fetchImpl: typeof fetch = fetch): Promise<SystemWorkerDto[]> {
  const response = await fetchImpl('/api/agents/system-workers');
  if (!response.ok) throw new Error(`system worker request failed (${response.status})`);
  return await response.json() as SystemWorkerDto[];
}
