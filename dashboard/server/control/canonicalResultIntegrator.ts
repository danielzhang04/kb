import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { renameWithRetrySync } from '../atomicRename.ts';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import {
  defaultGitRunner,
  prepareCoordination,
  resolveBaseCommit,
  type GitRunner,
} from '../write/branch.ts';
import { resolveCheckedOutBranch, withOpsTransaction } from '../write/asyncGit.ts';
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { type CoordinationPublication } from '../write/outbox.ts';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import {
  RECONCILIATION_INTENT_SCHEMA,
  reconciliationIdempotencyKey,
  type CardTransitionIntent,
  type CardTransitionWrite,
} from '../reconciliation/contracts.ts';
import type { ReconciliationPublisher } from '../reconciliation/realPorts.ts';
import type { CanonicalStageResult, CanonicalStageResultPayload, ResultIntegrator, WorkerArtifactResult } from './execution.ts';
import {
  canonicalResultOperationKey,
  canonicalStageResultHash,
  iterationResultOperationKey,
  planAttemptWorktreePath,
} from './execution.ts';
import { createLocalGitCommandRunner, type GitCommandRunner } from './adapters.ts';
import { isSafeRepoRelativePath, type ProposalIterationGroup, type ProposalReview } from './proposal.ts';
import {
  parseIterationOutcome,
  type IterationOutcome,
  type IterationOutcomeContract,
} from './iterationOutcome.ts';

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const INTEGRATION_INPUT_KEYS = new Set([
  'operationKey', 'subject', 'runRef', 'stageRef', 'stageId', 'attemptRef', 'canonicalCardRef',
  'summary', 'artifacts', 'changed', 'checkpoints', 'iterationOutcome', 'iterationContract',
  'resultHash', 'worktreePath',
]);
/** The one branch a coordination write may ever run git against (CLAUDE.md's Branch rules). */
const COORDINATION_BRANCH = 'ops';
/** Named, greppable refusal so every guarded coordination call is findable in the daemon log. */
export const COORDINATION_GIT_GUARD_REASON = 'canonical-coordination-git-guard';

export class CanonicalResultIntegrationError extends Error {}

interface IntegrationRecord {
  operationKey: string;
  fingerprint: string;
  subject: string;
  runRef: string;
  stageId: string;
  attemptRef: string;
  cardRef: string | null;
  iterationContract?: IterationOutcomeContract;
  integrationBranch: string;
  attemptBaseCommit: string;
  attemptCommit: string | null;
  integrationBaseCommit: string;
  integrationCommit: string | null;
  result: CanonicalStageResultPayload & { resultHash: string };
  state: 'intent' | 'attempt-committed' | 'lineage-local' | 'lineage-committed' | 'canonical-intent' | 'canonical-committed';
}

interface IntegrationState {
  schema: 'kb.canonical-integration/v1';
  records: IntegrationRecord[];
}

/**
 * The journal holds a record that IS this operation's own — same subject, runRef and stageId — but an
 * earlier call left its integration BELOW the canonical states because a step failed mid-flight (a refused
 * lineage push, a daemon exit, a coordination refusal). `lookup` retries the progression first; this is
 * raised only when the retry fails again, and it names both the stranded state and the step that failed so
 * the human ask is truthful. It is NOT an identity mismatch and must never be reported as one: the
 * 2026-08 incident (`transport 'file' not allowed` after the record was durable at `lineage-local`) parked
 * three generations behind the byte-identical, false message "canonical result lookup identity differs".
 */
export class CanonicalIntegrationIncompleteError extends CanonicalResultIntegrationError {
  /**
   * Duck-typed marker so `execution.ts` can classify this without importing this module — the dependency
   * runs the other way (this module imports execution.ts), and a cycle would be worse than a marker.
   * `isCanonicalIntegrationIncomplete` in execution.ts is the only reader.
   */
  readonly canonicalIntegrationIncomplete = true as const;

  readonly integrationState: IntegrationRecord['state'];

  readonly strandedCause: unknown;

  constructor(integrationState: IntegrationRecord['state'], cause: unknown) {
    super(`canonical integration incomplete (state: ${integrationState}): `
      + `${cause instanceof Error ? cause.message : String(cause)}`);
    this.integrationState = integrationState;
    this.strandedCause = cause;
  }
}

export interface CanonicalGitResultIntegratorOptions {
  repoRoot: string;
  coordinationRoot: string;
  integrationRoot: string;
  worktreeRoot: string;
  stateRoot: string;
  baseCommit: string;
  gitRunner?: GitCommandRunner;
  coordinationGit?: GitRunner;
  publication?: CoordinationPublication;
  outboxRoot?: string;
  runPy?: PyRunner;
  /**
   * READ-ONLY branch resolution for the coordination checkout, injected as its OWN seam — deliberately
   * NOT the mutating `coordinationGit` runner, exactly as `audit/log.ts` keeps `resolveCheckedOutBranch`
   * outside its `OpsGitRunner` (commit 2fdb2ca). Faking the mutating runner therefore cannot neuter the
   * guard: a test that wants a coordination git call to happen has to say so through this seam, and a
   * test that proves the refusal can assert the mutating runner was invoked zero times. Production never
   * passes it, so the daemon always gets the real `git symbolic-ref --short HEAD` resolution.
   */
  resolveCoordinationBranch?: (root: string) => Promise<string | null>;
  /**
   * The ONE server-owned reconciliation publisher (P4 §3.4), composed once in the surface and threaded
   * through the activation options. The canonical coordination phase publishes its inbox->working->done
   * card walk as SERIAL single-step `card-transition` intents through this seam — it no longer runs any
   * `cards.py` mutation, `git commit`, or `git push` of its own. Optional so construction stays additive;
   * a coordination phase that reaches the card walk without it fails closed (a real posture, never a
   * silent bypass), exactly as the attempt port is `null` with no session host.
   */
  reconciliationPublisher?: ReconciliationPublisher;
  /**
   * Reads the control-plane store's current document revision, so each card-transition intent pins the
   * `expectedStoreRevision` the publisher's freshness gate compares against. Threaded from the same
   * `controlStore` the surface composed the publisher over; a card-transition never mutates that document,
   * so the value is stable across the walk.
   */
  readStoreRevision?: () => string;
}

// Mirrors the repository's existing exact-byte card-section grammar: only `## Result` at column 0,
// with no trailing whitespace, outside balanced column-0 backtick fences is structural. Keep this
// helper embedded with the fixed scripts because they execute against the independently versioned
// ops worktree and must not depend on a newly added cards.py API being deployed there first.
const CANONICAL_RESULT_HEADING_HELPER = `
def canonical_result_structure(body):
    offsets = []
    fenced = False
    offset = 0
    for line in body.splitlines(keepends=True):
        value = line.rstrip("\\r\\n")
        if value.startswith("\`\`\`"):
            fenced = not fenced
        elif not fenced and value == "## Result":
            offsets.append(offset)
        offset += len(line)
    return offsets, fenced
`.trim();

// The canonical card mutation (single `## Result`, fence balance, already-has-a-different-Result
// idempotency, blocked-dependency-done, and the inbox->working->done state walk) is NO LONGER a
// `cards.py` heredoc run against the ops worktree. Post-cutover it is validated in TypeScript
// (`canonicalResultStructure` + the coordination phase below) and PUBLISHED as serial single-step
// `card-transition` intents through the ONE reconciliation publisher, whose `cards` port owns the
// reconcile -> append_section -> state transition -> commit -> push per step. The
// `CANONICAL_RESULT_VERIFY_SCRIPT` stays: it re-proves the exact published bytes from one immutable
// fetched ops commit and shares `CANONICAL_RESULT_HEADING_HELPER` with the validator's TS twin.

