/**
 * Pure, fail-closed compiler boundary for assistant-authored plan proposals.
 *
 * Assistant text is untrusted process output. This module admits only one closed, versioned JSON
 * document and deliberately has no execution, filesystem, route, or persistence capability.
 */
import { createHash } from 'node:crypto';

export const PLAN_PROPOSAL_SCHEMA = 'kb.plan-proposal/v1' as const;
export const PLAN_PROPOSAL_DIFF_SCHEMA = 'kb.plan-proposal-diff/v1' as const;
export const PLAN_PROPOSAL_REVISION_SCHEMA = 'kb.plan-proposal-revision/v1' as const;

export const MAX_ASSISTANT_TEXT_CHARS = 256 * 1024;
export const MAX_PROPOSAL_BYTES = 128 * 1024;
export const MAX_PROPOSAL_STAGES = 32;

const MAX_ID_CHARS = 64;
const MAX_PATH_CHARS = 512;
const MAX_TITLE_CHARS = 200;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_ACTION_CHARS = 256;
const MAX_WORK_ORDER_CHARS = 64 * 1024;
const MAX_LIST_ITEMS = 64;
const MAX_ARTIFACTS = 32;
const MAX_CHECKPOINTS = 32;
const MAX_HUMAN_GATES = 16;
const MAX_JSON_DEPTH = 32;
const REQUIRED_GOVERNANCE_REFS = [
  'CLAUDE.md',
  'governance/agent-rules.md',
  'governance/risk-tiers.md',
] as const;

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_ACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const RUNTIME_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXECUTION_PROFILE_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const DECLARATION_HASH_RE = /^[a-f0-9]{64}$/;
const SAFE_PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const WINDOWS_DEVICE_SEGMENT_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export type ProposalRiskTier = 'T1' | 'T2' | 'T3';
export type HumanGateKind = 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';

export interface ProposalRegistry {
  /** Closed runtime -> model registry loaded from server-owned policy. */
  runtimes: Readonly<Record<string, readonly string[]>>;
  /** Closed server-owned skill ids. */
  skills: readonly string[];
  /**
   * Closed server-owned workflow tool-allowlist profile ids (`environment.ts` WORKFLOW_EXECUTION_PROFILES).
   * Optional ONLY so registries assembled before this field existed still typecheck; it is never a
   * widening default. A proposal that declares `profile` is REFUSED when this list is absent or does not
   * contain the declared id — absent list means "no profile is admissible", never "any profile is".
   */
  workflowProfiles?: readonly string[];
}

export interface ProposalRouting {
  runtime: string;
  model: string;
}

/** Immutable compiler-resolved declaration/profile binding. Never accepted from assistant/browser input. */
export interface ResolvedAgentAssignment {
  agentId: string;
  declarationPath: string;
  declarationHash: string;
  profileId: string;
  runtime: 'claude' | 'codex';
  model: string;
}

export interface ProposalManager extends ProposalRouting {
  requiredSkills: string[];
  assignment?: ResolvedAgentAssignment;
}

export interface ProposalScope {
  read: string[];
  write: string[];
}

export interface ProposalArtifact {
  id: string;
  path: string;
  description: string;
}

export interface ProposalCheckpoint {
  id: string;
  label: string;
}

export interface ProposalHumanGate {
  id: string;
  kind: HumanGateKind;
  prompt: string;
  /**
   * COMPILER-ONLY. When true, the human approval recorded against this gate IS the run's spend
   * authorization for the gate's own stage (`policy.ts` `spendAuthorization`). Admitted only on a
   * server-compiled proposal — an assistant- or browser-authored proposal that declares it is
   * refused, exactly like `review`/`completionGate`. It is never a capability grant on its own: it
   * ADDS a blocking approval boundary to the stage that carries it, and it authorizes nothing on any
   * other stage. Only `kind: 'approval'` may carry it — an `input`/`review` response can never
   * satisfy a spend requirement.
   */
  spendAuthorization?: boolean;
}

/** Compiler-only checker review contract. Browser proposals cannot carry this field. */
export interface ProposalReviewCriterion { id: string; description: string; }
export interface ProposalReview {
  subjectStageId: string;
  maxCreatorReworks: number;
  criteria: ProposalReviewCriterion[];
}
/** Compiler-only checker completion gate. Browser proposals cannot carry this field. */
export interface ProposalCompletionGate { id: string; kind: 'approval'; prompt: string; requiresReview: 'pass'; }

/** Each stage is one executable task node in the deterministic DAG. */
export interface ProposalStage {
  id: string;
  title: string;
  action: string;
  target: string;
  workOrder: string;
  riskTier: ProposalRiskTier;
  dependsOn: string[];
  worker: ProposalRouting;
  requiredSkills: string[];
  scope: ProposalScope;
  artifacts: ProposalArtifact[];
  checkpoints: ProposalCheckpoint[];
  humanGates: ProposalHumanGate[];
  assignment?: ResolvedAgentAssignment;
  workflowProfile?: string;
  review?: ProposalReview;
  completionGate?: ProposalCompletionGate;
}

