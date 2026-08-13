import {
  isSafeRepoRelativePath,
  type ProposalIterationGroup,
  type ProposalIterationVerdict,
  type ProposalReview,
} from './proposal.ts';
import type { IterationDissent, IterationFinding, IterationPosition, IterationRequest } from './types.ts';
import { redactSensitiveText } from '../composer/publicTimeline.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_FINDING_SUMMARY_CHARS = 2_000;
const MAX_CRITERIA = 16;
const MAX_FINDINGS = 256;
const MAX_FINDINGS_PER_CRITERION = 32;
const MAX_EVIDENCE_PATHS = 16;
const MAX_POSITIONS = 256;
const MAX_DISSENTS = 256;
const MAX_GENERATION_REFS = 256;
export const MAX_REVIEW_OUTCOME_CHARS = 5_000_000;
const MAX_JSON_NESTING = 64;
const MAX_CONTAINER_ITEMS = 4_096;

export interface ReviewOutcomeCriterion {
  criterionId: string;
  verdict: 'pass' | 'fail' | 'unverified';
  findingIds: string[];
}

export interface ReviewOutcomeFinding {
  id: string;
  criterionId: string;
  severity: 'blocking' | 'advisory';
  summary: string;
  evidencePaths: string[];
}

/** The model-authored portion of a checker receipt; all lineage remains server-owned. */
export interface ReviewOutcome {
  schema: 'kb.review-outcome/v1';
  decision: 'pass' | 'fail' | 'parked';
  summary: string;
  criteria: ReviewOutcomeCriterion[];
  findings: ReviewOutcomeFinding[];
}

export interface IterationOutcome {
  schema: 'kb.iteration-outcome/v1';
  requestRef: string;
  iterationLoopRef: string;
  participantId: string;
  cycle: number;
  verdict: ProposalIterationVerdict;
  inputGenerationRefs: string[];
  criteria: ReviewOutcomeCriterion[];
  findings: IterationFinding[];
  resolvedFindingRefs?: string[];
  positions: IterationPosition[];
  recordedDissent: IterationDissent[];
  summary: string;
}

export interface IterationOutcomeContract {
  iterationGroup: ProposalIterationGroup;
  request: IterationRequest;
  currentPositions?: IterationPosition[];
}

/** Immutable server-owned definition supplied only to a direct checker invocation. */
export interface ReviewContract {
  review: ProposalReview;
}

export type ReviewOutcomeParseResult =
  | { ok: true; value: ReviewOutcome }
  | { ok: false; detail: string };