export const CANONICAL_RESULT_VERIFY_SCRIPT = `
import sys, json, re, subprocess
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

${CANONICAL_RESULT_HEADING_HELPER}

op = json.loads(sys.argv[1])
path = Path("queue/done") / (op["cardRef"] + ".md")
git_commit = op.get("gitCommit")
if git_commit is None:
    if not path.is_file():
        raise cards.ValidationError("committed canonical result card is missing")
    card = cards.parse(path)
elif re.fullmatch(r"[a-f0-9]{40}(?:[a-f0-9]{24})?", git_commit):
    candidates = [
        Path("queue/inbox") / (op["cardRef"] + ".md"),
        Path("queue/working") / (op["cardRef"] + ".md"),
        Path("queue/approvals") / (op["cardRef"] + ".md"),
        path,
    ]
    found = []
    for candidate in candidates:
        shown = subprocess.run(
            ["git", "show", git_commit + ":" + candidate.as_posix()],
            capture_output=True, text=True, encoding="utf-8",
        )
        if shown.returncode == 0:
            found.append((candidate, shown.stdout))
    if len(found) != 1 or found[0][0] != path:
        raise cards.ValidationError("published canonical result card is missing or ambiguous")
    card = cards.parse_text(found[0][1], path)
else:
    raise cards.ValidationError("canonical result verification commit is invalid")
if card.meta.get("id") != op["cardRef"] or card.meta.get("workflow") != op["runRef"]:
    raise cards.ValidationError("committed canonical result identity differs")
if card.meta.get("execution-controller") != "dashboard" or card.meta.get("state") != "done":
    raise cards.ValidationError("committed canonical result controller or state differs")
headings, fenced = canonical_result_structure(card.body)
if fenced:
    raise cards.ValidationError("committed canonical result has unbalanced fenced content")
marker = "\`\`\`kb.canonical-stage-result/v1\\n"
if len(headings) != 1:
    raise cards.ValidationError("committed canonical Result section is missing or ambiguous")
section = card.body[headings[0]:]
prefix = "## Result\\n\\n" + marker
if not section.startswith(prefix):
    raise cards.ValidationError("committed canonical Result fence is missing")
start = len(prefix)
end = section.find("\\n\`\`\`", start)
if end < 0:
    raise cards.ValidationError("committed canonical Result fence is incomplete")
wire = json.loads(section[start:end])
if wire != op["result"]:
    raise cards.ValidationError("committed canonical Result payload differs")
expected = prefix + json.dumps(op["result"], sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\\n\`\`\`"
if section.rstrip() != expected:
    raise cards.ValidationError("committed canonical Result section has extra or non-canonical content")
print(json.dumps({"path": str(path)}))
`.trim();

function absolute(value: string, label: string): string {
  if (!isAbsolute(value) || value.includes('\0')) throw new CanonicalResultIntegrationError(`${label} must be absolute`);
  return resolve(value);
}

function childOf(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function canonicalExistingPath(value: string): string {
  const normalized = realpathSync.native(resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Reads a changed path for hashing only after proving it is a regular file contained within the
 * worktree, mirroring the worktree adapter's inspect discipline. A bare readFileSync follows
 * symlinks: a worker that still controls its worktree could swap an approved regular file for a
 * symlink whose dereferenced content hashes to the journaled digest, and the integrator would then
 * commit a mode-120000 symlink blob against a dereferenced-content digest. This fails closed on a
 * symlink or an out-of-root realpath so the integration aborts rather than committing a bad blob.
 */
function readRegularFileWithin(root: string, repoRelativePath: string): Buffer {
  const target = join(root, ...repoRelativePath.split('/'));
  if (!childOf(root, target)) throw new CanonicalResultIntegrationError('changed path escapes its worktree');
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new CanonicalResultIntegrationError('changed path is not a regular file');
  if (!childOf(canonicalExistingPath(root), canonicalExistingPath(target))) {
    throw new CanonicalResultIntegrationError('changed path resolves outside its worktree');
  }
  return readFileSync(target);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

/** g1 owns the immutable stage card; later iteration generations remain durable in the journal/lineage only. */
function expectedCardRef(operationKey: string, runRef: string, stageId: string): string | null {
  const firstGeneration = canonicalResultOperationKey(runRef, stageId);
  if (operationKey === firstGeneration) return workflowCardId(runRef, stageId);
  const iterationPrefix = `iteration-result:${runRef}:${stageId}:`;
  if (operationKey.startsWith(iterationPrefix)) {
    const requestRef = operationKey.slice(iterationPrefix.length);
    try {
      if (iterationResultOperationKey(runRef, stageId, requestRef) === operationKey) return null;
    } catch {
      // Fall through to the common invalid-identity error below.
    }
    throw new CanonicalResultIntegrationError('canonical result operation identity is invalid');
  }
  const suffix = operationKey.slice(firstGeneration.length);
  const match = /^:g([1-9]\d*)$/.exec(suffix);
  if (!match || Number(match[1]) < 2) throw new CanonicalResultIntegrationError('canonical result operation identity is invalid');
  return null;
}

function publicResult(record: IntegrationRecord): CanonicalStageResult {
  if (!record.integrationCommit) throw new CanonicalResultIntegrationError('canonical integration commit is unavailable');
  const migrated = decodeLegacyCanonicalJournalRecord(record);
  const result = migrated?.publicResult ?? record.result;
  return structuredClone({
    ...result,
    resultHash: canonicalStageResultHash(result),
    durability: 'canonical',
    attemptBaseCommit: record.attemptBaseCommit,
    integrationCommit: record.integrationCommit,
  });
}

/*
 * Canonical-journal migration reader. Historical records are immutable evidence: their field names,
 * result hash, fingerprint, and published wire cannot be rewritten. This decoder validates that old
 * shape in place and projects a generic outcome only at the read boundary. New writes never enter it.
 */
interface LegacyJournalOutcome {
  schema: 'kb.review-outcome/v1';
  decision: 'pass' | 'fail' | 'parked';
  summary: string;
  criteria: Array<{ criterionId: string; verdict: 'pass' | 'fail' | 'unverified'; findingIds: string[] }>;
  findings: Array<{
    id: string; criterionId: string; severity: 'blocking' | 'advisory'; summary: string; evidencePaths: string[];
  }>;
}

interface LegacyCanonicalJournalRecord extends IntegrationRecord {
  reviewContract?: { review: ProposalReview } | null;
  result: IntegrationRecord['result'] & { reviewOutcome?: LegacyJournalOutcome };
}

interface LegacyCanonicalJournalDecode {
  publicResult: CanonicalStageResultPayload & { resultHash: string };
  expectedResultHash: string;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function legacyCanonicalJournalResultHash(
  result: IntegrationRecord['result'],
  outcome: LegacyJournalOutcome | null,
): string {
  const payload = {
    summary: result.summary,
    artifacts: [...result.artifacts].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path)),
    changed: [...result.changed].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path)),
    checkpoints: [...result.checkpoints].sort(),
  };
  const normalized = outcome === null ? null : {
    schema: outcome.schema,
    decision: outcome.decision,
    summary: outcome.summary,
    criteria: outcome.criteria.map((criterion) => ({
      criterionId: criterion.criterionId, verdict: criterion.verdict, findingIds: [...criterion.findingIds],
    })),
    findings: outcome.findings.map((finding) => ({
      id: finding.id, criterionId: finding.criterionId, severity: finding.severity,
      summary: finding.summary, evidencePaths: [...finding.evidencePaths],
    })),
  };
  return createHash('sha256').update(JSON.stringify({ ...payload, reviewOutcome: normalized }), 'utf8').digest('hex');
}

function legacyNonIterationJournalResultHash(result: IntegrationRecord['result']): string {
  const payload = {
    summary: result.summary,
    artifacts: [...result.artifacts].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path)),
    changed: [...result.changed].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path)),
    checkpoints: [...result.checkpoints].sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function decodeLegacyCanonicalJournalRecord(record: IntegrationRecord): LegacyCanonicalJournalDecode | null {
  const legacy = record as LegacyCanonicalJournalRecord;
  const hasContract = Object.prototype.hasOwnProperty.call(legacy, 'reviewContract');
  const hasOutcome = Object.prototype.hasOwnProperty.call(legacy.result ?? {}, 'reviewOutcome');
  if (!hasContract) {
    if (hasOutcome) throw new CanonicalResultIntegrationError('legacy canonical journal outcome lacks its immutable contract');
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'iterationContract')
    || Object.prototype.hasOwnProperty.call(record.result ?? {}, 'iterationOutcome')) {
    throw new CanonicalResultIntegrationError('canonical integration mixes current and migration fields');
  }
  if (legacy.reviewContract === null) {
    if (hasOutcome) throw new CanonicalResultIntegrationError('legacy canonical journal contract is empty');
    return { publicResult: record.result, expectedResultHash: legacyCanonicalJournalResultHash(record.result, null) };
  }
  if (!objectRecord(legacy.reviewContract) || !objectRecord(legacy.reviewContract.review) || !hasOutcome
    || !objectRecord(legacy.result.reviewOutcome)) {
    throw new CanonicalResultIntegrationError('legacy canonical journal record is incomplete');
  }
  const review = legacy.reviewContract.review;
  const outcome = legacy.result.reviewOutcome;
  if (!Array.isArray(review.criteria) || typeof review.subjectStageId !== 'string'
    || !Number.isSafeInteger(review.maxCreatorReworks)
    || Object.keys(outcome).some((key) => !['schema', 'decision', 'summary', 'criteria', 'findings'].includes(key))) {
    throw new CanonicalResultIntegrationError('legacy canonical journal record is invalid');
  }
  const participantId = 'legacy-reviewer';
  const request = {
    schema: 'kb.iteration-request/v1' as const,
    requestRef: 'legacy-review-request', iterationLoopRef: 'legacy-review-loop', routeId: 'legacy-review-route',
    senderParticipantId: 'legacy-subject', recipientParticipantId: participantId, kind: 'review' as const, cycle: 1,
    inputGenerationRefs: ['legacy-generation'], baseCommit: 'legacy-server-owned', artifactHashes: {},
    criteria: review.criteria, unresolvedFindingRefs: [], preservedInvariants: [],
    nextAcceptanceCheck: 'Apply the authored review criteria.', instructions: 'Return the closed review outcome.',
  };
  const iterationGroup: ProposalIterationGroup = {
    iterationGroupId: 'legacy-review-group',
    participants: [
      { participantId: 'legacy-subject', stageRef: review.subjectStageId, role: 'contributor', perspective: 'Subject', mandate: 'Produce the reviewed artifact.' },
      { participantId, stageRef: 'legacy-review-stage', role: 'judge', perspective: 'Checker', mandate: 'Apply the authored review criteria.' },
    ],
    routes: [{
      routeId: request.routeId, senderParticipantId: request.senderParticipantId,
      recipientParticipantId: request.recipientParticipantId, requestKinds: ['review'],
      baseResolutionStageIds: [review.subjectStageId],
    }],
    activation: { seedParticipantId: 'legacy-subject', seedArtifactIds: ['legacy-artifact'] },
    initialStepId: 'legacy-review-step',
    schedule: [
      { stepId: 'legacy-review-step', routeId: request.routeId, cycle: 'current' },
      { stepId: 'legacy-review-rework', routeId: request.routeId,
        after: { stepId: 'legacy-review-step', participantId, verdict: 'fail' }, cycle: 'next' },
    ],
    artifacts: ['legacy-artifact'], criteria: review.criteria, maxCycles: review.maxCreatorReworks + 1,
    cycleUnit: 'one legacy creator generation and checker verdict',
    terminalAuthorities: [{ participantId, verdict: 'pass' }],
  };
  const parsed = parseIterationOutcome(JSON.stringify({
    schema: 'kb.iteration-outcome/v1', requestRef: request.requestRef,
    iterationLoopRef: request.iterationLoopRef, participantId, cycle: request.cycle,
    verdict: outcome.decision, inputGenerationRefs: request.inputGenerationRefs, criteria: outcome.criteria,
    findings: Array.isArray(outcome.findings) ? outcome.findings.map((finding) => {
      if (!objectRecord(finding)) return finding;
      const { id, ...rest } = finding;
      return { ...rest, findingId: id };
    }) : outcome.findings,
    positions: [], recordedDissent: [], summary: outcome.summary,
  }), { iterationGroup, request });
  if (!parsed.ok) throw new CanonicalResultIntegrationError(`legacy canonical journal outcome is invalid: ${parsed.detail}`);
  const { reviewOutcome: _legacyOutcome, ...plain } = legacy.result;
  return {
    publicResult: { ...plain, iterationOutcome: parsed.value },
    expectedResultHash: legacyCanonicalJournalResultHash(record.result, outcome),
  };
}