export interface PlanProposal {
  schema: typeof PLAN_PROPOSAL_SCHEMA;
  proposalId: string;
  project: string;
  title: string;
  summary: string;
  manager: ProposalManager;
  scope: ProposalScope;
  governanceRefs: string[];
  stages: ProposalStage[];
  /**
   * The workflow tool-allowlist profile this proposal executes under, as DATA (not merely as a
   * proposal-id hash input). The worker adapter resolves `--allowedTools` from it; an absent or
   * unresolvable profile refuses the spawn rather than launching uncapped (`claudeWorkerAdapter.ts`).
   *
   * Optional on the wire so proposals stored before this field existed still validate and still hash
   * to the SAME content hash (the key is emitted only when declared). Optional here is a
   * back-compatibility affordance, never a capability default: see `createWorkflowToolPolicyResolver`.
   */
  profile?: string;
}

export interface ProposalChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface ProposalRevisionDiff {
  readonly schema: typeof PLAN_PROPOSAL_DIFF_SCHEMA;
  readonly fromContentHash: string | null;
  readonly toContentHash: string;
  readonly changed: boolean;
  readonly changes: readonly ProposalChange[];
}

export interface ProposalRevision {
  readonly schema: typeof PLAN_PROPOSAL_REVISION_SCHEMA;
  readonly revision: number;
  readonly contentHash: string;
  readonly previousContentHash: string | null;
  readonly proposal: DeepReadonly<PlanProposal>;
  readonly diff: ProposalRevisionDiff;
}

export type ProposalValidation<T> = { ok: true; value: T } | { ok: false; detail: string };

/** Required top-level fields. `profile` is deliberately absent: it is admissible but not mandatory here. */
const TOP_REQUIRED_FIELDS = [
  'schema', 'proposalId', 'project', 'title', 'summary', 'manager', 'scope', 'governanceRefs', 'stages',
] as const;
const TOP_FIELDS = new Set<string>([...TOP_REQUIRED_FIELDS, 'profile']);
const MANAGER_FIELDS = new Set(['runtime', 'model', 'requiredSkills']);
const COMPILED_MANAGER_FIELDS = new Set([...MANAGER_FIELDS, 'assignment']);
const ROUTING_FIELDS = new Set(['runtime', 'model']);
const SCOPE_FIELDS = new Set(['read', 'write']);
const STAGE_FIELDS = new Set([
  'id', 'title', 'action', 'target', 'workOrder', 'riskTier', 'dependsOn', 'worker', 'requiredSkills',
  'scope', 'artifacts', 'checkpoints', 'humanGates',
]);
const COMPILED_STAGE_FIELDS = new Set([...STAGE_FIELDS, 'assignment', 'workflowProfile', 'review', 'completionGate']);
const ASSIGNMENT_FIELDS = new Set(['agentId', 'declarationPath', 'declarationHash', 'profileId', 'runtime', 'model']);
const ARTIFACT_FIELDS = new Set(['id', 'path', 'description']);
const CHECKPOINT_FIELDS = new Set(['id', 'label']);
const HUMAN_GATE_FIELDS = new Set(['id', 'kind', 'prompt']);
/** `spendAuthorization` is compiler-only; browser/assistant gates are held to HUMAN_GATE_FIELDS. */
const COMPILED_HUMAN_GATE_FIELDS = new Set([...HUMAN_GATE_FIELDS, 'spendAuthorization']);
const REVIEW_FIELDS = new Set(['subjectStageId', 'maxCreatorReworks', 'criteria']);
const REVIEW_CRITERION_FIELDS = new Set(['id', 'description']);
const COMPLETION_GATE_FIELDS = new Set(['id', 'kind', 'prompt', 'requiresReview']);
const SOURCE_FIELDS = new Set(['role', 'state', 'visibility', 'text']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): string | null {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) return `unknown field '${unknown}'`;
  const missing = required.find((key) => !(key in value));
  return missing ? `missing field '${missing}'` : null;
}

function validateId(value: unknown, label: string): ProposalValidation<string> {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    return { ok: false, detail: `${label} must be a safe identifier of 1-${MAX_ID_CHARS} characters` };
  }
  return { ok: true, value };
}

function validateText(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): ProposalValidation<string> {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    return { ok: false, detail: `${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}` };
  }
  if (value.length > max) return { ok: false, detail: `${label} must be at most ${max} characters` };
  if (value.includes('\0')) return { ok: false, detail: `${label} must not contain NUL bytes` };
  return { ok: true, value };
}

/** Accept only canonical, forward-slash, repo-relative references. No normalization is attempted. */
export function isSafeRepoRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_CHARS) return false;
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value) || value.includes('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) =>
    segment !== '.'
    && segment !== '..'
    && segment.toLowerCase() !== '.git'
    && !segment.endsWith('.')
    && !WINDOWS_DEVICE_SEGMENT_RE.test(segment)
    && SAFE_PATH_SEGMENT_RE.test(segment));
}

function validatePath(value: unknown, label: string): ProposalValidation<string> {
  return isSafeRepoRelativePath(value)
    ? { ok: true, value }
    : { ok: false, detail: `${label} must be a canonical safe repo-relative path` };
}

function validateUniqueStringArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
  item: (entry: unknown, itemLabel: string) => ProposalValidation<string>,
): ProposalValidation<string[]> {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return { ok: false, detail: `${label} must contain ${min}-${max} items` };
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = item(value[index], `${label}[${index}]`);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value)) return { ok: false, detail: `${label} must not contain duplicates` };
    seen.add(parsed.value);
    result.push(parsed.value);
  }
  return { ok: true, value: result };
}

