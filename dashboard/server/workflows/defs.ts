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
const MAX_GATE_PROMPT_CHARS = 2_000;
const MAX_REVIEW_CRITERIA = 16;
/** Bound mirrors proposal.ts MAX_ARTIFACTS so a def can never compile to an over-budget stage. */
const MAX_STAGE_ARTIFACTS = 32;
/** Bound mirrors the proposal validator's artifact-description limit. */
const MAX_ARTIFACT_DESCRIPTION_CHARS = 1_000;
/** Bound mirrors proposal.ts MAX_HUMAN_GATES so a def can never compile to an over-budget stage. */
const MAX_STAGE_HUMAN_GATES = 16;
/** Read-scope list bound — mirrors proposal.ts MAX_LIST_ITEMS (64) so a def can never compile to an
 * over-budget `scope.read` the proposal validator would reject. */
const MAX_READ_SCOPE_ITEMS = 64;

/** Every workflow target must live under `orgs/<project>/` — see the containment note in validateStage. */
const ORGS_DIR = 'orgs';

/**
 * The CLOSED, server-owned set of shareable repo roots a definition may declare in `readScope`, in
 * addition to its own `orgs/<project>` tree (always allowed, unioned in by compile.ts). A frozen code
 * table exactly like `WORKFLOW_EXECUTION_PROFILES` and the action-tier registry: a def can only NAME a
 * root here, never invent one. This is an ALLOWLIST, not a denylist — an unanticipated root fails safe
 * (refused), never admitted. See docs/specs/2026-07-21-worker-read-scope-design.md §4.4.
 *
 * Deliberately EXCLUDED (refused unless a code-reviewed change adds them): `orgs/<other-project>`
 * (cross-org privacy — mirrors the write-containment rule), `memory/` (private agent notes),
 * `dashboard/` (the control-plane source, incl. this policy code), `scripts/`, and the repo root.
 * Note the asymmetry with writes: `governance/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` are human-owned
 * for WRITES (policy.ts HUMAN_OWNED_PREFIXES) but are readable policy text — declaring them for read is
 * safe; policy.ts keeps refusing any write TARGET under them, unchanged.
 */
export const SHAREABLE_READ_ROOTS: readonly string[] = Object.freeze([
  'queue',
  'dashboards',
  'ledgers',
  '_index.md',
  'governance',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
]);

/** True when `path` is the def's own org tree or is covered by a `SHAREABLE_READ_ROOTS` entry. A root
 *  covers `root` exactly and any `root/...` descendant; a file root (`_index.md`) covers only itself. */