export type IterationOutcomeParseResult =
  | { ok: true; value: IterationOutcome }
  | { ok: false; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  return Object.keys(value).every((key) => expected.has(key)) && fields.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function safeText(value: unknown, maxChars: number): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxChars
    && !value.includes('\0')
    // A decoded replacement character proves the stream was not valid UTF-8. Reject it rather than
    // canonicalizing a lossy payload into an auditable outcome.
    && !value.includes('\uFFFD')
    && redactSensitiveText(value) === value;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function invalid(detail: string): ReviewOutcomeParseResult {
  return { ok: false, detail: `invalid review outcome: ${detail}` };
}

function invalidIteration(detail: string): IterationOutcomeParseResult {
  return { ok: false, detail: `invalid iteration outcome: ${detail}` };
}

class JsonScanError extends Error {
  readonly duplicateKey: string | null;

  constructor(message: string, duplicateKey: string | null = null) {
    super(message);
    this.duplicateKey = duplicateKey;
  }
}

/**
 * JSON.parse silently applies last-key-wins semantics. This bounded lexical pass preserves decoded
 * object-member names so escaped-equivalent spellings (for example `decision` and `dec\\u0069sion`)
 * cannot smuggle a second value past the closed-shape validator.
 */
class JsonDuplicateKeyScanner {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  scan(): void {
    this.scanValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) throw new JsonScanError('trailing JSON content');
  }

  private scanValue(depth: number): void {
    if (depth > MAX_JSON_NESTING) throw new JsonScanError('JSON nesting exceeds the review outcome bound');
    this.skipWhitespace();
    const current = this.text[this.index];
    if (current === '{') return this.scanObject(depth + 1);
    if (current === '[') return this.scanArray(depth + 1);
    if (current === '"') { this.scanString(); return; }
    if (current === 't') return this.scanLiteral('true');
    if (current === 'f') return this.scanLiteral('false');
    if (current === 'n') return this.scanLiteral('null');
    if (current === '-' || (current !== undefined && current >= '0' && current <= '9')) return this.scanNumber();
    throw new JsonScanError('invalid JSON value');
  }

  private scanObject(depth: number): void {
    this.index += 1; // {
    this.skipWhitespace();
    if (this.text[this.index] === '}') { this.index += 1; return; }
    const keys = new Set<string>();
    let itemCount = 0;
    while (true) {
      this.skipWhitespace();
      const key = this.scanString();
      itemCount += 1;
      if (itemCount > MAX_CONTAINER_ITEMS) throw new JsonScanError('JSON object has too many members');
      if (keys.has(key)) throw new JsonScanError(`duplicate JSON object key '${key}'`, key);
      keys.add(key);
      this.skipWhitespace();
      this.expect(':');
      this.scanValue(depth);
      this.skipWhitespace();
      if (this.text[this.index] === '}') { this.index += 1; return; }
      this.expect(',');
    }
  }

  private scanArray(depth: number): void {
    this.index += 1; // [
    this.skipWhitespace();
    if (this.text[this.index] === ']') { this.index += 1; return; }
    let itemCount = 0;
    while (true) {
      itemCount += 1;
      if (itemCount > MAX_CONTAINER_ITEMS) throw new JsonScanError('JSON array has too many items');
      this.scanValue(depth);
      this.skipWhitespace();
      if (this.text[this.index] === ']') { this.index += 1; return; }
      this.expect(',');
    }
  }

  private scanString(): string {
    if (this.text[this.index] !== '"') throw new JsonScanError('JSON object member name is not a string');
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const current = this.text[this.index];
      if (current === '"') {
        this.index += 1;
        try {
          const decoded = JSON.parse(this.text.slice(start, this.index));
          if (typeof decoded !== 'string') throw new JsonScanError('JSON string did not decode to a string');
          return decoded;
        } catch (error) {
          if (error instanceof JsonScanError) throw error;
          throw new JsonScanError('invalid JSON string escape');
        }
      }
      if (current === '\\') {
        this.index += 1;
        const escape = this.text[this.index];
        if (escape === 'u') {
          this.index += 1;
          for (let offset = 0; offset < 4; offset += 1) {
            const hex = this.text[this.index];
            if (hex === undefined || !/[0-9A-Fa-f]/.test(hex)) throw new JsonScanError('invalid JSON unicode escape');
            this.index += 1;
          }
          continue;
        }
        if (escape === undefined || !'"\\\\/bfnrt'.includes(escape)) throw new JsonScanError('invalid JSON string escape');
        this.index += 1;
        continue;
      }
      if (current.charCodeAt(0) < 0x20) throw new JsonScanError('unescaped JSON control character');
      this.index += 1;
    }
    throw new JsonScanError('unterminated JSON string');
  }

  private scanLiteral(literal: string): void {
    if (!this.text.startsWith(literal, this.index)) throw new JsonScanError('invalid JSON literal');
    this.index += literal.length;
  }

  private scanNumber(): void {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index));
    if (!match || match.index !== 0) throw new JsonScanError('invalid JSON number');
    this.index += match[0].length;
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /[\t\n\r ]/.test(this.text[this.index])) this.index += 1;
  }

  private expect(expected: string): void {
    this.skipWhitespace();
    if (this.text[this.index] !== expected) throw new JsonScanError(`expected JSON '${expected}'`);
    this.index += 1;
  }
}

function duplicateJsonKey(text: string): string | null {
  try {
    new JsonDuplicateKeyScanner(text).scan();
    return null;
  } catch (error) {
    return error instanceof JsonScanError ? error.duplicateKey : null;
  }
}

