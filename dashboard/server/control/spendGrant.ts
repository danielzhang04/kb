import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { createAtomicJsonDocument } from './atomicJsonDocument.ts';
import { FYT_PAID_ACTION_DEFINITIONS, type PaidActionOperation } from './paidActionService.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GRANT_REF = /^grant-[a-f0-9]{32}$/;
const MAX_JOURNAL_BYTES = 1 * 1024 * 1024;
const TOKEN_BYTES = 32;
const MAX_TOKEN_CHARS = 4_096;
/** A grant is a stage-lifetime capability; a stage runs in minutes, never near the six-hour ceiling. */
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 6 * 60 * 60 * 1_000;

/** The durable, tokenless view a caller may read; the tokenHash never leaves the store. */
export interface SpendGrant {
  grantRef: string;
  runRef: string;
  stageRef: string;
  operation: PaidActionOperation;
  maxCalls: number;
  maxCostUsdMicros: number;
  maxCharacters: number;
  maxOutputs: number;
  tokenHash: string;
  subject: string;
  gateRequestRef: string;
  mintedAt: string;
  expiresAt: string;
}

interface SpendGrantJournal {
  schema: 'kb.spend-grant-journal/v1';
  revision: number;
  grants: SpendGrant[];
}

export type SpendGrantErrorCode = 'invalid-input' | 'grant-already-live' | 'journal-unavailable';

/** Only stable, non-secret details cross this boundary; a raw token is never attached. */
export class SpendGrantError extends Error {
  readonly code: SpendGrantErrorCode;
  readonly grantRef: string | null;

  constructor(code: SpendGrantErrorCode, message: string, grantRef: string | null = null) {
    super(message);
    this.code = code;
    this.grantRef = grantRef;
  }
}

function fail(code: SpendGrantErrorCode, message: string, grantRef: string | null = null): never {
  throw new SpendGrantError(code, message, grantRef);
}

function requireSafeRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_REF.test(value) || value.includes('..')) fail('invalid-input', `${label} is invalid`);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function ensureSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isKnownOperation(value: unknown): value is PaidActionOperation {
  return typeof value === 'string' && Object.hasOwn(FYT_PAID_ACTION_DEFINITIONS, value);
}

/**
 * Strict, fail-closed load validation. Every grant must be well-typed AND its caps must still equal the
 * current frozen per-stage policy, so a hand-edit that inflates a cap — or corrupts any field — bricks
 * the read rather than authorizing extra spend. grantRefs and tokenHashes are globally unique.
 */
function assertJournal(value: unknown): asserts value is SpendGrantJournal {
  const journal = value as SpendGrantJournal;
  if (!journal || typeof journal !== 'object' || Array.isArray(journal) || journal.schema !== 'kb.spend-grant-journal/v1'
    || !Number.isSafeInteger(journal.revision) || journal.revision < 0 || !Array.isArray(journal.grants)) {
    fail('journal-unavailable', 'spend grant journal is invalid');
  }
  const seenGrantRefs = new Set<string>();
  const seenTokenHashes = new Set<string>();
  for (const grant of journal.grants) {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) fail('journal-unavailable', 'spend grant journal is invalid');
    if (typeof grant.grantRef !== 'string' || !GRANT_REF.test(grant.grantRef) || seenGrantRefs.has(grant.grantRef)
      || typeof grant.runRef !== 'string' || !SAFE_REF.test(grant.runRef) || grant.runRef.includes('..')
      || typeof grant.stageRef !== 'string' || !SAFE_REF.test(grant.stageRef) || grant.stageRef.includes('..')
      || typeof grant.subject !== 'string' || !SAFE_REF.test(grant.subject)
      || typeof grant.gateRequestRef !== 'string' || !SAFE_REF.test(grant.gateRequestRef)
      || typeof grant.tokenHash !== 'string' || !SHA256.test(grant.tokenHash) || seenTokenHashes.has(grant.tokenHash)
      || !isKnownOperation(grant.operation)
      || !ensureSafeNumber(grant.maxCalls) || !ensureSafeNumber(grant.maxCostUsdMicros)
      || !ensureSafeNumber(grant.maxCharacters) || !ensureSafeNumber(grant.maxOutputs)
      || !isIsoTimestamp(grant.mintedAt) || !isIsoTimestamp(grant.expiresAt)
      || Date.parse(grant.expiresAt) <= Date.parse(grant.mintedAt)) {
      fail('journal-unavailable', 'spend grant journal is invalid');
    }
    const caps = FYT_PAID_ACTION_DEFINITIONS[grant.operation].perStage;
    if (grant.maxCalls !== caps.maxCalls || grant.maxCostUsdMicros !== caps.maxCostUsdMicros
      || grant.maxCharacters !== caps.maxCharacters || grant.maxOutputs !== caps.maxOutputs) {
      fail('journal-unavailable', 'spend grant caps differ from the frozen policy');
    }
    seenGrantRefs.add(grant.grantRef);
    seenTokenHashes.add(grant.tokenHash);
  }
}

function journalError(error: unknown): SpendGrantError {
  if (error instanceof SpendGrantError) return error;
  return new SpendGrantError('journal-unavailable', 'spend grant journal is unavailable');
}

export interface SpendGrantStoreOptions {
  stateRoot: string;
  now?: () => Date;
  lockTimeoutMs?: number;
}

