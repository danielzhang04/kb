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
  type ProposalIterationGroup,
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

/**
 * Compute the effective read scope: the declared roots unioned with the def's own `orgs/<project>`
 * tree, order-stable and duplicate-free. A def WITHOUT `readScope` yields exactly `[orgs/<project>]` —
 * byte-identical to the pre-change hardcode, the migration guarantee. The own-org tree is ALWAYS
 * present (the worker must read the tree it writes into), so a def can only ADD read roots, never
 * narrow below its own tree. See docs/specs/2026-07-21-worker-read-scope-design.md §4.2.
 */
function effectiveReadScope(def: WorkflowDef): string[] {
  return [...new Set([...def.readScope, `orgs/${def.project}`])];
}

/** A stable, safe-id proposal identity derived only from the definition content. */
function deriveProposalId(
  def: WorkflowDef,
  effectiveRead: readonly string[],
  iterationGroups: readonly ProposalIterationGroup[],
): string {
  const preimage = JSON.stringify({
    id: def.id,
    project: def.project,
    title: def.title,
    // Omitted standard mode preserves pre-existing definition proposal identities. The non-default
    // validation mode is explicitly committed, so weakening/removing its publication prohibition
    // always forces a fresh approval.
    ...(def.executionMode === 'validation-slice' ? { executionMode: def.executionMode } : {}),
    profile: def.profile,
    // The effective read scope is part of the approved proposal identity: a changed read scope changes
    // the proposalId, forcing re-approval. Without this the scan roots would be tamper-silent. (§4.2)
    readScope: [...effectiveRead],
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
      // Declared gates are part of the approved proposal identity: editing, renaming, or deleting a
      // gate (or flipping `spendAuthorization`) must change the proposalId and force re-approval,
      // or the halt structure would be tamper-silent. Emitted only when present, so definitions
      // without gates keep their existing proposalId exactly.
      ...(stage.humanGates?.length ? { humanGates: stage.humanGates } : {}),
      // Declared artifacts are part of the approved identity for the same reason: they are the
      // server-verified condition on a stage's success (`execution.ts#validateWorkerResultEnvelope`), so deleting or
      // weakening one must force re-approval rather than silently lowering the bar on a live run.
      // Emitted only when present, so definitions without artifacts keep their existing proposalId.
      ...(stage.artifacts?.length ? { artifacts: stage.artifacts } : {}),
    })),
    ...(iterationGroups.length > 0 ? { iterationGroups } : {}),
    ...(def.manager ? { manager: { agentId: def.manager.agentId, profileId: def.manager.profileId } } : {}),
  });
  const hash = createHash('sha256').update(preimage, 'utf8').digest('hex');
  return `wf-${hash.slice(0, 48)}`;
}

type IterationCompilation =
  | { ok: true; groups: ProposalIterationGroup[]; dependsOn: Map<string, string[]> }
  | { ok: false; reason: string; detail: string };

