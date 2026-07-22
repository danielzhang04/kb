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
} from '../control/proposal.ts';
import type { WorkflowDef } from './defs.ts';

export interface CompileWorkflowEnvironment {
  registry: RuntimeSkillRegistry;
}

export type CompileWorkflowResult =
  | { ok: true; value: PlanProposal }
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
function deriveProposalId(def: WorkflowDef, effectiveRead: readonly string[]): string {
  const preimage = JSON.stringify({
    id: def.id,
    project: def.project,
    title: def.title,
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
    })),
  });
  const hash = createHash('sha256').update(preimage, 'utf8').digest('hex');
  return `wf-${hash.slice(0, 48)}`;
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
  const managerModel = pickModel(claudeModels, 'opus');
  const workerModel = pickModel(claudeModels, 'sonnet');
  if (!managerModel || !workerModel) {
    return { ok: false, reason: 'no-registered-claude-models', detail: 'the runtime registry has no registered claude models to route the manager and workers' };
  }

  const writeTargets = [...new Set(def.stages.map((stage) => stage.target))];
  const readScope = effectiveReadScope(def);
  const proposalScope = { read: readScope, write: writeTargets };

  const stages: ProposalStage[] = def.stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    action: stage.action,
    target: stage.target,
    workOrder: stage.workOrder,
    riskTier: stage.riskTier,
    dependsOn: [...stage.dependsOn],
    worker: { runtime: 'claude', model: workerModel },
    requiredSkills: [],
    // Minimal-valid stage envelope: the stage reads its org and writes only its own declared target.
    scope: { read: readScope, write: [stage.target] },
    artifacts: [],
    checkpoints: [],
    humanGates: [],
  }));

  const governanceRefs = [...REQUIRED_GLOBAL_REFS, `orgs/${def.project}/contract.md`];
  const summary = firstLine(def.description, `Workflow ${def.id} (${highestTier(stages)}, ${def.stages.length} stage${def.stages.length === 1 ? '' : 's'}).`);

  const proposal: PlanProposal = {
    schema: PLAN_PROPOSAL_SCHEMA,
    proposalId: deriveProposalId(def, readScope),
    project: def.project,
    title: def.title,
    summary,
    manager: { runtime: 'claude', model: managerModel, requiredSkills: [] },
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
