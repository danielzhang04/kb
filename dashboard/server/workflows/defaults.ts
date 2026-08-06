/**
 * Workflow DEFAULT ASSIGNMENT resolution — who WILL run each stage when nobody has assigned anyone.
 *
 * Product doctrine (Daniel, binding): "Each workflow should have a default manager. Each agent should be
 * running on a default model. I don't want to have to assign them each time I want to run a workflow. A
 * workflow should be comprised of a specific chain of agents interacting in a specific way."
 *
 * So assignment is never presented as required work. This module answers, for a definition that may
 * declare NOTHING executable, the honest question "who runs this?" — from the declaration's own
 * governance chain (`governedBy` at the workflow level and at each stage) and, failing that, from the
 * declared-agent roster of the definition's project.
 *
 * It is PURE: no filesystem, no network, no clock. Callers pass the roster in (the same
 * `AgentRosterEntry[]` `/api/agents` serves), which is what makes the whole rule unit-testable and lets
 * the caller compute the roster ONCE per scan instead of once per definition.
 *
 * It also invents nothing. `model` is always the roster entry's EFFECTIVE model (`effective.model`, the
 * routing projection) — there is no fallback model table here and no new model-routing mechanism. An
 * agent named by a definition but absent from the declared roster resolves with `model: null` rather
 * than a guess, and genuine ambiguity (two declared managers in one project) resolves to `null` rather
 * than a coin flip.
 */
import { executionAssignmentRole, type AgentRosterEntry } from '../agents/roster.ts';
import type { WorkflowDef, WorkflowStageDef } from './defs.ts';

/** Which rung of the precedence ladder produced a resolved assignment. */
export type AssignmentSource =
  /** the def itself declared it (`manager:` / a stage's `agentId`+`profileId`) */
  | 'declared'
  /** the def's `governedBy` names a declared roster agent */
  | 'governed-by'
  /** a STAGE's own `governedBy` names a declared roster agent */
  | 'stage-governed-by'
  /** exactly one DECLARED agent in the def's project has manager role */
  | 'project-manager'
  /** the def's project has exactly one DECLARED agent */
  | 'sole-project-agent'
  /** a stage with no declared assignment and no stage governor inherits the resolved manager */
  | 'manager-default';

export interface ResolvedAssignment {
  agentId: string;
  /** The declared assignment's profileId, else the agent declaration's `defaultProfile`, else null. */
  profileId: string | null;
  /** The agent's EFFECTIVE model from the roster; null when no roster entry resolves. */
  model: string | null;
  source: AssignmentSource;
}

export interface WorkflowDefaults {
  manager: ResolvedAssignment | null;
  /** Keyed by stage id. `null` means nothing resolvable — say so honestly, never fabricate an agent. */
  stages: Record<string, ResolvedAssignment | null>;
}

/** The declared roster entry for an id, or undefined. Only DECLARED agents are assignable: a merely
 *  observed id (a ledger writer, a card owner) has no declaration and so no authority to inherit. */
function declaredEntry(
  roster: readonly AgentRosterEntry[],
  agentId: string | null | undefined,
): AgentRosterEntry | undefined {
  if (typeof agentId !== 'string' || agentId === '') return undefined;
  return roster.find((entry) => entry.declared && entry.id === agentId);
}

/** The roster's EFFECTIVE model for an entry, or null. Never a declared-model fallback. */
function effectiveModel(entry: AgentRosterEntry | undefined): string | null {
  const model = entry?.effective?.model;
  return typeof model === 'string' && model !== '' ? model : null;
}

/** Turn a roster entry into an assignment: its declaration default profile, its effective model. */
function fromRoster(entry: AgentRosterEntry, source: AssignmentSource): ResolvedAssignment {
  return {
    agentId: entry.id,
    profileId: entry.defaultProfile ?? null,
    model: effectiveModel(entry),
    source,
  };
}

/** Turn a DECLARED (def-authored) agent/profile pair into an assignment, annotating it with the
 *  roster's effective model when the named agent is on the roster at all. */