function canonicalWire(record: IntegrationRecord): CanonicalStageResultPayload & {
  resultHash: string;
  attemptBaseCommit: string;
  integrationCommit: string;
  runRef: string;
  stageId: string;
  attemptRef: string;
} {
  if (!record.integrationCommit) throw new CanonicalResultIntegrationError('canonical integration commit is unavailable');
  return {
    ...record.result,
    attemptBaseCommit: record.attemptBaseCommit,
    integrationCommit: record.integrationCommit,
    runRef: record.runRef,
    stageId: record.stageId,
    attemptRef: record.attemptRef,
  };
}

function validatedIterationOutcome(value: unknown, contract: unknown): IterationOutcome | undefined {
  if (value === undefined) {
    if (contract !== undefined && contract !== null) throw new CanonicalResultIntegrationError('canonical result has an iteration contract without an outcome');
    return undefined;
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new CanonicalResultIntegrationError('canonical iteration outcome lacks an immutable iteration contract');
  }
  try {
    const parsed = parseIterationOutcome(JSON.stringify(value), contract as IterationOutcomeContract);
    if (!parsed.ok) throw new CanonicalResultIntegrationError(parsed.detail);
    return parsed.value;
  } catch (error) {
    if (error instanceof CanonicalResultIntegrationError) throw error;
    throw new CanonicalResultIntegrationError('canonical iteration outcome is invalid');
  }
}

function normalizeArtifacts(items: readonly WorkerArtifactResult[]): WorkerArtifactResult[] {
  const paths = new Set<string>();
  return [...items].map((item) => {
    if (!isSafeRepoRelativePath(item.path) || !/^[a-f0-9]{64}$/.test(item.digest) || paths.has(item.path)) {
      throw new CanonicalResultIntegrationError('result contains an invalid or duplicate artifact');
    }
    paths.add(item.path);
    return { path: item.path, digest: item.digest };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeCheckpoints(items: readonly string[]): string[] {
  if (items.length > 128) throw new CanonicalResultIntegrationError('result contains too many checkpoints');
  const seen = new Set<string>();
  return [...items].map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 512 || item.includes('\0')
      || redactSensitiveText(item) !== item || seen.has(item)) {
      throw new CanonicalResultIntegrationError('result contains an invalid or duplicate checkpoint');
    }
    seen.add(item);
    return item;
  }).sort();
}

function readState(path: string): IntegrationState {
  if (!existsSync(path)) return { schema: 'kb.canonical-integration/v1', records: [] };
  if (statSync(path).size > MAX_STATE_BYTES) throw new CanonicalResultIntegrationError('canonical integration state exceeds its bound');
  const value = JSON.parse(readFileSync(path, 'utf8')) as IntegrationState;
  if (value.schema !== 'kb.canonical-integration/v1' || !Array.isArray(value.records)) {
    throw new CanonicalResultIntegrationError('canonical integration state is invalid');
  }
  const operations = new Set<string>();
  for (const record of value.records) {
    const hasIterationContract = Object.prototype.hasOwnProperty.call(record, 'iterationContract');
    const hasIterationOutcome = Object.prototype.hasOwnProperty.call(record.result ?? {}, 'iterationOutcome');
    const migrated = decodeLegacyCanonicalJournalRecord(record);
    if (!migrated && ((hasIterationContract && (!record.iterationContract || !hasIterationOutcome))
      || (!hasIterationContract && hasIterationOutcome))) {
      throw new CanonicalResultIntegrationError('canonical integration has incomplete iteration fields');
    }
    const branch = `codex/managed-${createHash('sha256').update(record.runRef ?? '').digest('hex').slice(0, 24)}`;
    if (typeof record.operationKey !== 'string' || record.operationKey.length === 0 || record.operationKey.length > 512
      || typeof record.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint)
      || typeof record.subject !== 'string' || record.subject.length === 0 || record.subject.length > 256
      || !SAFE_REF.test(record.runRef) || !SAFE_REF.test(record.stageId) || !SAFE_REF.test(record.attemptRef)
      || record.cardRef !== expectedCardRef(record.operationKey, record.runRef, record.stageId) || record.integrationBranch !== branch
      || !SHA.test(record.attemptBaseCommit) || (record.attemptCommit !== null && !SHA.test(record.attemptCommit))
      || !SHA.test(record.integrationBaseCommit) || (record.integrationCommit !== null && !SHA.test(record.integrationCommit))
      || !['intent', 'attempt-committed', 'lineage-local', 'lineage-committed', 'canonical-intent', 'canonical-committed'].includes(record.state)
      || (record.state === 'attempt-committed' && record.attemptCommit === null)
      || (['lineage-local', 'lineage-committed', 'canonical-intent', 'canonical-committed'].includes(record.state) && record.integrationCommit === null)
      || !record.result || typeof record.result.summary !== 'string' || !Array.isArray(record.result.artifacts)
      || !Array.isArray(record.result.changed) || !Array.isArray(record.result.checkpoints)
      || !/^[a-f0-9]{64}$/.test(record.result.resultHash)
      || (migrated
        ? migrated.expectedResultHash !== record.result.resultHash
        : canonicalStageResultHash(record.result) !== record.result.resultHash
          && (hasIterationContract || hasIterationOutcome
            || legacyNonIterationJournalResultHash(record.result) !== record.result.resultHash))
      || operations.has(record.operationKey)) {
      throw new CanonicalResultIntegrationError('canonical integration state is invalid');
    }
    if (hasIterationContract) validatedIterationOutcome(record.result.iterationOutcome, record.iterationContract);
    normalizeArtifacts(record.result.artifacts);
    normalizeArtifacts(record.result.changed);
    normalizeCheckpoints(record.result.checkpoints);
    operations.add(record.operationKey);
  }
  return value;
}

