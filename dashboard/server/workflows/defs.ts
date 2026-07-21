/**
 * D15 — org workflow DEFINITION parser + validator.
 *
 * A workflow definition is a Markdown file `orgs/<project>/workflows/<name>.md` whose leading `---`
 * YAML frontmatter declares the closed shape `{ id, project, title, profile, stages[] }` and whose body
 * is the human-readable description. For a stage that omits an inline `workOrder`, the Markdown body is
 * used as that stage's work order (the natural single-stage authoring style).
 *
 * This module is PURE and fail-closed. It admits only the closed shape, mirroring proposal.ts's bounds,
 * and it can never LOWER a risk tier: the effective tier of a stage is `max(declared, classified floor)`
 * where the floor comes from the server-owned `classifyActionRisk` namespace registry. A forbidden
 * namespace (credentials/spend/...) or an unregistered namespace fails the whole definition.
 *
 * It has no filesystem, network, or execution capability — the registry route reads the file and hands
 * the text here.
 */
import { classifyActionRisk } from '../control/policy.ts';
import { isSafeRepoRelativePath, type ProposalRiskTier } from '../control/proposal.ts';
import { parseYaml } from '../routing/yaml.ts';

// Bounds mirror dashboard/server/control/proposal.ts so a definition can never compile to an
// over-budget proposal.
export const MAX_DEFINITION_BYTES = 128 * 1024;
export const MAX_DEFINITION_STAGES = 32;
const MAX_ID_CHARS = 64;
const MAX_TITLE_CHARS = 200;
const MAX_PROFILE_CHARS = 64;
const MAX_ACTION_CHARS = 256;
const MAX_WORK_ORDER_CHARS = 64 * 1024;
const MAX_DESCRIPTION_CHARS = 64 * 1024;

/** Every workflow target must live under `orgs/<project>/` — see the containment note in validateStage. */
const ORGS_DIR = 'orgs';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_ACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** Matches the declared-agent catalog grammar; these ids are syntax only until compiler binding. */
const SAFE_AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Matches the declared-agent profile grammar; these ids are syntax only until compiler binding. */
const SAFE_EXECUTION_PROFILE_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

const RISK_RANK: Record<ProposalRiskTier, number> = { T1: 1, T2: 2, T3: 3 };

export interface WorkflowStageDef {
  id: string;
  title: string;
  action: string;
  target: string;
  workOrder: string;
  dependsOn: string[];
  /** Effective tier = max(declared, classified floor). Prose can never lower the server-owned floor. */
  riskTier: ProposalRiskTier;
  /** The tier the author declared, or null when the stage relied on the classified floor. */
  declaredRiskTier: ProposalRiskTier | null;
  /** The floor derived from the action namespace registry. */
  classifiedFloor: ProposalRiskTier;
  /** Optional declared worker identity; present only with `profileId`. */
  agentId?: string;
  /** Optional declared execution profile identity; present only with `agentId`. */
  profileId?: string;
}

/** A closed declaration-side manager assignment. It is syntax only; compiler resolves authority later. */
export interface WorkflowManagerAssignment {
  agentId: string;
  profileId: string;
}

export interface WorkflowDef {
  id: string;
  project: string;
  title: string;
  /** Existing workflow tool profile; distinct from the optional execution-profile assignment below. */
  profile: string;
  /** Optional manager declaration. Omitted for legacy workflow definitions. */
  manager?: WorkflowManagerAssignment;
  /** The Markdown body after the frontmatter (also the fallback work order for a stage). */
  description: string;
  stages: WorkflowStageDef[];
}

export type WorkflowDefResult = { ok: true; value: WorkflowDef } | { ok: false; detail: string };

export interface ParseWorkflowOptions {
  /** When supplied, `profile` must name a server-owned execution profile. */
  knownProfiles?: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRiskTier(value: unknown): value is ProposalRiskTier {
  return value === 'T1' || value === 'T2' || value === 'T3';
}

/** Split `---`-delimited YAML frontmatter from the Markdown body. */
function splitFrontmatter(source: string): { frontmatter: string; body: string } | null {
  const normalized = source.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

/** Resolve the effective tier: never below the classified floor, and honoring a stricter declaration. */
function effectiveTier(declared: ProposalRiskTier | null, floor: ProposalRiskTier): ProposalRiskTier {
  if (declared === null) return floor;
  return RISK_RANK[declared] >= RISK_RANK[floor] ? declared : floor;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Validate a closed, syntactic agent/profile pair without consulting live declarations or runner state. */
function validateAgentProfileAssignment(
  raw: unknown,
  label: string,
): { ok: true; value: WorkflowManagerAssignment } | { ok: false; detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: `${label} must be a mapping` };
  const allowed = new Set(['agentId', 'profileId']);
  const unknownKey = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknownKey) return { ok: false, detail: `${label} has unknown field '${unknownKey}'` };
  const agentId = asString(raw.agentId);
  if (agentId === null || !SAFE_AGENT_ID_RE.test(agentId)) {
    return { ok: false, detail: `${label}.agentId must be a safe identifier of 1-64 characters` };
  }
  const profileId = asString(raw.profileId);
  if (profileId === null || !SAFE_EXECUTION_PROFILE_ID_RE.test(profileId)) {
    return { ok: false, detail: `${label}.profileId must be a safe execution profile identifier of 1-128 characters` };
  }
  return { ok: true, value: { agentId, profileId } };
}

function validateStage(
  raw: unknown,
  index: number,
  body: string,
  project: string,
): { ok: true; value: WorkflowStageDef } | { ok: false; detail: string } {
  const label = `stages[${index}]`;
  if (!isRecord(raw)) return { ok: false, detail: `${label} must be a mapping` };
  const allowed = new Set(['id', 'title', 'action', 'target', 'workOrder', 'dependsOn', 'riskTier', 'agentId', 'profileId']);
  const unknownKey = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknownKey) return { ok: false, detail: `${label} has unknown field '${unknownKey}'` };