function isDeclarableReadRoot(path: string, project: string): boolean {
  const orgTree = `${ORGS_DIR}/${project}`;
  if (path === orgTree || path.startsWith(`${orgTree}/`)) return true;
  return SHAREABLE_READ_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Validate an optional def-level `readScope` list. Each entry is a canonical, repo-relative, `..`-free
 * path (`isSafeRepoRelativePath` — the SAME validator the compiled `scope.read` passes through), bounded
 * and duplicate-free, and covered by the closed allowlist (own org ∪ SHAREABLE_READ_ROOTS). The repo root
 * (`.` / `""`) is not expressible: it already fails `isSafeRepoRelativePath`, asserted here for legibility.
 */
function validateReadScope(
  raw: unknown,
  project: string,
): { ok: true; value: string[] } | { ok: false; detail: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, detail: 'readScope must be a list of repo-relative paths' };
  if (raw.length > MAX_READ_SCOPE_ITEMS) {
    return { ok: false, detail: `readScope must contain at most ${MAX_READ_SCOPE_ITEMS} paths` };
  }
  const seen = new Set<string>();
  const value: string[] = [];
  for (const entry of raw) {
    if (!isSafeRepoRelativePath(entry)) {
      return { ok: false, detail: 'readScope entries must each be a canonical safe repo-relative path (no .., no whole-repo root)' };
    }
    if (seen.has(entry)) return { ok: false, detail: `readScope must not contain the duplicate path '${entry}'` };
    if (!isDeclarableReadRoot(entry, project)) {
      return {
        ok: false,
        detail: `readScope path '${entry}' is not a declarable read root: declare only your own '${ORGS_DIR}/${project}' tree or a server-owned shareable root (${SHAREABLE_READ_ROOTS.join(', ')})`,
      };
    }
    seen.add(entry);
    value.push(entry);
  }
  return { ok: true, value };
}

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
  /** Durable accountable agent. Ownership is descriptive and never grants execution authority. */
  governedBy?: string;
  /** Optional declared worker identity; present only with `profileId`. */
  agentId?: string;
  /** Optional declared execution profile identity; present only with `agentId`. */
  profileId?: string;
  /** Optional per-stage server-owned tool allowlist override. */
  workflowProfile?: string;
  review?: WorkflowReviewDef;
  completionGate?: WorkflowCompletionGateDef;
  /**
   * Declared human gates that BLOCK this stage. `execution.ts#stageBoundary` evaluates a stage's
   * gates BEFORE any attempt is prepared, so a gate declared here halts the stage it is written on
   * until a human resolves it — declare a gate on the stage that must not run, never on the stage
   * whose output is being judged. Omitted (not `[]`) when the stage declares none, so existing
   * definitions hash and compile byte-identically.
   */
  humanGates?: WorkflowHumanGateDef[];
  /**
   * The load-bearing files this stage must actually leave on disk. These are VERIFIED server-side before
   * a completion is accepted (`rosterSessions.ts#deliver`), which is the only thing standing between "the
   * agent printed DONE" and "the stage succeeded": with no declared artifacts the verification loop
   * iterates an empty list and a bare marker with nothing on disk is accepted, so the run advances to the
   * next gate asking a human to approve an artifact that does not exist.
   *
   * Paths are repo-relative, may carry `<parameter>` placeholders (substituted by
   * `instantiateWorkflowDef`), and must sit inside the stage's own `target` tree — a stage cannot promise
   * a file it has no write scope for. Omitted (not `[]`) when a stage declares none, so existing
   * definitions hash and compile byte-identically.
   */
  artifacts?: WorkflowArtifactDef[];
}

/**
 * Declaration-side declared artifact. `id` is the run-visible handle, `path` the file the server checks
 * for, `description` the operator-facing note about what it is.
 */
export interface WorkflowArtifactDef {
  id: string;
  path: string;
  description: string;
}

/**
 * Declaration-side human gate. `spendAuthorization` and `publicationAuthorization` are each admissible
 * only on an `approval` gate: they say WHICH recorded human decision authorizes their own stage's paid
 * generation / T3 publication, and a non-approval response can never stand in for either.
 */
export interface WorkflowHumanGateDef {
  id: string;
  kind: 'approval' | 'input' | 'review';
  prompt: string;
  spendAuthorization?: boolean;
  publicationAuthorization?: boolean;
}