function validateScope(value: unknown, label: string): ProposalValidation<ProposalScope> {
  if (!isRecord(value)) return { ok: false, detail: `${label} must be an object` };
  const fields = exactFields(value, SCOPE_FIELDS, ['read', 'write']);
  if (fields) return { ok: false, detail: `${label}: ${fields}` };
  const read = validateUniqueStringArray(value.read, `${label}.read`, 0, MAX_LIST_ITEMS, validatePath);
  if (!read.ok) return read;
  const write = validateUniqueStringArray(value.write, `${label}.write`, 0, MAX_LIST_ITEMS, validatePath);
  if (!write.ok) return write;
  return { ok: true, value: { read: read.value, write: write.value } };
}

function validateRegisteredSkills(
  value: unknown,
  label: string,
  registry: ProposalRegistry,
): ProposalValidation<string[]> {
  const lexical = validateUniqueStringArray(value, label, 0, MAX_LIST_ITEMS, validateId);
  if (!lexical.ok) return lexical;
  const registered = new Set(registry.skills);
  for (let index = 0; index < lexical.value.length; index += 1) {
    if (!registered.has(lexical.value[index])) {
      return { ok: false, detail: `${label}[${index}] '${lexical.value[index]}' is not registered` };
    }
  }
  return lexical;
}

function validateRouting(
  value: unknown,
  label: string,
  registry: ProposalRegistry,
  manager: boolean,
): ProposalValidation<ProposalRouting | ProposalManager> {
  if (!isRecord(value)) return { ok: false, detail: `${label} must be an object` };
  const allowed = manager ? MANAGER_FIELDS : ROUTING_FIELDS;
  const required = manager ? ['runtime', 'model', 'requiredSkills'] : ['runtime', 'model'];
  const fields = exactFields(value, allowed, required);
  if (fields) return { ok: false, detail: `${label}: ${fields}` };
  if (typeof value.runtime !== 'string' || !RUNTIME_ID_RE.test(value.runtime)) {
    return { ok: false, detail: `${label}.runtime must be a valid runtime identifier` };
  }
  if (!Object.prototype.hasOwnProperty.call(registry.runtimes, value.runtime)) {
    return { ok: false, detail: `${label}.runtime '${value.runtime}' is not registered` };
  }
  if (typeof value.model !== 'string' || !MODEL_ID_RE.test(value.model)) {
    return { ok: false, detail: `${label}.model must be a valid model identifier` };
  }
  if (!(registry.runtimes[value.runtime] ?? []).includes(value.model)) {
    return { ok: false, detail: `${label}.model '${value.model}' is not registered for runtime '${value.runtime}'` };
  }
  if (!manager) return { ok: true, value: { runtime: value.runtime, model: value.model } };
  const skills = validateRegisteredSkills(value.requiredSkills, `${label}.requiredSkills`, registry);
  if (!skills.ok) return skills;
  return { ok: true, value: { runtime: value.runtime, model: value.model, requiredSkills: skills.value } };
}

function validateResolvedAssignment(value: unknown, label: string): ProposalValidation<ResolvedAgentAssignment> {
  if (!isRecord(value)) return { ok: false, detail: `${label} must be an object` };
  const fields = exactFields(value, ASSIGNMENT_FIELDS, [...ASSIGNMENT_FIELDS]);
  if (fields) return { ok: false, detail: `${label}: ${fields}` };
  if (typeof value.agentId !== 'string' || !AGENT_ID_RE.test(value.agentId)) {
    return { ok: false, detail: `${label}.agentId must be a safe declared agent id` };
  }
  const declarationPath = `agents/${value.agentId}.md`;
  if (value.declarationPath !== declarationPath || !isSafeRepoRelativePath(value.declarationPath)) {
    return { ok: false, detail: `${label}.declarationPath must be the canonical declaration path for agentId` };
  }
  if (typeof value.declarationHash !== 'string' || !DECLARATION_HASH_RE.test(value.declarationHash)) {
    return { ok: false, detail: `${label}.declarationHash must be a lowercase SHA-256 hash` };
  }
  if (typeof value.profileId !== 'string' || !EXECUTION_PROFILE_ID_RE.test(value.profileId)) {
    return { ok: false, detail: `${label}.profileId must be a safe execution profile id` };
  }
  if (value.runtime !== 'claude' && value.runtime !== 'codex') {
    return { ok: false, detail: `${label}.runtime must be claude or codex` };
  }
  if (typeof value.model !== 'string' || !MODEL_ID_RE.test(value.model)) {
    return { ok: false, detail: `${label}.model must be a valid model identifier` };
  }
  return {
    ok: true,
    value: {
      agentId: value.agentId,
      declarationPath,
      declarationHash: value.declarationHash,
      profileId: value.profileId,
      runtime: value.runtime,
      model: value.model,
    },
  };
}

