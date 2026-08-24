// P4 §3.1 closed contracts: the learning proposal record DTO emitted by `scripts/learning_proposals.py`
// (the sole Markdown parser/renderer) and its strict JSON decoder. W0 implements NO Markdown parser:
// server code executes the Python module for closed JSON output and decodes that DTO here.
import {
  ContractDecodeError, closedObject, isImplementerTargetPath, LEARNING_RECORD_PREFIX, requireString,
} from '../write/durableManifest.ts';

export const LEARNING_PROPOSAL_SCHEMA = 'kb.learning-proposal/v1';

/** The six closed kinds (`design:323`). */
export type ProposalKind =
  | 'lesson' | 'agent-improvement' | 'grade-finding' | 'model-audit' | 'hygiene' | 'context-lifecycle';
export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'lesson', 'agent-improvement', 'grade-finding', 'model-audit', 'hygiene', 'context-lifecycle',
];

/**
 * The Implementer batches `lesson` AND `agent-improvement` [P4-C22]. Neither kind is exempt from the
 * target wall; the other four kinds are records-only and stay `proposed` until a human acts.
 */
export const IMPLEMENTABLE_PROPOSAL_KINDS: readonly ProposalKind[] = ['agent-improvement', 'lesson'];
export const RECORDS_ONLY_PROPOSAL_KINDS: readonly ProposalKind[] = [
  'context-lifecycle', 'grade-finding', 'hygiene', 'model-audit',
];

export type ProposalStatus = 'proposed' | 'implemented';

/** Producers are capped at five candidates per fire, so `ordinal` is 1-5 and never exceeds 99. */
export const PROPOSAL_CANDIDATE_CAP = 5;
export const MIN_EVIDENCE_ROWS = 1;
export const MAX_EVIDENCE_ROWS = 20;
export const MAX_PROPOSED_CHANGE_BYTES = 8192;

/** The exact frontmatter keys, in the exact order, that the parser accepts (`design:321-330`). */
export const PROPOSAL_FRONTMATTER_KEYS = [
  'schema', 'id', 'kind', 'source-agent', 'source-run', 'created-at', 'target', 'status',
  'batch-id', 'implemented-at', 'content-hash',
] as const;

/**
 * `content-hash` = sha256 over the canonical candidate body (kind, target, evidence, proposed
 * change). The plan pins the id grammar to a positional ordinal, so this is what binds an id to
 * its content: a body changed under a reused id fails closed when the parser re-reads it.
 */
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Refused in EVERY decoded string field. The Python parser scans the raw record, so a
 * JSON-escaped \u0000 or \u001b, a bidi override or a zero-width joiner inside a quoted locator
 * would otherwise arrive here as live JS string content and land in a PR body or an audit row.
 * The same closed set is enforced on both sides of the wire.
 */
// eslint-disable-next-line no-control-regex
export const DISALLOWED_FIELD_CHARS = /[\u0000-\u001f\u007f\u0085\u200b\u2028\u2029\u202a-\u202e\ufeff]/;
/** Locators are bounded on both sides of the wire (the Python parser's MAX_LOCATOR_BYTES). */
export const MAX_LOCATOR_BYTES = 512;
export const MAX_EVIDENCE_PATH_BYTES = 256;

/** Reject the closed disallowed set without ever echoing the offending text back. */
function requireInertField(value: string, field: string, allowNewline = false): string {
  const scanned = allowNewline ? value.replace(/\n/g, '') : value;
  if (DISALLOWED_FIELD_CHARS.test(scanned)) {
    throw new ContractDecodeError(field, 'control, bidi and zero-width characters are refused');
  }
  return value;
}

/** The closed JSON wire object: the frontmatter keys plus the two parsed body blocks. */
export const PROPOSAL_WIRE_KEYS = [...PROPOSAL_FRONTMATTER_KEYS, 'evidence', 'proposed-change'] as const;

export const SOURCE_AGENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SOURCE_RUN_PATTERN = /^run[-_][A-Za-z0-9][A-Za-z0-9._-]{0,94}$/;
/** One canonical UTC second, supplied by the server schedule receipt. */
export const CANONICAL_UTC_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const BATCH_ID_PATTERN = /^learn-[0-9a-f]{24}$/;

export interface ProposalEvidenceRow {
  /** Inert string data. Never copied into a worker prompt or a command. */
  readonly path: string;
  readonly locator: string;
}

