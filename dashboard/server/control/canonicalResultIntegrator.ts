import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { renameWithRetrySync } from '../atomicRename.ts';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import { defaultGitRunner, prepareCoordination, type GitRunner } from '../write/branch.ts';
import { resolveCheckedOutBranch, withOpsTransaction } from '../write/asyncGit.ts';
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { CanonicalStageResult, CanonicalStageResultPayload, ResultIntegrator, WorkerArtifactResult } from './execution.ts';
import { canonicalResultOperationKey, canonicalStageResultHash, iterationResultOperationKey, planAttemptWorktreePath } from './execution.ts';
import { createLocalGitCommandRunner, type GitCommandRunner } from './adapters.ts';
import { isSafeRepoRelativePath } from './proposal.ts';
import {
  parseIterationOutcome,
  parseReviewOutcome,
  type IterationOutcome,
  type IterationOutcomeContract,
  type ReviewContract,
  type ReviewOutcome,
} from './reviewOutcome.ts';

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
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
  /** Absent only on legacy non-review v1 records written before review contracts were journaled. */
  reviewContract?: ReviewContract | null;
  /** Present only on generic iteration operations written after the Task-6 cutover. */
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

export const CANONICAL_RESULT_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

${CANONICAL_RESULT_HEADING_HELPER}

op = json.loads(sys.argv[1])
card_id = op["cardRef"]
candidates = [
    Path("queue/inbox") / (card_id + ".md"),
    Path("queue/working") / (card_id + ".md"),
    Path("queue/approvals") / (card_id + ".md"),
    Path("queue/done") / (card_id + ".md"),
]
found = [path for path in candidates if path.is_file()]
if len(found) != 1:
    raise cards.ValidationError("canonical managed card path is missing or ambiguous")
source = found[0]
card = cards.parse(source)
if card.meta.get("id") != card_id or card.meta.get("workflow") != op["runRef"]:
    raise cards.ValidationError("canonical managed card identity differs")
if card.meta.get("execution-controller") != "dashboard":
    raise cards.ValidationError("canonical managed card controller differs")