export interface WorkflowReviewCriterionDef { id: string; description: string; }
export interface WorkflowReviewDef {
  subjectStageId: string;
  maxCreatorReworks: number;
  criteria: WorkflowReviewCriterionDef[];
}
export interface WorkflowCompletionGateDef {
  id: string;
  kind: 'approval';
  prompt: string;
  requiresReview: 'pass';
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
  /**
   * `validation-slice` is a server-enforced non-publication workflow class. It exists for bounded
   * live validation runs: no stage may be a T3 publish action or carry a publication gate, even if
   * a later human request or a forged artifact tries to make a release path look available.
   * Omitted keeps the normal production-workflow behaviour.
   */
  executionMode?: 'validation-slice';
  /** Existing workflow tool profile; distinct from the optional execution-profile assignment below. */
  profile: string;
  /** Durable workflow governor. Distinct from the optional executable manager assignment. */
  governedBy?: string;
  /** Optional manager declaration. Omitted for legacy workflow definitions. */
  manager?: WorkflowManagerAssignment;
  /** Explicit launch-time path-segment inputs. Only these placeholders are substituted. */
  parameters?: string[];
  /**
   * The VALUES a launch substituted, set only by `instantiateWorkflowDef` (never parsed from the file).
   * The compiler carries them into the proposal as structured data so a run's identity keeps its channel /
   * slug / slice instead of leaving them recoverable only from substituted prose.
   */
  launchParameters?: Record<string, string>;
  /**
   * Optional declared read roots beyond the def's own `orgs/<project>` tree. Validated against the
   * closed `SHAREABLE_READ_ROOTS` allowlist. Empty when the frontmatter omits `readScope`, which
   * compiles to today's exact `[orgs/<project>]` behaviour (compile.ts).
   */
  readScope: string[];
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

/**
 * Validate a stage's optional `humanGates` list: a closed mapping per entry, a bounded prompt, and a
 * `kind` from the declaration-side enum. Cross-stage id uniqueness is enforced once in
 * `parseWorkflowDef` (a gate id is the run-visible handle a human approves; two stages sharing one id
 * would make an approval ambiguous). `spendAuthorization` is admissible ONLY on an approval gate:
 * an `input`/`review` response is not an approval, and must never read as authorizing spend.
 */
function validateHumanGates(
  raw: unknown,
  label: string,
): { ok: true; value: WorkflowHumanGateDef[] } | { ok: false; detail: string } {
  if (!Array.isArray(raw)) return { ok: false, detail: `${label} must be a list of gate mappings` };
  if (raw.length === 0 || raw.length > MAX_STAGE_HUMAN_GATES) {
    return { ok: false, detail: `${label} must contain 1-${MAX_STAGE_HUMAN_GATES} gates` };
  }
  const allowed = new Set(['id', 'kind', 'prompt', 'spendAuthorization', 'publicationAuthorization']);
  const kinds = new Set(['approval', 'input', 'review']);
  const value: WorkflowHumanGateDef[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(entry)) return { ok: false, detail: `${itemLabel} must be a mapping` };
    const unknownKey = Object.keys(entry).find((key) => !allowed.has(key));
    if (unknownKey) return { ok: false, detail: `${itemLabel} has unknown field '${unknownKey}'` };
    const id = asString(entry.id);
    if (id === null || !SAFE_ID_RE.test(id)) {
      return { ok: false, detail: `${itemLabel}.id must be a safe identifier of 1-${MAX_ID_CHARS} characters` };
    }
    if (seen.has(id)) return { ok: false, detail: `${label} must not contain the duplicate gate id '${id}'` };
    seen.add(id);
    const kind = asString(entry.kind);
    if (kind === null || !kinds.has(kind)) {
      return { ok: false, detail: `${itemLabel}.kind must be approval, input, or review` };
    }
    const prompt = asString(entry.prompt);
    if (prompt === null || prompt.trim() === '' || prompt.length > MAX_GATE_PROMPT_CHARS || prompt.includes('\0')) {
      return { ok: false, detail: `${itemLabel}.prompt must be a non-empty string of at most ${MAX_GATE_PROMPT_CHARS} characters` };
    }
    let spendAuthorization: boolean | undefined;
    if (hasOwn(entry, 'spendAuthorization')) {
      if (typeof entry.spendAuthorization !== 'boolean') {
        return { ok: false, detail: `${itemLabel}.spendAuthorization must be a boolean when present` };
      }
      if (entry.spendAuthorization && kind !== 'approval') {
        return { ok: false, detail: `${itemLabel}.spendAuthorization requires kind 'approval'` };
      }
      spendAuthorization = entry.spendAuthorization;
    }
    let publicationAuthorization: boolean | undefined;
    if (hasOwn(entry, 'publicationAuthorization')) {
      if (typeof entry.publicationAuthorization !== 'boolean') {
        return { ok: false, detail: `${itemLabel}.publicationAuthorization must be a boolean when present` };
      }
      if (entry.publicationAuthorization && kind !== 'approval') {
        return { ok: false, detail: `${itemLabel}.publicationAuthorization requires kind 'approval'` };
      }
      publicationAuthorization = entry.publicationAuthorization;
    }
    value.push({
      id,
      kind: kind as WorkflowHumanGateDef['kind'],
      prompt,
      ...(spendAuthorization === undefined ? {} : { spendAuthorization }),
      ...(publicationAuthorization === undefined ? {} : { publicationAuthorization }),
    });
  }
  return { ok: true, value };
}

