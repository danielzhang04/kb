import type { WorkflowRunRequest } from '../write/workflowRun.ts';
import type { PlanProposal, ProposalHumanGate } from './proposal.ts';
import { classifyActionRisk, evaluateExecutionPolicy, type PolicyDecision, type PolicyEnvironment } from './policy.ts';

export interface CompileEnvironment {
  policy: PolicyEnvironment;
  defaultWorkers: Record<string, string>;
}

export interface CompiledStagePolicy {
  stageId: string;
  decision: PolicyDecision;
}

export interface CompiledPlan {
  /** Null while any T3 stage remains approval-bound; v1 card publication admits T1/T2 only. */
  workflow: WorkflowRunRequest | null;
  managerProfileId: string;
  stagePolicies: CompiledStagePolicy[];
  humanGates: Array<{ stageId: string; gate: ProposalHumanGate }>;
}

export type CompileResult = { ok: true; value: CompiledPlan } | { ok: false; reason: string; detail: string };

function contains(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`));
}

/** Compile only validated proposal data plus server-owned policy/worker registries. */
export function compileApprovedProposal(
  proposal: PlanProposal,
  proposalHash: string,
  approvedHash: string | null,
  environment: CompileEnvironment,
): CompileResult {
  const manager = environment.policy.profiles.find((profile) =>
    profile.role === 'manager' && profile.runtime === proposal.manager.runtime && profile.model === proposal.manager.model,
  );
  if (!manager) return { ok: false, reason: 'manager-profile-refused', detail: 'manager runtime/model is not a server-owned profile' };
  const managerSkill = proposal.manager.requiredSkills.find((skill) => !environment.policy.curatedSkills.has(skill));
  if (managerSkill) return { ok: false, reason: 'manager-skill-refused', detail: `manager skill '${managerSkill}' is not curated` };

  const stagePolicies: CompiledStagePolicy[] = [];
  const humanGates: CompiledPlan['humanGates'] = [];
  const stages: WorkflowRunRequest['stages'] = [];
  let runnableWorkflow = true;
  for (const stage of proposal.stages) {
    const classified = classifyActionRisk(stage.action);
    if (classified.disposition === 'forbidden') {
      return { ok: false, reason: 'action-capability-refused', detail: `stage '${stage.id}': ${classified.reason}` };
    }
    const rank = { T1: 1, T2: 2, T3: 3 } as const;
    if (rank[stage.riskTier] < rank[classified.minimumTier]) {
      return {
        ok: false,
        reason: 'risk-tier-underclassified',
        detail: `stage '${stage.id}' action '${stage.action}' requires at least ${classified.minimumTier}`,
      };
    }
    if (stage.scope.read.some((path) => !contains(path, proposal.scope.read)) || stage.scope.write.some((path) => !contains(path, proposal.scope.write))) {
      return { ok: false, reason: 'scope-widening-refused', detail: `stage '${stage.id}' widens the proposal scope` };
    }
    const artifactOutsideScope = stage.artifacts.find((artifact) => !contains(artifact.path, stage.scope.write));
    if (artifactOutsideScope) {
      return { ok: false, reason: 'artifact-scope-refused', detail: `artifact '${artifactOutsideScope.id}' is outside stage '${stage.id}' write scope` };
    }
    const owner = environment.defaultWorkers[stage.worker.runtime];
    if (!owner) return { ok: false, reason: 'runtime-unbound', detail: `runtime '${stage.worker.runtime}' has no registered default worker` };
    const decision = evaluateExecutionPolicy({
      project: proposal.project,
      riskTier: stage.riskTier,
      role: 'worker',
      runtime: stage.worker.runtime as 'claude' | 'codex',
      model: stage.worker.model,
      target: stage.target,
      requiredSkills: stage.requiredSkills,
      scope: stage.scope,
      governanceRefs: proposal.governanceRefs,
      proposalHash,
      approvedHash,
    }, environment.policy);
    stagePolicies.push({ stageId: stage.id, decision });
    if (decision.disposition === 'refuse') {
      return { ok: false, reason: 'governance-refused', detail: `stage '${stage.id}': ${decision.reason}` };
    }
    for (const gate of stage.humanGates) humanGates.push({ stageId: stage.id, gate });
    if (stage.riskTier === 'T3') {
      runnableWorkflow = false;
      continue;
    }
    stages.push({
      id: stage.id,
      action: stage.action,
      target: stage.target,
      workOrder: stage.workOrder,
      riskTier: stage.riskTier,
      owner,
      dependsOn: [...stage.dependsOn],
    });
  }
  return {
    ok: true,
    value: {
      workflow: runnableWorkflow
        ? { name: proposal.proposalId, project: proposal.project, workflowDefinitionId: proposal.proposalId, stages }
        : null,
      managerProfileId: manager.id,
      stagePolicies,
      humanGates,
    },
  };
}