wire = json.dumps(op["result"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
block = "## Result\\n\\n\`\`\`kb.canonical-stage-result/v1\\n" + wire + "\\n\`\`\`\\n"
headings, fenced = canonical_result_structure(card.body)
if fenced:
    raise cards.ValidationError("canonical card has unbalanced fenced content")
if len(headings) > 1:
    raise cards.ValidationError("canonical card has ambiguous Result sections")
if headings:
    prefix = card.body[:headings[0]].rstrip()
    if card.body.rstrip() != (prefix + "\\n\\n" + block).rstrip():
        raise cards.ValidationError("canonical card already has a different Result")
else:
    card.body = card.body.rstrip() + "\\n\\n" + block

old_path = source
changed = card.meta.get("state") != "done" or cards.parse(source).body != card.body
if card.meta.get("state") == "blocked":
    for dep in card.meta.get("depends-on") or []:
        dep_path = Path("queue/done") / (dep + ".md")
        if not dep_path.is_file() or cards.parse(dep_path).meta.get("state") != "done":
            raise cards.ValidationError("canonical dependency is not done")
    cards.transition(card, "inbox", Path("queue"))
if card.meta.get("state") == "inbox":
    cards.transition(card, "working", Path("queue"))
if card.meta.get("state") == "working":
    result_path = cards.transition(card, "done", Path("queue"))
elif card.meta.get("state") == "approved":
    result_path = cards.transition(card, "done", Path("queue"))
elif card.meta.get("state") == "done":
    cards.save(card, Path("queue"))
    result_path = Path("queue/done") / (card_id + ".md")
else:
    raise cards.ValidationError("canonical managed card cannot legally transition to done")
print(json.dumps({"oldPath": str(old_path), "resultPath": str(result_path), "changed": changed}))
`.trim();

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

/** g1 owns the immutable stage card; later review generations remain durable in the journal/lineage only. */
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
  const raw = record.result;
  const result = raw.reviewOutcome && record.reviewContract
    ? (() => {
        const { reviewOutcome, ...plain } = raw;
        return { ...plain, iterationOutcome: legacyReviewIterationOutcome(reviewOutcome) };
      })()
    : raw;
  return structuredClone({
    ...result,
    durability: 'canonical',
    attemptBaseCommit: record.attemptBaseCommit,
    integrationCommit: record.integrationCommit,
  });
}

function legacyReviewIterationOutcome(outcome: ReviewOutcome): IterationOutcome {
  return {
    schema: 'kb.iteration-outcome/v1', requestRef: 'legacy-review-request', iterationLoopRef: 'legacy-review-loop',
    participantId: 'legacy-reviewer', cycle: 1, verdict: outcome.decision,
    inputGenerationRefs: ['legacy-generation'], criteria: structuredClone(outcome.criteria),
    findings: outcome.findings.map((finding) => ({
      findingId: finding.id, criterionId: finding.criterionId, severity: finding.severity,
      summary: finding.summary, evidencePaths: [...finding.evidencePaths],
    })),
    positions: [], recordedDissent: [], summary: outcome.summary,
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

function validatedReviewOutcome(value: unknown, contract: unknown): ReviewOutcome | undefined {
  if (value === undefined) {
    if (contract !== null && contract !== undefined) throw new CanonicalResultIntegrationError('canonical result has a review contract without an outcome');
    return undefined;
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new CanonicalResultIntegrationError('canonical review outcome lacks an immutable review contract');
  }
  try {
    const parsed = parseReviewOutcome(JSON.stringify(value), contract as ReviewContract);
    if (!parsed.ok) throw new CanonicalResultIntegrationError(parsed.detail);
    return parsed.value;
  } catch (error) {
    if (error instanceof CanonicalResultIntegrationError) throw error;
    throw new CanonicalResultIntegrationError('canonical review outcome is invalid');
  }
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
    const hasReviewContract = Object.prototype.hasOwnProperty.call(record, 'reviewContract');
    const hasIterationContract = Object.prototype.hasOwnProperty.call(record, 'iterationContract');
    const hasIterationOutcome = Object.prototype.hasOwnProperty.call(record.result ?? {}, 'iterationOutcome');
    if ((hasIterationContract && (!record.iterationContract || !hasIterationOutcome || hasReviewContract
      || Object.prototype.hasOwnProperty.call(record.result ?? {}, 'reviewOutcome')))
      || (!hasIterationContract && hasIterationOutcome)) {
      throw new CanonicalResultIntegrationError('canonical integration mixes generic and legacy iteration fields');
    }
    // reviewContract was added to the v1 journal after non-review results were already durable.
    // Preserve that legacy wire shape because its omission is part of the immutable fingerprint.
    if (!hasReviewContract && record.result && typeof record.result === 'object'
      && Object.prototype.hasOwnProperty.call(record.result, 'reviewOutcome')) {
      throw new CanonicalResultIntegrationError('canonical integration review contract is absent');
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
      || canonicalStageResultHash(
        record.result,
        hasIterationContract || hasReviewContract ? 'current' : 'legacy-non-review',
      ) !== record.result.resultHash
      || operations.has(record.operationKey)) {
      throw new CanonicalResultIntegrationError('canonical integration state is invalid');
    }
    if (hasIterationContract) validatedIterationOutcome(record.result.iterationOutcome, record.iterationContract);
    else validatedReviewOutcome(record.result.reviewOutcome, hasReviewContract ? record.reviewContract : undefined);
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
  const hooksPath = join(worktreeRoot, '.disabled-hooks');
  mkdirSync(hooksPath, { recursive: true, mode: 0o700 });
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
    await opsGit(coordinationRoot, [
      'fetch', '--no-tags', 'origin', 'refs/heads/ops:refs/remotes/origin/ops',
    ]);
    const publishedCommit = (await opsGit(
      coordinationRoot, ['rev-parse', '--verify', 'refs/remotes/origin/ops^{commit}'],
    )).trim();
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
      return { status: 'replayed', resultHash: record.result.resultHash,
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
      await prepareCoordination(coordinationRoot, opsGit);
      const dirty = await opsGit(coordinationRoot, ['diff', '--cached', '--name-only', '-z']);
      if (dirty) throw new CanonicalResultIntegrationError('coordination index is dirty');
      record.state = 'canonical-intent';
      saveState(statePath, state);
    }
    if (record.state !== 'canonical-intent') {
      throw new CanonicalResultIntegrationError('canonical integration phase is invalid');
    }
    const branch = (await opsGit(coordinationRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch !== 'ops') throw new CanonicalResultIntegrationError('canonical coordination checkout differs');
    if (!record.integrationCommit) throw new CanonicalResultIntegrationError('integration commit is unavailable');
    const wire = canonicalWire(record);
    const encoded = JSON.stringify({ runRef: record.runRef, cardRef: record.cardRef, result: wire });
    if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) throw new CanonicalResultIntegrationError('canonical card result exceeds its bound');
    const card = runPy(coordinationRoot, CANONICAL_RESULT_CARD_SCRIPT, encoded);
    if (card.exitCode !== 0) throw new CanonicalResultIntegrationError(card.stderr.trim() || card.stdout.trim() || 'canonical card mutation failed');
    const parsed = JSON.parse(card.stdout.trim()) as { oldPath: string; resultPath: string; changed: boolean };
    const resultPath = `queue/done/${record.cardRef}.md`;
    if (parsed.resultPath.replace(/\\/g, '/') !== resultPath || typeof parsed.changed !== 'boolean') {
      throw new CanonicalResultIntegrationError('canonical card mutation returned a mismatched result');
    }
    const oldPath = parsed.oldPath.replace(/\\/g, '/');
    const allowed = new Set([
      `queue/inbox/${record.cardRef}.md`, `queue/working/${record.cardRef}.md`,
      `queue/approvals/${record.cardRef}.md`, resultPath,
    ]);
    const stagedPaths = nulPaths(await opsGit(coordinationRoot, ['diff', '--cached', '--name-only', '-z']));
    const trackedPaths = nulPaths(await opsGit(coordinationRoot, ['diff', '--name-only', '-z']));
    const untrackedPaths = nulPaths(await opsGit(coordinationRoot, ['ls-files', '--others', '--exclude-standard', '-z']));
    const changedPaths = [...new Set([...stagedPaths, ...trackedPaths, ...untrackedPaths])].sort();
    if (changedPaths.some((path) => !allowed.has(path)) || (parsed.changed && !changedPaths.includes(resultPath))
      || (!allowed.has(oldPath) && oldPath !== resultPath)) {
      throw new CanonicalResultIntegrationError('canonical recovery contains unrelated coordination changes');
    }
    if (changedPaths.length > 0) {
      await opsGit(coordinationRoot, ['add', '--', ...changedPaths]);
      await opsGit(coordinationRoot, [
        'commit', '-m', `chore(queue): integrate managed result ${record.cardRef}`, '--only', '--', ...changedPaths,
      ]);
    }
    try {
      await opsGit(coordinationRoot, ['push', 'origin', 'ops']);
    } catch (pushError) {
      try {
        await opsGit(coordinationRoot, ['pull', '--rebase', 'origin', 'ops']);
      } catch (reconcileError) {
        try { await opsGit(coordinationRoot, ['rebase', '--abort']); } catch { /* no rebase was active */ }
        throw new CanonicalResultIntegrationError(
          `canonical publication reconciliation failed: ${reconcileError instanceof Error ? reconcileError.message : String(reconcileError)}`,
        );
      }
      const reconciled = runPy(coordinationRoot, CANONICAL_RESULT_VERIFY_SCRIPT, JSON.stringify({
        cardRef: record.cardRef, runRef: record.runRef, result: wire,
      }));
      if (reconciled.exitCode !== 0) {
        throw new CanonicalResultIntegrationError(
          reconciled.stderr.trim() || reconciled.stdout.trim() || 'reconciled canonical Result differs',
        );
      }
      try {
        await opsGit(coordinationRoot, ['push', 'origin', 'ops']);
      } catch {
        throw pushError;
      }
    }
    await verifyCanonical(record);
    record.state = 'canonical-committed';
    saveState(statePath, state);
    return { status: 'integrated' as const, resultHash: record.result.resultHash,
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
        if (!input.operationKey || input.operationKey.length > 512 || input.operationKey.includes('\0')
          || !input.subject || input.subject.length > 256 || input.subject.includes('\0')
          || !SAFE_REF.test(input.stageRef) || !SAFE_REF.test(input.attemptRef)
          || !input.summary || input.summary.includes('\0') || redactSensitiveText(input.summary) !== input.summary
          || Buffer.byteLength(input.summary) > 64 * 1024 || !SAFE_REF.test(input.runRef)
          || !SAFE_REF.test(input.stageId) || input.canonicalCardRef !== expectedCardRef(input.operationKey, input.runRef, input.stageId)) {
          throw new CanonicalResultIntegrationError('canonical result input is invalid');
        }
        if ((input.iterationOutcome !== undefined || input.iterationContract !== undefined)
          && (input.reviewOutcome !== undefined || input.reviewContract !== undefined)) {
          throw new CanonicalResultIntegrationError('canonical result mixes generic and legacy iteration fields');
        }
        const iterationOutcome = validatedIterationOutcome(input.iterationOutcome, input.iterationContract);
        const reviewOutcome = validatedReviewOutcome(input.reviewOutcome, input.reviewContract);
        const result: CanonicalStageResultPayload & { resultHash: string } = {
          summary: input.summary,
          artifacts: normalizeArtifacts(input.artifacts),
          changed: normalizeArtifacts(input.changed),
          checkpoints: normalizeCheckpoints(input.checkpoints),
          ...(iterationOutcome ? { iterationOutcome } : {}),
          ...(reviewOutcome ? { reviewOutcome } : {}),
          resultHash: input.resultHash,
        };
        if (canonicalStageResultHash(result) !== input.resultHash) throw new CanonicalResultIntegrationError('result hash differs');
        const fingerprintInput = {
          operationKey: input.operationKey, subject: input.subject, runRef: input.runRef,
          stageRef: input.stageRef, stageId: input.stageId, attemptRef: input.attemptRef,
          canonicalCardRef: input.canonicalCardRef,
          ...(iterationOutcome
            ? { iterationContract: structuredClone(input.iterationContract as IterationOutcomeContract) }
            : { reviewContract: reviewOutcome ? structuredClone(input.reviewContract as ReviewContract) : null }),
          result,
        };
        const fingerprint = hash(fingerprintInput);
        const state = readState(statePath);
        let record = state.records.find((item) => item.operationKey === input.operationKey);
        if (record) {
          let expectedFingerprint = fingerprint;
          if (!Object.prototype.hasOwnProperty.call(record, 'reviewContract')
            && !Object.prototype.hasOwnProperty.call(record, 'iterationContract')) {
            const legacyFingerprintInput: Record<string, unknown> = { ...fingerprintInput };
            delete legacyFingerprintInput.reviewContract;
            expectedFingerprint = hash({
              ...legacyFingerprintInput,
              result: {
                ...result,
                resultHash: canonicalStageResultHash(result, 'legacy-non-review'),
              },
            });
          }
          if (record.fingerprint !== expectedFingerprint) {
            throw new CanonicalResultIntegrationError('result replay payload differs');
          }
        }
        if (record?.state === 'canonical-committed') {
          await verifyCanonical(record);
          return { status: 'replayed' as const, resultHash: record.result.resultHash,
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
            ...(iterationOutcome
              ? { iterationContract: structuredClone(input.iterationContract as IterationOutcomeContract) }
              : { reviewContract: reviewOutcome ? structuredClone(input.reviewContract as ReviewContract) : null }),
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