function validateArtifacts(value: unknown, label: string): ProposalValidation<ProposalArtifact[]> {
  if (!Array.isArray(value) || value.length > MAX_ARTIFACTS) {
    return { ok: false, detail: `${label} must contain 0-${MAX_ARTIFACTS} items` };
  }
  const result: ProposalArtifact[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(raw)) return { ok: false, detail: `${itemLabel} must be an object` };
    const fields = exactFields(raw, ARTIFACT_FIELDS, [...ARTIFACT_FIELDS]);
    if (fields) return { ok: false, detail: `${itemLabel}: ${fields}` };
    const id = validateId(raw.id, `${itemLabel}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return { ok: false, detail: `${label} contains duplicate id '${id.value}'` };
    ids.add(id.value);
    const path = validatePath(raw.path, `${itemLabel}.path`);
    if (!path.ok) return path;
    const description = validateText(raw.description, `${itemLabel}.description`, 1_000);
    if (!description.ok) return description;
    result.push({ id: id.value, path: path.value, description: description.value });
  }
  return { ok: true, value: result };
}

function validateCheckpoints(value: unknown, label: string): ProposalValidation<ProposalCheckpoint[]> {
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINTS) {
    return { ok: false, detail: `${label} must contain 0-${MAX_CHECKPOINTS} items` };
  }
  const result: ProposalCheckpoint[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(raw)) return { ok: false, detail: `${itemLabel} must be an object` };
    const fields = exactFields(raw, CHECKPOINT_FIELDS, [...CHECKPOINT_FIELDS]);
    if (fields) return { ok: false, detail: `${itemLabel}: ${fields}` };
    const id = validateId(raw.id, `${itemLabel}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return { ok: false, detail: `${label} contains duplicate id '${id.value}'` };
    ids.add(id.value);
    const labelText = validateText(raw.label, `${itemLabel}.label`, 1_000);
    if (!labelText.ok) return labelText;
    result.push({ id: id.value, label: labelText.value });
  }
  return { ok: true, value: result };
}

