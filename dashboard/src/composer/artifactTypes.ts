/**
 * C2 — the artifact-type registry: the pure convergence spine behind Composer.
 *
 * Composer's idea-first flow converges a freeform idea into a typed artifact DRAFT and then a DEPLOY PLAN
 * that the deploy dispatcher (C4) hands to an already-governed endpoint. This module is that spine and
 * NOTHING else: pure, deterministic functions — no I/O, no network, no React, no Date.now. The date a
 * project template needs is passed IN (on the draft), never read from the clock, so every output here is
 * a pure function of its inputs and the suite is fully reproducible.
 *
 * Three responsibilities:
 *   - seedTemplate(kind, idea)  — the house-authored creation prompt for the first (or type-switch) turn.
 *   - validateDraft(kind, draft) — schema check → Problem[]; empty means deploy-ready.
 *   - toDeploy(kind, draft)      — the validated draft → a DeployPlan {relpath, content, branchClass,
 *                                  endpoint, followUps?} the dispatcher maps to /api/write/launch|save.
 *
 * Binding decisions folded in (Daniel, 2026-07-17):
 *   - kinds are task | workflow | skill | project | agent (+ the `idea`/unknown seed state). C7 un-defers
 *     `agent`: a first-class fleet identity declared as a durable agents/<id>.md record (PR to main). The
 *     client is an HONEST PREVIEW only — the server owns the authoritative registry / impersonation checks
 *     (C7.6). Declaring an agent is NOT making it run: a human binds a runner (runner-bound stays false).
 *   - Multi-file artifacts deploy the PRIMARY FILE ONLY in v1. Skill → skills/learned/<slug>/SKILL.md
 *     (the LEARNED tier — binding, never curated, so the sync_skills curated-mirror hook is never
 *     tripped). Project → orgs/<name>/_index.md rendered from templates/_index.md (the other three
 *     rendered files ride along as `followUps` the UI may offer as subsequent saves). Workflow →
 *     orgs/<project>/workflows/<slug>.md.
 *   - Task maps to the launch endpoint's fields {project, action, target, riskTier, body}.
 */

