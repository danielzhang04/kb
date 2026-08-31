/**
 * Guarded, byte-preserving assignment amendments for workflow definitions.
 *
 * This deliberately is not a YAML serializer.  Definitions contain human work orders and review
 * contracts; re-emitting them would silently rewrite comments, bodies, and unrelated gates.  The
 * narrow patcher below understands only block-style `manager` and `stages` assignments and refuses
 * every layout it cannot prove safe.
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { sha256Hex } from '../shared/hashing.ts';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { normalizedTextSha256 } from '../control/textArtifactHash.ts';
import { parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { DEFAULT_WORK_BRANCH } from '../write/branch.ts';
import type { DefinitionAmendmentKind, DefinitionAmendmentStore } from './amendmentStore.ts';

export interface BuilderAmendmentReceipt {
  status: 'pending';
  operationId: string;
  replayed: boolean;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalValue(child)]));
}

export function builderAmendmentFingerprint(input: {
  kind: DefinitionAmendmentKind;
  entityPath: string;
  idempotencyKey: string;
  baseSourceHash: string;
  request: unknown;
}): string {
  return sha256Hex(JSON.stringify(canonicalValue(input)));
}

/** The single durable effect gate for Agent and Workflow builder create/edit operations. */
export async function runBuilderAmendment(
  store: DefinitionAmendmentStore,
  input: {
    kind: Extract<DefinitionAmendmentKind, `${string}-builder-${string}`>;
    entityPath: string;
    idempotencyKey: string;
    baseSourceHash: string;
    proposedSourceHash: string;
    request: unknown;
    effect: () => Promise<void>;
  },
): Promise<BuilderAmendmentReceipt> {
  const fingerprint = builderAmendmentFingerprint(input);
  const replay = store.lookupRequest(input.entityPath, input.idempotencyKey);
  if (!replay.ok) throw new Error('builder-amendment-state-invalid');
  if (replay.record) {
    if (replay.record.requestFingerprint !== fingerprint) throw new Error('idempotency-body-conflict');
    if (replay.record.phase !== 'pending-human-merge' && replay.record.phase !== 'settled') throw new Error('builder-amendment-incomplete');
    return { status: 'pending', operationId: input.idempotencyKey, replayed: true };
  }
  const pending = store.lookup(input.entityPath, input.baseSourceHash);
  if (!pending.ok) throw new Error('builder-amendment-state-invalid');
  if (pending.record) throw new Error('builder-amendment-pending');
  const record = {
    kind: input.kind, workflowPath: input.entityPath, baseSourceHash: input.baseSourceHash,
    proposedSourceHash: input.proposedSourceHash, branch: DEFAULT_WORK_BRANCH, pr: {}, phase: 'prepared' as const,
    idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
  };
  store.put(record);
  await input.effect();
  store.update({ ...record, phase: 'pending-human-merge' });
  return { status: 'pending', operationId: input.idempotencyKey, replayed: false };
}

export type AssignmentTarget = { kind: 'manager' } | { kind: 'stage'; stageId: string };
export type AssignmentValue = { agentId: string; profileId: string } | null;
export interface GovernanceValue { workflow: string | null; stages: Record<string, string | null> }

/** Keep the raw patcher closed to the same scalar grammar the workflow parser admits. */
export const SAFE_AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SAFE_EXECUTION_PROFILE_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

export function isSafeAssignmentValue(value: AssignmentValue): boolean {
  return value === null || (SAFE_AGENT_ID_RE.test(value.agentId) && SAFE_EXECUTION_PROFILE_ID_RE.test(value.profileId));
}

export function isSafeGovernanceValue(value: GovernanceValue): boolean {
  if (value.workflow !== null && !SAFE_AGENT_ID_RE.test(value.workflow)) return false;
  return Object.entries(value.stages).every(([stageId, agentId]) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(stageId)
      && (agentId === null || SAFE_AGENT_ID_RE.test(agentId)));
}

export interface PatchedAssignment {
  source: string;
  oldAssignment: AssignmentValue;
}

export interface PatchedGovernance {
  source: string;
  oldGovernance: GovernanceValue;
}