function validateHumanGates(
  value: unknown,
  label: string,
  allowResolvedAssignments: boolean,
): ProposalValidation<ProposalHumanGate[]> {
  if (!Array.isArray(value) || value.length > MAX_HUMAN_GATES) {
    return { ok: false, detail: `${label} must contain 0-${MAX_HUMAN_GATES} items` };
  }
  const kinds = new Set<HumanGateKind>(['input', 'approval', 'review', 'intervention', 'governance-refusal']);
  const result: ProposalHumanGate[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(raw)) return { ok: false, detail: `${itemLabel} must be an object` };
    const fields = exactFields(
      raw,
      allowResolvedAssignments ? COMPILED_HUMAN_GATE_FIELDS : HUMAN_GATE_FIELDS,
      [...HUMAN_GATE_FIELDS],
    );
    if (fields) return { ok: false, detail: `${itemLabel}: ${fields}` };
    const id = validateId(raw.id, `${itemLabel}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return { ok: false, detail: `${label} contains duplicate id '${id.value}'` };
    ids.add(id.value);
    if (typeof raw.kind !== 'string' || !kinds.has(raw.kind as HumanGateKind)) {
      return { ok: false, detail: `${itemLabel}.kind is not a supported human gate kind` };
    }
    const prompt = validateText(raw.prompt, `${itemLabel}.prompt`, 2_000);
    if (!prompt.ok) return prompt;
    let spendAuthorization: boolean | undefined;
    if (Object.prototype.hasOwnProperty.call(raw, 'spendAuthorization')) {
      if (typeof raw.spendAuthorization !== 'boolean') {
        return { ok: false, detail: `${itemLabel}.spendAuthorization must be a boolean when present` };
      }
      // A non-approval response ('responded' on an input gate) must never read as a spend
      // authorization, so the flag is only expressible on an approval gate.
      if (raw.spendAuthorization && raw.kind !== 'approval') {
        return { ok: false, detail: `${itemLabel}.spendAuthorization requires kind 'approval'` };
      }
      spendAuthorization = raw.spendAuthorization;
    }
    result.push({
      id: id.value,
      kind: raw.kind as HumanGateKind,
      prompt: prompt.value,
      ...(spendAuthorization === undefined ? {} : { spendAuthorization }),
    });
  }
  return { ok: true, value: result };
}

function validateStage(
  value: unknown,
  index: number,
  registry: ProposalRegistry,
  allowResolvedAssignments: boolean,
): ProposalValidation<ProposalStage> {
  const label = `stages[${index}]`;
  if (!isRecord(value)) return { ok: false, detail: `${label} must be an object` };
  const fields = exactFields(value, allowResolvedAssignments ? COMPILED_STAGE_FIELDS : STAGE_FIELDS, [...STAGE_FIELDS]);
  if (fields) return { ok: false, detail: `${label}: ${fields}` };
  const id = validateId(value.id, `${label}.id`);
  if (!id.ok) return id;
  const title = validateText(value.title, `${label}.title`, MAX_TITLE_CHARS);
  if (!title.ok) return title;
  if (typeof value.action !== 'string' || value.action.length > MAX_ACTION_CHARS || !SAFE_ACTION_RE.test(value.action)) {
    return { ok: false, detail: `${label}.action must be a safe action identifier` };
  }
  const target = validatePath(value.target, `${label}.target`);
  if (!target.ok) return target;
  const workOrder = validateText(value.workOrder, `${label}.workOrder`, MAX_WORK_ORDER_CHARS);
  if (!workOrder.ok) return workOrder;
  if (value.riskTier !== 'T1' && value.riskTier !== 'T2' && value.riskTier !== 'T3') {
    return { ok: false, detail: `${label}.riskTier must be T1, T2, or T3` };
  }
  const dependsOn = validateUniqueStringArray(value.dependsOn, `${label}.dependsOn`, 0, MAX_PROPOSAL_STAGES, validateId);
  if (!dependsOn.ok) return dependsOn;
  const worker = validateRouting(value.worker, `${label}.worker`, registry, false);
  if (!worker.ok) return worker;
  const requiredSkills = validateRegisteredSkills(value.requiredSkills, `${label}.requiredSkills`, registry);
  if (!requiredSkills.ok) return requiredSkills;
  const scope = validateScope(value.scope, `${label}.scope`);
  if (!scope.ok) return scope;
  const artifacts = validateArtifacts(value.artifacts, `${label}.artifacts`);
  if (!artifacts.ok) return artifacts;
  const checkpoints = validateCheckpoints(value.checkpoints, `${label}.checkpoints`);
  if (!checkpoints.ok) return checkpoints;
  const humanGates = validateHumanGates(value.humanGates, `${label}.humanGates`, allowResolvedAssignments);
  if (!humanGates.ok) return humanGates;
  let assignment: ResolvedAgentAssignment | undefined;
  if (allowResolvedAssignments && Object.prototype.hasOwnProperty.call(value, 'assignment')) {
    const parsed = validateResolvedAssignment(value.assignment, `${label}.assignment`);
    if (!parsed.ok) return parsed;
    if (parsed.value.runtime !== (worker.value as ProposalRouting).runtime || parsed.value.model !== (worker.value as ProposalRouting).model) {
      return { ok: false, detail: `${label}.assignment runtime/model must match worker routing` };
    }
    assignment = parsed.value;
  }
  let workflowProfile: string | undefined;
  if (allowResolvedAssignments && Object.prototype.hasOwnProperty.call(value, 'workflowProfile')) {
    const parsed = validateId(value.workflowProfile, `${label}.workflowProfile`);
    if (!parsed.ok) return parsed;
    if (!(registry.workflowProfiles ?? []).includes(parsed.value)) {
      return { ok: false, detail: `${label}.workflowProfile '${parsed.value}' is not a server-owned workflow execution profile` };
    }
    workflowProfile = parsed.value;
  }
  let review: ProposalReview | undefined;
  if (allowResolvedAssignments && Object.prototype.hasOwnProperty.call(value, 'review')) {
    if (!assignment || !value.action.startsWith('review:') || workflowProfile !== 'checker-readonly') {
      return { ok: false, detail: `${label}.review requires a review action, resolved assignment, and workflowProfile 'checker-readonly'` };
    }
    if (!isRecord(value.review)) return { ok: false, detail: `${label}.review must be an object` };
    const reviewFields = exactFields(value.review, REVIEW_FIELDS, ['subjectStageId', 'maxCreatorReworks', 'criteria']);
    if (reviewFields) return { ok: false, detail: `${label}.review: ${reviewFields}` };
    const subjectStageId = validateId(value.review.subjectStageId, `${label}.review.subjectStageId`);
    if (!subjectStageId.ok) return subjectStageId;
    if (!(dependsOn.value as string[]).includes(subjectStageId.value)) {
      return { ok: false, detail: `${label}.review.subjectStageId must be a direct dependency` };
    }
    const maxCreatorReworks = value.review.maxCreatorReworks;
    if (typeof maxCreatorReworks !== 'number' || !Number.isSafeInteger(maxCreatorReworks) || maxCreatorReworks < 0 || maxCreatorReworks > 2) {
      return { ok: false, detail: `${label}.review.maxCreatorReworks must be an integer from 0 to 2` };
    }
    if (!Array.isArray(value.review.criteria) || value.review.criteria.length < 1 || value.review.criteria.length > 16) {
      return { ok: false, detail: `${label}.review.criteria must contain 1-16 items` };
    }
    const criteria: ProposalReviewCriterion[] = [];
    const criterionIds = new Set<string>();
    for (let criterionIndex = 0; criterionIndex < value.review.criteria.length; criterionIndex += 1) {
      const raw = value.review.criteria[criterionIndex];
      if (!isRecord(raw)) return { ok: false, detail: `${label}.review.criteria[${criterionIndex}] must be an object` };
      const criterionFields = exactFields(raw, REVIEW_CRITERION_FIELDS, ['id', 'description']);
      if (criterionFields) return { ok: false, detail: `${label}.review.criteria[${criterionIndex}]: ${criterionFields}` };
      const criterionId = validateId(raw.id, `${label}.review.criteria[${criterionIndex}].id`);
      if (!criterionId.ok) return criterionId;
      const description = validateText(raw.description, `${label}.review.criteria[${criterionIndex}].description`, MAX_TITLE_CHARS);
      if (!description.ok) return description;
      if (criterionIds.has(criterionId.value)) return { ok: false, detail: `${label}.review.criteria ids must be unique` };
      criterionIds.add(criterionId.value);
      criteria.push({ id: criterionId.value, description: description.value });
    }
    review = { subjectStageId: subjectStageId.value, maxCreatorReworks, criteria };
  }
  let completionGate: ProposalCompletionGate | undefined;
  if (allowResolvedAssignments && Object.prototype.hasOwnProperty.call(value, 'completionGate')) {
    if (!review) return { ok: false, detail: `${label}.completionGate requires review` };
    if (!isRecord(value.completionGate)) return { ok: false, detail: `${label}.completionGate must be an object` };
    const gateFields = exactFields(value.completionGate, COMPLETION_GATE_FIELDS, ['id', 'kind', 'prompt', 'requiresReview']);
    if (gateFields) return { ok: false, detail: `${label}.completionGate: ${gateFields}` };
    const gateId = validateId(value.completionGate.id, `${label}.completionGate.id`);
    if (!gateId.ok) return gateId;
    if (value.completionGate.kind !== 'approval' || value.completionGate.requiresReview !== 'pass') {
      return { ok: false, detail: `${label}.completionGate must be approval requiring review pass` };
    }
    const prompt = validateText(value.completionGate.prompt, `${label}.completionGate.prompt`, 2_000);
    if (!prompt.ok) return prompt;
    completionGate = { id: gateId.value, kind: 'approval', prompt: prompt.value, requiresReview: 'pass' };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      title: title.value,
      action: value.action,
      target: target.value,
      workOrder: workOrder.value,
      riskTier: value.riskTier,
      dependsOn: dependsOn.value,
      worker: worker.value as ProposalRouting,
      requiredSkills: requiredSkills.value,
      scope: scope.value,
      artifacts: artifacts.value,
      checkpoints: checkpoints.value,
      humanGates: humanGates.value,
      ...(assignment ? { assignment } : {}),
      ...(workflowProfile ? { workflowProfile } : {}),
      ...(review ? { review } : {}),
      ...(completionGate ? { completionGate } : {}),
    },
  };
}

function validatePlanProposalInternal(
  input: unknown,
  registry: ProposalRegistry,
  allowResolvedAssignments: boolean,
): ProposalValidation<PlanProposal> {
  if (!isRecord(input)) return { ok: false, detail: 'proposal must be an object' };
  try {
    const encoded = JSON.stringify(input);
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_PROPOSAL_BYTES) {
      return { ok: false, detail: `proposal must be at most ${MAX_PROPOSAL_BYTES} bytes` };
    }
  } catch {
    return { ok: false, detail: 'proposal must be a JSON-compatible object' };
  }
  const fields = exactFields(input, TOP_FIELDS, [...TOP_REQUIRED_FIELDS]);
  if (fields) return { ok: false, detail: fields };
  if (input.schema !== PLAN_PROPOSAL_SCHEMA) {
    return { ok: false, detail: `schema must be '${PLAN_PROPOSAL_SCHEMA}'` };
  }
  const proposalId = validateId(input.proposalId, 'proposalId');
  if (!proposalId.ok) return proposalId;
  const project = validateId(input.project, 'project');
  if (!project.ok) return project;
  const title = validateText(input.title, 'title', MAX_TITLE_CHARS);
  if (!title.ok) return title;
  const summary = validateText(input.summary, 'summary', MAX_SUMMARY_CHARS);
  if (!summary.ok) return summary;
  if (!isRecord(input.manager)) return { ok: false, detail: 'manager must be an object' };
  const managerFields = exactFields(
    input.manager,
    allowResolvedAssignments ? COMPILED_MANAGER_FIELDS : MANAGER_FIELDS,
    ['runtime', 'model', 'requiredSkills'],
  );
  if (managerFields) return { ok: false, detail: `manager: ${managerFields}` };
  const manager = validateRouting(
    allowResolvedAssignments
      ? { runtime: input.manager.runtime, model: input.manager.model, requiredSkills: input.manager.requiredSkills }
      : input.manager,
    'manager', registry, true,
  );
  if (!manager.ok) return manager;
  let managerAssignment: ResolvedAgentAssignment | undefined;
  if (allowResolvedAssignments && Object.prototype.hasOwnProperty.call(input.manager, 'assignment')) {
    const parsed = validateResolvedAssignment(input.manager.assignment, 'manager.assignment');
    if (!parsed.ok) return parsed;
    if (parsed.value.runtime !== (manager.value as ProposalManager).runtime || parsed.value.model !== (manager.value as ProposalManager).model) {
      return { ok: false, detail: 'manager.assignment runtime/model must match manager routing' };
    }
    managerAssignment = parsed.value;
  }
  // Fail closed: `profile`, when declared, must name a member of the server-owned closed set. An absent
  // or empty registry list admits NOTHING — it can never be read as "profile unconstrained".
  let profile: string | undefined;
  if (Object.prototype.hasOwnProperty.call(input, 'profile')) {
    const parsed = validateId(input.profile, 'profile');
    if (!parsed.ok) return parsed;
    const known = registry.workflowProfiles ?? [];
    if (!known.includes(parsed.value)) {
      return { ok: false, detail: `profile '${parsed.value}' is not a server-owned workflow execution profile` };
    }
    profile = parsed.value;
  }
  const scope = validateScope(input.scope, 'scope');
  if (!scope.ok) return scope;
  const governanceRefs = validateUniqueStringArray(
    input.governanceRefs,
    'governanceRefs',
    1,
    32,
    validatePath,
  );
  if (!governanceRefs.ok) return governanceRefs;
  const contractRef = `orgs/${project.value}/contract.md`;
  const missingGovernance = [...REQUIRED_GOVERNANCE_REFS, contractRef].find(
    (ref) => !governanceRefs.value.includes(ref),
  );
  if (missingGovernance) return { ok: false, detail: `governanceRefs must include '${missingGovernance}'` };
  if (!Array.isArray(input.stages) || input.stages.length === 0 || input.stages.length > MAX_PROPOSAL_STAGES) {
    return { ok: false, detail: `stages must contain 1-${MAX_PROPOSAL_STAGES} items` };
  }
  const stages: ProposalStage[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < input.stages.length; index += 1) {
    const stage = validateStage(input.stages[index], index, registry, allowResolvedAssignments);
    if (!stage.ok) return stage;
    if (ids.has(stage.value.id)) return { ok: false, detail: `duplicate stage id '${stage.value.id}'` };
    ids.add(stage.value.id);
    stages.push(stage.value);
  }
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) {
      if (!ids.has(dependency)) {
        return { ok: false, detail: `stage '${stage.id}' depends on missing stage '${dependency}'` };
      }
      if (dependency === stage.id) {
        return { ok: false, detail: `stage '${stage.id}' cannot depend on itself` };
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
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) children.get(dependency)?.push(stage.id);
  }
  const ready = stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop() as string;
    visited += 1;
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  if (visited !== stages.length) return { ok: false, detail: 'proposal stage graph contains a cycle' };
  const value: PlanProposal = {
    schema: PLAN_PROPOSAL_SCHEMA,
    proposalId: proposalId.value,
    project: project.value,
    title: title.value,
    summary: summary.value,
    manager: {
      ...(manager.value as ProposalManager),
      ...(managerAssignment ? { assignment: managerAssignment } : {}),
    },
    scope: scope.value,
    governanceRefs: governanceRefs.value,
    stages,
  };
  // Emit the key ONLY when declared. `profile: undefined` would both break canonical JSON and change the
  // content hash of every pre-existing profile-less proposal.
  if (profile !== undefined) value.profile = profile;
  return { ok: true, value };
}

/** Validate untrusted/browser proposal wire input. Compiler-only resolved assignments remain forbidden. */
export function validatePlanProposal(input: unknown, registry: ProposalRegistry): ProposalValidation<PlanProposal> {
  return validatePlanProposalInternal(input, registry, false);
}

/** Validate a server-compiled/stored proposal which may carry immutable resolved assignment snapshots. */
export function validateServerCompiledPlanProposal(input: unknown, registry: ProposalRegistry): ProposalValidation<PlanProposal> {
  return validatePlanProposalInternal(input, registry, true);
}

class DuplicateJsonKeyError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`duplicate key '${key}'`);
    this.key = key;
  }
}

/** Small strict JSON reader used so duplicate object keys cannot be hidden by JSON.parse last-key-wins. */
class StrictJsonReader {
  private index = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): unknown {
    const value = this.value(0);
    this.whitespace();
    if (this.index !== this.text.length) throw new SyntaxError('trailing input');
    return value;
  }

  private whitespace(): void {
    while (/[\x20\t\r\n]/.test(this.text[this.index] ?? '')) this.index += 1;
  }

  private value(depth: number): unknown {
    if (depth > MAX_JSON_DEPTH) throw new SyntaxError('JSON nesting is too deep');
    this.whitespace();
    const char = this.text[this.index];
    if (char === '{') return this.object(depth + 1);
    if (char === '[') return this.array(depth + 1);
    if (char === '"') return this.string();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new SyntaxError('expected JSON value');
    this.index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) throw new SyntaxError('number is not finite');
    return number;
  }

  private object(depth: number): Record<string, unknown> {
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === '}') { this.index += 1; return {}; }
    const entries: Array<[string, unknown]> = [];
    const keys = new Set<string>();
    while (true) {
      this.whitespace();
      if (this.text[this.index] !== '"') throw new SyntaxError('expected object key');
      const key = this.string();
      if (keys.has(key)) throw new DuplicateJsonKeyError(key);
      keys.add(key);
      this.whitespace();
      if (this.text[this.index] !== ':') throw new SyntaxError('expected colon');
      this.index += 1;
      entries.push([key, this.value(depth)]);
      this.whitespace();
      if (this.text[this.index] === '}') { this.index += 1; break; }
      if (this.text[this.index] !== ',') throw new SyntaxError('expected comma');
      this.index += 1;
    }
    return Object.fromEntries(entries);
  }

  private array(depth: number): unknown[] {
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === ']') { this.index += 1; return []; }
    const result: unknown[] = [];
    while (true) {
      result.push(this.value(depth));
      this.whitespace();
      if (this.text[this.index] === ']') { this.index += 1; break; }
      if (this.text[this.index] !== ',') throw new SyntaxError('expected comma');
      this.index += 1;
    }
    return result;
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '"') {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if (char === '\\') this.index += 1;
      this.index += 1;
    }
    throw new SyntaxError('unterminated string');
  }
}

function extractProposalFence(text: string): ProposalValidation<string> {
  const blocks: string[] = [];
  let activeFence: string | null = null;
  let proposalBody: string[] | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (activeFence !== null) {
      if (line === activeFence) {
        if (proposalBody !== null) blocks.push(proposalBody.join('\n'));
        activeFence = null;
        proposalBody = null;
      } else if (proposalBody !== null) {
        proposalBody.push(line);
      }
      continue;
    }
    const opening = line.match(/^(`{3,})([^`]*)$/);
    if (!opening) continue;
    activeFence = opening[1];
    if (opening[1] === '```' && opening[2].trim() === PLAN_PROPOSAL_SCHEMA) proposalBody = [];
  }
  if (proposalBody !== null) return { ok: false, detail: `${PLAN_PROPOSAL_SCHEMA} fenced block is not closed` };
  if (blocks.length !== 1) {
    return { ok: false, detail: `assistant text must contain exactly one ${PLAN_PROPOSAL_SCHEMA} fenced block` };
  }
  if (Buffer.byteLength(blocks[0], 'utf8') > MAX_PROPOSAL_BYTES) {
    return { ok: false, detail: `proposal JSON must be at most ${MAX_PROPOSAL_BYTES} bytes` };
  }
  return { ok: true, value: blocks[0] };
}

/**
 * Admit a proposal only from the explicit public completion DTO. The exact source shape prevents a
 * caller from accidentally handing raw provider/tool payloads across this boundary.
 */
export function parseProposalFromAssistant(source: unknown, registry: ProposalRegistry): ProposalValidation<PlanProposal> {
  if (!isRecord(source)) return { ok: false, detail: 'proposal source must be an object' };
  const fields = exactFields(source, SOURCE_FIELDS, [...SOURCE_FIELDS]);
  if (fields) return { ok: false, detail: `proposal source: ${fields}` };
  if (source.role !== 'assistant' || source.state !== 'complete' || source.visibility !== 'visible') {
    return { ok: false, detail: 'proposal source must be completed visible assistant text' };
  }
  if (typeof source.text !== 'string') return { ok: false, detail: 'proposal source text must be a string' };
  if (source.text.length > MAX_ASSISTANT_TEXT_CHARS) {
    return { ok: false, detail: `assistant text must be at most ${MAX_ASSISTANT_TEXT_CHARS} characters` };
  }
  const block = extractProposalFence(source.text);
  if (!block.ok) return block;
  let decoded: unknown;
  try {
    decoded = new StrictJsonReader(block.value).parse();
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) {
      return { ok: false, detail: `proposal JSON contains duplicate key '${error.key}'` };
    }
    return { ok: false, detail: 'proposal fenced block must contain valid JSON' };
  }
  return validatePlanProposal(decoded, registry);
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not admit non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON admits only JSON values');
}