function saveState(path: string, state: IntegrationState): void {
  const encoded = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) throw new CanonicalResultIntegrationError('canonical integration state exceeds its bound');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameWithRetrySync(temp, path);
}

function statusPaths(output: Buffer): string[] {
  const rows = output.toString('utf8').split('\0').filter(Boolean);
  return rows.map((row) => {
    if (row.length < 4 || row[2] !== ' ') throw new CanonicalResultIntegrationError('git returned malformed status');
    const status = row.slice(0, 2);
    const path = row.slice(3);
    if (!(status === '??' || [...status].every((char) => char === ' ' || char === 'M' || char === 'A'))
      || !isSafeRepoRelativePath(path)) throw new CanonicalResultIntegrationError('git returned unsupported changed state');
    return path;
  }).sort();
}

function nulPaths(output: string): string[] {
  const paths = output.split('\0').filter(Boolean);
  if (paths.some((path) => !isSafeRepoRelativePath(path))) {
    throw new CanonicalResultIntegrationError('git returned an unsafe changed path');
  }
  return paths.sort();
}

/** The fenced payload marker the canonical Result block carries; VERIFY asserts these exact bytes. */
const CANONICAL_STAGE_RESULT_MARKER = 'kb.canonical-stage-result/v1';

/**
 * TS twin of `canonical_result_structure` (the Python helper VERIFY still runs): the column-0 offsets of
 * a bare `## Result` heading that sits OUTSIDE balanced column-0 backtick fences, plus whether the body
 * closes with an unbalanced fence. Card bodies are `\n`-delimited; the split keeps line ends so an offset
 * indexes straight into `body`, exactly as the Python twin indexes `card.body`.
 */
function canonicalResultStructure(body: string): { offsets: number[]; fenced: boolean } {
  const offsets: number[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of body.split(/(?<=\n)/)) {
    const value = line.replace(/[\r\n]+$/, '');
    if (value.startsWith('```')) fenced = !fenced;
    else if (!fenced && value === '## Result') offsets.push(offset);
    offset += line.length;
  }
  return { offsets, fenced };
}

interface LocatedCanonicalCard {
  state: string;
  body: string;
  dependsOn: string[];
  id: string;
  workflow: string;
  controller: string;
}

/** Find the ONE queue file for a managed card; missing or ambiguous fails closed (Python parity). */
function locateCanonicalCard(coordinationRoot: string, cardId: string): LocatedCanonicalCard {
  const found = ['inbox', 'working', 'approvals', 'done']
    .map((dir) => join(coordinationRoot, 'queue', dir, `${cardId}.md`))
    .filter((path) => existsSync(path));
  if (found.length !== 1) throw new CanonicalResultIntegrationError('canonical managed card path is missing or ambiguous');
  const { meta, body } = parseCardFrontmatter(readFileSync(found[0]!, 'utf8'));
  const dependsOn = meta['depends-on'];
  return {
    state: String(meta.state ?? ''),
    body,
    dependsOn: Array.isArray(dependsOn) ? dependsOn.map((value) => String(value)) : [],
    id: String(meta.id ?? ''),
    workflow: String(meta.workflow ?? ''),
    controller: String(meta['execution-controller'] ?? ''),
  };
}