/**
 * A `<parameter>` placeholder inside a declared path. `instantiateWorkflowDef` substitutes these at
 * launch; until then the path cannot pass `isSafeRepoRelativePath` (`<` and `>` are not safe segment
 * characters), so validation checks the placeholder-substituted form.
 */
const PATH_PLACEHOLDER_RE = /<([A-Za-z0-9][A-Za-z0-9._-]{0,63})>/g;

/** Every `<parameter>` name appearing in `value`, in order of appearance. */
export function pathPlaceholders(value: string): string[] {
  return [...value.matchAll(PATH_PLACEHOLDER_RE)].map((match) => match[1]);
}

/**
 * Validate a stage's optional `artifacts` list. Each entry is a closed mapping; each path is checked in
 * its placeholder-substituted form against the SAME `isSafeRepoRelativePath` validator the compiled
 * `ProposalArtifact.path` passes through, and must sit inside the stage's own `target` tree. Containment
 * is what keeps a declared artifact honest: a stage may only promise files in the tree its write scope
 * is derived from (compile.ts builds `scope.write` from `target`), so it can never claim a file it has
 * no authority to write.
 */
function validateArtifacts(
  raw: unknown,
  label: string,
  target: string,
): { ok: true; value: WorkflowArtifactDef[] } | { ok: false; detail: string } {
  if (!Array.isArray(raw)) return { ok: false, detail: `${label} must be a list of artifact mappings` };
  if (raw.length === 0 || raw.length > MAX_STAGE_ARTIFACTS) {
    return { ok: false, detail: `${label} must contain 1-${MAX_STAGE_ARTIFACTS} artifacts` };
  }
  const allowed = new Set(['id', 'path', 'description']);
  const value: WorkflowArtifactDef[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(entry)) return { ok: false, detail: `${itemLabel} must be a mapping` };
    const unknownKey = Object.keys(entry).find((key) => !allowed.has(key));
    if (unknownKey) return { ok: false, detail: `${itemLabel} has unknown field '${unknownKey}'` };
    const id = asString(entry.id);
    if (id === null || !SAFE_ID_RE.test(id)) {
      return { ok: false, detail: `${itemLabel}.id must be a safe identifier of 1-${MAX_ID_CHARS} characters` };
    }
    if (seenIds.has(id)) return { ok: false, detail: `${label} must not contain the duplicate artifact id '${id}'` };
    seenIds.add(id);
    const path = asString(entry.path);
    if (path === null || !isSafeRepoRelativePath(path.replace(PATH_PLACEHOLDER_RE, 'x'))) {
      return { ok: false, detail: `${itemLabel}.path must be a canonical safe repo-relative path (parameter placeholders allowed)` };
    }
    if (seenPaths.has(path)) return { ok: false, detail: `${label} must not contain the duplicate artifact path '${path}'` };
    seenPaths.add(path);
    if (path !== target && !path.startsWith(`${target}/`)) {
      return { ok: false, detail: `${itemLabel}.path must sit inside this stage's own target tree '${target}/'` };
    }
    const description = asString(entry.description);
    if (description === null || description.trim() === '' || description.length > MAX_ARTIFACT_DESCRIPTION_CHARS || description.includes('\0')) {
      return { ok: false, detail: `${itemLabel}.description must be a non-empty string of at most ${MAX_ARTIFACT_DESCRIPTION_CHARS} characters` };
    }
    value.push({ id, path, description });
  }
  return { ok: true, value };
}