/** Checkout-independent identity for authored UTF-8 Workflow definition text. */
export function sourceHash(bytes: Buffer): string {
  return normalizedTextSha256(bytes);
}

export function decodeUtf8(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

/** Refuse a client path: callers receive a canonical scanned path only. */
function readCanonicalFileLocation(repoRoot: string, relpath: string, allowed: RegExp): { bytes: Buffer; path: string } | null {
  if (!allowed.test(relpath)) return null;
  try {
    const root = realpathSync(resolve(repoRoot));
    const candidate = resolve(root, relpath);
    if (!candidate.startsWith(`${root}${sep}`) || lstatSync(candidate).isSymbolicLink() || !lstatSync(candidate).isFile()) return null;
    const actual = realpathSync(candidate);
    const rel = relative(root, actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || rel.replace(/\\/g, '/') !== relpath) return null;
    return { bytes: readFileSync(actual), path: actual };
  } catch { return null; }
}

export function readCanonicalDefinitionLocation(repoRoot: string, relpath: string): { bytes: Buffer; path: string } | null {
  return readCanonicalFileLocation(repoRoot, relpath, /^orgs\/[A-Za-z0-9._-]+\/workflows\/[A-Za-z0-9._-]+\.md$/);
}

export function readCanonicalDefinition(repoRoot: string, relpath: string): Buffer | null {
  return readCanonicalDefinitionLocation(repoRoot, relpath)?.bytes ?? null;
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end + 1;
}

function line(text: string, start: number): string { return text.slice(start, lineEnd(text, start)); }

function frontmatterEnd(source: string): number | null {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) return null;
  const match = /^(?:---\r?\n)([\s\S]*?)(?:\r?\n---)(?:\r?\n|$)/.exec(source);
  return match ? match[0].length : null;
}