/** The concrete artifact kinds. `agent` (C7) is a first-class fleet identity declared as agents/<id>.md. */
export const ARTIFACT_KINDS = ['task', 'workflow', 'skill', 'project', 'agent'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The seedable states: the four concrete kinds plus `idea` (the unknown, idea-first entry point). */
export type SeedKind = ArtifactKind | 'idea';

/** Valid risk tiers — mirrors scripts/cards.py RISK_TIERS (server truth for card validation). */
export const RISK_TIERS = ['T1', 'T2', 'T3'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** A single schema-validation problem, surfaced inline by the draft-preview panel (C3). */
export interface Problem {
  field: string;
  message: string;
}

// ── Per-kind draft shapes ──────────────────────────────────────────────────────────────────────────

/** Task draft — exactly the fields LaunchControls collects and POSTs to /api/write/launch. */
export interface TaskDraft {
  project: string;
  action: string;
  target: string;
  riskTier: RiskTier;
  /** Optional work-order body (cards.py defaults it to ''). */
  body?: string;
  /** Assigned background runner. */
  owner?: string;
}

/** Skill draft — the two frontmatter fields registry/skills.ts reads, plus the Markdown body. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

/** Workflow draft — a canonical project-scoped definition. The filename stem is its stable id/title. */
export interface WorkflowStageDraft {
  id: string;
  action: string;
  target: string;
  workOrder: string;
  riskTier: 'T1' | 'T2';
  dependsOn: string[];
  /** Optional logical agent assignment. Must be authored with profileId. */
  agentId?: string;
  /** Optional declared execution profile assignment. Must be authored with agentId. */
  profileId?: string;
}

/** Optional workflow manager assignment. Its two declared ids are authored together or omitted. */
export interface WorkflowManagerDraft {
  agentId?: string;
  profileId?: string;
}

export interface WorkflowDraft {
  filename: string;
  project: string;
  /** Server-owned execution profile. Never default this client-side. */
  profile: string;
  /** Optional logical manager assignment. Execution identity remains compiler-owned. */
  manager?: WorkflowManagerDraft;
  body: string;
  stages: WorkflowStageDraft[];
}

/** Project draft — a name + the render date. The date is passed IN (not read from the clock) so
 *  toDeploy stays pure and deterministic; it fills the `{{date}}` placeholder in templates/STATE.md. */
export interface ProjectDraft {
  name: string;
  date: string;
}

/** Agent draft (C7) — the declarative fleet-identity record. `id`/`role`/`runtime`/`model` are exactly
 *  the tuple the roster displays and the routing resolver consumes; `projects`/`description` are advisory
 *  display metadata. `runner-bound` is NOT a draft field — the registry hard-codes it false (a human binds
 *  a runner). The client validates shape only; the SERVER owns the authoritative registry / impersonation
 *  checks (C7.6). */
export interface AgentDraft {
  /** Identity string. Becomes agents/<id>.md, the card owner, the routing-override key, and git user.name —
   *  MUST be a single safe path segment (the F4 guard). */
  id: string;
  /** One of cards.ROLES — the behavioral template (routines/roles/<role>.md). */
  role: string;
  /** Declared default execution engine — a registered runtime. */
  runtime: string;
  /** Optional declared default concrete model id (omit to inherit the role×tier policy model). */
  model?: string;
  /** Advisory scope hint: projects this agent works. [] / omitted = fleet-wide. */
  projects?: string[];
  /** One-line human description for the roster / Agents view. */
  description: string;
  /** Optional freeform Markdown body (inert prose). */
  body?: string;
}

/** Map a kind to its draft type (used only for local typing; callers pass the concrete shapes). */
export type DraftFor<K extends ArtifactKind> = K extends 'task'
  ? TaskDraft
  : K extends 'skill'
    ? SkillDraft
    : K extends 'workflow'
      ? WorkflowDraft
      : K extends 'project'
        ? ProjectDraft
        : AgentDraft;

// ── Agent mirrored constants (honest previews — the server owns the authoritative checks) ─────────────
//
// These mirror server-side source-of-truth the client-pure module may not import, EXACTLY as
// COORDINATION_PREFIXES / RISK_TIERS are mirrored above. Each is an honest preview only; the server's
// routing-override set + governed-save impersonation guard (C7.6) do the authoritative validation.

/** Mirror of scripts/cards.py ROLES — the behavioral-template roles. */
const AGENT_ROLES = ['scout', 'manage', 'work', 'inspect', 'consolidate'] as const;

/** Mirror of governance/model-routing.yaml runtimes. The server override-set does the AUTHORITATIVE
 *  registry check (a runtime must be one governance already blesses). */
const AGENT_RUNTIMES = ['claude', 'codex'] as const;

/** Small mirrored set of existing runtime identities an agent id must not shadow (anti-impersonation
 *  honest preview). The AUTHORITATIVE humans.yaml / existing-agent collision check is SERVER-SIDE (C7.6). */
const RESERVED_AGENT_IDS = ['worker-desktop', 'codex-worker'] as const;

// ── Deploy plan ────────────────────────────────────────────────────────────────────────────────────

/** Which governed branch discipline the write routes through (mirrors server/write/branch.ts Target). */
export type BranchClass = 'coordination' | 'durable';

/** Which governed endpoint the dispatcher (C4) calls. Task → launch (files a queue card); durable → save. */
export type DeployEndpoint = 'launch' | 'save';

/** A rendered secondary file a multi-file artifact exposes for optional follow-up saves. */
export interface FollowUp {
  relpath: string;
  content: string;
}

/** The exact fields the launch endpoint expects for a Task (see TaskDraft / LaunchControls). */
export interface TaskLaunchFields {
  project: string;
  action: string;
  target: string;
  riskTier: RiskTier;
  body: string;
  owner?: string;
}

/**
 * The primary deploy action for a validated draft. For durable kinds it is a single relpath+content the
 * dispatcher sends to /api/write/save. For a Task it is a coordination card filed via /api/write/launch,
 * whose structured payload is carried in `launchFields` (the launch endpoint mints the queue ULID, so
 * `relpath` is the coordination target pattern, not a fixed filename).
 */
export interface DeployPlan {
  kind: ArtifactKind;
  relpath: string;
  content: string;
  branchClass: BranchClass;
  endpoint: DeployEndpoint;
  /** Present only for kind === 'task': the exact payload for POST /api/write/launch. */
  launchFields?: TaskLaunchFields;
  /** Present for multi-file artifacts (Project): the other rendered files, offered as follow-up saves. */
  followUps?: FollowUp[];
}

// ── Branch classification (mirrored from the server) ─────────────────────────────────────────────────

/**
 * The coordination prefixes — copied VERBATIM from server/write/branch.ts COORDINATION_PREFIXES. A
 * client-pure module may not import a server module, so the split is mirrored here; the deploy-mapping
 * test cross-checks that this agrees with classifyTarget's prefixes. Total binary function: anything not
 * under a coordination prefix is durable content (work-branch → PR to main).
 */
const COORDINATION_PREFIXES = ['queue/', 'ledgers/', 'traces/'] as const;

/** Classify a relpath exactly as server/write/branch.ts#classifyTarget does. */
function classifyRelpath(relpath: string): BranchClass {
  const norm = relpath.replace(/\\/g, '/').replace(/^\/+/, '');
  return COORDINATION_PREFIXES.some((p) => norm.startsWith(p)) ? 'coordination' : 'durable';
}

/** Lowercase-hyphen slug for on-disk directory names (skill slug, project org dir). Deterministic. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * review F4 — defense-in-depth + honest previews. A skill/project name becomes an on-disk path SEGMENT
 * (skills/learned/<slug>/…, orgs/<slug>/…). Reject a name that carries path syntax — a separator, a `..`
 * parent ref, a leading `.`, or an absolute root — or that slugifies to nothing (which would emit an
 * empty/escaping relpath segment like `skills/learned//SKILL.md`). This makes `validateDraft` REPORT the
 * problem instead of silently transforming it, and stops `toDeploy` from ever emitting an escaping
 * relpath. NOTE: the server's /api/write/save still owns the REAL path confinement — this is an honest
 * client-side preview, not the security boundary.
 */
function nameSegmentProblem(field: string, name: unknown): Problem | null {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (/[/\\]/.test(raw) || raw.includes('..') || raw.startsWith('.') || slugify(raw) === '') {
    return {
      field,
      message: `${field} must be a simple name (no path separators, no "..", no leading dot)`,
    };
  }
  return null;
}

// ── Inlined project templates ────────────────────────────────────────────────────────────────────────
//
// Copied VERBATIM from templates/{_index,STATE,contract,HEARTBEAT}.md. They are inlined (not read from
// disk) because this module is client-pure — no fs, no bundler-time file reads. A drift here is caught by
// the project-render test asserting the rendered _index carries the project name and no leftover
// placeholders. The `{{name}}` / `{{date}}` placeholders are filled by renderTemplate below.

const TEMPLATE_INDEX = `# {{name}} — index

- [STATE](STATE.md) — current state (agents keep this current)
- [contract](contract.md) — autonomy policy for this project
- [HEARTBEAT](HEARTBEAT.md) — recurring cadences
- \`raw/\` — ingest inbox (dump anything) · \`wiki/\` — structured knowledge · \`output/\` — deliverables
`;

const TEMPLATE_STATE = `# {{name}} — STATE

_Updated: {{date}}_

## Now
(nothing yet — project scaffolded {{date}})

## Next
## Blocked
`;

const TEMPLATE_CONTRACT = `# {{name}} — contract (autonomy policy)

Conservative default: EVERYTHING queues-for-me until grades earn wider lists (governance/risk-tiers.md).

## acts-alone
- update STATE.md and wiki/ in this project
- write reports into output/ marked DRAFT

## queues-for-me
- everything else, explicitly including: merges to main, external publishing,
  any diff > 400 lines, anything touching other projects

## wakes-me-up
- verification fails twice on the same item
- daily budget breached
- any request to handle a secret as an object
- governance rule violated
`;

const TEMPLATE_HEARTBEAT = `# Heartbeat — {{name}}

\`\`\`yaml
cadences: []
# enable like:
#  - name: nightly-review
#    schedule: daily
#    tier: cloud
#    risk-tier: T1
#    prompt: |
#      Read orgs/{{name}}/STATE.md and raw/; file new raw/ items into wiki/; update STATE.md.
\`\`\`
`;

/** Fill `{{name}}` / `{{date}}` placeholders. Deterministic — date is supplied by the caller. */
function renderTemplate(template: string, name: string, date: string): string {
  return template.replace(/\{\{name\}\}/g, name).replace(/\{\{date\}\}/g, date);
}

// ── Seeds ────────────────────────────────────────────────────────────────────────────────────────────
//
// House-authored creation prompts. Each is inert trusted scaffolding (schema shape + conventions + the
// deploy contract) the operator could have typed themselves — NOT untrusted external text. The seed is
// the FIRST turn's prompt (composed with the operator's idea), never sourced from a card body.

/** The idea-first disambiguation seed — asks the model to help decide which type the idea wants to become.
 *  IDEA-FIRST is binding; C7 adds `agent` as a fifth convergence target. */
function ideaSeed(idea: string): string {
  return [
    'You are helping an operator turn a raw idea into governed kb work. The idea below may be vague or',
    'half-formed — that is expected. Your first job is to flesh it out: interview the operator with one',
    'focused question at a time (purpose, constraints, scope, success criteria), offering concrete options',
    'where you can, until the idea is clear enough to route.',
    '',
    'The idea:',
    idea,
    '',
    'Then help route it through the proper channel — do not assume. A multi-step or multi-agent idea',
    'becomes a governed plan proposal for review (the planning protocol covers the format). A single',
    'small artifact instead converges to a typed deploy —',
    'help decide which TYPE this idea wants to become. The kinds are:',
    '- task — a single governed work order filed as a queue card (project, action, target, risk tier).',
    '- workflow — a reusable multi-step procedure saved as orgs/<project>/workflows/<slug>.md.',
    '- skill — a packaged capability saved as skills/learned/<slug>/SKILL.md (name + description + body).',
    '- project — a new orgs/<name>/ workspace scaffolded from the standard templates.',
    '- agent — a first-class fleet identity (id, role, runtime) declared as agents/<id>.md. Declaring it',
    '  registers the identity + its defaults; a human must bind a runner before its cards actually run.',
    '',
    'When the fleshed-out idea fits one kind, recommend it and explain why; choosing it re-seeds the',
    'conversation with that type’s creation prompt. When it needs multiple stages, agents, or approvals,',
    'recommend the plan-proposal route and keep refining until the plan is ready for review.',
  ].join('\n');
}

/** Per-kind creation prompts: schema shape + conventions + the deploy contract for that type. */
function kindSeed(kind: ArtifactKind, idea: string): string {
  const header = ['You are drafting a kb artifact from this idea:', idea, ''];
  switch (kind) {
    case 'task':
      return [
        ...header,
        'Draft a TASK — a single governed work order filed as a queue card via /api/write/launch.',
        'Fields (server-validated by scripts/cards.py): project, action, target, risk tier (T1|T2|T3),',
        'and an optional work-order body. Deploy is coordination-class: it lands on the ops branch.',
      ].join('\n');
    case 'workflow':
      return [
        ...header,
        'Draft a WORKFLOW — a reusable procedure saved as orgs/<project>/workflows/<slug>.md.',
        'Use a lowercase <slug>.md filename and choose a server-owned execution profile. Write the full',
        'Markdown body and canonical stages. Deploy is durable: work branch → PR to main.',
      ].join('\n');
    case 'skill':
      return [
        ...header,
        'Draft a SKILL — a packaged capability saved as skills/learned/<slug>/SKILL.md (the LEARNED tier,',
        'never curated). Required frontmatter: name, description (the two fields the registry reads),',
        'plus a Markdown body of instructions. Deploy is durable: work branch → PR to main.',
      ].join('\n');
    case 'project':
      return [
        ...header,
        'Draft a PROJECT — a new orgs/<name>/ workspace scaffolded from the standard templates',
        '(_index.md, STATE.md, contract.md, HEARTBEAT.md). Choose a short slug-like name. Deploy is',
        'durable: the rendered _index.md is the primary save (work branch → PR to main); the other',
        'three files are offered as follow-up saves.',
      ].join('\n');
    case 'agent':
      return [
        ...header,
        'Draft an AGENT — a first-class fleet identity declared as agents/<id>.md (YAML frontmatter).',
        'Schema: id (a single safe path segment — it becomes the card owner, git user.name, and the',
        'routing-override key), role (scout|manage|work|inspect|consolidate), runtime (claude|codex),',
        'an optional model, optional projects, and a one-line description.',
        'IMPORTANT — declaring an agent is NOT the same as making it run: the file registers the identity',
        'and its declared defaults, but a human must bind a runner before its cards execute (runner-bound',
        'stays false until then). Deploy is durable: work branch → PR to main (the human merge admits the',
        'identity to the fleet).',
      ].join('\n');
  }
}

/** The house-authored creation prompt for the first (or type-switch) turn. */
export function seedTemplate(kind: SeedKind, idea: string): string {
  return kind === 'idea' ? ideaSeed(idea) : kindSeed(kind, idea);
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────

function requireNonEmpty(problems: Problem[], field: string, value: unknown, message: string): void {
  if (typeof value !== 'string' || value.trim() === '') problems.push({ field, message });
}

function validateTask(draft: TaskDraft): Problem[] {
  const problems: Problem[] = [];
  requireNonEmpty(problems, 'project', draft.project, 'project is required');
  requireNonEmpty(problems, 'action', draft.action, 'action is required');
  requireNonEmpty(problems, 'target', draft.target, 'target is required');
  if (!RISK_TIERS.includes(draft.riskTier)) {
    problems.push({ field: 'riskTier', message: `risk tier must be one of ${RISK_TIERS.join(', ')}` });
  }
  if (draft.owner !== undefined && !/^[A-Za-z0-9._-]+$/.test(draft.owner)) {
    problems.push({ field: 'owner', message: 'owner must be a safe registered agent id' });
  }
  // body is optional (cards.py defaults it to '') — not validated.
  return problems;
}

function validateSkill(draft: SkillDraft): Problem[] {
  const problems: Problem[] = [];
  requireNonEmpty(problems, 'name', draft.name, 'name frontmatter is required');
  // review F4 — the name becomes the skills/learned/<slug>/ path segment; reject traversal / empty slug.
  const nameProblem = nameSegmentProblem('name', draft.name);
  if (nameProblem) problems.push(nameProblem);
  requireNonEmpty(problems, 'description', draft.description, 'description frontmatter is required');
  requireNonEmpty(problems, 'body', draft.body, 'a SKILL.md body is required');
  return problems;
}

function validateWorkflow(draft: WorkflowDraft): Problem[] {
  const problems: Problem[] = [];
  // A filename becomes the definition id and a path segment. Keep it a single, canonical slug file so
  // `orgs/<project>/workflows/<filename>` cannot traverse outside its project tree.
  if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(draft.filename ?? '')) {
    problems.push({ field: 'filename', message: 'filename must match <slug>.md (lowercase, no path separators or "..")' });
  }
  requireNonEmpty(problems, 'body', draft.body, 'a workflow body is required');
  requireNonEmpty(problems, 'project', draft.project, 'workflow project is required');
  const projectProblem = nameSegmentProblem('project', draft.project);
  if (projectProblem) problems.push(projectProblem);
  requireNonEmpty(problems, 'profile', draft.profile, 'a server-owned execution profile is required');
  validateWorkflowAssignment(problems, 'manager', draft.manager);
  if (!Array.isArray(draft.stages) || draft.stages.length === 0) {
    problems.push({ field: 'stages', message: 'at least one executable stage is required' });
    return problems;
  }
  const ids = new Set<string>();
  for (const [index, stage] of draft.stages.entries()) {
    const prefix = `stages[${index}]`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(stage.id)) {
      problems.push({ field: `${prefix}.id`, message: 'stage id must be a safe 1-64 character id' });
    } else if (ids.has(stage.id)) {
      problems.push({ field: `${prefix}.id`, message: `duplicate stage id ${stage.id}` });
    }
    ids.add(stage.id);
    requireNonEmpty(problems, `${prefix}.action`, stage.action, 'stage action is required');
    requireNonEmpty(problems, `${prefix}.target`, stage.target, 'stage target is required');
    requireNonEmpty(problems, `${prefix}.workOrder`, stage.workOrder, 'stage work order is required');
    if (!['T1', 'T2'].includes(stage.riskTier)) {
      problems.push({ field: `${prefix}.riskTier`, message: 'Run now v1 accepts T1 or T2 only' });
    }
    validateWorkflowAssignment(problems, prefix, stage);
  }
  for (const [index, stage] of draft.stages.entries()) {
    for (const dep of stage.dependsOn) {
      if (!ids.has(dep)) problems.push({ field: `stages[${index}].dependsOn`, message: `unknown dependency ${dep}` });
      if (dep === stage.id) problems.push({ field: `stages[${index}].dependsOn`, message: 'a stage cannot depend on itself' });
    }
  }
  return problems;
}

/** Client-only shape check. Composition/compiler owns live registry and adapter validation. */
function validateWorkflowAssignment(
  problems: Problem[],
  prefix: string,
  assignment: WorkflowManagerDraft | Pick<WorkflowStageDraft, 'agentId' | 'profileId'> | undefined,
): void {
  if (assignment === undefined) return;
  const hasAgentId = assignment.agentId !== undefined;
  const hasProfileId = assignment.profileId !== undefined;
  if (hasAgentId !== hasProfileId) {
    problems.push({ field: `${prefix}.assignment`, message: 'agentId and profileId must be authored together' });
  } else if (hasAgentId) {
    // These are declared ids only. Workflow composition/compiler validates their live registry
    // membership and adapter availability before an executable proposal can exist.
    requireNonEmpty(problems, `${prefix}.agentId`, assignment.agentId, 'agentId must be non-empty');
    requireNonEmpty(problems, `${prefix}.profileId`, assignment.profileId, 'profileId must be non-empty');
  }
}

function validateProject(draft: ProjectDraft): Problem[] {
  const problems: Problem[] = [];
  requireNonEmpty(problems, 'name', draft.name, 'project name is required');
  // review F4 — the name becomes the orgs/<slug>/ path segment; reject traversal / empty slug.
  const nameProblem = nameSegmentProblem('name', draft.name);
  if (nameProblem) problems.push(nameProblem);
  requireNonEmpty(problems, 'date', draft.date, 'a render date is required');
  return problems;
}

function validateAgent(draft: AgentDraft): Problem[] {
  const problems: Problem[] = [];
  requireNonEmpty(problems, 'id', draft.id, 'id is required');
  // review F4 — the id becomes agents/<slug>.md, the card owner, the routing-override key, and git
  // user.name; reject traversal / separators / leading-dot / empty slug. This is the load-bearing check.
  const idProblem = nameSegmentProblem('id', draft.id);
  if (idProblem) problems.push(idProblem);
  // Anti-impersonation honest preview: reject an id that shadows an existing runtime identity. The
  // AUTHORITATIVE humans.yaml / existing-agent collision check is SERVER-SIDE (C7.6) — this is a preview.
  if (typeof draft.id === 'string') {
    const norm = draft.id.trim().toLowerCase();
    if (RESERVED_AGENT_IDS.some((r) => r === norm)) {
      problems.push({ field: 'id', message: `id "${draft.id.trim()}" is a reserved runtime identity` });
    }
  }
  // role / runtime are mirrored closed sets (server owns the authoritative registry check).
  if (!(AGENT_ROLES as readonly string[]).includes(draft.role)) {
    problems.push({ field: 'role', message: `role must be one of ${AGENT_ROLES.join(', ')}` });
  }
  if (!(AGENT_RUNTIMES as readonly string[]).includes(draft.runtime)) {
    problems.push({ field: 'runtime', message: `runtime must be one of ${AGENT_RUNTIMES.join(', ')}` });
  }
  // model is optional; if present it must be non-empty (concrete registry validation is the server's job
  // at override-set time — the client cannot read the live policy).
  if (draft.model !== undefined) {
    requireNonEmpty(problems, 'model', draft.model, 'model, if set, must be non-empty');
  }
  requireNonEmpty(problems, 'description', draft.description, 'description is required');
  return problems;
}

/** Validate a proposed draft for `kind`. An empty array means the draft is deploy-ready. */
export function validateDraft<K extends ArtifactKind>(kind: K, draft: DraftFor<K>): Problem[] {
  switch (kind) {
    case 'task':
      return validateTask(draft as TaskDraft);
    case 'skill':
      return validateSkill(draft as SkillDraft);
    case 'workflow':
      return validateWorkflow(draft as WorkflowDraft);
    case 'project':
      return validateProject(draft as ProjectDraft);
    case 'agent':
      return validateAgent(draft as AgentDraft);
    default:
      // Exhaustiveness: an unhandled kind is a programming error, not a runtime input.
      return [{ field: 'kind', message: `unknown kind: ${String(kind)}` }];
  }
}

// ── Deploy mapping ─────────────────────────────────────────────────────────────────────────────────

function taskPlan(draft: TaskDraft): DeployPlan {
  const launchFields: TaskLaunchFields = {
    project: draft.project,
    action: draft.action,
    target: draft.target,
    riskTier: draft.riskTier,
    body: draft.body ?? '',
    owner: draft.owner,
  };
  // A human-readable preview of the card. The queue ULID is minted server-side by launchCard, so the
  // relpath is the coordination target pattern (starts with queue/ → coordination) rather than a fixed
  // filename; the actual write is driven by launchFields through /api/write/launch.
  const content = [
    `project: ${launchFields.project}`,
    `action: ${launchFields.action}`,
    `target: ${launchFields.target}`,
    `risk-tier: ${launchFields.riskTier}`,
    '',
    launchFields.body,
  ].join('\n');
  const relpath = 'queue/<new>.md';
  return {
    kind: 'task',
    relpath,
    content,
    branchClass: classifyRelpath(relpath),
    endpoint: 'launch',
    launchFields,
  };
}

function skillPlan(draft: SkillDraft): DeployPlan {
  const slug = slugify(draft.name);
  const relpath = `skills/learned/${slug}/SKILL.md`;
  const learnedOn = new Date().toISOString().slice(0, 10);
  const content = [
    '---',
    `name: ${draft.name}`,
    `description: ${draft.description}`,
    'source: dashboard-composer',
    `imported: ${learnedOn}`,
    'provenance-tier: learned',
    '---',
    '',
    draft.body,
    '',
  ].join('\n');
  return {
    kind: 'skill',
    relpath,
    content,
    branchClass: classifyRelpath(relpath),
    endpoint: 'save',
  };
}

function workflowPlan(draft: WorkflowDraft): DeployPlan {
  const id = draft.filename.replace(/\.md$/, '');
  const relpath = `orgs/${draft.project}/workflows/${draft.filename}`;
  const content = [
    '---',
    `id: ${JSON.stringify(id)}`,
    `project: ${JSON.stringify(draft.project)}`,
    // The former draft had no distinct title field. The slug is a safe, deterministic display title
    // until the canonical authoring form adds one.
    `title: ${JSON.stringify(id)}`,
    `profile: ${JSON.stringify(draft.profile)}`,
    ...(draft.manager?.agentId !== undefined && draft.manager.profileId !== undefined
      ? [
          'manager:',
          `  agentId: ${JSON.stringify(draft.manager.agentId)}`,
          `  profileId: ${JSON.stringify(draft.manager.profileId)}`,
        ]
      : []),
    'stages:',
    ...draft.stages.flatMap((stage) => [
      `  - id: ${JSON.stringify(stage.id)}`,
      `    title: ${JSON.stringify(stage.id)}`,
      `    action: ${JSON.stringify(stage.action)}`,
      `    target: ${JSON.stringify(stage.target)}`,
      `    workOrder: ${JSON.stringify(stage.workOrder)}`,
      `    riskTier: ${JSON.stringify(stage.riskTier)}`,
      `    dependsOn: ${JSON.stringify(stage.dependsOn)}`,
      ...(stage.agentId !== undefined && stage.profileId !== undefined
        ? [
            `    agentId: ${JSON.stringify(stage.agentId)}`,
            `    profileId: ${JSON.stringify(stage.profileId)}`,
          ]
        : []),
    ]),
    '---',
    '',
    `# ${id}`,
    '',
    draft.body.trim(),
    '',
  ].join('\n');
  return {
    kind: 'workflow',
    relpath,
    content,
    branchClass: classifyRelpath(relpath),
    endpoint: 'save',
  };
}

function projectPlan(draft: ProjectDraft): DeployPlan {
  const slug = slugify(draft.name);
  const dir = `orgs/${slug}`;
  const relpath = `${dir}/_index.md`;
  // Primary action = the rendered _index.md. The other three rendered files ride along as followUps the
  // UI can offer as subsequent governed saves (v1 primary-file-only decision).
  const followUps: FollowUp[] = [
    { relpath: `${dir}/STATE.md`, content: renderTemplate(TEMPLATE_STATE, draft.name, draft.date) },
    { relpath: `${dir}/contract.md`, content: renderTemplate(TEMPLATE_CONTRACT, draft.name, draft.date) },
    { relpath: `${dir}/HEARTBEAT.md`, content: renderTemplate(TEMPLATE_HEARTBEAT, draft.name, draft.date) },
  ];
  return {
    kind: 'project',
    relpath,
    content: renderTemplate(TEMPLATE_INDEX, draft.name, draft.date),
    branchClass: classifyRelpath(relpath),
    endpoint: 'save',
    followUps,
  };
}

function agentPlan(draft: AgentDraft): DeployPlan {
  const slug = slugify(draft.id);
  const relpath = `agents/${slug}.md`;
  // Frontmatter mirrors the roster/routing tuple. `runner-bound: false` is HARD-CODED — the registry
  // DECLARES an identity; only a human flips it true after binding a runner (plan Flagged #2). agents/ is
  // not a coordination prefix, so classifyRelpath resolves durable (work branch → PR to main).
  const lines = ['---', `id: ${draft.id}`, `role: ${draft.role}`, `runtime: ${draft.runtime}`];
  if (draft.model !== undefined && draft.model.trim() !== '') lines.push(`model: ${draft.model}`);
  if (draft.projects && draft.projects.length > 0) lines.push(`projects: [${draft.projects.join(', ')}]`);
  lines.push('runner-bound: false');
  lines.push(`description: ${draft.description}`);
  lines.push('---');
  const body = draft.body && draft.body.trim() !== '' ? draft.body.replace(/\n+$/, '') : `# Agent: ${draft.id}`;
  const content = `${lines.join('\n')}\n\n${body}\n`;
  return {
    kind: 'agent',
    relpath,
    content,
    branchClass: classifyRelpath(relpath),
    endpoint: 'save',
  };
}

/**
 * Map a VALIDATED draft to its DeployPlan. Refuses (throws) an invalid draft so deploy is blocked at the
 * registry level — the UI must not be able to route a half-formed draft to a governed endpoint.
 */
export function toDeploy<K extends ArtifactKind>(kind: K, draft: DraftFor<K>): DeployPlan {
  const problems = validateDraft(kind, draft);
  if (problems.length > 0) {
    throw new Error(`cannot deploy invalid ${kind} draft: ${problems.map((p) => p.field).join(', ')}`);
  }
  switch (kind) {
    case 'task':
      return taskPlan(draft as TaskDraft);
    case 'skill':
      return skillPlan(draft as SkillDraft);
    case 'workflow':
      return workflowPlan(draft as WorkflowDraft);
    case 'project':
      return projectPlan(draft as ProjectDraft);
    case 'agent':
      return agentPlan(draft as AgentDraft);
    default:
      throw new Error(`unknown kind: ${String(kind)}`);
  }
}