export interface ProposalRecord {
  readonly schema: typeof LEARNING_PROPOSAL_SCHEMA;
  readonly id: string;
  readonly kind: ProposalKind;
  readonly sourceAgent: string;
  readonly sourceRun: string;
  readonly createdAt: string;
  /** Exactly one normalized repository-relative path. */
  readonly target: string;
  readonly status: ProposalStatus;
  readonly batchId: string | null;
  readonly implementedAt: string | null;
  /** sha256 of the canonical candidate body; the id↔content binding, verified by the parser. */
  readonly contentHash: string;
  readonly evidence: readonly ProposalEvidenceRow[];
  readonly proposedChange: string;
}

/** The closed wire shape produced by the Python parser; extra keys are a compile AND decode error. */
export interface ProposalRecordWire {
  readonly schema: typeof LEARNING_PROPOSAL_SCHEMA;
  readonly id: string;
  readonly kind: ProposalKind;
  readonly 'source-agent': string;
  readonly 'source-run': string;
  readonly 'created-at': string;
  readonly target: string;
  readonly status: ProposalStatus;
  readonly 'batch-id': string | null;
  readonly 'implemented-at': string | null;
  readonly 'content-hash': string;
  readonly evidence: readonly ProposalEvidenceRow[];
  readonly 'proposed-change': string;
}

/** `id = <source-agent>-<source-run>-<ordinal as two digits>`. */
export function proposalRecordId(sourceAgent: string, sourceRun: string, ordinal: number): string {
  if (!SOURCE_AGENT_PATTERN.test(sourceAgent) || Buffer.byteLength(sourceAgent, 'utf8') > 64) {
    throw new ContractDecodeError('source-agent', 'lowercase dash-separated token of 1-64 bytes required');
  }
  if (!SOURCE_RUN_PATTERN.test(sourceRun)) throw new ContractDecodeError('source-run', 'run[-_]<ref> required');
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > PROPOSAL_CANDIDATE_CAP) {
    throw new ContractDecodeError('ordinal', `1..${PROPOSAL_CANDIDATE_CAP} required`);
  }
  return `${sourceAgent}-${sourceRun}-${String(ordinal).padStart(2, '0')}`;
}

/** `docs/proposals/learnings/<created-date>-<id>.md`; the date is the first ten bytes of `created-at`. */
export function proposalRecordRelpath(record: Pick<ProposalRecord, 'createdAt' | 'id'>): string {
  if (!CANONICAL_UTC_SECOND.test(record.createdAt)) {
    throw new ContractDecodeError('created-at', 'canonical UTC second required');
  }
  return `${LEARNING_RECORD_PREFIX}${record.createdAt.slice(0, 10)}-${record.id}.md`;
}

/** A candidate is an implementable kind whose target clears the wall. Neither kind is exempt [P4-C22]. */
export function isImplementerCandidate(record: ProposalRecord): boolean {
  return record.status === 'proposed'
    && IMPLEMENTABLE_PROPOSAL_KINDS.includes(record.kind)
    && isImplementerTargetPath(record.target);
}

const TARGET_REJECT = /^[/\\]|^[A-Za-z]:|(?:^|\/)\.\.?(?:\/|$)|\\/;

function decodeEvidence(value: unknown): readonly ProposalEvidenceRow[] {
  if (!Array.isArray(value)) throw new ContractDecodeError('evidence', 'array required');
  if (value.length < MIN_EVIDENCE_ROWS || value.length > MAX_EVIDENCE_ROWS) {
    throw new ContractDecodeError('evidence', `${MIN_EVIDENCE_ROWS}..${MAX_EVIDENCE_ROWS} rows required`);
  }
  return value.map((entry) => {
    const row = closedObject(entry, ['path', 'locator'], 'evidence');
    const path = requireString(row, 'path', 'evidence');
    const locator = row['locator'];
    if (typeof locator !== 'string') throw new ContractDecodeError('evidence.locator', 'string required');
    if (TARGET_REJECT.test(path)) throw new ContractDecodeError('evidence.path', 'repository-relative path required');
    if (Buffer.byteLength(path, 'utf8') > MAX_EVIDENCE_PATH_BYTES) {
      throw new ContractDecodeError('evidence.path', `at most ${MAX_EVIDENCE_PATH_BYTES} bytes`);
    }
    if (Buffer.byteLength(locator, 'utf8') > MAX_LOCATOR_BYTES) {
      throw new ContractDecodeError('evidence.locator', `at most ${MAX_LOCATOR_BYTES} bytes`);
    }
    requireInertField(path, 'evidence.path');
    requireInertField(locator, 'evidence.locator');
    return { path, locator };
  });
}