const ITERATION_OUTCOME_REQUIRED_FIELDS = [
  'schema', 'requestRef', 'iterationLoopRef', 'participantId', 'cycle', 'verdict',
  'inputGenerationRefs', 'criteria', 'findings', 'positions', 'recordedDissent', 'summary',
] as const;
const ITERATION_OUTCOME_FIELDS = [...ITERATION_OUTCOME_REQUIRED_FIELDS, 'resolvedFindingRefs'] as const;
const ITERATION_VERDICTS = new Set<ProposalIterationVerdict>([
  'fulfilled', 'accept', 'rework', 'pass', 'fail', 'consensus', 'continue', 'complete', 'parked',
]);
const TERMINAL_VERDICTS = new Set<ProposalIterationVerdict>(['accept', 'pass', 'consensus', 'complete']);
const NEGATIVE_VERDICTS = new Set<ProposalIterationVerdict>(['rework', 'fail']);

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function legalVerdict(contract: IterationOutcomeContract, participantId: string, verdict: ProposalIterationVerdict): boolean {
  if (verdict === 'parked') return true;
  if (verdict === 'fulfilled') return contract.request.kind === 'rework' || contract.request.kind === 'delegate';
  if (TERMINAL_VERDICTS.has(verdict)) {
    return contract.iterationGroup.terminalAuthorities.some((authority) =>
      authority.participantId === participantId && authority.verdict === verdict);
  }
  return contract.iterationGroup.schedule.some((step) =>
    step.after?.participantId === participantId && step.after.verdict === verdict);
}

function samePosition(left: IterationPosition, right: IterationPosition): boolean {
  return left.positionId === right.positionId
    && left.participantId === right.participantId
    && left.summary === right.summary
    && sameStrings(left.generationRefs, right.generationRefs);
}