function fromDeclaration(
  roster: readonly AgentRosterEntry[],
  agentId: string,
  profileId: string,
): ResolvedAssignment {
  return { agentId, profileId, model: effectiveModel(declaredEntry(roster, agentId)), source: 'declared' };
}

/**
 * Resolve the manager, in strict precedence order:
 *   1. `def.manager`                        → 'declared'          (the explicit executable assignment;
 *                                                                  this is what the governed assignment
 *                                                                  amendment route writes, so it IS the
 *                                                                  operator's override and must win)
 *   2. `def.governedBy` naming a declared agent → 'governed-by'
 *   3. exactly one declared manager-role agent in the project → 'project-manager'
 *   4. exactly one declared agent in the project → 'sole-project-agent'
 *   5. otherwise null — ambiguity is reported, never guessed.
 */
function resolveManager(def: WorkflowDef, roster: readonly AgentRosterEntry[]): ResolvedAssignment | null {
  if (def.manager) return fromDeclaration(roster, def.manager.agentId, def.manager.profileId);

  const governor = declaredEntry(roster, def.governedBy);
  if (governor) return fromRoster(governor, 'governed-by');

  const projectAgents = roster.filter((entry) => entry.declared && entry.projects.includes(def.project));
  const managers = projectAgents.filter((entry) => executionAssignmentRole(entry.role) === 'manager');
  if (managers.length === 1) return fromRoster(managers[0], 'project-manager');
  if (projectAgents.length === 1) return fromRoster(projectAgents[0], 'sole-project-agent');
  return null;
}

/**
 * Resolve one stage, in strict precedence order:
 *   1. `stage.agentId` + `stage.profileId`      → 'declared'
 *   2. `stage.governedBy` naming a declared agent → 'stage-governed-by'  (the per-stage chain the
 *                                                    definition format already encodes)
 *   3. the resolved manager, re-stamped           → 'manager-default'
 *   4. otherwise null.
 */
function resolveStage(
  stage: WorkflowStageDef,
  roster: readonly AgentRosterEntry[],
  manager: ResolvedAssignment | null,
): ResolvedAssignment | null {
  if (stage.agentId && stage.profileId) return fromDeclaration(roster, stage.agentId, stage.profileId);
  const governor = declaredEntry(roster, stage.governedBy);
  if (governor) return fromRoster(governor, 'stage-governed-by');
  if (manager) return { ...manager, source: 'manager-default' };
  return null;
}

/**
 * Resolve who WILL run this workflow's manager slot and every stage. Pure; the roster is supplied by the
 * caller. A definition that declares no executable assignment at all (the shape of every real definition
 * in this repo today) still resolves a real cast whenever its governance chain or its project roster can
 * name one, and resolves honest nulls when neither can.
 */
export function resolveWorkflowDefaults(
  def: WorkflowDef,
  roster: readonly AgentRosterEntry[],
): WorkflowDefaults {
  const manager = resolveManager(def, roster);
  const stages: Record<string, ResolvedAssignment | null> = {};
  for (const stage of def.stages) stages[stage.id] = resolveStage(stage, roster, manager);
  return { manager, stages };
}

/**
 * Stage ids in DEPENDENCY order (Kahn, preserving declared order among ready stages). `parseWorkflowDef`
 * has already proven the graph acyclic and every reference resolvable, so this is a presentation
 * ordering, not a validation — any stage the traversal could not reach is appended in declared order so
 * the caller never silently loses one.
 */
export function stagesInDependencyOrder(def: WorkflowDef): WorkflowStageDef[] {
  const remaining = new Map(def.stages.map((stage) => [stage.id, stage]));
  const done = new Set<string>();
  const ordered: WorkflowStageDef[] = [];
  let progress = true;
  while (progress && remaining.size > 0) {
    progress = false;
    for (const stage of def.stages) {
      if (!remaining.has(stage.id)) continue;
      if (!stage.dependsOn.every((dep) => done.has(dep) || !remaining.has(dep))) continue;
      ordered.push(stage);
      remaining.delete(stage.id);
      done.add(stage.id);
      progress = true;
    }
  }
  for (const stage of def.stages) if (remaining.has(stage.id)) ordered.push(stage);
  return ordered;
}

