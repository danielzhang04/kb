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
 *   - v1 kinds are task | workflow | skill | project (+ the `idea`/unknown seed state). `agent` is
 *     EXCLUDED — deferred to a later registry-design chunk.
 *   - Multi-file artifacts deploy the PRIMARY FILE ONLY in v1. Skill → skills/learned/<slug>/SKILL.md
 *     (the LEARNED tier — binding, never curated, so the sync_skills curated-mirror hook is never
 *     tripped). Project → orgs/<name>/_index.md rendered from templates/_index.md (the other three
 *     rendered files ride along as `followUps` the UI may offer as subsequent saves). Workflow →
 *     workflows/wf_<name>.md.
 *   - Task maps to the launch endpoint's fields {project, action, target, riskTier, body}.
 */

/** The concrete v1 artifact kinds. `agent` is intentionally absent (deferred). */
export const ARTIFACT_KINDS = ['task', 'workflow', 'skill', 'project'] as const;
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
}

/** Skill draft — the two frontmatter fields registry/skills.ts reads, plus the Markdown body. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

/** Workflow draft — the registry derives `id` from the wf_-prefixed filename; there is no frontmatter
 *  schema today, so we validate the filename shape + a non-empty body. */
export interface WorkflowDraft {
  filename: string;
  body: string;
}

/** Project draft — a name + the render date. The date is passed IN (not read from the clock) so
 *  toDeploy stays pure and deterministic; it fills the `{{date}}` placeholder in templates/STATE.md. */
export interface ProjectDraft {
  name: string;
  date: string;
}

/** Map a kind to its draft type (used only for local typing; callers pass the concrete shapes). */
export type DraftFor<K extends ArtifactKind> = K extends 'task'
  ? TaskDraft
  : K extends 'skill'
    ? SkillDraft
    : K extends 'workflow'
      ? WorkflowDraft
      : ProjectDraft;

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

/** The idea-first disambiguation seed — asks the model to help decide which of the four v1 types the
 *  idea wants to become. IDEA-FIRST is binding; `agent` is not offered (excluded from v1). */
function ideaSeed(idea: string): string {
  return [
    'You are helping an operator turn a raw idea into a typed, deployable kb artifact.',
    '',
    'The idea:',
    idea,
    '',
    'First, help decide which TYPE this idea wants to become — do not assume. The four v1 kinds are:',
    '- task — a single governed work order filed as a queue card (project, action, target, risk tier).',
    '- workflow — a reusable multi-step procedure saved as workflows/wf_<name>.md.',
    '- skill — a packaged capability saved as skills/learned/<slug>/SKILL.md (name + description + body).',
    '- project — a new orgs/<name>/ workspace scaffolded from the standard templates.',
    '',
    'Ask the operator any clarifying question needed to disambiguate, then recommend one type and explain',
    'why. Once the type is chosen the conversation re-seeds with that type’s creation prompt.',
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
        'Draft a WORKFLOW — a reusable procedure saved as workflows/wf_<name>.md.',
        'The filename MUST be wf_<name>.md (the registry derives its id from the filename). Write the',
        'full Markdown body (the steps). Deploy is durable: work branch → PR to main.',
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
  // The registry derives the id from the filename; it MUST be wf_<name>.md. review F4 — the old
  // `^wf_.+\.md$` accepted `wf_../../x.md` (the `.+` swallowed the traversal), so the durable relpath
  // `workflows/<filename>` could escape workflows/. Constrain the name to a single safe segment of
  // lowercase alphanumerics + hyphens — no `/`, no `.`, so no traversal survives.
  if (!/^wf_[a-z0-9-]+\.md$/.test(draft.filename ?? '')) {
    problems.push({ field: 'filename', message: 'filename must match wf_<name>.md (lowercase name, no path separators or "..")' });
  }
  requireNonEmpty(problems, 'body', draft.body, 'a workflow body is required');
  return problems;
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
  // SKILL.md = the two frontmatter fields the registry reads + the body.
  const content = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.body}\n`;
  return {
    kind: 'skill',
    relpath,
    content,
    branchClass: classifyRelpath(relpath),
    endpoint: 'save',
  };
}

function workflowPlan(draft: WorkflowDraft): DeployPlan {
  const relpath = `workflows/${draft.filename}`;
  return {
    kind: 'workflow',
    relpath,
    content: draft.body,
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
    default:
      throw new Error(`unknown kind: ${String(kind)}`);
  }
}