export function parseIterationOutcome(text: string, contract: IterationOutcomeContract): IterationOutcomeParseResult {
  if (text.length > MAX_REVIEW_OUTCOME_CHARS) return invalidIteration('payload exceeds the iteration outcome bound');
  if (text.includes('\uFFFD')) return invalidIteration('payload is not valid UTF-8');
  const duplicate = duplicateJsonKey(text);
  if (duplicate !== null) return invalidIteration(`duplicate JSON object key '${duplicate}'`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalidIteration('payload is not JSON');
  }
  if (!isRecord(raw) || !Object.keys(raw).every((key) => (ITERATION_OUTCOME_FIELDS as readonly string[]).includes(key))
    || !ITERATION_OUTCOME_REQUIRED_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(raw, key))) {
    return invalidIteration(`top-level shape must contain exactly ${ITERATION_OUTCOME_REQUIRED_FIELDS.join(', ')}, with optional resolvedFindingRefs`);
  }
  if (raw.schema !== 'kb.iteration-outcome/v1') return invalidIteration('schema must be kb.iteration-outcome/v1');
  if (!safeText(raw.summary, MAX_SUMMARY_CHARS)) return invalidIteration('summary is unsafe or out of bounds');

  const group = contract?.iterationGroup;
  const request = contract?.request;
  const declared = group?.criteria;
  if (!group || !request || !Array.isArray(declared) || declared.length < 1 || declared.length > MAX_CRITERIA) {
    return invalidIteration('iteration contract criteria are invalid');
  }
  const declaredIds = declared.map((criterion) => criterion.id);
  if (declaredIds.some((id) => !safeId(id)) || new Set(declaredIds).size !== declaredIds.length
    || !Array.isArray(request.criteria) || request.criteria.length !== declared.length
    || request.criteria.some((criterion, index) => criterion.id !== declared[index].id
      || criterion.description !== declared[index].description)) {
    return invalidIteration('iteration contract criteria are invalid');
  }
  const participant = group.participants.find((candidate) => candidate.participantId === request.recipientParticipantId);
  const route = group.routes.find((candidate) => candidate.routeId === request.routeId);
  if (!participant || !route || route.senderParticipantId !== request.senderParticipantId
    || route.recipientParticipantId !== request.recipientParticipantId || !route.requestKinds.includes(request.kind)) {
    return invalidIteration('iteration request route or participant is outside the declared group');
  }
  if (!safeId(request.requestRef) || !safeId(request.iterationLoopRef) || !safeId(request.recipientParticipantId)
    || !Number.isSafeInteger(request.cycle) || request.cycle < 1
    || !Array.isArray(request.inputGenerationRefs) || request.inputGenerationRefs.length < 1
    || request.inputGenerationRefs.length > MAX_GENERATION_REFS || !request.inputGenerationRefs.every(safeId)
    || new Set(request.inputGenerationRefs).size !== request.inputGenerationRefs.length
    || !Array.isArray(request.unresolvedFindingRefs) || request.unresolvedFindingRefs.length > MAX_FINDINGS
    || !request.unresolvedFindingRefs.every(safeId)
    || new Set(request.unresolvedFindingRefs).size !== request.unresolvedFindingRefs.length) {
    return invalidIteration('iteration request identity or generation lineage is invalid');
  }
  if (raw.requestRef !== request.requestRef || raw.iterationLoopRef !== request.iterationLoopRef
    || raw.participantId !== request.recipientParticipantId || raw.cycle !== request.cycle) {
    return invalidIteration('outcome identity does not match the exact request and participant');
  }
  if (!Array.isArray(raw.inputGenerationRefs) || !raw.inputGenerationRefs.every(safeId)
    || !sameStrings(request.inputGenerationRefs, raw.inputGenerationRefs as string[])) {
    return invalidIteration('input generation refs do not match the exact request generations');
  }
  if (typeof raw.verdict !== 'string' || !ITERATION_VERDICTS.has(raw.verdict as ProposalIterationVerdict)) {
    return invalidIteration('verdict is invalid');
  }
  const verdict = raw.verdict as ProposalIterationVerdict;
  if (!legalVerdict(contract, participant.participantId, verdict)) {
    return invalidIteration(`participant '${participant.participantId}' is not authorized to issue verdict '${verdict}'`);
  }
  const hasResolvedFindingRefs = Object.prototype.hasOwnProperty.call(raw, 'resolvedFindingRefs');
  let resolvedFindingRefs: string[] | undefined;
  if (hasResolvedFindingRefs) {
    if (verdict !== 'complete' && verdict !== 'consensus') {
      return invalidIteration('resolvedFindingRefs are allowed only for complete and consensus');
    }
    if (!Array.isArray(raw.resolvedFindingRefs) || raw.resolvedFindingRefs.length > MAX_FINDINGS
      || !raw.resolvedFindingRefs.every(safeId)
      || new Set(raw.resolvedFindingRefs).size !== raw.resolvedFindingRefs.length) {
      return invalidIteration('resolvedFindingRefs are invalid or duplicate');
    }
    resolvedFindingRefs = [...(raw.resolvedFindingRefs as string[])].sort();
    if (resolvedFindingRefs.some((findingRef) => !request.unresolvedFindingRefs.includes(findingRef))) {
      return invalidIteration('resolvedFindingRefs must reference unresolved findings from the request');
    }
  }

  if (!Array.isArray(raw.criteria)) return invalidIteration('criteria are invalid');
  if (verdict === 'fulfilled') {
    if (raw.criteria.length !== 0) return invalidIteration('fulfilled must carry no criteria verdicts');
  } else if (raw.criteria.length !== declared.length) {
    return invalidIteration('criteria must contain every authored criterion exactly once');
  }
  const criteria: ReviewOutcomeCriterion[] = [];
  const criterionById = new Map<string, ReviewOutcomeCriterion>();
  for (let index = 0; index < raw.criteria.length; index += 1) {
    const item = raw.criteria[index];
    if (!isRecord(item) || !exactFields(item, ['criterionId', 'verdict', 'findingIds'])) {
      return invalidIteration(`criteria[${index}] has an invalid shape`);
    }
    if (item.criterionId !== declaredIds[index]) return invalidIteration('criteria must use authored order and ids exactly once');
    if (item.verdict !== 'pass' && item.verdict !== 'fail' && item.verdict !== 'unverified') {
      return invalidIteration(`criteria[${index}].verdict is invalid`);
    }
    if (!Array.isArray(item.findingIds) || item.findingIds.length > MAX_FINDINGS_PER_CRITERION || !item.findingIds.every(safeId)) {
      return invalidIteration(`criteria[${index}].findingIds are invalid`);
    }
    const findingIds = [...item.findingIds] as string[];
    if (new Set(findingIds).size !== findingIds.length) return invalidIteration(`criteria[${index}].findingIds must be unique`);
    const criterion: ReviewOutcomeCriterion = { criterionId: item.criterionId, verdict: item.verdict, findingIds };
    criteria.push(criterion);
    criterionById.set(criterion.criterionId, criterion);
  }

  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_FINDINGS) return invalidIteration('findings are out of bounds');
  const findings: IterationFinding[] = [];
  const findingsById = new Map<string, IterationFinding>();
  for (let index = 0; index < raw.findings.length; index += 1) {
    const item = raw.findings[index];
    if (!isRecord(item) || !exactFields(item, ['findingId', 'criterionId', 'severity', 'summary', 'evidencePaths'])) {
      return invalidIteration(`findings[${index}] has an invalid shape`);
    }
    if (!safeId(item.findingId) || findingsById.has(item.findingId)) return invalidIteration(`findings[${index}].findingId is invalid or duplicate`);
    if (!safeId(item.criterionId) || !criterionById.has(item.criterionId)) return invalidIteration(`findings[${index}].criterionId is unknown`);
    if (item.severity !== 'blocking' && item.severity !== 'advisory') return invalidIteration(`findings[${index}].severity is invalid`);
    if (!safeText(item.summary, MAX_FINDING_SUMMARY_CHARS)) return invalidIteration(`findings[${index}].summary is unsafe or out of bounds`);
    if (!Array.isArray(item.evidencePaths) || item.evidencePaths.length > MAX_EVIDENCE_PATHS
      || !item.evidencePaths.every((path) => isSafeRepoRelativePath(path) && redactSensitiveText(path) === path)) {
      return invalidIteration(`findings[${index}].evidencePaths are invalid`);
    }
    const evidencePaths = [...item.evidencePaths] as string[];
    if (new Set(evidencePaths).size !== evidencePaths.length) return invalidIteration(`findings[${index}].evidencePaths must be unique`);
    const finding: IterationFinding = {
      findingId: item.findingId,
      criterionId: item.criterionId,
      severity: item.severity,
      summary: item.summary,
      evidencePaths,
    };
    findings.push(finding);
    findingsById.set(finding.findingId, finding);
  }
  for (const criterion of criteria) {
    for (const findingId of criterion.findingIds) {
      const finding = findingsById.get(findingId);
      if (!finding || finding.criterionId !== criterion.criterionId) {
        return invalidIteration('criterion findingIds must link to matching findings exactly once');
      }
    }
  }
  for (const finding of findings) {
    const criterion = criterionById.get(finding.criterionId);
    if (!criterion?.findingIds.includes(finding.findingId)) return invalidIteration('every finding must be linked by its criterion');
  }

  const participantIds = new Set(group.participants.map((candidate) => candidate.participantId));
  if (!Array.isArray(raw.positions) || raw.positions.length > MAX_POSITIONS) return invalidIteration('positions are out of bounds');
  const positions: IterationPosition[] = [];
  const positionsById = new Map<string, IterationPosition>();
  for (let index = 0; index < raw.positions.length; index += 1) {
    const item = raw.positions[index];
    if (!isRecord(item) || !exactFields(item, ['positionId', 'participantId', 'summary', 'generationRefs'])) {
      return invalidIteration(`positions[${index}] has an invalid shape`);
    }
    if (!safeId(item.positionId) || positionsById.has(item.positionId)) return invalidIteration(`positions[${index}].positionId is invalid or duplicate`);
    if (!safeId(item.participantId) || !participantIds.has(item.participantId)) return invalidIteration(`positions[${index}].participantId is unknown`);
    if (!safeText(item.summary, MAX_FINDING_SUMMARY_CHARS)) return invalidIteration(`positions[${index}].summary is unsafe or out of bounds`);
    if (!Array.isArray(item.generationRefs) || item.generationRefs.length < 1 || item.generationRefs.length > MAX_GENERATION_REFS
      || !item.generationRefs.every(safeId) || new Set(item.generationRefs).size !== item.generationRefs.length
      || !item.generationRefs.every((generationRef) => request.inputGenerationRefs.includes(generationRef))) {
      return invalidIteration(`positions[${index}].generationRefs are stale or invalid`);
    }
    const position: IterationPosition = {
      positionId: item.positionId,
      participantId: item.participantId,
      summary: item.summary,
      generationRefs: [...item.generationRefs] as string[],
    };
    positions.push(position);
    positionsById.set(position.positionId, position);
  }

  const currentPositions = contract.currentPositions ?? [];
  const currentById = new Map<string, IterationPosition>();
  for (const position of currentPositions) {
    if (!safeId(position.positionId) || currentById.has(position.positionId) || !participantIds.has(position.participantId)
      || !safeText(position.summary, MAX_FINDING_SUMMARY_CHARS) || !Array.isArray(position.generationRefs)
      || position.generationRefs.length < 1 || position.generationRefs.length > MAX_GENERATION_REFS
      || !position.generationRefs.every((generationRef) => safeId(generationRef) && request.inputGenerationRefs.includes(generationRef))) {
      return invalidIteration('iteration contract current positions are invalid');
    }
    currentById.set(position.positionId, position);
  }
  if (!Array.isArray(raw.recordedDissent) || raw.recordedDissent.length > MAX_DISSENTS) {
    return invalidIteration('recorded dissent is out of bounds');
  }
  const recordedDissent: IterationDissent[] = [];
  const dissentIds = new Set<string>();
  const dissentedPositionIds = new Set<string>();
  for (let index = 0; index < raw.recordedDissent.length; index += 1) {
    const item = raw.recordedDissent[index];
    if (!isRecord(item) || !exactFields(item, ['dissentId', 'participantId', 'positionId', 'summary'])) {
      return invalidIteration(`recordedDissent[${index}] has an invalid shape`);
    }
    const referencedPosition = currentById.get(String(item.positionId));
    if (!safeId(item.dissentId) || dissentIds.has(item.dissentId)) return invalidIteration(`recordedDissent[${index}].dissentId is invalid or duplicate`);
    if (!safeId(item.positionId) || !referencedPosition) return invalidIteration(`recordedDissent[${index}].positionId is unknown`);
    if (item.participantId !== referencedPosition.participantId) return invalidIteration(`recordedDissent[${index}].participantId does not own the position`);
    if (!safeText(item.summary, MAX_FINDING_SUMMARY_CHARS)) return invalidIteration(`recordedDissent[${index}].summary is unsafe or out of bounds`);
    if (dissentedPositionIds.has(item.positionId)) return invalidIteration(`recordedDissent[${index}].positionId is duplicated`);
    dissentIds.add(item.dissentId);
    dissentedPositionIds.add(item.positionId);
    recordedDissent.push({
      dissentId: item.dissentId,
      participantId: item.participantId,
      positionId: item.positionId,
      summary: item.summary,
    });
  }

  if (verdict !== 'consensus' && verdict !== 'continue' && (positions.length > 0 || recordedDissent.length > 0)) {
    return invalidIteration(`${verdict} must carry no positions or recorded dissent`);
  }
  if (verdict === 'consensus' || verdict === 'continue') {
    for (const position of positions) {
      const current = currentById.get(position.positionId);
      if (!current || !samePosition(position, current)) {
        return invalidIteration(`${verdict} position '${position.positionId}' is not bound to the current server position set`);
      }
    }
  }

  const failedCriteria = criteria.filter((criterion) => criterion.verdict === 'fail');
  const unverifiedCriteria = criteria.filter((criterion) => criterion.verdict === 'unverified');
  const blockingFindings = findings.filter((finding) => finding.severity === 'blocking');
  if (TERMINAL_VERDICTS.has(verdict)
    && (failedCriteria.length > 0 || unverifiedCriteria.length > 0 || blockingFindings.length > 0)) {
    return invalidIteration(`${verdict} requires all criteria to pass and no blocking findings`);
  }
  if (NEGATIVE_VERDICTS.has(verdict)) {
    if (unverifiedCriteria.length > 0 || failedCriteria.length === 0) {
      return invalidIteration(`${verdict} requires structured findings, failed criteria, and no unverified criteria`);
    }
    if (failedCriteria.some((criterion) => !criterion.findingIds.some((id) => findingsById.get(id)?.severity === 'blocking'))) {
      return invalidIteration(`every criterion failed by ${verdict} requires a linked blocking finding`);
    }
  }
  if (verdict === 'continue' && findings.length === 0) {
    return invalidIteration('continue requires at least one linked disagreement or evidence-gap finding');
  }
  if (verdict === 'parked' && unverifiedCriteria.length === 0) return invalidIteration('parked requires an unverified criterion');
  if (verdict === 'complete' || verdict === 'consensus') {
    const resolved = new Set(resolvedFindingRefs ?? []);
    for (const findingRef of request.unresolvedFindingRefs) {
      const restated = findingsById.get(findingRef);
      if (restated?.severity === 'blocking') {
        return invalidIteration(`${verdict} cannot restate unresolved finding '${findingRef}' as blocking`);
      }
      if (!resolved.has(findingRef) && restated?.severity !== 'advisory') {
        return invalidIteration(`${verdict} must resolve or restate unresolved finding '${findingRef}' as advisory residue`);
      }
    }
  }
  if (verdict === 'consensus') {
    for (const position of currentPositions) {
      const incorporated = positionsById.get(position.positionId);
      const dissented = dissentedPositionIds.has(position.positionId);
      if ((incorporated && !samePosition(incorporated, position)) || (incorporated !== undefined) === dissented) {
        return invalidIteration(`consensus must incorporate position '${position.positionId}' or record it as dissent exactly once`);
      }
    }
  }

  return {
    ok: true,
    value: {
      schema: 'kb.iteration-outcome/v1',
      requestRef: request.requestRef,
      iterationLoopRef: request.iterationLoopRef,
      participantId: participant.participantId,
      cycle: request.cycle,
      verdict,
      inputGenerationRefs: [...request.inputGenerationRefs],
      criteria,
      findings,
      ...(resolvedFindingRefs === undefined ? {} : { resolvedFindingRefs }),
      positions,
      recordedDissent,
      summary: raw.summary,
    },
  };
}