  const id = asString(raw.id);
  if (id === null || !SAFE_ID_RE.test(id)) {
    return { ok: false, detail: `${label}.id must be a safe identifier of 1-${MAX_ID_CHARS} characters` };
  }
  const title = asString(raw.title);
  if (title === null || title.trim() === '' || title.length > MAX_TITLE_CHARS) {
    return { ok: false, detail: `${label}.title must be a non-empty string of at most ${MAX_TITLE_CHARS} characters` };
  }
  const action = asString(raw.action);
  if (action === null || action.length > MAX_ACTION_CHARS || !SAFE_ACTION_RE.test(action)) {
    return { ok: false, detail: `${label}.action must be a safe action identifier` };
  }
  const classified = classifyActionRisk(action);
  if (classified.disposition === 'forbidden') {
    return { ok: false, detail: `${label}.action '${action}' is refused: ${classified.reason}` };
  }
  const target = raw.target;
  if (!isSafeRepoRelativePath(target)) {
    return { ok: false, detail: `${label}.target must be a canonical safe repo-relative path` };
  }
  // ORG CONTAINMENT. compile.ts derives the proposal's write scope FROM these targets, so without this
  // the downstream scope checks (compiler.ts's widening refusal, policy.ts's `within(target, scope.write)`)
  // compare a set against itself and can never fire. Bounding each target to the definition's own project
  // tree is what makes those checks mean something: a def for project X cannot declare a target anywhere
  // else in the repo (e.g. dashboard/server/control/policy.ts), whatever its prose claims. Human-owned
  // `governance/` and `CLAUDE.md` stay refused by policy.ts on top of this.
  const orgTree = `${ORGS_DIR}/${project}`;
  if (target !== orgTree && !target.startsWith(`${orgTree}/`)) {
    return { ok: false, detail: `${label}.target must be inside this definition's own org tree '${orgTree}/'` };
  }
  // A stage may inline a single-line workOrder, or omit it and inherit the Markdown body (single-stage
  // authoring). The resolved value must be a non-empty, bounded, NUL-free string.
  let workOrder: string;
  if (raw.workOrder === undefined) {
    workOrder = body;
  } else {
    const inline = asString(raw.workOrder);
    if (inline === null) return { ok: false, detail: `${label}.workOrder must be a string when present` };
    workOrder = inline;
  }
  if (workOrder.trim() === '') {
    return { ok: false, detail: `${label}.workOrder is empty (a stage without an inline work order inherits the Markdown body, which must be non-empty)` };
  }
  if (workOrder.length > MAX_WORK_ORDER_CHARS) {
    return { ok: false, detail: `${label}.workOrder must be at most ${MAX_WORK_ORDER_CHARS} characters` };
  }
  if (workOrder.includes('\0')) return { ok: false, detail: `${label}.workOrder must not contain NUL bytes` };

  let dependsOn: string[] = [];
  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (!Array.isArray(raw.dependsOn)) return { ok: false, detail: `${label}.dependsOn must be a list of stage ids` };
    if (raw.dependsOn.length > MAX_DEFINITION_STAGES) return { ok: false, detail: `${label}.dependsOn is too long` };
    const seen = new Set<string>();
    for (const dep of raw.dependsOn) {
      const depId = asString(dep);
      if (depId === null || !SAFE_ID_RE.test(depId)) return { ok: false, detail: `${label}.dependsOn must contain safe stage ids` };
      if (seen.has(depId)) return { ok: false, detail: `${label}.dependsOn must not contain duplicates` };
      seen.add(depId);
    }
    dependsOn = [...seen];
  }

  let declaredRiskTier: ProposalRiskTier | null = null;
  if (raw.riskTier !== undefined && raw.riskTier !== null) {
    if (!isRiskTier(raw.riskTier)) return { ok: false, detail: `${label}.riskTier must be T1, T2, or T3` };
    declaredRiskTier = raw.riskTier;
  }
  const floor = classified.minimumTier;
  const hasAgentId = hasOwn(raw, 'agentId');
  const hasProfileId = hasOwn(raw, 'profileId');
  if (hasAgentId !== hasProfileId) return { ok: false, detail: `${label}.agentId and profileId must appear together` };
  let assignment: WorkflowManagerAssignment | undefined;
  if (hasAgentId && hasProfileId) {
    const validated = validateAgentProfileAssignment({ agentId: raw.agentId, profileId: raw.profileId }, label);
    if (!validated.ok) return validated;
    assignment = validated.value;
  }
  return {
    ok: true,
    value: {
      id,
      title,
      action,
      target,
      workOrder,
      dependsOn,
      riskTier: effectiveTier(declaredRiskTier, floor),
      declaredRiskTier,
      classifiedFloor: floor,
      ...(assignment ?? {}),
    },
  };
}