function compileIterationGroups(def: WorkflowDef): IterationCompilation {
  const stageById = new Map(def.stages.map((stage) => [stage.id, stage]));
  const groups: ProposalIterationGroup[] = [];
  const occupiedStages = new Set<string>();
  const authored = def.iterationGroups ?? [];
  for (const group of authored) {
    for (const participant of group.participants) {
      if (!stageById.has(participant.stageRef)) {
        return { ok: false, reason: 'iteration-stage-reference-invalid', detail: `iteration group '${group.iterationGroupId}' names missing stage '${participant.stageRef}'` };
      }
      if (occupiedStages.has(participant.stageRef)) {
        return { ok: false, reason: 'iteration-stage-shared', detail: `stage '${participant.stageRef}' belongs to more than one iteration group` };
      }
      occupiedStages.add(participant.stageRef);
    }
    const routes: ProposalIterationGroup['routes'] = [];
    for (const route of group.routes) {
      const sender = group.participants.find((participant) => participant.participantId === route.senderParticipantId);
      const recipient = group.participants.find((participant) => participant.participantId === route.recipientParticipantId);
      if (!sender || !recipient) {
        return { ok: false, reason: 'iteration-route-reference-invalid', detail: `iteration route '${route.routeId}' names an unknown participant` };
      }
      const baseResolutionStageIds = group.routes
        .filter((candidate) => candidate.recipientParticipantId === recipient.participantId)
        .map((candidate) => group.participants.find((participant) => participant.participantId === candidate.senderParticipantId)?.stageRef)
        .filter((stageRef): stageRef is string => stageRef !== undefined);
      routes.push({ ...structuredClone(route), baseResolutionStageIds: [...new Set(baseResolutionStageIds)] });
    }
    groups.push({ ...structuredClone(group), routes });
  }
  for (const reviewStage of def.stages.filter((stage) => stage.review !== undefined)) {
    const review = reviewStage.review!;
    if (!Number.isSafeInteger(review.maxCreatorReworks) || review.maxCreatorReworks < 0
      || review.maxCreatorReworks > Number.MAX_SAFE_INTEGER - 1) {
      return {
        ok: false,
        reason: 'legacy-review-bound-unsafe',
        detail: `review stage '${reviewStage.id}' maxCreatorReworks must be a nonnegative safe integer that can be incremented`,
      };
    }
    const subject = stageById.get(review.subjectStageId);
    if (!subject) return { ok: false, reason: 'legacy-review-subject-missing', detail: `review stage '${reviewStage.id}' names missing subject '${review.subjectStageId}'` };
    if (!subject.artifacts || subject.artifacts.length === 0) {
      return {
        ok: false,
        reason: 'legacy-review-artifacts-required',
        detail: `review stage '${reviewStage.id}' subject '${subject.id}' must declare at least one artifact`,
      };
    }
    if (occupiedStages.has(subject.id) || occupiedStages.has(reviewStage.id)) {
      return { ok: false, reason: 'iteration-stage-shared', detail: `legacy review '${reviewStage.id}' overlaps another iteration group` };
    }
    occupiedStages.add(subject.id);
    occupiedStages.add(reviewStage.id);
    const managerParticipantId = `${subject.id}-manager`;
    const judgeParticipantId = `${reviewStage.id}-judge`;
    const reviewStepId = `${reviewStage.id}-review`;
    const reworkStepId = `${reviewStage.id}-rework`;
    const toJudgeRouteId = `${reviewStage.id}-to-judge`;
    const toManagerRouteId = `${reviewStage.id}-to-manager`;
    groups.push({
      iterationGroupId: `${reviewStage.id}-iteration`,
      goal: `Accept '${subject.title}' against the declared review criteria.`,
      participants: [
        {
          participantId: managerParticipantId,
          stageRef: subject.id,
          role: 'manager',
          perspective: `Own the artifact produced by stage '${subject.id}'.`,
          mandate: subject.workOrder,
        },
        {
          participantId: judgeParticipantId,
          stageRef: reviewStage.id,
          role: 'judge',
          perspective: `Apply the declared criteria to stage '${subject.id}' without changing its artifact.`,
          mandate: reviewStage.workOrder,
        },
      ],
      routes: [
        {
          routeId: toJudgeRouteId,
          senderParticipantId: managerParticipantId,
          recipientParticipantId: judgeParticipantId,
          requestKinds: ['review'],
          baseResolutionStageIds: [subject.id],
        },
        {
          routeId: toManagerRouteId,
          senderParticipantId: judgeParticipantId,
          recipientParticipantId: managerParticipantId,
          requestKinds: ['rework'],
          baseResolutionStageIds: [reviewStage.id],
        },
      ],
      activation: {
        seedParticipantId: managerParticipantId,
        seedArtifactIds: (subject.artifacts ?? []).map((artifact) => artifact.id),
      },
      initialStepId: reviewStepId,
      schedule: [
        {
          stepId: reviewStepId,
          routeId: toJudgeRouteId,
          after: { stepId: reworkStepId, participantId: managerParticipantId, verdict: 'fulfilled' },
          cycle: 'next',
        },
        {
          stepId: reworkStepId,
          routeId: toManagerRouteId,
          after: { stepId: reviewStepId, participantId: judgeParticipantId, verdict: 'fail' },
          cycle: 'current',
        },
      ],
      artifacts: (subject.artifacts ?? []).map((artifact) => artifact.id),
      criteria: structuredClone(review.criteria),
      maxCycles: review.maxCreatorReworks + 1,
      cycleUnit: `One '${subject.id}' generation followed by one '${reviewStage.id}' verdict.`,
      terminalAuthorities: [{ participantId: judgeParticipantId, verdict: 'pass' }],
      ...(reviewStage.completionGate ? { completionGate: structuredClone(reviewStage.completionGate) } : {}),
    });
  }
  const dependsOn = new Map(def.stages.map((stage) => [stage.id, [...stage.dependsOn]]));
  for (const group of groups) {
    const seed = group.participants.find((participant) => participant.participantId === group.activation.seedParticipantId);
    if (!seed) return { ok: false, reason: 'iteration-activation-invalid', detail: `iteration group '${group.iterationGroupId}' has no activation seed` };
    for (const participant of group.participants) {
      if (participant.stageRef === seed.stageRef) continue;
      const dependencies = dependsOn.get(participant.stageRef);
      if (!dependencies) return { ok: false, reason: 'iteration-stage-reference-invalid', detail: `iteration group '${group.iterationGroupId}' names missing stage '${participant.stageRef}'` };
      if (!dependencies.includes(seed.stageRef)) dependencies.push(seed.stageRef);
    }
  }
  const indegree = new Map(def.stages.map((stage) => [stage.id, dependsOn.get(stage.id)?.length ?? 0]));
  const children = new Map(def.stages.map((stage) => [stage.id, [] as string[]]));
  for (const [stageId, dependencies] of dependsOn) for (const dependency of dependencies) children.get(dependency)?.push(stageId);
  const ready = def.stages.filter((stage) => (dependsOn.get(stage.id)?.length ?? 0) === 0).map((stage) => stage.id);
  let visited = 0;
  while (ready.length > 0) {
    const stageId = ready.pop() as string;
    visited += 1;
    for (const child of children.get(stageId) ?? []) {
      const remaining = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (visited !== def.stages.length) {
    return { ok: false, reason: 'iteration-dependency-cycle', detail: 'iteration activation wiring would create a cyclic stage dependency graph' };
  }
  return { ok: true, groups, dependsOn };
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

/**
 * Render a declared artifact path for the COMPILED proposal.
 *
 * A launch always substitutes first (`instantiateWorkflowDef` → `launchDefinition`), so a run's declared
 * artifacts are the real files. But raw, uninstantiated definitions are also compiled — the workflows
 * list builds a compile preview from one, and the assignment/governance amendment route compiles the
 * before/after definition and runs it through `validateServerCompiledPlanProposal`. A path still holding
 * `<channel>` fails that validator outright (`<` is not a safe path segment character), which would turn
 * every parameterised definition into "compiled-proposal-invalid" the moment it declared an artifact.
 *
 * So an unsubstituted placeholder is rendered as a path-safe, obviously-symbolic segment instead. The
 * artifact list is therefore never silently emptied — the declared success bar shows up in every compile
 * — and if an uninstantiated definition ever were launched, its artifacts would point at paths that do
 * not exist, so the stage parks for a human rather than succeeding on an unverifiable claim.
 */
function compiledArtifactPath(path: string): string {
  return path.replace(/<([A-Za-z0-9][A-Za-z0-9._-]{0,63})>/g, 'unresolved-parameter-$1');
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
  // Parser validation is the first boundary. Keep this independent compiler assertion because callers
  // can construct a WorkflowDef programmatically: a validation slice must never acquire a release
  // stage through a bypassed parser, an approved G4, or a forged completion artifact.
  if (def.executionMode === 'validation-slice') {
    const forbidden = def.stages.find((stage) => stage.action.startsWith('publish:')
      || stage.riskTier === 'T3'
      || stage.humanGates?.some((gate) => gate.publicationAuthorization === true));
    if (forbidden) {
      return {
        ok: false,
        reason: 'validation-slice-publication-forbidden',
        detail: `validation-slice workflow cannot compile publication-capable stage '${forbidden.id}'`,
      };
    }
  }
  const reviewStageIds = new Set(def.stages.filter((stage) => stage.review !== undefined).map((stage) => stage.id));
  const reviewSubjects = new Set<string>();
  for (const stage of def.stages) {
    if (!stage.review) continue;
    const subjectStageId = stage.review.subjectStageId;
    if (stage.dependsOn.length !== 1 || stage.dependsOn[0] !== subjectStageId) {
      return { ok: false, reason: 'review-depends-on-subject-only', detail: `review stage '${stage.id}' must depend only on its subject '${subjectStageId}'` };
    }
    if (reviewSubjects.has(subjectStageId)) {
      return { ok: false, reason: 'duplicate-review-subject', detail: `multiple review stages target subject '${subjectStageId}'` };
    }
    if (reviewStageIds.has(subjectStageId)) {
      return { ok: false, reason: 'review-of-review-not-allowed', detail: `review stage '${stage.id}' cannot review review stage '${subjectStageId}'` };
    }
    reviewSubjects.add(subjectStageId);
  }
  const iterationCompilation = compileIterationGroups(def);
  if (!iterationCompilation.ok) return iterationCompilation;
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

  // Structured checker stages inspect their subject's immutable canonical result and must not write.
  // Their authored `target` remains routing/context metadata, not a capability grant. Proposal-level
  // write scope therefore contains creator targets only.
  const writeTargets = [...new Set(def.stages.filter((stage) => !stage.review).map((stage) => stage.target))];
  const readScope = effectiveReadScope(def);
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
      dependsOn: [...(iterationCompilation.dependsOn.get(stage.id) ?? stage.dependsOn)],
      worker: assignment ? { runtime: assignment.runtime, model: assignment.model } : { runtime: 'claude', model: workerModel as string },
      requiredSkills: [],
      // Minimal-valid stage envelope: the stage reads its org and writes only its own declared target.
      scope: { read: readScope, write: stage.review ? [] : [stage.target] },
      // The declared artifacts ARE the compiled artifacts. This was hardcoded `[]` for its whole life,
      // which made the server-side declared-artifact verification in `execution.ts` iterate an empty
      // list: a successful result with nothing on disk was accepted, and the
      // run advanced to the next human gate asking for approval of a file that was never written.
      artifacts: (stage.artifacts ?? []).map((artifact) => ({ ...artifact, path: compiledArtifactPath(artifact.path) })),
      checkpoints: [],
      // The declared gates ARE the compiled gates. Anything hardcoded here would make an org
      // definition's declared halt structure unenforceable at `execution.ts#stageBoundary`.
      humanGates: (stage.humanGates ?? []).map((gate) => ({
        id: gate.id,
        kind: gate.kind,
        prompt: gate.prompt,
        ...(gate.spendAuthorization === undefined ? {} : { spendAuthorization: gate.spendAuthorization }),
        ...(gate.publicationAuthorization === undefined ? {} : { publicationAuthorization: gate.publicationAuthorization }),
      })),
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
    proposalId: deriveProposalId(def, readScope, iterationCompilation.groups),
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
    ...(iterationCompilation.groups.length > 0 ? { iterationGroups: iterationCompilation.groups } : {}),
    // Carry the profile as DATA, not merely as hash preimage. Without this line the declared
    // profile reaches deriveProposalId and nothing else, so the worker spawns with NO
    // --allowedTools at all — a capability cap that reads as enforced while capping nothing.
    // `def.profile` is required by the def schema and already validated against the server-owned
    // closed set (defs.ts:227), so an unresolvable profile refuses the spawn rather than widening it.
    profile: def.profile,
    // The substituted launch values, as data. `instantiateWorkflowDef` is the only writer; a definition
    // without parameters emits nothing here and keeps its existing proposal identity.
    ...(def.launchParameters && Object.keys(def.launchParameters).length > 0
      ? { parameters: { ...def.launchParameters } }
      : {}),
  };
  return { ok: true, value: proposal };
}