function validateStage(
  raw: unknown,
  index: number,
  body: string,
  project: string,
  knownProfiles?: ReadonlySet<string>,
): { ok: true; value: WorkflowStageDef } | { ok: false; detail: string } {
  const label = `stages[${index}]`;
  if (!isRecord(raw)) return { ok: false, detail: `${label} must be a mapping` };
  const allowed = new Set(['id', 'title', 'action', 'target', 'workOrder', 'dependsOn', 'riskTier', 'governedBy', 'agentId', 'profileId', 'workflowProfile', 'review', 'completionGate', 'humanGates', 'artifacts']);
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
  if (typeof target !== 'string' || !isSafeRepoRelativePath(target.replace(PATH_PLACEHOLDER_RE, 'x'))) {
    return { ok: false, detail: `${label}.target must be a canonical safe repo-relative path (parameter placeholders allowed)` };
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
  let governedBy: string | undefined;
  if (hasOwn(raw, 'governedBy')) {
    const owner = asString(raw.governedBy);
    if (owner === null || !SAFE_AGENT_ID_RE.test(owner)) {
      return { ok: false, detail: `${label}.governedBy must be a safe agent identifier of 1-64 characters` };
    }
    governedBy = owner;
  }
  const hasAgentId = hasOwn(raw, 'agentId');
  const hasProfileId = hasOwn(raw, 'profileId');
  if (hasAgentId !== hasProfileId) return { ok: false, detail: `${label}.agentId and profileId must appear together` };
  let assignment: WorkflowManagerAssignment | undefined;
  if (hasAgentId && hasProfileId) {
    const validated = validateAgentProfileAssignment({ agentId: raw.agentId, profileId: raw.profileId }, label);
    if (!validated.ok) return validated;
    assignment = validated.value;
  }
  let workflowProfile: string | undefined;
  if (hasOwn(raw, 'workflowProfile')) {
    const profile = asString(raw.workflowProfile);
    if (profile === null || !SAFE_EXECUTION_PROFILE_ID_RE.test(profile)) {
      return { ok: false, detail: `${label}.workflowProfile must be a safe execution profile identifier` };
    }
    if (knownProfiles && !knownProfiles.has(profile)) {
      return { ok: false, detail: `${label}.workflowProfile '${profile}' is not a server-owned execution profile` };
    }
    workflowProfile = profile;
  }
  let review: WorkflowReviewDef | undefined;
  if (hasOwn(raw, 'review')) {
    if (!action.startsWith('review:')) return { ok: false, detail: `${label}.review requires an action beginning 'review:'` };
    if (!assignment) return { ok: false, detail: `${label}.review requires agentId and profileId assignment` };
    if (workflowProfile !== 'checker-readonly') return { ok: false, detail: `${label}.review requires workflowProfile 'checker-readonly'` };
    if (!isRecord(raw.review)) return { ok: false, detail: `${label}.review must be a mapping` };
    const reviewAllowed = new Set(['subjectStageId', 'maxCreatorReworks', 'criteria']);
    const reviewUnknown = Object.keys(raw.review).find((key) => !reviewAllowed.has(key));
    if (reviewUnknown) return { ok: false, detail: `${label}.review has unknown field '${reviewUnknown}'` };
    const subjectStageId = asString(raw.review.subjectStageId);
    if (subjectStageId === null || !SAFE_ID_RE.test(subjectStageId) || !dependsOn.includes(subjectStageId)) {
      return { ok: false, detail: `${label}.review.subjectStageId must be a direct dependsOn stage id` };
    }
    const maxCreatorReworks = raw.review.maxCreatorReworks;
    if (typeof maxCreatorReworks !== 'number' || !Number.isSafeInteger(maxCreatorReworks) || maxCreatorReworks < 0 || maxCreatorReworks > 2) {
      return { ok: false, detail: `${label}.review.maxCreatorReworks must be an integer from 0 to 2` };
    }
    if (!Array.isArray(raw.review.criteria) || raw.review.criteria.length < 1 || raw.review.criteria.length > MAX_REVIEW_CRITERIA) {
      return { ok: false, detail: `${label}.review.criteria must contain 1-${MAX_REVIEW_CRITERIA} items` };
    }
    const criteria: WorkflowReviewCriterionDef[] = [];
    const criterionIds = new Set<string>();
    for (let criterionIndex = 0; criterionIndex < raw.review.criteria.length; criterionIndex += 1) {
      const criterion = raw.review.criteria[criterionIndex];
      if (!isRecord(criterion) || Object.keys(criterion).some((key) => key !== 'id' && key !== 'description')) {
        return { ok: false, detail: `${label}.review.criteria[${criterionIndex}] must be a closed mapping` };
      }
      const criterionId = asString(criterion.id);
      const description = asString(criterion.description);
      if (criterionId === null || !SAFE_ID_RE.test(criterionId) || criterionIds.has(criterionId)
        || description === null || description.trim() === '' || description.length > MAX_TITLE_CHARS || description.includes('\0')) {
        return { ok: false, detail: `${label}.review.criteria must have unique safe ids and bounded descriptions` };
      }
      criterionIds.add(criterionId);
      criteria.push({ id: criterionId, description });
    }
    review = { subjectStageId, maxCreatorReworks, criteria };
  }
  let completionGate: WorkflowCompletionGateDef | undefined;
  if (hasOwn(raw, 'completionGate')) {
    if (!review) return { ok: false, detail: `${label}.completionGate requires review` };
    if (!isRecord(raw.completionGate)) return { ok: false, detail: `${label}.completionGate must be a mapping` };
    const gateAllowed = new Set(['id', 'kind', 'prompt', 'requiresReview']);
    const gateUnknown = Object.keys(raw.completionGate).find((key) => !gateAllowed.has(key));
    if (gateUnknown) return { ok: false, detail: `${label}.completionGate has unknown field '${gateUnknown}'` };
    const gateId = asString(raw.completionGate.id);
    const prompt = asString(raw.completionGate.prompt);
    if (gateId === null || !SAFE_ID_RE.test(gateId) || raw.completionGate.kind !== 'approval' || raw.completionGate.requiresReview !== 'pass'
      || prompt === null || prompt.trim() === '' || prompt.length > MAX_GATE_PROMPT_CHARS || prompt.includes('\0')) {
      return { ok: false, detail: `${label}.completionGate must be an approval requiring review pass with a bounded prompt` };
    }
    completionGate = { id: gateId, kind: 'approval', prompt, requiresReview: 'pass' };
  }
  let humanGates: WorkflowHumanGateDef[] | undefined;
  if (hasOwn(raw, 'humanGates')) {
    const validated = validateHumanGates(raw.humanGates, `${label}.humanGates`);
    if (!validated.ok) return validated;
    humanGates = validated.value;
  }
  let artifacts: WorkflowArtifactDef[] | undefined;
  if (hasOwn(raw, 'artifacts')) {
    const validated = validateArtifacts(raw.artifacts, `${label}.artifacts`, target);
    if (!validated.ok) return validated;
    artifacts = validated.value;
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
      ...(governedBy ? { governedBy } : {}),
      ...(assignment ?? {}),
      ...(workflowProfile ? { workflowProfile } : {}),
      ...(review ? { review } : {}),
      ...(completionGate ? { completionGate } : {}),
      ...(humanGates ? { humanGates } : {}),
      ...(artifacts ? { artifacts } : {}),
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
  const allowed = new Set(['id', 'project', 'title', 'executionMode', 'profile', 'governedBy', 'manager', 'parameters', 'readScope', 'stages']);
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
  let executionMode: WorkflowDef['executionMode'];
  if (hasOwn(frontmatter, 'executionMode')) {
    if (frontmatter.executionMode !== 'validation-slice') {
      return { ok: false, detail: "executionMode must be 'validation-slice' when present" };
    }
    executionMode = 'validation-slice';
  }
  const profile = asString(frontmatter.profile);
  if (profile === null || profile.trim() === '' || profile.length > MAX_PROFILE_CHARS) {
    return { ok: false, detail: `profile must be a non-empty string of at most ${MAX_PROFILE_CHARS} characters` };
  }
  if (options.knownProfiles && !options.knownProfiles.has(profile)) {
    return { ok: false, detail: `profile '${profile}' is not a server-owned execution profile` };
  }

  let governedBy: string | undefined;
  if (hasOwn(frontmatter, 'governedBy')) {
    const managerOwner = asString(frontmatter.governedBy);
    if (managerOwner === null || !SAFE_AGENT_ID_RE.test(managerOwner)) {
      return { ok: false, detail: 'governedBy must be a safe agent identifier of 1-64 characters' };
    }
    governedBy = managerOwner;
  }

  let manager: WorkflowManagerAssignment | undefined;
  if (hasOwn(frontmatter, 'manager')) {
    const validated = validateAgentProfileAssignment(frontmatter.manager, 'manager');
    if (!validated.ok) return validated;
    manager = validated.value;
  }
  const readScope = validateReadScope(frontmatter.readScope, project);
  if (!readScope.ok) return readScope;

  const description = split.body.trim();
  if (description.length > MAX_DESCRIPTION_CHARS) return { ok: false, detail: 'description body is too long' };

  const rawStages = frontmatter.stages;
  if (!Array.isArray(rawStages) || rawStages.length === 0 || rawStages.length > MAX_DEFINITION_STAGES) {
    return { ok: false, detail: `stages must contain 1-${MAX_DEFINITION_STAGES} items` };
  }
  const stages: WorkflowStageDef[] = [];
  const ids = new Set<string>();
  // A human gate id is the run-visible handle a person approves. Uniqueness is enforced across the
  // WHOLE workflow, not per stage: two stages sharing a gate id would make "g2 is approved"
  // ambiguous about which stage it released — and a spend gate must never be ambiguous.
  const gateIds = new Set<string>();
  for (let index = 0; index < rawStages.length; index += 1) {
    const stage = validateStage(rawStages[index], index, description, project, options.knownProfiles);
    if (!stage.ok) return stage;
    if (ids.has(stage.value.id)) return { ok: false, detail: `duplicate stage id '${stage.value.id}'` };
    ids.add(stage.value.id);
    // A completion gate is a human gate the operator answers in the same Inbox, under the same
    // `automatic:gate:<stageId>:<gateId>` title shape, so it shares the one id namespace: leaving it out
    // of this set let a completionGate id collide with a humanGates id and make an approval ambiguous.
    for (const gate of [...(stage.value.humanGates ?? []), ...(stage.value.completionGate ? [stage.value.completionGate] : [])]) {
      if (gateIds.has(gate.id)) return { ok: false, detail: `duplicate human gate id '${gate.id}'` };
      gateIds.add(gate.id);
    }
    stages.push(stage.value);
  }

  // Dependency references must resolve and the graph must be acyclic (Kahn's algorithm).
  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      if (!ids.has(dep)) return { ok: false, detail: `stage '${stage.id}' depends on missing stage '${dep}'` };
      if (dep === stage.id) return { ok: false, detail: `stage '${stage.id}' cannot depend on itself` };
    }
  }
  if (executionMode === 'validation-slice') {
    for (const stage of stages) {
      if (stage.action.startsWith('publish:') || stage.riskTier === 'T3') {
        return { ok: false, detail: `validation-slice workflow must not declare publish or T3 stage '${stage.id}'` };
      }
      if (stage.humanGates?.some((gate) => gate.publicationAuthorization === true)) {
        return { ok: false, detail: `validation-slice workflow must not declare publication gate on stage '${stage.id}'` };
      }
    }
  }
  const parameters = frontmatter.parameters === undefined ? [] : frontmatter.parameters;
  if (!Array.isArray(parameters) || parameters.some((value) => typeof value !== 'string' || !SAFE_ID_RE.test(value))) {
    return { ok: false, detail: 'parameters must be an array of safe identifiers' };
  }
  if (new Set(parameters).size !== parameters.length) return { ok: false, detail: 'parameters must not contain duplicates' };
  // A placeholder in a declared target or artifact path that is NOT a launch parameter would survive substitution
  // as a literal `<name>`, which no file on disk can ever be — the stage would report done, the server
  // would look for a path containing `<`, and the run would park at every stage. Refuse it here, where
  // the message can name the offender, instead of at proposal validation.
  const declaredParameters = new Set(parameters as string[]);
  for (const stage of stages) {
    const unknownTarget = pathPlaceholders(stage.target).find((name) => !declaredParameters.has(name));
    if (unknownTarget) {
      return { ok: false, detail: `stage '${stage.id}' target uses undeclared parameter '<${unknownTarget}>'` };
    }
    for (const artifact of stage.artifacts ?? []) {
      const unknown = pathPlaceholders(artifact.path).find((name) => !declaredParameters.has(name));
      if (unknown) {
        return { ok: false, detail: `stage '${stage.id}' artifact '${artifact.id}' uses undeclared parameter '<${unknown}>'` };
      }
    }
  }
  const reviewStageIds = new Set(stages.filter((stage) => stage.review !== undefined).map((stage) => stage.id));
  const reviewSubjects = new Set<string>();
  for (const stage of stages) {
    if (!stage.review) continue;
    const subjectStageId = stage.review.subjectStageId;
    if (stage.dependsOn.length !== 1 || stage.dependsOn[0] !== subjectStageId) {
      return { ok: false, detail: `review stage '${stage.id}' must depend only on its subject '${subjectStageId}'` };
    }
    if (reviewSubjects.has(subjectStageId)) return { ok: false, detail: `multiple review stages target subject '${subjectStageId}'` };
    if (reviewStageIds.has(subjectStageId)) return { ok: false, detail: `review stage '${stage.id}' cannot review review stage '${subjectStageId}'` };
    reviewSubjects.add(subjectStageId);
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

  return {
    ok: true,
    value: {
      id, project, title, ...(executionMode ? { executionMode } : {}), profile, readScope: readScope.value, parameters: [...parameters],
      ...(governedBy ? { governedBy } : {}), ...(manager ? { manager } : {}), description, stages,
    },
  };
}

/** Substitute only declared launch parameters; unrelated placeholders such as `<shot-id>` remain literal. */
export function instantiateWorkflowDef(def: WorkflowDef, input: Record<string, string>): WorkflowDefResult {
  const keys = Object.keys(input).sort();
  const expected = [...(def.parameters ?? [])].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return { ok: false, detail: 'launch parameters must provide exactly the declared keys' };
  const isSafeSegment = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    const deviceBase = value.split('.', 1)[0];
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
      && !/[. ]$/.test(value) && value !== '.' && value !== '..'
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(deviceBase);
  };
  for (const key of expected) if (!isSafeSegment(input[key])) return { ok: false, detail: `parameter '${key}' must be a safe path segment` };
  const sourceFields = [
    def.description,
    ...def.stages.flatMap((stage) => [
      stage.workOrder,
      stage.target,
      // Declared artifact paths count as USE: a parameter that only scopes an output path is still used.
      ...(stage.artifacts ?? []).map((artifact) => artifact.path),
    ]),
  ];
  for (const key of expected) if (!sourceFields.some((value) => value.includes(`<${key}>`))) return { ok: false, detail: `parameter '${key}' is declared but not used by the workflow` };
  const replace = (value: string) => expected.reduce((next, key) => next.replaceAll(`<${key}>`, input[key]), value);
  return {
    ok: true,
    value: {
      ...def,
      description: replace(def.description),
      // Artifact paths are substituted with the same replacer as targets and work orders: an unsubstituted
      // `<slug>` in a declared path is a path no file can ever have, so the stage would park forever.
      stages: def.stages.map((stage) => ({
        ...stage,
        workOrder: replace(stage.workOrder),
        target: replace(stage.target),
        ...(stage.artifacts ? { artifacts: stage.artifacts.map((artifact) => ({ ...artifact, path: replace(artifact.path) })) } : {}),
      })),
      // Emitted only when the def actually declares parameters, so a parameterless definition compiles to
      // the byte-identical proposal it did before this field existed.
      ...(expected.length === 0 ? {} : { launchParameters: Object.fromEntries(expected.map((key) => [key, input[key]])) }),
    },
  };
}
