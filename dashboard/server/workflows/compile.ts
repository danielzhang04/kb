/**
 * D15 — compile a validated workflow DEFINITION into a closed `kb.plan-proposal/v1` proposal.
 *
 * The output is deliberately the SAME wire shape the reviewed proposal machinery already admits, so a
 * launched definition reuses the proposal → approval → launch → canonical-cards path instead of a second
 * executor. The compiler adds only server-owned facts (routing from the runtime registry, the required
 * governance refs, minimal-valid stage envelopes) — it never widens capability. The derived proposalId
 * is a stable, deterministic function of the definition content, so the same definition always compiles
 * to the same proposal identity.
 */
import { createHash } from 'node:crypto';
import type { RuntimeSkillRegistry } from '../control/environment.ts';
import {
  PLAN_PROPOSAL_SCHEMA,
  type PlanProposal,
  type ProposalRiskTier,
  type ProposalStage,
  type ResolvedAgentAssignment,
} from '../control/proposal.ts';
import type { ExecutionProfile } from '../control/policy.ts';
import type { DeclaredAgentDetail } from '../agents/roster.ts';
import type { WorkflowDef, WorkflowManagerAssignment } from './defs.ts';

export interface CompileWorkflowEnvironment {
  registry: RuntimeSkillRegistry;
  /** Optional until a definition authors an assignment; then all three binding inputs are required. */
  declaredAgents?: ReadonlyMap<string, DeclaredAgentDetail>;
  executionProfiles?: readonly ExecutionProfile[];
  availableRuntimes?: ReadonlySet<'claude' | 'codex'>;
}

export type CompileWorkflowResult =
  | { ok: true; value: PlanProposal }
  | { ok: false; reason: string; detail: string };

type ResolvedAssignmentResult =
  | { ok: true; value: ResolvedAgentAssignment }
  | { ok: false; reason: string; detail: string };

const REQUIRED_GLOBAL_REFS = ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md'] as const;

/** Prefer a model whose id contains `hint`, else the first registered model for the runtime. */
function pickModel(models: readonly string[], hint: string): string | null {
  if (models.length === 0) return null;
  return models.find((model) => model.toLowerCase().includes(hint)) ?? models[0];
}

/** A stable, safe-id proposal identity derived only from the definition content. */
function deriveProposalId(def: WorkflowDef): string {
  const preimage = JSON.stringify({
    id: def.id,
    project: def.project,
    title: def.title,
    profile: def.profile,
    description: def.description,
    stages: def.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      action: stage.action,
      target: stage.target,
      workOrder: stage.workOrder,
      dependsOn: [...stage.dependsOn].sort(),
      riskTier: stage.riskTier,
      ...(stage.agentId && stage.profileId ? { agentId: stage.agentId, profileId: stage.profileId } : {}),
      ...(stage.workflowProfile ? { workflowProfile: stage.workflowProfile } : {}),
      ...(stage.review ? { review: stage.review } : {}),
      ...(stage.completionGate ? { completionGate: stage.completionGate } : {}),
    })),
    ...(def.manager ? { manager: { agentId: def.manager.agentId, profileId: def.manager.profileId } } : {}),
  });
  const hash = createHash('sha256').update(preimage, 'utf8').digest('hex');
  return `wf-${hash.slice(0, 48)}`;
}