function plainOrJsonAgentId(raw: string): string | null {
  const value = raw.trim();
  if (SAFE_AGENT_ID_RE.test(value)) return value;
  if (!value.startsWith('"') || !value.endsWith('"')) return null;
  try {
    const decoded = JSON.parse(value) as unknown;
    return typeof decoded === 'string' && SAFE_AGENT_ID_RE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function governedValue(source: string, start: number, end: number, indent: string): { start: number; end: number; value: string } | null | 'malformed' {
  const body = source.slice(start, end);
  if (new RegExp(`^${indent}#\\s*governedBy:`, 'm').test(body)) return 'malformed';
  const loose = [...body.matchAll(new RegExp(`^${indent}governedBy:.*$`, 'gm'))];
  if (loose.length === 0) return null;
  if (loose.length !== 1) return 'malformed';
  const exact = new RegExp(`^${indent}governedBy: ([^\\r\\n#]+?)\\s*\\r?$`).exec(loose[0][0]);
  const value = exact ? plainOrJsonAgentId(exact[1]) : null;
  if (!value || loose[0].index === undefined) return 'malformed';
  const absoluteStart = start + loose[0].index;
  return { start: absoluteStart, end: lineEnd(source, absoluteStart), value };
}

function patchGovernedValue(source: string, start: number, end: number, indent: string, insertAt: number, value: string | null): { source: string; oldValue: string | null } | null {
  const current = governedValue(source, start, end, indent);
  if (current === 'malformed') return null;
  if (current && value === current.value) return { source, oldValue: current.value };
  if (current && value === null) return { source: `${source.slice(0, current.start)}${source.slice(current.end)}`, oldValue: current.value };
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const replacement = value === null ? '' : `${indent}governedBy: ${value}${newline}`;
  if (current) return { source: `${source.slice(0, current.start)}${replacement}${source.slice(current.end)}`, oldValue: current.value };
  if (value === null) return { source, oldValue: null };
  return { source: `${source.slice(0, insertAt)}${replacement}${source.slice(insertAt)}`, oldValue: null };
}

function governanceOf(definition: WorkflowDef): GovernanceValue {
  return {
    workflow: definition.governedBy ?? null,
    stages: Object.fromEntries(definition.stages.map((stage) => [stage.id, stage.governedBy ?? null])),
  };
}

function composerOrPlainStageId(raw: string): string | null {
  const value = raw.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) return value;
  if (!value.startsWith('"') || !value.endsWith('"')) return null;
  try {
    const decoded = JSON.parse(value) as unknown;
    return typeof decoded === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Patch the complete governance snapshot in one byte-preserving operation. */
export function patchWorkflowGovernance(source: string, governance: GovernanceValue): PatchedGovernance | null {
  if (!isSafeGovernanceValue(governance)) return null;
  const parsed = parseWorkflowDef(source);
  if (!parsed.ok) return null;
  const stageIds = parsed.value.stages.map((stage) => stage.id).sort();
  const requestedIds = Object.keys(governance.stages).sort();
  if (JSON.stringify(stageIds) !== JSON.stringify(requestedIds)) return null;
  const oldGovernance = governanceOf(parsed.value);
  let next = source;
  const fmEnd = frontmatterEnd(next);
  if (fmEnd === null) return null;
  const anchor = /^(?:manager|parameters|readScope|stages):/m.exec(next.slice(0, fmEnd));
  if (!anchor || anchor.index === undefined) return null;
  const workflowPatch = patchGovernedValue(next, 0, fmEnd, '', anchor.index, governance.workflow);
  if (!workflowPatch) return null;
  next = workflowPatch.source;
  for (const stageId of stageIds) {
    const nextFmEnd = frontmatterEnd(next);
    if (nextFmEnd === null) return null;
    const frontmatter = next.slice(0, nextFmEnd);
    const starts = [...frontmatter.matchAll(/^  - id: ([^\r\n#]+?)\s*\r?$/gm)];
    const found = starts.find((match) => composerOrPlainStageId(match[1]) === stageId);
    if (!found || found.index === undefined) return null;
    const following = starts.find((match) => match.index! > found.index!);
    const end = following?.index ?? frontmatter.lastIndexOf('\n---') + 1;
    const insertAt = lineEnd(next, found.index);
    const stagePatch = patchGovernedValue(next, insertAt, end, '    ', insertAt, governance.stages[stageId]);
    if (!stagePatch) return null;
    next = stagePatch.source;
  }
  return { source: next, oldGovernance };
}

export function isExactGovernanceAmendment(before: WorkflowDef, after: WorkflowDef, governance: GovernanceValue, expectedOld: GovernanceValue): boolean {
  if (JSON.stringify(governanceOf(before)) !== JSON.stringify(expectedOld) || JSON.stringify(governanceOf(after)) !== JSON.stringify(governance)) return false;
  const clean = (definition: WorkflowDef): WorkflowDef => {
    const copy = { ...definition, stages: definition.stages.map((stage) => ({ ...stage })) };
    delete copy.governedBy;
    for (const stage of copy.stages) delete stage.governedBy;
    return copy;
  };
  return JSON.stringify(clean(before)) === JSON.stringify(clean(after));
}

interface FieldBlock { start: number; end: number; indent: string; headerStart?: number; agent?: { start: number; end: number; value: string }; profile?: { start: number; end: number; value: string } }

function assignmentBlock(source: string, start: number, end: number, indent: string): FieldBlock | null {
  const child = `${indent}  `;
  let cursor = start;
  let agent: FieldBlock['agent'];
  let profile: FieldBlock['profile'];
  while (cursor < end) {
    const value = line(source, cursor);
    // A block scalar means the following indented bytes have YAML-dependent meaning.  Do not infer
    // mapping fields from them, even if they look exactly like an assignment.
    if (new RegExp(`^${child.replace(/ /g, ' ')}[A-Za-z][A-Za-z0-9_-]*:\\s*[>|][+-]?(?:\\s*(?:#.*)?)?\\r?\\n?$`).test(value)) return null;
    if (new RegExp(`^\\s*#\\s*(agentId|profileId):`).test(value)) return null;
    const assignmentPrefix = new RegExp(`^${child.replace(/ /g, ' ')}(agentId|profileId):`).exec(value);
    if (assignmentPrefix && !new RegExp(`^${child.replace(/ /g, ' ')}(agentId|profileId): ([^\\r\\n#]+?)\\s*\\r?\\n?$`).test(value)) return null;
    const match = new RegExp(`^${child.replace(/ /g, ' ')}(agentId|profileId): ([^\\r\\n#]+?)\\s*\\r?\\n?$`).exec(value);
    if (match) {
      const key = match[1];
      const parsed = match[2].trim();
      if (key === 'agentId') { if (agent) return null; agent = { start: cursor, end: lineEnd(source, cursor), value: parsed }; }
      else { if (profile) return null; profile = { start: cursor, end: lineEnd(source, cursor), value: parsed }; }
    }
    cursor = lineEnd(source, cursor);
  }
  return { start, end, indent, ...(agent ? { agent } : {}), ...(profile ? { profile } : {}) };
}

function fields(block: FieldBlock): AssignmentValue | 'malformed' {
  if (!block.agent && !block.profile) return null;
  if (!block.agent || !block.profile) return 'malformed';
  return { agentId: block.agent.value, profileId: block.profile.value };
}

function patchFields(source: string, block: FieldBlock, assignment: AssignmentValue): PatchedAssignment | null {
  const old = fields(block);
  if (old === 'malformed') return null;
  if (assignment === null) {
    if (old === null) return { source, oldAssignment: null };
    if (block.headerStart !== undefined) {
      const headerEnd = lineEnd(source, block.headerStart);
      const ordered = [block.agent!, block.profile!].sort((a, b) => a.start - b.start);
      // An authored comment/blank line inside a manager mapping is semantically attached to that
      // mapping. Do not guess where it belongs after removal.
      if (ordered[0].start !== headerEnd || ordered[1].start !== ordered[0].end || ordered[1].end !== block.end) return null;
      return { source: `${source.slice(0, block.headerStart)}${source.slice(block.end)}`, oldAssignment: old };
    }
    const removals = [block.agent!, block.profile!].sort((a, b) => b.start - a.start);
    let next = source;
    for (const removal of removals) next = `${next.slice(0, removal.start)}${next.slice(removal.end)}`;
    return { source: next, oldAssignment: old };
  }
  const ending = source.slice(Math.max(0, block.end - 2), block.end).includes('\r\n') ? '\r\n' : '\n';
  const replacement = `${block.indent}  agentId: ${assignment.agentId}${ending}${block.indent}  profileId: ${assignment.profileId}${ending}`;
  if (old === null) return { source: `${source.slice(0, block.end)}${replacement}${source.slice(block.end)}`, oldAssignment: null };
  // The two scalar lines must be the only bytes altered.  Preserve their comments only when unchanged;
  // comments attached to an assignment cannot safely survive a value replacement, so refuse that layout.
  const rawAgent = source.slice(block.agent!.start, block.agent!.end);
  const rawProfile = source.slice(block.profile!.start, block.profile!.end);
  if (rawAgent.includes('#') || rawProfile.includes('#')) return null;
  const first = block.agent!.start < block.profile!.start ? block.agent! : block.profile!;
  const last = first === block.agent ? block.profile! : block.agent!;
  const between = source.slice(first.end, last.start);
  if (between !== '') return null;
  return { source: `${source.slice(0, first.start)}${replacement}${source.slice(last.end)}`, oldAssignment: old };
}

function managerBlock(source: string, fmEnd: number): FieldBlock | null | 'absent' {
  const header = /^manager:(.*)\r?\n/m.exec(source.slice(0, fmEnd));
  if (!header) return 'absent';
  if (header[1].trim() !== '') return null;
  const start = header.index!;
  const contentStart = lineEnd(source, start);
  let end = contentStart;
  while (end < fmEnd) {
    const value = line(source, end);
    if (/^[^ \t#\r\n]/.test(value)) break;
    end = lineEnd(source, end);
  }
  const block = assignmentBlock(source, contentStart, end, '');
  return block ? { ...block, headerStart: start } : null;
}

function stageBlock(source: string, fmEnd: number, stageId: string): FieldBlock | null {
  const frontmatter = source.slice(0, fmEnd);
  const starts = [...frontmatter.matchAll(/^  - id: ([^\r\n#]+?)\s*\r?$/gm)];
  const found = starts.find((match) => match[1].trim() === stageId);
  if (!found || found.index === undefined) return null;
  const start = found.index;
  const next = starts.find((match) => match.index! > start);
  // Include the final stage line ending before the frontmatter terminator.  Inserting at the
  // newline itself would concatenate `dependsOn: [...]` and `agentId`, producing invalid YAML.
  const end = next?.index ?? frontmatter.lastIndexOf('\n---') + 1;
  if (end < start) return null;
  return assignmentBlock(source, lineEnd(source, start), end, '  ');
}

/** Patch only manager/stage `agentId` + `profileId`, or decline the source layout. */
export function patchWorkflowAssignment(source: string, target: AssignmentTarget, assignment: AssignmentValue): PatchedAssignment | null {
  if (!isSafeAssignmentValue(assignment)) return null;
  const fmEnd = frontmatterEnd(source);
  if (fmEnd === null) return null;
  if (target.kind === 'stage') {
    const block = stageBlock(source, fmEnd, target.stageId);
    return block ? patchFields(source, block, assignment) : null;
  }
  const block = managerBlock(source, fmEnd);
  if (block === null) return null;
  if (block === 'absent') {
    if (assignment === null) return { source, oldAssignment: null };
    const anchor = /^(?:parameters|stages):/m.exec(source.slice(0, fmEnd));
    if (!anchor || anchor.index === undefined) return null;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const insertion = `manager:${newline}  agentId: ${assignment.agentId}${newline}  profileId: ${assignment.profileId}${newline}`;
    return { source: `${source.slice(0, anchor.index)}${insertion}${source.slice(anchor.index)}`, oldAssignment: null };
  }
  return patchFields(source, block, assignment);
}

/** Final structural protection shared by the amendment route after the raw edit. */
export function parsePatchedDefinition(source: string, expectedProject: string): WorkflowDef | null {
  const parsed = parseWorkflowDef(source);
  return parsed.ok && parsed.value.project === expectedProject ? parsed.value : null;
}

/**
 * Parser-level backstop for the byte patcher.  A raw edit is accepted only when the parsed definition
 * differs at the requested declaration-side assignment and nowhere else.  This deliberately compares
 * the parser's complete semantic projection, not a hand-picked subset of fields.
 */
export function isExactAssignmentAmendment(
  before: WorkflowDef,
  after: WorkflowDef,
  target: AssignmentTarget,
  assignment: AssignmentValue,
  expectedOldAssignment: AssignmentValue,
): boolean {
  const atTarget = (definition: WorkflowDef): AssignmentValue | 'missing' => {
    if (target.kind === 'manager') return definition.manager ? { ...definition.manager } : null;
    const stage = definition.stages.find((candidate) => candidate.id === target.stageId);
    if (!stage) return 'missing';
    if (stage.agentId === undefined && stage.profileId === undefined) return null;
    if (!stage.agentId || !stage.profileId) return 'missing';
    return { agentId: stage.agentId, profileId: stage.profileId };
  };
  const equalAssignment = (left: AssignmentValue | 'missing', right: AssignmentValue): boolean => {
    if (left === 'missing') return false;
    if (left === null || right === null) return left === right;
    return left.agentId === right.agentId && left.profileId === right.profileId;
  };
  // Normalizing each side alone would conceal a parser/patch mismatch. Prove the before image is the
  // raw patcher's observed value and the after image is exactly the server-requested value first.
  if (!equalAssignment(atTarget(before), expectedOldAssignment) || !equalAssignment(atTarget(after), assignment)) return false;
  const clean = (definition: WorkflowDef): WorkflowDef => {
    const copy: WorkflowDef = {
      ...definition,
      ...(definition.manager ? { manager: { ...definition.manager } } : {}),
      parameters: definition.parameters ? [...definition.parameters] : undefined,
      stages: definition.stages.map((stage) => ({ ...stage, dependsOn: [...stage.dependsOn], review: stage.review
        ? { ...stage.review, criteria: stage.review.criteria.map((criterion) => ({ ...criterion })) } : undefined,
        completionGate: stage.completionGate ? { ...stage.completionGate } : undefined })),
    };
    if (target.kind === 'manager') {
      delete copy.manager;
    } else {
      const stage = copy.stages.find((candidate) => candidate.id === target.stageId);
      if (!stage) return copy;
      delete stage.agentId; delete stage.profileId;
    }
    return copy;
  };
  return JSON.stringify(clean(before)) === JSON.stringify(clean(after));
}