/** Concrete but inactive-by-default Git lineage + canonical ops-card integrator. */
export function createCanonicalGitResultIntegrator(options: CanonicalGitResultIntegratorOptions): ResultIntegrator {
  const repoRoot = absolute(options.repoRoot, 'repoRoot');
  const coordinationRoot = absolute(options.coordinationRoot, 'coordinationRoot');
  const integrationRoot = absolute(options.integrationRoot, 'integrationRoot');
  const worktreeRoot = absolute(options.worktreeRoot, 'worktreeRoot');
  const stateRoot = absolute(options.stateRoot, 'stateRoot');
  if (!SHA.test(options.baseCommit)) throw new CanonicalResultIntegrationError('baseCommit must be immutable');
  const git = options.gitRunner ?? createLocalGitCommandRunner();
  const rawOpsGit = options.coordinationGit ?? defaultGitRunner;
  const runPy = options.runPy ?? defaultPyRunner;
  const statePath = join(stateRoot, 'control', 'canonical-integration.json');
  // [C-S4] No eager mkdir under the worktree root. On the VM that root is `/var/lib/kb-shell/worktrees`,
  // broker-owned (02770, installer-created) and not writable by the dashboard uid at composition time, so
  // creating it here made activation unconstructible on Linux (EACCES). Nothing is lost: `core.hooksPath`
  // pointing at a path that does not exist disables repo hooks exactly as an empty directory does, and the
  // worktree adapter materializes this same directory at first provisioning.
  const hooksPath = join(worktreeRoot, '.disabled-hooks');
  // core.longpaths=true: the integration worktree is created under the same deep state-root path as the
  // attempt worktree, so long repo-relative paths tip over Windows MAX_PATH (260) without it. No-op off
  // Windows; not a gate.
  const gitPrefix = [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
    '-c', 'core.longpaths=true',
    '-c', `core.hooksPath=${hooksPath}`, '-c', 'commit.gpgsign=false', '--literal-pathspecs',
  ];
  const coordinationHooksPath = join(stateRoot, 'control', '.disabled-hooks');
  mkdirSync(coordinationHooksPath, { recursive: true, mode: 0o700 });
  const coordinationPrefix = [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
    '-c', 'core.longpaths=true',
    '-c', `core.hooksPath=${coordinationHooksPath}`, '-c', 'commit.gpgsign=false', '--literal-pathspecs',
  ];
  const resolveCoordinationBranch = options.resolveCoordinationBranch ?? resolveCheckedOutBranch;
  /**
   * THE COORDINATION-GIT GUARD. Every coordination git invocation — fetch, pull, rebase, add, commit and
   * both `push origin ops` calls — funnels through here, and NONE of them runs until the checkout at
   * `cwd` has been proven, read-only and outside the mutating seam, to be exactly `ops`.
   *
   * Why this exists even though `integrate` already compared `rev-parse --abbrev-ref HEAD` to `'ops'`:
   * that comparison sat BELOW `prepareCoordination`, which had already run `pull --rebase origin ops`
   * against whatever checkout it was handed, and it asked the INJECTABLE mutating runner — the same seam
   * a caller fakes — so it proved nothing about the real directory. `verifyCanonical` fetched with no
   * branch check at all, and it is reachable from `lookup`/`resolveBase` at run activation. That is the
   * shape of the 2026-07-30 incident (a daemon booted with `DASHBOARD_REPO_ROOT` on a feature-branch
   * worktree ran `pull --rebase origin ops` against it and jammed a 549-step rebase); see commit 2fdb2ca,
   * which fixed the identical hazard in `audit/log.ts`.
   *
   * Unlike the audit ledger there is no degraded local-only path here: a canonical stage result is only
   * meaningful once it is durably published to `ops`, so ambiguity — a feature branch, a detached HEAD, a
   * non-git directory, an unresolvable or timed-out check — REFUSES. The run parks; nothing is pushed.
   */
  const opsGit: GitRunner = async (cwd, args) => {
    const branch = await resolveCoordinationBranch(cwd);
    if (branch !== COORDINATION_BRANCH) {
      const resolved = branch === null
        ? 'UNRESOLVED (detached HEAD, not a git repo, or git failed/timed out)'
        : `"${branch}"`;
      // eslint-disable-next-line no-console -- deliberately loud: a misconfigured coordination root is a
      // misconfiguration, not a normal condition, and must be unmistakable when grepping daemon logs.
      console.error(
        `CANONICAL-GIT-GUARD: coordination git REFUSED for coordinationRoot="${cwd}" — checked-out branch `
        + `is ${resolved}, not "${COORDINATION_BRANCH}". No git command ran (no fetch/pull/rebase/add/`
        + `commit/push). This almost certainly means DASHBOARD_REPO_ROOT points at the wrong checkout.`,
      );
      throw new CanonicalResultIntegrationError(
        `${COORDINATION_GIT_GUARD_REASON}: coordination checkout '${cwd}' is on ${resolved}, not '${COORDINATION_BRANCH}'`,
      );
    }
    return rawOpsGit(cwd, [...coordinationPrefix, ...args]);
  };
  let tail: Promise<unknown> = Promise.resolve();

  const gitRaw = (args: string[], cwd: string) => git.run([...gitPrefix, ...args], cwd);
  const gitRun = async (args: string[], cwd: string, label: string): Promise<string> => {
    const result = await gitRaw(args, cwd);
    if (result.exitCode !== 0) throw new CanonicalResultIntegrationError(`${label} failed: ${result.stderr.slice(0, 512)}`);
    return result.stdout.toString('utf8').trim();
  };
  const integrationPath = (runRef: string): string => join(integrationRoot, createHash('sha256').update(runRef).digest('hex').slice(0, 24));
  const verifyRepoWorktree = async (path: string, label: string): Promise<void> => {
    const top = await gitRun(['rev-parse', '--show-toplevel'], path, `${label} root verification`);
    if (canonicalExistingPath(top) !== canonicalExistingPath(path)) {
      throw new CanonicalResultIntegrationError(`${label} is not the planned worktree root`);
    }
    const repoCommon = await gitRun(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'], repoRoot, `${label} repository identity`,
    );
    const worktreeCommon = await gitRun(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'], path, `${label} worktree identity`,
    );
    if (canonicalExistingPath(repoCommon) !== canonicalExistingPath(worktreeCommon)) {
      throw new CanonicalResultIntegrationError(`${label} belongs to a different repository`);
    }
  };
  const ensureLineage = async (runRef: string): Promise<{ path: string; branch: string }> => {
    const path = integrationPath(runRef);
    const branch = `codex/managed-${createHash('sha256').update(runRef).digest('hex').slice(0, 24)}`;
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const branchExists = await gitRaw(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot);
      if (branchExists.exitCode !== 0 && branchExists.exitCode !== 1) {
        throw new CanonicalResultIntegrationError(`integration branch inspection failed: ${branchExists.stderr.slice(0, 512)}`);
      }
      await gitRun(
        branchExists.exitCode === 0 ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, options.baseCommit],
        repoRoot, 'integration worktree creation',
      );
    }
    await verifyRepoWorktree(path, 'integration lineage');
    const checkedOut = await gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], path, 'integration branch verification');
    if (checkedOut !== branch) throw new CanonicalResultIntegrationError('integration worktree branch differs');
    const dirty = await gitRun(['status', '--porcelain=v1', '-z', '--untracked-files=all'], path, 'integration status');
    if (dirty) throw new CanonicalResultIntegrationError('integration lineage worktree is dirty');
    return { path, branch };
  };
  const verifyCanonical = async (record: IntegrationRecord): Promise<void> => {
    if (!record.integrationCommit) throw new CanonicalResultIntegrationError('canonical integration commit is unavailable');
    if (record.cardRef === null) {
      const lineage = await ensureLineage(record.runRef);
      if (lineage.branch !== record.integrationBranch) throw new CanonicalResultIntegrationError('lineage branch identity differs');
      const localCommit = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'generation lineage verification');
      if (localCommit !== record.integrationCommit) throw new CanonicalResultIntegrationError('generation lineage commit differs');
      await gitRun([
        'fetch', '--no-tags', 'origin',
        `refs/heads/${record.integrationBranch}:refs/remotes/origin/${record.integrationBranch}`,
      ], lineage.path, 'generation lineage refresh');
      const remoteCommit = await gitRun(
        ['rev-parse', `refs/remotes/origin/${record.integrationBranch}`], lineage.path, 'generation lineage remote verification',
      );
      if (remoteCommit !== record.integrationCommit) throw new CanonicalResultIntegrationError('generation lineage is not remotely durable');
      return;
    }
    let publishedCommit: string;
    if ((options.publication ?? 'direct') === 'outbox') {
      publishedCommit = (await opsGit(coordinationRoot, ['rev-parse', 'HEAD'])).trim();
    } else {
      await opsGit(coordinationRoot, [
        'fetch', '--no-tags', 'origin', 'refs/heads/ops:refs/remotes/origin/ops',
      ]);
      publishedCommit = (await opsGit(
        coordinationRoot, ['rev-parse', '--verify', 'refs/remotes/origin/ops^{commit}'],
      )).trim();
    }
    if (!SHA.test(publishedCommit)) {
      throw new CanonicalResultIntegrationError('published coordination commit is not immutable');
    }
    const wire = canonicalWire(record);
    const verified = runPy(coordinationRoot, CANONICAL_RESULT_VERIFY_SCRIPT, JSON.stringify({
      cardRef: record.cardRef, runRef: record.runRef, result: wire, gitCommit: publishedCommit,
    }));
    if (verified.exitCode !== 0) {
      throw new CanonicalResultIntegrationError(verified.stderr.trim() || verified.stdout.trim() || 'canonical Result verification failed');
    }
  };
  /**
   * THE one progression from a journaled record to a durably published canonical result: attempt commit →
   * lineage cherry-pick → lineage publication → coordination card → ops publication → verification. Every
   * phase is resumable and idempotent, so calling this on a record already part-way through re-proves the
   * completed phases rather than repeating them.
   *
   * Two callers share this exact code — never a copy: `integrate` drives it for a fresh worker result, and
   * `lookup` drives it for a record an earlier call left stranded below canonical. That is what makes a
   * transient failure (a refused push, a crash) retried on the next lookup instead of parking the stage
   * forever. The attempt worktree is re-derived from the JOURNALED runRef/attemptRef through the same
   * server-owned planner `integrate` validates its caller's path against, so a resuming lookup — which has
   * no worktree input at all — cannot be pointed anywhere else.
   */
  const advanceIntegration = async (record: IntegrationRecord, state: IntegrationState): Promise<{
    status: 'integrated' | 'replayed'; resultHash: string; durability: 'canonical';
    attemptBaseCommit: string; integrationCommit: string;
  }> => {
    // A concurrent writer may have finished this record between the state read and this call.
    if (record.state === 'canonical-committed') {
      await verifyCanonical(record);
      return { status: 'replayed', resultHash: publicResult(record).resultHash,
        durability: 'canonical', attemptBaseCommit: record.attemptBaseCommit, integrationCommit: record.integrationCommit as string };
    }
    const attemptPath = planAttemptWorktreePath(worktreeRoot, record.runRef, record.attemptRef);
    if (record.state === 'intent' || record.state === 'attempt-committed') {
      if (!childOf(worktreeRoot, attemptPath) || !existsSync(attemptPath)) {
        throw new CanonicalResultIntegrationError('attempt worktree differs from the server-owned layout');
      }
      await verifyRepoWorktree(attemptPath, 'attempt worktree');
      const expectedPaths = record.result.changed.map((item) => item.path);
      const commitMessage = `chore(run): integrate ${record.stageId}`;
      const verifyChangedContent = () => {
        for (const item of record.result.changed) {
          const content = readRegularFileWithin(attemptPath, item.path);
          if (createHash('sha256').update(content).digest('hex') !== item.digest) {
            throw new CanonicalResultIntegrationError(`artifact digest changed for '${item.path}'`);
          }
        }
      };

      if (record.state === 'intent' && expectedPaths.length > 0) {
        const attemptHead = await gitRun(['rev-parse', 'HEAD'], attemptPath, 'attempt recovery head');
        if (attemptHead === record.attemptBaseCommit) {
          verifyChangedContent();
          const current = await gitRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], attemptPath);
          if (current.exitCode !== 0 || JSON.stringify(statusPaths(current.stdout)) !== JSON.stringify(expectedPaths)) {
            throw new CanonicalResultIntegrationError('attempt recovery changes differ from the journaled intent');
          }
          const staged = nulPaths(await gitRun(['diff', '--cached', '--name-only', '-z'], attemptPath, 'attempt recovery index'));
          if (staged.length > 0 && JSON.stringify(staged) !== JSON.stringify(expectedPaths)) {
            throw new CanonicalResultIntegrationError('attempt recovery index differs from the journaled intent');
          }
          if (staged.length === 0) await gitRun(['add', '--', ...expectedPaths], attemptPath, 'attempt staging');
          await gitRun(['commit', '-m', commitMessage], attemptPath, 'attempt commit');
          record.attemptCommit = await gitRun(['rev-parse', 'HEAD'], attemptPath, 'attempt commit resolution');
        } else {
          const dirty = await gitRun(['status', '--porcelain=v1', '-z', '--untracked-files=all'], attemptPath, 'attempt recovery status');
          if (dirty) throw new CanonicalResultIntegrationError('recovered attempt commit has additional worktree changes');
          const parent = await gitRun(['rev-parse', 'HEAD^'], attemptPath, 'attempt recovery parent');
          const message = await gitRun(['show', '-s', '--format=%B', 'HEAD'], attemptPath, 'attempt recovery message');
          const committedPaths = nulPaths(await gitRun(
            ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], attemptPath, 'attempt recovery paths',
          ));
          if (parent !== record.attemptBaseCommit || message !== commitMessage
            || JSON.stringify(committedPaths) !== JSON.stringify(expectedPaths)) {
            throw new CanonicalResultIntegrationError('attempt HEAD differs from the journaled integration intent');
          }
          verifyChangedContent();
          record.attemptCommit = attemptHead;
        }
        if (!record.attemptCommit || !SHA.test(record.attemptCommit)) {
          throw new CanonicalResultIntegrationError('attempt commit is not immutable');
        }
        record.state = 'attempt-committed';
        saveState(statePath, state);
      } else if (record.state === 'intent') {
        record.integrationCommit = record.integrationBaseCommit;
        record.state = 'lineage-local';
        saveState(statePath, state);
      }

      if (record.state === 'attempt-committed') {
        if (!record.attemptCommit) throw new CanonicalResultIntegrationError('attempt commit is unavailable');
        const dirty = await gitRun(['status', '--porcelain=v1', '-z', '--untracked-files=all'], attemptPath, 'attempt committed status');
        if (dirty) throw new CanonicalResultIntegrationError('attempt committed worktree is dirty');
        const attemptHead = await gitRun(['rev-parse', 'HEAD'], attemptPath, 'attempt committed head verification');
        if (attemptHead !== record.attemptCommit) throw new CanonicalResultIntegrationError('attempt committed HEAD differs');
        const lineage = await ensureLineage(record.runRef);
        if (lineage.branch !== record.integrationBranch) throw new CanonicalResultIntegrationError('lineage branch identity differs');
        let lineageHead = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'lineage recovery head');
        if (lineageHead === record.integrationBaseCommit) {
          await gitRun(['cherry-pick', record.attemptCommit], lineage.path, 'run lineage integration');
          lineageHead = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'integration commit resolution');
        } else {
          const parent = await gitRun(['rev-parse', 'HEAD^'], lineage.path, 'lineage recovery parent');
          const message = await gitRun(['show', '-s', '--format=%B', 'HEAD'], lineage.path, 'lineage recovery message');
          const committedPaths = nulPaths(await gitRun(
            ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], lineage.path, 'lineage recovery paths',
          ));
          if (parent !== record.integrationBaseCommit || message !== commitMessage
            || JSON.stringify(committedPaths) !== JSON.stringify(expectedPaths)) {
            throw new CanonicalResultIntegrationError('lineage HEAD differs from the journaled integration intent');
          }
          for (const item of record.result.changed) {
            const content = readRegularFileWithin(lineage.path, item.path);
            if (createHash('sha256').update(content).digest('hex') !== item.digest) {
              throw new CanonicalResultIntegrationError(`lineage artifact digest changed for '${item.path}'`);
            }
          }
        }
        if (!SHA.test(lineageHead)) throw new CanonicalResultIntegrationError('integration commit is not immutable');
        record.integrationCommit = lineageHead;
        record.state = 'lineage-local';
        saveState(statePath, state);
      }
    }

    if (record.state === 'lineage-local') {
      const lineage = await ensureLineage(record.runRef);
      if (lineage.branch !== record.integrationBranch) throw new CanonicalResultIntegrationError('lineage branch identity differs');
      const localCommit = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'local lineage verification');
      if (!record.integrationCommit || localCommit !== record.integrationCommit) throw new CanonicalResultIntegrationError('local lineage commit differs');
      await gitRun(['push', 'origin', `HEAD:refs/heads/${record.integrationBranch}`], lineage.path, 'lineage publication');
      await gitRun([
        'fetch', '--no-tags', 'origin',
        `refs/heads/${record.integrationBranch}:refs/remotes/origin/${record.integrationBranch}`,
      ], lineage.path, 'published lineage refresh');
      const remoteCommit = await gitRun(
        ['rev-parse', `refs/remotes/origin/${record.integrationBranch}`], lineage.path, 'published lineage verification',
      );
      if (remoteCommit !== record.integrationCommit) {
        throw new CanonicalResultIntegrationError('published lineage does not equal the integrated commit');
      }
      record.state = 'lineage-committed';
      saveState(statePath, state);
    }

    if (record.state === 'lineage-committed') {
      if (record.cardRef === null) {
        record.state = 'canonical-committed';
        saveState(statePath, state);
        return { status: 'integrated' as const, resultHash: record.result.resultHash,
          durability: 'canonical' as const, attemptBaseCommit: record.attemptBaseCommit, integrationCommit: record.integrationCommit as string };
      }
      // The `cards` port owns its own reconcile (`prepareCoordination`) per intent, so this phase no
      // longer stages/commits/pushes coordination git itself. `prepareCoordination` still runs once here
      // to fail-closed on a dirty coordination index BEFORE the walk (parity with the retired heredoc's
      // index guard) and to reconcile the checkout the TS validator reads the live card from.
      await prepareCoordination(coordinationRoot, opsGit, options.publication, options.outboxRoot);
      const dirty = await opsGit(coordinationRoot, ['diff', '--cached', '--name-only', '-z']);
      if (dirty) throw new CanonicalResultIntegrationError('coordination index is dirty');
      record.state = 'canonical-intent';
      saveState(statePath, state);
    }
    if (record.state !== 'canonical-intent') {
      throw new CanonicalResultIntegrationError('canonical integration phase is invalid');
    }
    // Re-prove the checkout is `ops` before minting any intent even though `opsGit`'s guard also refuses
    // off-ops: an off-ops coordination root parks the stage here with a named error, mutating nothing.
    const branch = (await opsGit(coordinationRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch !== 'ops') throw new CanonicalResultIntegrationError('canonical coordination checkout differs');
    if (!record.integrationCommit) throw new CanonicalResultIntegrationError('integration commit is unavailable');
    const cardRef = record.cardRef;
    if (cardRef === null) throw new CanonicalResultIntegrationError('canonical coordination requires a card reference');
    const publisher = options.reconciliationPublisher;
    if (!publisher) throw new CanonicalResultIntegrationError('canonical coordination requires a reconciliation publisher');
    const readStoreRevision = options.readStoreRevision;
    if (!readStoreRevision) throw new CanonicalResultIntegrationError('canonical coordination requires a store-revision reader');
    const wire = canonicalWire(record);
    const encoded = JSON.stringify({ runRef: record.runRef, cardRef, result: wire });
    if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) throw new CanonicalResultIntegrationError('canonical card result exceeds its bound');
    // The exact fenced Result bytes VERIFY re-proves: `## Result` then a `kb.canonical-stage-result/v1`
    // fence wrapping the sort-keyed compact wire. `canonical(...)` is the same sorted-key serializer the
    // journal fingerprint uses and matches Python's `json.dumps(..., sort_keys=True,
    // separators=(",",":"), ensure_ascii=False)`; the `cards` port's `append_section` inserts this block
    // under `## Result`, so the committed section is byte-identical to the retired heredoc's output.
    const resultBlock = `\`\`\`${CANONICAL_STAGE_RESULT_MARKER}\n${canonical(wire)}\n\`\`\``;
    const resultWrite: CardTransitionWrite = { section: 'Result', block: resultBlock };

    // Publish ONE serial single-step `card-transition` intent, pinned to the card's CURRENT bytes + the
    // CURRENT ops/store revisions, wrapped so the `cards` port's own `withOpsTransaction` joins this span
    // reentrantly (AsyncLocalStorage). Each hop commits+pushes atomically inside the publisher, so a crash
    // mid-walk leaves the card at a durable intermediate state the resume re-reads from disk; the
    // publisher's receipt is the at-most-once dedup for a hop whose effect landed before its receipt
    // advanced. The final hop into `done` carries the Result block so `append_section` writes it once.
    // A card's queue DIRECTORY is not always its state name: `blocked` lives in `queue/inbox/` and
    // `approved` in `queue/approvals/` (scripts/cards.py STATE_DIR). The intent pins the card by its real
    // on-disk path, while `fromState`/`toState` stay the STATE names the `cards` port transitions between.
    const queueDir = (queueState: string): string =>
      queueState === 'blocked' ? 'inbox' : queueState === 'approved' ? 'approvals' : queueState;
    const publishCardStep = async (from: string, to: string, write?: CardTransitionWrite): Promise<void> => {
      const cardPath = `queue/${queueDir(from)}/${cardRef}.md`;
      const cardAbsolute = join(coordinationRoot, 'queue', queueDir(from), `${cardRef}.md`);
      if (!existsSync(cardAbsolute)) {
        throw new CanonicalResultIntegrationError(`canonical card is not in ${from} (already reconciled?): ${cardRef}`);
      }
      const draft: CardTransitionIntent = {
        schema: RECONCILIATION_INTENT_SCHEMA,
        kind: 'card-transition',
        actor: 'dashboard-supervisor',
        idempotencyKey: '',
        expectedSourceRevision: await resolveBaseCommit(coordinationRoot, opsGit),
        expectedStoreRevision: readStoreRevision(),
        exactTargets: [cardPath],
        cardId: cardPath,
        expectedCardSha256: createHash('sha256').update(readFileSync(cardAbsolute)).digest('hex'),
        fromState: from,
        toState: to,
        ...(write === undefined ? {} : { write }),
      };
      await publisher(
        { ...draft, idempotencyKey: reconciliationIdempotencyKey(draft) },
        { authenticatedTaskAction: false },
      );
    };

    // Validate the LIVE card in TS (the faithful port of the retired heredoc's checks) BEFORE minting any
    // intent, then walk it to `done`. The Result block rides the FINAL hop into `done` so `append_section`
    // reproduces the verified bytes exactly once; a `done` card whose Result already matches is the
    // idempotent no-op replay (nothing minted), re-proven from the ops commit by `verifyCanonical` below.
    const located = locateCanonicalCard(coordinationRoot, cardRef);
    if (located.id !== cardRef || located.workflow !== record.runRef) {
      throw new CanonicalResultIntegrationError('canonical managed card identity differs');
    }
    if (located.controller !== 'dashboard') {
      throw new CanonicalResultIntegrationError('canonical managed card controller differs');
    }
    const { offsets, fenced } = canonicalResultStructure(located.body);
    if (fenced) throw new CanonicalResultIntegrationError('canonical card has unbalanced fenced content');
    if (offsets.length > 1) throw new CanonicalResultIntegrationError('canonical card has ambiguous Result sections');
    if (offsets.length === 1) {
      const prefix = located.body.slice(0, offsets[0]).replace(/\s+$/, '');
      const expected = `${prefix}\n\n## Result\n\n${resultBlock}`.replace(/\s+$/, '');
      if (located.body.replace(/\s+$/, '') !== expected) {
        throw new CanonicalResultIntegrationError('canonical card already has a different Result');
      }
    } else if (located.body.split('\n').some((line) => line.trim() === '## Result')) {
      // No STRUCTURAL Result (the only matches are inside a balanced fence), but the `cards` port's
      // `append_section` is not fence-aware and would insert the block under that fenced heading, mangling
      // the card. The retired heredoc appended at end and dodged this; fail closed here rather than commit
      // corrupted bytes. Production managed cards never carry a fenced `## Result`, so this never fires.
      throw new CanonicalResultIntegrationError('canonical card body has a fenced Result heading that would misdirect the append');
    }
    // The Result block rides the final hop ONLY when no structural Result is present yet; when one already
    // matches (a resume that already appended it), the final hop is a pure transition so `append_section`
    // never duplicates the section.
    const finalWrite = offsets.length === 0 ? resultWrite : undefined;
    if (located.state === 'blocked') {
      for (const dep of located.dependsOn) {
        const depPath = join(coordinationRoot, 'queue', 'done', `${dep}.md`);
        if (!existsSync(depPath)
          || String(parseCardFrontmatter(readFileSync(depPath, 'utf8')).meta.state ?? '') !== 'done') {
          throw new CanonicalResultIntegrationError('canonical dependency is not done');
        }
      }
      await publishCardStep('blocked', 'inbox');
      await publishCardStep('inbox', 'working');
      await publishCardStep('working', 'done', finalWrite);
    } else if (located.state === 'inbox') {
      await publishCardStep('inbox', 'working');
      await publishCardStep('working', 'done', finalWrite);
    } else if (located.state === 'working') {
      await publishCardStep('working', 'done', finalWrite);
    } else if (located.state === 'approved') {
      await publishCardStep('approved', 'done', finalWrite);
    } else if (located.state !== 'done') {
      throw new CanonicalResultIntegrationError('canonical managed card cannot legally transition to done');
    }
    await verifyCanonical(record);
    record.state = 'canonical-committed';
    saveState(statePath, state);
    return { status: 'integrated' as const, resultHash: publicResult(record).resultHash,
      durability: 'canonical' as const, attemptBaseCommit: record.attemptBaseCommit, integrationCommit: record.integrationCommit };
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> =>
    withOpsTransaction(() => {
      const next = tail.then(operation, operation);
      tail = next.then(() => undefined, () => undefined);
      return next;
    });

  return {
    async lookup(input) {
      return serialize(async () => {
        const state = readState(statePath);
        const record = state.records.find((item) => item.operationKey === input.operationKey);
        if (!record) return null;
        // TRUE identity mismatch — a different subject, run or stage journaled under this operation key.
        // Nothing can reconcile that, so it stays a hard refusal.
        if (record.subject !== input.subject || record.runRef !== input.runRef || record.stageId !== input.stageId) {
          throw new CanonicalResultIntegrationError(
            `canonical result lookup identity differs: operation '${input.operationKey}' is journaled for `
            + `subject/run/stage '${record.subject}'/'${record.runRef}'/'${record.stageId}'`,
          );
        }
        // Identity MATCHES but an earlier integration was interrupted below canonical. This is not an
        // identity problem and must not be reported as one: resume the record through the same progression
        // `integrate` drives, so a transient failure is retried here instead of parking the stage forever.
        if (record.state !== 'canonical-intent' && record.state !== 'canonical-committed') {
          const stranded = record.state;
          try {
            await advanceIntegration(record, state);
          } catch (error) {
            throw new CanonicalIntegrationIncompleteError(stranded, error);
          }
          // Re-verify after the resume against the DURABLE journal, not the in-memory record: a racing
          // writer that completed the same operation is then the state we return, and a resume that
          // stopped short can never be reported as a canonical result.
          const settled = readState(statePath).records.find((item) => item.operationKey === input.operationKey);
          if (!settled || settled.state !== 'canonical-committed') {
            throw new CanonicalIntegrationIncompleteError(
              settled?.state ?? stranded,
              new CanonicalResultIntegrationError('resumed integration did not reach canonical-committed'),
            );
          }
          await verifyCanonical(settled);
          return publicResult(settled);
        }
        // The coordination push can succeed before its acknowledgement/final verification returns.
        // Re-prove the exact journaled card from one immutable fetched ops commit; only that remotely
        // durable state may promote canonical-intent. Dirty, local-only, unpushed, or different cards fail.
        await verifyCanonical(record);
        if (record.state === 'canonical-intent') {
          record.state = 'canonical-committed';
          saveState(statePath, state);
        }
        return publicResult(record);
      });
    },

    async resolveBase(input) {
      // A stage with no dependencies verifies nothing, touches no coordination checkout and reads no
      // journal, so it stays OUTSIDE the transaction/queue entirely — this is the only path here that
      // never reaches `opsGit`.
      if (input.dependencyStageIds.length === 0) return null;
      // Everything below MUST be serialized exactly like `lookup`/`integrate`: `verifyCanonical` runs
      // coordination git through `opsGit`, and the production runner (`defaultGitRunner`,
      // `createAsyncGitRunner({ requireTransaction: true })`) REJECTS outside `withOpsTransaction`.
      // Without this wrapper every dependent stage crashed at dispatch with "ops git 'fetch' invoked
      // outside withOpsTransaction" — stage 1 always worked because this method only runs when a stage
      // has dependencies. The journal read joins the span too, so it is ordered against concurrent
      // integrations rather than racing a half-written record.
      return serialize(async () => {
        const state = readState(statePath);
        const exact = input.dependencyResultOperationKeys === undefined ? null : new Map(input.dependencyResultOperationKeys.map((item) => [item.stageId, item.operationKey]));
        if (exact && (exact.size !== input.dependencyStageIds.length || input.dependencyStageIds.some((stageId) => !exact.has(stageId)))) {
          throw new CanonicalResultIntegrationError('dependency result identities do not match the dependency graph');
        }
        for (const dependency of input.dependencyStageIds) {
          const record = state.records.find((item) => item.subject === input.subject && item.runRef === input.runRef
            && item.stageId === dependency && item.state === 'canonical-committed'
            && (exact === null || item.operationKey === exact.get(dependency)));
          if (!record) throw new CanonicalResultIntegrationError(`dependency '${dependency}' lacks a committed canonical result`);
          await verifyCanonical(record);
        }
        const lineage = await ensureLineage(input.runRef);
        const commit = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'lineage base resolution');
        if (!SHA.test(commit)) throw new CanonicalResultIntegrationError('lineage base is not immutable');
        return commit;
      });
    },

    async integrate(input) {
      return serialize(async () => {
        if (Object.keys(input).some((key) => !INTEGRATION_INPUT_KEYS.has(key))
          || !input.operationKey || input.operationKey.length > 512 || input.operationKey.includes('\0')
          || !input.subject || input.subject.length > 256 || input.subject.includes('\0')
          || !SAFE_REF.test(input.stageRef) || !SAFE_REF.test(input.attemptRef)
          || !input.summary || input.summary.includes('\0') || redactSensitiveText(input.summary) !== input.summary
          || Buffer.byteLength(input.summary) > 64 * 1024 || !SAFE_REF.test(input.runRef)
          || !SAFE_REF.test(input.stageId) || input.canonicalCardRef !== expectedCardRef(input.operationKey, input.runRef, input.stageId)) {
          throw new CanonicalResultIntegrationError('canonical result input is invalid');
        }
        const iterationOutcome = validatedIterationOutcome(input.iterationOutcome, input.iterationContract);
        const result: CanonicalStageResultPayload & { resultHash: string } = {
          summary: input.summary,
          artifacts: normalizeArtifacts(input.artifacts),
          changed: normalizeArtifacts(input.changed),
          checkpoints: normalizeCheckpoints(input.checkpoints),
          ...(iterationOutcome ? { iterationOutcome } : {}),
          resultHash: input.resultHash,
        };
        if (canonicalStageResultHash(result) !== input.resultHash) throw new CanonicalResultIntegrationError('result hash differs');
        const fingerprintInput = {
          operationKey: input.operationKey, subject: input.subject, runRef: input.runRef,
          stageRef: input.stageRef, stageId: input.stageId, attemptRef: input.attemptRef,
          canonicalCardRef: input.canonicalCardRef,
          ...(iterationOutcome ? { iterationContract: structuredClone(input.iterationContract as IterationOutcomeContract) } : {}),
          result,
        };
        const fingerprint = hash(fingerprintInput);
        const state = readState(statePath);
        let record = state.records.find((item) => item.operationKey === input.operationKey);
        if (record) {
          let expectedFingerprint = fingerprint;
          if (decodeLegacyCanonicalJournalRecord(record)) {
            throw new CanonicalResultIntegrationError('result replay payload differs');
          }
          if (!Object.prototype.hasOwnProperty.call(record, 'iterationContract')
            && record.result.resultHash === legacyNonIterationJournalResultHash(record.result)) {
            const legacyFingerprintInput: Record<string, unknown> = { ...fingerprintInput };
            expectedFingerprint = hash({
              ...legacyFingerprintInput,
              result: {
                ...result,
                resultHash: legacyNonIterationJournalResultHash(result),
              },
            });
          }
          if (record.fingerprint !== expectedFingerprint) {
            throw new CanonicalResultIntegrationError('result replay payload differs');
          }
        }
        if (record?.state === 'canonical-committed') {
          await verifyCanonical(record);
          return { status: 'replayed' as const, resultHash: publicResult(record).resultHash,
            durability: 'canonical' as const, attemptBaseCommit: record.attemptBaseCommit, integrationCommit: record.integrationCommit as string };
        }
        if (!record) {
          const attemptPath = absolute(input.worktreePath, 'worktreePath');
          const expectedAttemptPath = planAttemptWorktreePath(worktreeRoot, input.runRef, input.attemptRef);
          if (attemptPath !== expectedAttemptPath || !childOf(worktreeRoot, attemptPath) || !existsSync(attemptPath)) {
            throw new CanonicalResultIntegrationError('attempt worktree differs from the server-owned layout');
          }
          await verifyRepoWorktree(attemptPath, 'attempt worktree');
          const staged = await gitRun(['diff', '--cached', '--name-only', '-z'], attemptPath, 'attempt index inspection');
          if (staged) throw new CanonicalResultIntegrationError('attempt worktree index is dirty');
           const status = await gitRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], attemptPath);
          if (status.exitCode !== 0) throw new CanonicalResultIntegrationError('attempt status failed');
          const paths = statusPaths(status.stdout);
          if (JSON.stringify(paths) !== JSON.stringify(result.changed.map((item) => item.path))) {
            throw new CanonicalResultIntegrationError('attempt changes differ from server inspection');
          }
          for (const item of result.changed) {
            const content = readRegularFileWithin(attemptPath, item.path);
            if (createHash('sha256').update(content).digest('hex') !== item.digest) {
              throw new CanonicalResultIntegrationError(`artifact digest changed for '${item.path}'`);
            }
          }
          const lineage = await ensureLineage(input.runRef);
          const attemptBaseCommit = await gitRun(['rev-parse', 'HEAD'], attemptPath, 'attempt base resolution');
          const integrationBaseCommit = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'integration base resolution');
          if (!SHA.test(attemptBaseCommit) || !SHA.test(integrationBaseCommit)) {
            throw new CanonicalResultIntegrationError('integration bases must be immutable');
          }
          record = {
            operationKey: input.operationKey, fingerprint, subject: input.subject, runRef: input.runRef,
            stageId: input.stageId, attemptRef: input.attemptRef, cardRef: input.canonicalCardRef, integrationBranch: lineage.branch,
            ...(iterationOutcome ? { iterationContract: structuredClone(input.iterationContract as IterationOutcomeContract) } : {}),
            attemptBaseCommit, attemptCommit: null, integrationBaseCommit, integrationCommit: null, result, state: 'intent',
          };
          state.records.push(record);
          saveState(statePath, state);
        }

        return advanceIntegration(record, state);
      });
    },
  };
}