/** Stable UTF-8 JSON preimage: object keys sort lexically; array order remains consequential. */
export function canonicalProposal(value: PlanProposal): string {
  return canonicalValue(value);
}

export function proposalContentHash(value: PlanProposal): string {
  return createHash('sha256').update(canonicalProposal(value), 'utf8').digest('hex');
}

/** Compute a detached, deeply immutable diff DTO directly from two validated proposal snapshots. */
export function diffPlanProposals(previous: PlanProposal | null, next: PlanProposal): ProposalRevisionDiff {
  const nextSnapshot = cloneCanonical(next);
  const nextHash = proposalContentHash(nextSnapshot);
  const previousSnapshot = previous === null ? null : cloneCanonical(previous);
  const previousHash = previousSnapshot === null ? null : proposalContentHash(previousSnapshot);
  const changes: ProposalChange[] = [];
  collectChanges(previousSnapshot, nextSnapshot, '', changes);
  return deepFreeze({
    schema: PLAN_PROPOSAL_DIFF_SCHEMA,
    fromContentHash: previousHash,
    toContentHash: nextHash,
    changed: changes.length > 0,
    changes,
  });
}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalValue(value)) as T;
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function collectChanges(before: unknown, after: unknown, path: string, result: ProposalChange[]): void {
  if (canonicalValue(before) === canonicalValue(after)) return;
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      const childPath = `${path}/${pointerSegment(key)}`;
      if (!hasBefore || !hasAfter) {
        result.push({ path: childPath, before: hasBefore ? cloneCanonical(before[key]) : null, after: hasAfter ? cloneCanonical(after[key]) : null });
      } else {
        collectChanges(before[key], after[key], childPath, result);
      }
    }
    return;
  }
  result.push({ path: path || '', before: cloneCanonical(before), after: cloneCanonical(after) });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Create a detached, deeply frozen revision snapshot and its content-hash-bound public diff DTO. */
export function createProposalRevision(
  proposal: PlanProposal,
  revision: number,
  previous?: ProposalRevision,
): ProposalRevision {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision must be a positive safe integer');
  if (previous && revision !== previous.revision + 1) throw new TypeError('revision must immediately follow previous revision');
  if (previous && proposalContentHash(previous.proposal as PlanProposal) !== previous.contentHash) {
    throw new TypeError('previous revision content hash is invalid');
  }
  const snapshot = cloneCanonical(proposal);
  const contentHash = proposalContentHash(snapshot);
  const diff = diffPlanProposals(previous ? previous.proposal as PlanProposal : null, snapshot);
  const dto: ProposalRevision = {
    schema: PLAN_PROPOSAL_REVISION_SCHEMA,
    revision,
    contentHash,
    previousContentHash: previous?.contentHash ?? null,
    proposal: snapshot,
    diff,
  };
  return deepFreeze(dto);
}
