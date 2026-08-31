// P6 W3 §3.2, design:383: the placement requirement is the UNION of workflow-level capability fields
// (`workflows/defs.ts:277-280`) and every ASSIGNED stage agent's capability fields (`agents/roster.ts:
// 696-701`). Normalisation happens exactly once, here, by handing the raw union straight to W0's
// `decodeCapabilityRequirement` — this module never re-implements canonicalisation, sorting, or the
// exact-key wall. `pty`/`gpu` have no declaration source today (no agent or workflow field names them),
// so the union is closed-false unless a future caller supplies an explicit override.
import type { CapabilityRequirement } from './contracts.ts';
import { decodeCapabilityRequirement, normalizeCapabilityName } from './normalize.ts';

/** The four `workflows/defs.ts:277-280` fields this module reads. Everything else is out of scope. */
export interface WorkflowCapabilityFields {
  tools?: string[];
  skills?: string[];
  connectors?: Array<{ server: string; tools: string[] }>;
  filesystemRoots?: string[];
}

/**
 * The `agents/roster.ts:696-701` fields for ONE stage's assigned agent. `runtime` is the agent's
 * declared CLI runtime (`meta.runtime`, e.g. `'claude'`/`'codex'`) — the only existing declaration
 * source for a `clis` requirement; any other value (including `null`) contributes no CLI requirement.
 */
export interface StageAgentCapabilityFields {
  skills: readonly string[];
  connectors: ReadonlyArray<{ server: string; tools: readonly string[] }>;
  filesystemRoots: readonly string[];
  runtime: string | null;
}

const REQUIRABLE_CLI_RUNTIMES = new Set(['claude', 'codex']);

/**
 * Union connector tool sets by server so two agents naming the same server never collide as
 * duplicates. Keys the union `Map` by the W0-canonical server name (via `normalizeCapabilityName`)
 * rather than the raw pre-normalisation string — two agents spelling the same server differently
 * (`Gmail` vs `gmail`, `my_server` vs `my-server`) must union into one entry, not survive as two
 * that later trip `decodeCapabilityRequirement`'s duplicate-adjacent-server check. This is a
 * pre-merge key computation only; the single `decodeCapabilityRequirement` call below remains the
 * one normalisation-of-record for the returned requirement.
 */
function mergeConnectors(
  lists: ReadonlyArray<ReadonlyArray<{ server: string; tools: readonly string[] }>>,
): Array<{ server: string; tools: string[] }> {
  const byServer = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const { server, tools } of list) {
      const canonicalServer = normalizeCapabilityName(server);
      const toolSet = byServer.get(canonicalServer) ?? new Set<string>();
      for (const tool of tools) toolSet.add(tool);
      byServer.set(canonicalServer, toolSet);
    }
  }
  return [...byServer.entries()].map(([server, tools]) => ({ server, tools: [...tools] }));
}

/**
 * Compute the canonical placement `CapabilityRequirement` for a workflow run: the union of the
 * workflow's own declared fields and every one of its assigned stage agents' fields, normalised
 * exactly once through `decodeCapabilityRequirement` [§3.2, design:383]. `workflow.tools` is read but
 * deliberately unused — built-in tool ids are not part of `CapabilityRequirement` (§3.2: only
 * `connectors`, `skills`, `filesystemRoots`, `pty`, `gpu`, `clis` are requirable).
 */
export function computeCapabilityRequirement(
  workflow: WorkflowCapabilityFields,
  stageAgents: readonly StageAgentCapabilityFields[],
  overrides: { pty?: boolean; gpu?: boolean } = {},
): CapabilityRequirement {
  const skills = [...(workflow.skills ?? []), ...stageAgents.flatMap((agent) => [...agent.skills])];
  const filesystemRoots = [
    ...(workflow.filesystemRoots ?? []),
    ...stageAgents.flatMap((agent) => [...agent.filesystemRoots]),
  ];
  const connectors = mergeConnectors([
    (workflow.connectors ?? []).map((grant) => ({ server: grant.server, tools: grant.tools })),
    ...stageAgents.map((agent) => agent.connectors.map((grant) => ({ server: grant.server, tools: [...grant.tools] }))),
  ]);
  const clis = [...new Set(
    stageAgents
      .map((agent) => agent.runtime)
      .filter((runtime): runtime is string => runtime !== null && REQUIRABLE_CLI_RUNTIMES.has(runtime)),
  )];
  return decodeCapabilityRequirement({
    connectors,
    skills,
    filesystemRoots,
    pty: overrides.pty ?? false,
    gpu: overrides.gpu ?? false,
    clis,
  });
}