function resolveAssignment(
  assignment: WorkflowManagerAssignment,
  role: 'manager' | 'worker',
  project: string,
  env: CompileWorkflowEnvironment,
): ResolvedAssignmentResult {
  if (!env.declaredAgents || !env.executionProfiles || !env.availableRuntimes) {
    return { ok: false, reason: 'assignment-binding-environment-missing', detail: 'authored agent assignments require declared agents, execution profiles, and available runtimes' };
  }
  const declaration = env.declaredAgents.get(assignment.agentId);
  if (!declaration || declaration.id !== assignment.agentId) {
    return { ok: false, reason: 'assigned-agent-not-declared', detail: `assigned agent '${assignment.agentId}' is not declared` };
  }
  if (!declaration.projects.includes(project)) {
    return { ok: false, reason: 'assigned-agent-project-mismatch', detail: `assigned agent '${assignment.agentId}' is not declared for project '${project}'` };
  }
  if (!declaration.runnerBound) {
    return { ok: false, reason: 'assigned-agent-not-runner-bound', detail: `assigned agent '${assignment.agentId}' is not runner-bound` };
  }
  if (!declaration.defaultProfile || !declaration.allowedProfiles
    || !declaration.allowedProfiles.includes(declaration.defaultProfile)
    || !declaration.allowedProfiles.includes(assignment.profileId)) {
    return { ok: false, reason: 'assigned-profile-not-allowed', detail: `assigned profile '${assignment.profileId}' is not allowed for agent '${assignment.agentId}'` };
  }
  const selected = env.executionProfiles.find((profile) => profile.id === assignment.profileId);
  if (!selected) {
    return { ok: false, reason: 'assigned-profile-not-found', detail: `assigned execution profile '${assignment.profileId}' is unavailable` };
  }
  if (selected.role !== role) {
    return { ok: false, reason: 'assigned-profile-role-mismatch', detail: `assigned execution profile '${assignment.profileId}' is not a ${role} profile` };
  }
  const declaredDefault = env.executionProfiles.find((profile) => profile.id === declaration.defaultProfile);
  if (!declaredDefault || declaration.runtime === null || declaration.model === null
    || declaredDefault.runtime !== declaration.runtime || declaredDefault.model !== declaration.model) {
    return { ok: false, reason: 'assigned-default-profile-mismatch', detail: `declared default profile for agent '${assignment.agentId}' does not match its declared runtime/model` };
  }
  if (declaredDefault.role !== role) {
    return { ok: false, reason: 'assigned-default-profile-role-mismatch', detail: `declared default profile for agent '${assignment.agentId}' is not a ${role} profile` };
  }
  if (!env.availableRuntimes.has(selected.runtime)) {
    return { ok: false, reason: 'assigned-runtime-unavailable', detail: `runtime '${selected.runtime}' is unavailable for assigned profile '${assignment.profileId}'` };
  }
  if (!(env.registry.runtimes[selected.runtime] ?? []).includes(selected.model)) {
    return { ok: false, reason: 'assigned-profile-routing-unregistered', detail: `assigned profile '${assignment.profileId}' routing is not registered` };
  }
  const declarationPath = `agents/${assignment.agentId}.md`;
  if (declaration.source !== declarationPath || !/^[a-f0-9]{64}$/.test(declaration.sourceHash)) {
    return { ok: false, reason: 'assigned-declaration-invalid', detail: `declaration for agent '${assignment.agentId}' has an invalid canonical source` };
  }
  return {
    ok: true,
    value: {
      agentId: assignment.agentId,
      declarationPath,
      declarationHash: declaration.sourceHash,
      profileId: selected.id,
      runtime: selected.runtime,
      model: selected.model,
    },
  };
}

function firstLine(text: string, fallback: string): string {
  const line = text.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0);
  const summary = (line ?? fallback).replace(/^#+\s*/, '').slice(0, 4_000);
  return summary.trim() === '' ? fallback : summary;
}

function highestTier(stages: readonly { riskTier: ProposalRiskTier }[]): ProposalRiskTier {
  const rank = { T1: 1, T2: 2, T3: 3 } as const;
  return stages.reduce<ProposalRiskTier>((max, stage) => (rank[stage.riskTier] > rank[max] ? stage.riskTier : max), 'T1');
}

/**
 * Compile `def` into a validated-shape proposal. The caller is expected to run the result through
 * `validatePlanProposal` / the store; this function only assembles the closed shape and picks routing.
 */