function decodeNullableString(record: Record<string, unknown>, key: string, pattern: RegExp): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ContractDecodeError(`record.${key}`, 'null or the closed pattern required');
  }
  return value;
}

/** Strict decoder for one parser-emitted record. Unknown/missing keys and bad values throw. */
export function decodeProposalRecord(value: unknown): ProposalRecord {
  const record = closedObject(value, PROPOSAL_WIRE_KEYS as readonly string[], 'record');
  for (const key of PROPOSAL_WIRE_KEYS) {
    if (!(key in record)) throw new ContractDecodeError(`record.${key}`, 'required key missing');
  }
  if (record['schema'] !== LEARNING_PROPOSAL_SCHEMA) {
    throw new ContractDecodeError('record.schema', `expected ${LEARNING_PROPOSAL_SCHEMA}`);
  }
  const kind = record['kind'];
  if (typeof kind !== 'string' || !PROPOSAL_KINDS.includes(kind as ProposalKind)) {
    throw new ContractDecodeError('record.kind', 'closed kind required');
  }
  const status = record['status'];
  if (status !== 'proposed' && status !== 'implemented') {
    throw new ContractDecodeError('record.status', "'proposed' | 'implemented'");
  }
  const sourceAgent = requireString(record, 'source-agent', 'record');
  const sourceRun = requireString(record, 'source-run', 'record');
  const createdAt = requireString(record, 'created-at', 'record');
  if (!CANONICAL_UTC_SECOND.test(createdAt)) throw new ContractDecodeError('record.created-at', 'canonical UTC second required');
  const target = requireString(record, 'target', 'record');
  if (TARGET_REJECT.test(target)) throw new ContractDecodeError('record.target', 'normalized repository-relative path required');
  const id = requireString(record, 'id', 'record');
  const batchId = decodeNullableString(record, 'batch-id', BATCH_ID_PATTERN);
  const implementedAt = decodeNullableString(record, 'implemented-at', CANONICAL_UTC_SECOND);
  const proposedChange = requireString(record, 'proposed-change', 'record');
  if (Buffer.byteLength(proposedChange, 'utf8') > MAX_PROPOSED_CHANGE_BYTES) {
    throw new ContractDecodeError('record.proposed-change', `at most ${MAX_PROPOSED_CHANGE_BYTES} bytes`);
  }
  const contentHash = requireString(record, 'content-hash', 'record');
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new ContractDecodeError('record.content-hash', '64 lowercase hex characters required');
  }
  for (const [field, value] of [
    ['record.id', id], ['record.source-agent', sourceAgent], ['record.source-run', sourceRun],
    ['record.target', target], ['record.created-at', createdAt],
  ] as const) requireInertField(value, field);
  requireInertField(proposedChange, 'record.proposed-change', true);
  if (status === 'proposed' && (batchId !== null || implementedAt !== null)) {
    throw new ContractDecodeError('record.status', 'a proposed record carries no batch-id or implemented-at');
  }
  if (status === 'implemented' && (batchId === null || implementedAt === null)) {
    throw new ContractDecodeError('record.status', 'an implemented record carries both batch-id and implemented-at');
  }
  const decoded: ProposalRecord = {
    schema: LEARNING_PROPOSAL_SCHEMA,
    id, kind: kind as ProposalKind, sourceAgent, sourceRun, createdAt, target, status, batchId,
    implementedAt, contentHash, evidence: decodeEvidence(record['evidence']), proposedChange,
  };
  if (proposalRecordId(sourceAgent, sourceRun, ordinalOf(id, sourceAgent, sourceRun)) !== id) {
    throw new ContractDecodeError('record.id', 'id must equal <source-agent>-<source-run>-<ordinal>');
  }
  return decoded;
}

function ordinalOf(id: string, sourceAgent: string, sourceRun: string): number {
  const prefix = `${sourceAgent}-${sourceRun}-`;
  if (!id.startsWith(prefix)) throw new ContractDecodeError('record.id', 'id must start with <source-agent>-<source-run>-');
  const tail = id.slice(prefix.length);
  if (!/^\d{2}$/.test(tail)) throw new ContractDecodeError('record.id', 'two-digit ordinal required');
  return Number(tail);
}

/** The parser's batch envelope: a closed list, decoded whole or not at all (fail closed). */
export function decodeProposalRecords(value: unknown): readonly ProposalRecord[] {
  if (!Array.isArray(value)) throw new ContractDecodeError('records', 'array required');
  const records = value.map((entry) => decodeProposalRecord(entry));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) throw new ContractDecodeError('records', `duplicate id ${record.id}`);
    ids.add(record.id);
  }
  return records;
}