export interface SpendGrantMintInput {
  runRef: string;
  stageRef: string;
  operation: PaidActionOperation;
  subject: string;
  gateRequestRef: string;
  ttlMs: number;
}

/**
 * Server-owned spend-grant store. A passkey-approved spendAuthorization gate mints ONE durable grant per
 * (runRef, stageRef, operation); the returned opaque token is the stage's capability and authorizes many
 * capped calls until it expires (the images stage draws it down up to eleven times). The store keeps only
 * the token's sha256 hash — the raw token is returned exactly once and is never persisted or logged.
 *
 * Caps are copied from the frozen `FYT_PAID_ACTION_DEFINITIONS[operation].perStage` at mint time and are
 * never caller-supplied, so a grant cannot widen the service's own ceiling.
 *
 * Idempotency: mint refuses a second live grant for the same (runRef, stageRef, operation) tuple with a
 * `grant-already-live` error carrying the existing grantRef. This is the safer of the two allowed contracts:
 * because the token can only be shown once, a silent "second mint returns the old grantRef" would hand back
 * a grantRef with no usable token and risk a caller believing it holds a capability it cannot draw against;
 * refusing surfaces the collision explicitly and never mints two live capabilities for one tuple (no cap
 * doubling at the grant layer). The known cost — if the mint write commits but the token is lost before the
 * caller records it, the tuple is stuck until the grant expires — is why the mint-point caller (Unit D) must
 * persist the token in the same step as the mint and treat `grant-already-live` as "already provisioned".
 */
export function createSpendGrantStore(options: SpendGrantStoreOptions): {
  mint(input: SpendGrantMintInput): Promise<{ grantRef: string; token: string }>;
  resolve(token: string, now?: Date): SpendGrant | null;
  snapshot(): ReadonlyArray<Omit<SpendGrant, 'tokenHash'>>;
} {
  if (!isAbsolute(options.stateRoot) || options.stateRoot.includes('\0')) {
    fail('invalid-input', 'spend grant state root is invalid');
  }
  const stateRoot = resolve(options.stateRoot);
  const now = options.now ?? (() => new Date());
  const document = createAtomicJsonDocument<SpendGrantJournal>({
    path: join(stateRoot, 'control', 'spend-grants.json'),
    empty: () => ({ schema: 'kb.spend-grant-journal/v1', revision: 0, grants: [] }),
    validate: assertJournal,
    error: (message) => new SpendGrantError('journal-unavailable', message),
    maxBytes: MAX_JOURNAL_BYTES,
    lockTimeoutMs: options.lockTimeoutMs,
  });

  const mutate = async <R>(callback: (journal: SpendGrantJournal) => R): Promise<R> => {
    try {
      return await document.mutate((journal) => callback(journal));
    } catch (error) {
      throw journalError(error);
    }
  };
  const read = (): SpendGrantJournal => {
    try {
      return document.read();
    } catch (error) {
      throw journalError(error);
    }
  };

  return {
    async mint(input) {
      requireSafeRef(input.runRef, 'run reference');
      requireSafeRef(input.stageRef, 'stage reference');
      requireSafeRef(input.subject, 'subject');
      requireSafeRef(input.gateRequestRef, 'gate request reference');
      if (!isKnownOperation(input.operation)) fail('invalid-input', 'operation is not a known paid action operation');
      if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < MIN_TTL_MS || input.ttlMs > MAX_TTL_MS) {
        fail('invalid-input', 'grant ttl is out of bounds');
      }

      const caps = FYT_PAID_ACTION_DEFINITIONS[input.operation].perStage;
      // Minted before the mutate so a refused tuple never persists (or exposes) a token or its hash.
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const minted = now();
      const record: SpendGrant = {
        grantRef: `grant-${randomBytes(16).toString('hex')}`,
        runRef: input.runRef,
        stageRef: input.stageRef,
        operation: input.operation,
        maxCalls: caps.maxCalls,
        maxCostUsdMicros: caps.maxCostUsdMicros,
        maxCharacters: caps.maxCharacters,
        maxOutputs: caps.maxOutputs,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        subject: input.subject,
        gateRequestRef: input.gateRequestRef,
        mintedAt: minted.toISOString(),
        expiresAt: new Date(minted.getTime() + input.ttlMs).toISOString(),
      };

      const grantRef = await mutate((journal) => {
        const live = journal.grants.find((candidate) => candidate.runRef === record.runRef
          && candidate.stageRef === record.stageRef && candidate.operation === record.operation
          && Date.parse(candidate.expiresAt) > minted.getTime());
        if (live) fail('grant-already-live', 'a live spend grant already exists for this run/stage/operation', live.grantRef);
        journal.grants.push(record);
        journal.revision += 1;
        return record.grantRef;
      });
      return { grantRef, token };
    },

    resolve(token, at) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
      const candidateHash = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
      const nowMs = (at ?? now()).getTime();
      let matched: SpendGrant | null = null;
      // No early break: compare against every stored hash so a match's position cannot leak by timing.
      for (const grant of read().grants) {
        const storedHash = Buffer.from(grant.tokenHash, 'hex');
        if (storedHash.length === candidateHash.length && timingSafeEqual(storedHash, candidateHash)) matched = grant;
      }
      if (!matched || Date.parse(matched.expiresAt) <= nowMs) return null;
      return structuredClone(matched);
    },

    snapshot() {
      return read().grants.map(({ tokenHash: _tokenHash, ...grant }) => structuredClone(grant));
    },
  };
}
