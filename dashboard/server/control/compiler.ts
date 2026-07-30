import type { WorkflowRunRequest } from '../write/workflowRun.ts';
import type { PlanProposal } from './proposal.ts';
import {
  classifyActionRisk,
  evaluateExecutionPolicy,
  policyScopeForStage,
  type PolicyDecision,
  type PolicyEnvironment,
} from './policy.ts';

export interface CompileEnvironment {
  policy: PolicyEnvironment;
  defaultWorkers: Record<string, string>;
}

export interface CompiledStagePolicy {
  stageId: string;
  decision: PolicyDecision;
  /**
   * True when this stage's `waiting-human` decision is EXACTLY the content-bound wait that the stage's
   * OWN declared publication-authorization gate resolves at its entry boundary
   * (`execution.ts#stageBoundary` creates that boundary, and `stagePublicationAuthorization` records the
   * approval against it). Such a wait is not a launch-time refusal: the human decision the policy
   * demands exists, it simply has not been made yet, and it is made in front of the stage that spends or
   * publishes — not against a run the operator cannot yet inspect.
   *
   * Fail-closed by construction: it is false unless the stage declares an `approval` gate carrying
   * `publicationAuthorization: true` AND the decision's reason is one of the publication waits that gate
   * can clear. Every other `waiting-human` reason (missing governance reference, unapproved revision,
   * out-of-scope target, a T3 stage that declared no such gate) keeps its pre-existing launch-time park.
   */
  releasableByStageGate: boolean;
}

export interface CompiledPlan {
  /**
   * Null while a T3 stage remains approval-bound with NO declared publication-authorization gate — the
   * pre-existing fail-closed posture: nothing tells the server which human decision would release that
   * content, so its cards are never published. A T3 stage whose own declared gate carries
   * `publicationAuthorization: true` IS releasable (by that gate's approval at its entry boundary), so it
   * compiles into the card DAG and the run becomes launchable.
   */
  workflow: WorkflowRunRequest | null;
  managerProfileId: string;
  stagePolicies: CompiledStagePolicy[];
}

export type CompileResult = { ok: true; value: CompiledPlan } | { ok: false; reason: string; detail: string };

/**
 * The ONLY `waiting-human` reasons a stage's own declared publication-authorization gate can clear.
 * Anything outside this set is not a content decision a human approval releases, so it must keep
 * blocking the launch even when the stage happens to declare a publication gate.
 */
const PUBLICATION_GATE_RELEASABLE_WAITS: ReadonlySet<string> = new Set([
  't3-content-bound-approval-required',
  'declared-publication-gate-awaiting-human-authorization',
  'external-publication-requires-t3-approval',
]);

/**
 * Whether a stage declares its own content-bound publication authorization. `proposal.ts` already
 * refuses `publicationAuthorization` on any gate kind other than `approval`; re-checking the kind here
 * keeps the compiler's own reading fail-closed rather than dependent on an upstream validator.
 */
function declaresPublicationGate(stage: PlanProposal['stages'][number]): boolean {
  return stage.humanGates.some((gate) => gate.kind === 'approval' && gate.publicationAuthorization === true);
}

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
    // A declared publication gate is reported as `pending`, never `approved`: the compiler has no run
    // state, so it can only say that the naming decision EXISTS. Only `execution.ts` — reading the run's
    // own resolved, stage-scoped, gate-scoped approval — may ever produce `approved`.
    const publicationGate = declaresPublicationGate(stage);
    const decision = evaluateExecutionPolicy({
      project: proposal.project,
      riskTier: stage.riskTier,
      role: 'worker',
      runtime: stage.worker.runtime as 'claude' | 'codex',
      model: stage.worker.model,
      target: stage.target,
      requiredSkills: stage.requiredSkills,
      scope: policyScopeForStage(stage.scope, Boolean(stage.review)),
      governanceRefs: proposal.governanceRefs,
      proposalHash,
      approvedHash,
      ...(publicationGate ? { publicationAuthorization: 'pending' as const } : {}),
    }, environment.policy);
    const releasableByStageGate = publicationGate
      && decision.disposition === 'waiting-human'
      && PUBLICATION_GATE_RELEASABLE_WAITS.has(decision.reason);
    stagePolicies.push({ stageId: stage.id, decision, releasableByStageGate });
    if (decision.disposition === 'refuse') {
      return { ok: false, reason: 'governance-refused', detail: `stage '${stage.id}': ${decision.reason}` };
    }
    // A T3 stage with no releasing gate keeps the original posture: no card DAG at all, so nothing of
    // this run is ever published. A T3 stage whose own gate releases it falls through and is published
    // like any other stage — its upload is still held by that gate at its entry boundary.
    if (stage.riskTier === 'T3' && !releasableByStageGate) {
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
    },
  };
}