/** Parse and validate a workflow definition file's text. Fail-closed; unknown fields are rejected. */
export function parseWorkflowDef(source: string, options: ParseWorkflowOptions = {}): WorkflowDefResult {
  if (typeof source !== 'string') return { ok: false, detail: 'definition source must be a string' };
  if (Buffer.byteLength(source, 'utf8') > MAX_DEFINITION_BYTES) {
    return { ok: false, detail: `definition must be at most ${MAX_DEFINITION_BYTES} bytes` };
  }
  const split = splitFrontmatter(source);
  if (!split) return { ok: false, detail: 'definition must begin with a --- YAML frontmatter block' };

  // parseYaml is defensive: a structurally-unrecognised doc degrades to null (never throws on structure).
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(split.frontmatter);
  } catch {
    return { ok: false, detail: 'definition frontmatter is not valid YAML' };
  }
  if (!isRecord(frontmatter)) return { ok: false, detail: 'definition frontmatter must be a mapping' };
  const allowed = new Set(['id', 'project', 'title', 'profile', 'manager', 'stages']);
  const unknownKey = Object.keys(frontmatter).find((key) => !allowed.has(key));
  if (unknownKey) return { ok: false, detail: `frontmatter has unknown field '${unknownKey}'` };

  const id = asString(frontmatter.id);
  if (id === null || !SAFE_ID_RE.test(id)) return { ok: false, detail: `id must be a safe identifier of 1-${MAX_ID_CHARS} characters` };
  const project = asString(frontmatter.project);
  if (project === null || !SAFE_ID_RE.test(project)) return { ok: false, detail: 'project must be a safe identifier' };
  const title = asString(frontmatter.title);
  if (title === null || title.trim() === '' || title.length > MAX_TITLE_CHARS) {
    return { ok: false, detail: `title must be a non-empty string of at most ${MAX_TITLE_CHARS} characters` };
  }
  const profile = asString(frontmatter.profile);
  if (profile === null || profile.trim() === '' || profile.length > MAX_PROFILE_CHARS) {
    return { ok: false, detail: `profile must be a non-empty string of at most ${MAX_PROFILE_CHARS} characters` };
  }
  if (options.knownProfiles && !options.knownProfiles.has(profile)) {
    return { ok: false, detail: `profile '${profile}' is not a server-owned execution profile` };
  }

  let manager: WorkflowManagerAssignment | undefined;
  if (hasOwn(frontmatter, 'manager')) {
    const validated = validateAgentProfileAssignment(frontmatter.manager, 'manager');
    if (!validated.ok) return validated;
    manager = validated.value;
  }

  const description = split.body.trim();
  if (description.length > MAX_DESCRIPTION_CHARS) return { ok: false, detail: 'description body is too long' };

  const rawStages = frontmatter.stages;
  if (!Array.isArray(rawStages) || rawStages.length === 0 || rawStages.length > MAX_DEFINITION_STAGES) {
    return { ok: false, detail: `stages must contain 1-${MAX_DEFINITION_STAGES} items` };
  }
  const stages: WorkflowStageDef[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < rawStages.length; index += 1) {
    const stage = validateStage(rawStages[index], index, description, project);
    if (!stage.ok) return stage;
    if (ids.has(stage.value.id)) return { ok: false, detail: `duplicate stage id '${stage.value.id}'` };
    ids.add(stage.value.id);
    stages.push(stage.value);
  }

  // Dependency references must resolve and the graph must be acyclic (Kahn's algorithm).
  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      if (!ids.has(dep)) return { ok: false, detail: `stage '${stage.id}' depends on missing stage '${dep}'` };
      if (dep === stage.id) return { ok: false, detail: `stage '${stage.id}' cannot depend on itself` };
    }
  }
  const indegree = new Map(stages.map((stage) => [stage.id, stage.dependsOn.length]));
  const children = new Map(stages.map((stage) => [stage.id, [] as string[]]));
  for (const stage of stages) for (const dep of stage.dependsOn) children.get(dep)?.push(stage.id);
  const ready = stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id);
  let visited = 0;
  while (ready.length > 0) {
    const next = ready.pop() as string;
    visited += 1;
    for (const child of children.get(next) ?? []) {
      const remaining = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (visited !== stages.length) return { ok: false, detail: 'stage dependency graph contains a cycle' };

  return { ok: true, value: { id, project, title, profile, ...(manager ? { manager } : {}), description, stages } };
}