export function parseReviewOutcome(text: string, contract: ReviewContract): ReviewOutcomeParseResult {
  if (text.length > MAX_REVIEW_OUTCOME_CHARS) return invalid('payload exceeds the review outcome bound');
  if (text.includes('\uFFFD')) return invalid('payload is not valid UTF-8');
  const duplicate = duplicateJsonKey(text);
  if (duplicate !== null) return invalid(`duplicate JSON object key '${duplicate}'`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid('payload is not JSON');
  }
  if (!isRecord(raw) || !exactFields(raw, ['schema', 'decision', 'summary', 'criteria', 'findings'])) {
    return invalid('top-level shape must contain exactly schema, decision, summary, criteria, and findings');
  }
  if (raw.schema !== 'kb.review-outcome/v1') return invalid('schema must be kb.review-outcome/v1');
  if (raw.decision !== 'pass' && raw.decision !== 'fail' && raw.decision !== 'parked') return invalid('decision is invalid');
  if (!safeText(raw.summary, MAX_SUMMARY_CHARS)) return invalid('summary is unsafe or out of bounds');
  const review = contract?.review;
  const declared = review?.criteria;
  if (!Array.isArray(declared) || declared.length < 1 || declared.length > MAX_CRITERIA) {
    return invalid('review contract criteria are invalid');
  }
  const declaredIds = declared.map((criterion) => criterion.id);
  if (declaredIds.some((id) => !safeId(id)) || new Set(declaredIds).size !== declaredIds.length) {
    return invalid('review contract criterion ids are invalid');
  }
  if (!Array.isArray(raw.criteria) || raw.criteria.length !== declared.length) {
    return invalid('criteria must contain every authored criterion exactly once');
  }
  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_FINDINGS) return invalid('findings are out of bounds');
  for (let index = 0; index < raw.findings.length; index += 1) {
    const finding = raw.findings[index];
    if (!isRecord(finding) || !exactFields(finding, ['id', 'criterionId', 'severity', 'summary', 'evidencePaths'])) {
      return invalid(`findings[${index}] has an invalid shape`);
    }
  }

  const participantId = 'legacy-reviewer';
  const request: IterationRequest = {
    schema: 'kb.iteration-request/v1',
    requestRef: 'legacy-review-request',
    iterationLoopRef: 'legacy-review-loop',
    routeId: 'legacy-review-route',
    senderParticipantId: 'legacy-subject',
    recipientParticipantId: participantId,
    kind: 'review',
    cycle: 1,
    inputGenerationRefs: ['legacy-generation'],
    baseCommit: 'legacy-server-owned',
    artifactHashes: {},
    criteria: review.criteria,
    unresolvedFindingRefs: [],
    preservedInvariants: [],
    nextAcceptanceCheck: 'Apply the authored review criteria.',
    instructions: 'Return the closed review outcome.',
  };
  const iterationGroup: ProposalIterationGroup = {
    iterationGroupId: 'legacy-review-group',
    participants: [
      { participantId: 'legacy-subject', stageRef: review.subjectStageId, role: 'contributor', perspective: 'Subject', mandate: 'Produce the reviewed artifact.' },
      { participantId, stageRef: 'legacy-review-stage', role: 'judge', perspective: 'Checker', mandate: 'Apply the authored review criteria.' },
    ],
    routes: [{
      routeId: request.routeId,
      senderParticipantId: request.senderParticipantId,
      recipientParticipantId: request.recipientParticipantId,
      requestKinds: ['review'],
      baseResolutionStageIds: [review.subjectStageId],
    }],
    activation: { seedParticipantId: 'legacy-subject', seedArtifactIds: ['legacy-artifact'] },
    initialStepId: 'legacy-review-step',
    schedule: [
      { stepId: 'legacy-review-step', routeId: request.routeId, cycle: 'current' },
      {
        stepId: 'legacy-review-rework',
        routeId: request.routeId,
        after: { stepId: 'legacy-review-step', participantId, verdict: 'fail' },
        cycle: 'next',
      },
    ],
    artifacts: ['legacy-artifact'],
    criteria: review.criteria,
    maxCycles: review.maxCreatorReworks + 1,
    cycleUnit: 'one legacy creator generation and checker verdict',
    terminalAuthorities: [{ participantId, verdict: 'pass' }],
  };
  const translatedFindings = Array.isArray(raw.findings)
    ? raw.findings.map((finding) => {
      if (!isRecord(finding)) return finding;
      const { id, ...rest } = finding;
      return { ...rest, findingId: id };
    })
    : raw.findings;
  const parsed = parseIterationOutcome(JSON.stringify({
    schema: 'kb.iteration-outcome/v1',
    requestRef: request.requestRef,
    iterationLoopRef: request.iterationLoopRef,
    participantId,
    cycle: request.cycle,
    verdict: raw.decision,
    inputGenerationRefs: request.inputGenerationRefs,
    criteria: raw.criteria,
    findings: translatedFindings,
    positions: [],
    recordedDissent: [],
    summary: raw.summary,
  }), { iterationGroup, request });
  if (!parsed.ok) {
    let detail = parsed.detail.replace(/^invalid iteration outcome: /, '');
    detail = detail.replace(/^(findings\[\d+\])\.findingId is invalid or duplicate$/, '$1.id is invalid or duplicate');
    if (detail === 'fail requires structured findings, failed criteria, and no unverified criteria') {
      detail = 'fail requires failed and no unverified criteria';
    } else if (detail === 'every criterion failed by fail requires a linked blocking finding') {
      detail = 'every failed criterion requires a linked blocking finding';
    }
    return invalid(detail);
  }
  return {
    ok: true,
    value: {
      schema: 'kb.review-outcome/v1',
      decision: parsed.value.verdict as ReviewOutcome['decision'],
      summary: parsed.value.summary,
      criteria: parsed.value.criteria,
      findings: parsed.value.findings.map((finding) => ({
        id: finding.findingId,
        criterionId: finding.criterionId,
        severity: finding.severity,
        summary: finding.summary,
        evidencePaths: finding.evidencePaths,
      })),
    },
  };
}
