import { isSafeRepoRelativePath, type ProposalReview } from './proposal.ts';
import { redactSensitiveText } from '../composer/publicTimeline.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_FINDING_SUMMARY_CHARS = 2_000;
const MAX_CRITERIA = 16;
const MAX_FINDINGS = 256;
const MAX_FINDINGS_PER_CRITERION = 32;
const MAX_EVIDENCE_PATHS = 16;
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

/** Immutable server-owned definition supplied only to a direct checker invocation. */
export interface ReviewContract {
  review: ProposalReview;
}

export type ReviewOutcomeParseResult =
  | { ok: true; value: ReviewOutcome }
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

/**
 * Parses the only model-authored checker transport. It is closed, bounded, and binds every model
 * criterion/finding reference back to the immutable server-compiled review definition.
 */
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

  const declared = contract.review?.criteria;
  if (!Array.isArray(declared) || declared.length < 1 || declared.length > MAX_CRITERIA) return invalid('review contract criteria are invalid');
  const declaredIds = declared.map((criterion) => criterion.id);
  if (declaredIds.some((id) => !safeId(id)) || new Set(declaredIds).size !== declaredIds.length) return invalid('review contract criterion ids are invalid');
  if (!Array.isArray(raw.criteria) || raw.criteria.length !== declared.length) return invalid('criteria must contain every authored criterion exactly once');

  const criteria: ReviewOutcomeCriterion[] = [];
  const criterionById = new Map<string, ReviewOutcomeCriterion>();
  for (let index = 0; index < raw.criteria.length; index += 1) {
    const item = raw.criteria[index];
    if (!isRecord(item) || !exactFields(item, ['criterionId', 'verdict', 'findingIds'])) return invalid(`criteria[${index}] has an invalid shape`);
    if (item.criterionId !== declaredIds[index]) return invalid('criteria must use authored order and ids exactly once');
    if (item.verdict !== 'pass' && item.verdict !== 'fail' && item.verdict !== 'unverified') return invalid(`criteria[${index}].verdict is invalid`);
    if (!Array.isArray(item.findingIds) || item.findingIds.length > MAX_FINDINGS_PER_CRITERION || !item.findingIds.every(safeId)) {
      return invalid(`criteria[${index}].findingIds are invalid`);
    }
    const findingIds = [...item.findingIds];
    if (new Set(findingIds).size !== findingIds.length) return invalid(`criteria[${index}].findingIds must be unique`);
    const criterion = { criterionId: item.criterionId, verdict: item.verdict, findingIds } as ReviewOutcomeCriterion;
    criteria.push(criterion);
    criterionById.set(criterion.criterionId, criterion);
  }

  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_FINDINGS) return invalid('findings are out of bounds');
  const findings: ReviewOutcomeFinding[] = [];
  const findingsById = new Map<string, ReviewOutcomeFinding>();
  for (let index = 0; index < raw.findings.length; index += 1) {
    const item = raw.findings[index];
    if (!isRecord(item) || !exactFields(item, ['id', 'criterionId', 'severity', 'summary', 'evidencePaths'])) return invalid(`findings[${index}] has an invalid shape`);
    if (!safeId(item.id) || findingsById.has(item.id)) return invalid(`findings[${index}].id is invalid or duplicate`);
    if (!safeId(item.criterionId) || !criterionById.has(item.criterionId)) return invalid(`findings[${index}].criterionId is unknown`);
    if (item.severity !== 'blocking' && item.severity !== 'advisory') return invalid(`findings[${index}].severity is invalid`);
    if (!safeText(item.summary, MAX_FINDING_SUMMARY_CHARS)) return invalid(`findings[${index}].summary is unsafe or out of bounds`);
    if (!Array.isArray(item.evidencePaths) || item.evidencePaths.length > MAX_EVIDENCE_PATHS
      || !item.evidencePaths.every((path) => isSafeRepoRelativePath(path)
        && redactSensitiveText(path) === path)) {
      return invalid(`findings[${index}].evidencePaths are invalid`);
    }
    const evidencePaths = [...item.evidencePaths] as string[];
    if (new Set(evidencePaths).size !== evidencePaths.length) return invalid(`findings[${index}].evidencePaths must be unique`);
    findingsById.set(item.id, { id: item.id, criterionId: item.criterionId, severity: item.severity, summary: item.summary, evidencePaths });
  }
  for (const criterion of criteria) {
    for (const findingId of criterion.findingIds) {
      const finding = findingsById.get(findingId);
      if (!finding || finding.criterionId !== criterion.criterionId) return invalid('criterion findingIds must link to matching findings exactly once');
    }
  }
  for (const finding of findingsById.values()) {
    const criterion = criterionById.get(finding.criterionId) as ReviewOutcomeCriterion;
    if (!criterion.findingIds.includes(finding.id)) return invalid('every finding must be linked by its criterion');
    findings.push(finding);
  }

  const failedCriteria = criteria.filter((criterion) => criterion.verdict === 'fail');
  const unverifiedCriteria = criteria.filter((criterion) => criterion.verdict === 'unverified');
  const blockingFindings = findings.filter((finding) => finding.severity === 'blocking');
  if (raw.decision === 'pass' && (failedCriteria.length > 0 || unverifiedCriteria.length > 0 || blockingFindings.length > 0)) {
    return invalid('pass requires all criteria to pass and no blocking findings');
  }
  if (raw.decision === 'fail') {
    if (unverifiedCriteria.length > 0 || failedCriteria.length === 0) return invalid('fail requires failed and no unverified criteria');
    if (failedCriteria.some((criterion) => !criterion.findingIds.some((id) => findingsById.get(id)?.severity === 'blocking'))) {
      return invalid('every failed criterion requires a linked blocking finding');
    }
  }
  if (raw.decision === 'parked' && unverifiedCriteria.length === 0) return invalid('parked requires an unverified criterion');
  return { ok: true, value: { schema: 'kb.review-outcome/v1', decision: raw.decision, summary: raw.summary, criteria, findings } };
}