/** `agent (model) [source]`, or the honest refusal line when nothing resolved. */
function castOf(assignment: ResolvedAssignment | null): string {
  if (!assignment) return 'no default agent resolvable';
  return `${assignment.agentId} (${assignment.model ?? 'no model resolved'}) [${assignment.source}]`;
}

/**
 * Render the GOVERNING-AGENT priming preamble for a workflow terminal. Pure: the caller supplies the def,
 * the already-resolved defaults, and the definition's repo-relative path; this only formats them.
 *
 * The session it primes is the HEAD agent for the workflow, not a worker: it reads the definition, asks
 * the operator for the declared parameters conversationally, and then drives the stages through the
 * platform's normal mechanisms. The cast is inlined so a definition with ZERO declared assignments still
 * opens with a real, named default cast instead of an empty assignment form. Nothing secret is ever
 * rendered here — only the definition's own declared identifiers.
 */
export function renderWorkflowPriming(
  def: WorkflowDef,
  defaults: WorkflowDefaults,
  repoRelativePath: string,
): string {
  const parameters = def.parameters ?? [];
  const lines: string[] = [];
  lines.push(`# Governing agent — workflow: ${def.title}`);
  lines.push('');
  lines.push('You are the HEAD, GOVERNING agent for this workflow. This session is not a stage worker: it');
  lines.push('owns the run end to end and drives the stages below.');
  lines.push('');
  lines.push(`- workflow ref: ${def.id}`);
  lines.push(`- project: ${def.project}`);
  lines.push(`- definition (repo-relative): ${repoRelativePath}`);
  lines.push(`- default manager: ${castOf(defaults.manager)}`);
  lines.push('');
  lines.push('## Declared parameters');
  lines.push('');
  if (parameters.length === 0) lines.push('(none — this workflow declares no launch parameters)');
  else for (const name of parameters) lines.push(`- ${name}`);
  lines.push('');
  lines.push('## Default cast — stages in dependency order');
  lines.push('');
  lines.push('`id — title — action → resolved agent (model) [source]`');
  lines.push('');
  for (const stage of stagesInDependencyOrder(def)) {
    lines.push(`- ${stage.id} — ${stage.title} — ${stage.action} → ${castOf(defaults.stages[stage.id] ?? null)}`);
  }
  lines.push('');
  lines.push('## How to run this');
  lines.push('');
  lines.push(`1. READ the definition at \`${repoRelativePath}\` before anything else. It is the authority;`);
  lines.push('   everything above is a server-computed summary of it.');
  lines.push('2. Gather the declared parameters CONVERSATIONALLY from the operator — ask for them, one at a');
  lines.push('   time, and read the values back before using them. Never invent a parameter value.');
  lines.push('3. Then DRIVE the run: spin up the stages through the platform\'s normal mechanisms (the');
  lines.push('   workflow registry launch surface and the governed executor), in the dependency order above.');
  lines.push('   Do not hand-run a stage yourself when the cast names an agent for it.');
  lines.push('4. The cast above is the DEFAULT the server already resolved. Nobody has to be assigned before');
  lines.push('   this workflow can run. If the operator wants someone else on a stage, treat that as an');
  lines.push('   override and say which stage you are changing.');
  lines.push('5. Where a stage reads "no default agent resolvable", say so plainly and ask the operator who');
  lines.push('   should run it before that stage starts. Do not invent an agent.');
  lines.push('');
  lines.push('Follow the repo constitution (CLAUDE.md) and this project\'s contract. Never handle credentials');
  lines.push('as objects, and never spend real money outside this workflow\'s own human gates.');
  lines.push('');
  return lines.join('\n');
}
