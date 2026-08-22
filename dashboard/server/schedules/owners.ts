import type { RunnableRef } from '../control/p2Contracts.ts';
import type { RunnableSelector } from '../entities/contracts.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';

/** Resolve one persisted Schedule owner against the catalogs served in this request. */
export function resolveScheduleOwner(repoRoot: string, selector: RunnableSelector): RunnableRef | null {
  if (selector.type === 'agent') {
    const declaration = readDeclaredAgentDetails(repoRoot).get(selector.id);
    return declaration && (declaration.group === 'system' || declaration.projects.length > 0)
      ? { type: 'agent', id: declaration.id, sourcePath: declaration.source as `agents/${string}.md` }
      : null;
  }
  const matches = scanWorkflowDefs(repoRoot).filter((candidate) =>
    candidate.entry.ref === selector.id && candidate.def !== null);
  const workflow = matches.length === 1 ? matches[0] : null;
  return workflow ? {
    type: 'workflow', id: workflow.entry.ref, project: workflow.entry.project,
    sourcePath: workflow.entry.path as `orgs/${string}/workflows/${string}.md`,
  } : null;
}

/** Current runnable catalog used by Health's W5 integrity projector. */
export function declaredScheduleOwners(repoRoot: string): RunnableRef[] {
  const agents: RunnableRef[] = [...readDeclaredAgentDetails(repoRoot).values()]
    .filter((declaration) => declaration.group === 'system' || declaration.projects.length > 0)
    .map((declaration) => ({
      type: 'agent' as const, id: declaration.id,
      sourcePath: declaration.source as `agents/${string}.md`,
    }));
  const workflows: RunnableRef[] = scanWorkflowDefs(repoRoot)
    .filter((candidate) => candidate.def !== null)
    .map((workflow) => ({
      type: 'workflow' as const, id: workflow.entry.ref, project: workflow.entry.project,
      sourcePath: workflow.entry.path as `orgs/${string}/workflows/${string}.md`,
    }));
  return [...agents, ...workflows];
}