export function compileWorkflowDef(def: WorkflowDef, env: CompileWorkflowEnvironment): CompileWorkflowResult {
  const claudeModels = env.registry.runtimes.claude ?? [];
  const needsDefaultManager = def.manager === undefined;
  const needsDefaultWorker = def.stages.some((stage) => stage.agentId === undefined);
  const managerModel = needsDefaultManager ? pickModel(claudeModels, 'opus') : null;
  const workerModel = needsDefaultWorker ? pickModel(claudeModels, 'sonnet') : null;
  if ((needsDefaultManager && !managerModel) || (needsDefaultWorker && !workerModel)) {
    return { ok: false, reason: 'no-registered-claude-models', detail: 'the runtime registry has no registered claude models to route the manager and workers' };
  }

  let managerAssignment: ResolvedAgentAssignment | undefined;
  if (def.manager) {
    const resolved = resolveAssignment(def.manager, 'manager', def.project, env);
    if (!resolved.ok) return resolved;
    managerAssignment = resolved.value;
  }

  const writeTargets = [...new Set(def.stages.map((stage) => stage.target))];
  const readScope = [`orgs/${def.project}`];
  const proposalScope = { read: readScope, write: writeTargets };

  const stages: ProposalStage[] = [];
  for (const stage of def.stages) {
    let assignment: ResolvedAgentAssignment | undefined;
    if (stage.agentId !== undefined && stage.profileId !== undefined) {
      const resolved = resolveAssignment({ agentId: stage.agentId, profileId: stage.profileId }, 'worker', def.project, env);
      if (!resolved.ok) return resolved;
      assignment = resolved.value;
    }
    if (stage.review && stage.workflowProfile !== 'checker-readonly') {
      return { ok: false, reason: 'review-workflow-profile-required', detail: `review stage '${stage.id}' requires workflowProfile 'checker-readonly'` };
    }
    if (stage.workflowProfile !== undefined && !(env.registry.workflowProfiles ?? []).includes(stage.workflowProfile)) {
      return { ok: false, reason: 'stage-workflow-profile-unavailable', detail: `stage '${stage.id}' workflow profile '${stage.workflowProfile}' is not server-owned` };
    }
    stages.push({
      id: stage.id,
      title: stage.title,
      action: stage.action,
      target: stage.target,
      workOrder: stage.workOrder,
      riskTier: stage.riskTier,
      dependsOn: [...stage.dependsOn],
      worker: assignment ? { runtime: assignment.runtime, model: assignment.model } : { runtime: 'claude', model: workerModel as string },
      requiredSkills: [],
      // Minimal-valid stage envelope: the stage reads its org and writes only its own declared target.
      scope: { read: readScope, write: [stage.target] },
      artifacts: [],
      checkpoints: [],
      humanGates: [],
      ...(assignment ? { assignment } : {}),
      ...(stage.workflowProfile ? { workflowProfile: stage.workflowProfile } : {}),
      ...(stage.review ? { review: structuredClone(stage.review) } : {}),
      ...(stage.completionGate ? { completionGate: { ...stage.completionGate } } : {}),
    });
  }

  const governanceRefs = [...REQUIRED_GLOBAL_REFS, `orgs/${def.project}/contract.md`];
  const summary = firstLine(def.description, `Workflow ${def.id} (${highestTier(stages)}, ${def.stages.length} stage${def.stages.length === 1 ? '' : 's'}).`);

  const proposal: PlanProposal = {
    schema: PLAN_PROPOSAL_SCHEMA,
    proposalId: deriveProposalId(def),
    project: def.project,
    title: def.title,
    summary,
    manager: {
      runtime: managerAssignment?.runtime ?? 'claude',
      model: managerAssignment?.model ?? managerModel as string,
      requiredSkills: [],
      ...(managerAssignment ? { assignment: managerAssignment } : {}),
    },
    scope: proposalScope,
    governanceRefs,
    stages,
    // Carry the profile as DATA, not merely as hash preimage. Without this line the declared
    // profile reaches deriveProposalId and nothing else, so the worker spawns with NO
    // --allowedTools at all — a capability cap that reads as enforced while capping nothing.
    // `def.profile` is required by the def schema and already validated against the server-owned
    // closed set (defs.ts:227), so an unresolvable profile refuses the spawn rather than widening it.
    profile: def.profile,
  };
  return { ok: true, value: proposal };
}
