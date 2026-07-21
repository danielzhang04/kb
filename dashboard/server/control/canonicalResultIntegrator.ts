import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import { defaultGitRunner, prepareCoordination, type GitRunner } from '../write/branch.ts';
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { CanonicalStageResult, ResultIntegrator, WorkerArtifactResult } from './execution.ts';
import { canonicalStageResultHash, planAttemptWorktreePath } from './execution.ts';
import { createLocalGitCommandRunner, type GitCommandRunner } from './adapters.ts';
import { isSafeRepoRelativePath } from './proposal.ts';

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;

export class CanonicalResultIntegrationError extends Error {}

interface IntegrationRecord {
  operationKey: string;
  fingerprint: string;
  subject: string;
  runRef: string;
  stageId: string;
  attemptRef: string;
  cardRef: string;
  integrationBranch: string;
  attemptBaseCommit: string;
  attemptCommit: string | null;
  integrationBaseCommit: string;
  integrationCommit: string | null;
  result: CanonicalStageResult;
  state: 'intent' | 'attempt-committed' | 'lineage-local' | 'lineage-committed' | 'canonical-intent' | 'canonical-committed';
}

interface IntegrationState {
  schema: 'kb.canonical-integration/v1';
  records: IntegrationRecord[];
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
}

export const CANONICAL_RESULT_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

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
if "## Result" in card.body:
    if card.body.rstrip() != (card.body.split("## Result", 1)[0].rstrip() + "\\n\\n" + block).rstrip():
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
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
path = Path("queue/done") / (op["cardRef"] + ".md")
if not path.is_file():
    raise cards.ValidationError("committed canonical result card is missing")
card = cards.parse(path)
if card.meta.get("id") != op["cardRef"] or card.meta.get("workflow") != op["runRef"]:
    raise cards.ValidationError("committed canonical result identity differs")
if card.meta.get("execution-controller") != "dashboard" or card.meta.get("state") != "done":
    raise cards.ValidationError("committed canonical result controller or state differs")
marker = "\`\`\`kb.canonical-stage-result/v1\\n"
if card.body.count("## Result") != 1 or card.body.count(marker) != 1:
    raise cards.ValidationError("committed canonical Result section is missing or ambiguous")
start = card.body.index(marker) + len(marker)
end = card.body.find("\\n\`\`\`", start)
if end < 0:
    raise cards.ValidationError("committed canonical Result fence is incomplete")
wire = json.loads(card.body[start:end])
if wire != op["result"]:
    raise cards.ValidationError("committed canonical Result payload differs")
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
  const stages = new Set<string>();
  for (const record of value.records) {
    const stageKey = `${record.subject}\0${record.runRef}\0${record.stageId}`;
    const branch = `codex/managed-${createHash('sha256').update(record.runRef ?? '').digest('hex').slice(0, 24)}`;
    if (typeof record.operationKey !== 'string' || record.operationKey.length === 0 || record.operationKey.length > 512
      || typeof record.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint)
      || typeof record.subject !== 'string' || record.subject.length === 0 || record.subject.length > 256
      || !SAFE_REF.test(record.runRef) || !SAFE_REF.test(record.stageId) || !SAFE_REF.test(record.attemptRef)
      || record.cardRef !== workflowCardId(record.runRef, record.stageId) || record.integrationBranch !== branch
      || !SHA.test(record.attemptBaseCommit) || (record.attemptCommit !== null && !SHA.test(record.attemptCommit))
      || !SHA.test(record.integrationBaseCommit) || (record.integrationCommit !== null && !SHA.test(record.integrationCommit))
      || !['intent', 'attempt-committed', 'lineage-local', 'lineage-committed', 'canonical-intent', 'canonical-committed'].includes(record.state)
      || (record.state === 'attempt-committed' && record.attemptCommit === null)
      || (['lineage-local', 'lineage-committed', 'canonical-intent', 'canonical-committed'].includes(record.state) && record.integrationCommit === null)
      || !record.result || typeof record.result.summary !== 'string' || !Array.isArray(record.result.artifacts)
      || !Array.isArray(record.result.changed) || !Array.isArray(record.result.checkpoints)
      || !/^[a-f0-9]{64}$/.test(record.result.resultHash)
      || canonicalStageResultHash(record.result) !== record.result.resultHash
      || operations.has(record.operationKey) || stages.has(stageKey)) {
      throw new CanonicalResultIntegrationError('canonical integration state is invalid');
    }
    normalizeArtifacts(record.result.artifacts);
    normalizeArtifacts(record.result.changed);
    normalizeCheckpoints(record.result.checkpoints);
    operations.add(record.operationKey);
    stages.add(stageKey);
  }
  return value;
}

function saveState(path: string, state: IntegrationState): void {
  const encoded = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) throw new CanonicalResultIntegrationError('canonical integration state exceeds its bound');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
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
  const gitPrefix = [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
    '-c', `core.hooksPath=${hooksPath}`, '-c', 'commit.gpgsign=false', '--literal-pathspecs',
  ];
  const coordinationHooksPath = join(stateRoot, 'control', '.disabled-hooks');
  mkdirSync(coordinationHooksPath, { recursive: true, mode: 0o700 });
  const coordinationPrefix = [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
    '-c', `core.hooksPath=${coordinationHooksPath}`, '-c', 'commit.gpgsign=false', '--literal-pathspecs',
  ];
  const opsGit: GitRunner = (cwd, args) => rawOpsGit(cwd, [...coordinationPrefix, ...args]);
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
    await prepareCoordination(coordinationRoot, opsGit);
    const path = `queue/done/${record.cardRef}.md`;
    const current = readFileSync(join(coordinationRoot, ...path.split('/')), 'utf8').replace(/\r\n?/g, '\n');
    const committed = (await opsGit(coordinationRoot, ['show', `HEAD:${path}`])).replace(/\r\n?/g, '\n');
    if (current !== committed) {
      throw new CanonicalResultIntegrationError('committed canonical card no longer matches the integrated result');
    }
    const wire = {
      ...record.result, integrationCommit: record.integrationCommit, runRef: record.runRef,
      stageId: record.stageId, attemptRef: record.attemptRef,
    };
    const verified = runPy(coordinationRoot, CANONICAL_RESULT_VERIFY_SCRIPT, JSON.stringify({
      cardRef: record.cardRef, runRef: record.runRef, result: wire,
    }));
    if (verified.exitCode !== 0) {
      throw new CanonicalResultIntegrationError(verified.stderr.trim() || verified.stdout.trim() || 'canonical Result verification failed');
    }
  };
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  return {
    async lookup(input) {
      const state = readState(statePath);
      const record = state.records.find((item) => item.operationKey === input.operationKey
        || (item.subject === input.subject && item.runRef === input.runRef && item.stageId === input.stageId));
      if (!record) return null;
      if (record.operationKey !== input.operationKey || record.subject !== input.subject || record.runRef !== input.runRef
        || record.stageId !== input.stageId || record.state !== 'canonical-committed') {
        throw new CanonicalResultIntegrationError('canonical result lookup identity differs');
      }
      await verifyCanonical(record);
      return structuredClone(record.result);
    },

    async resolveBase(input) {
      if (input.dependencyStageIds.length === 0) return null;
      const state = readState(statePath);
      for (const dependency of input.dependencyStageIds) {
        const record = state.records.find((item) => item.subject === input.subject && item.runRef === input.runRef
          && item.stageId === dependency && item.state === 'canonical-committed');
        if (!record) throw new CanonicalResultIntegrationError(`dependency '${dependency}' lacks a committed canonical result`);
        await verifyCanonical(record);
      }
      const lineage = await ensureLineage(input.runRef);
      const commit = await gitRun(['rev-parse', 'HEAD'], lineage.path, 'lineage base resolution');
      if (!SHA.test(commit)) throw new CanonicalResultIntegrationError('lineage base is not immutable');
      return commit;
    },

    async integrate(input) {
      return serialize(async () => {
        if (!input.operationKey || input.operationKey.length > 512 || input.operationKey.includes('\0')
          || !input.subject || input.subject.length > 256 || input.subject.includes('\0')
          || !SAFE_REF.test(input.stageRef) || !SAFE_REF.test(input.attemptRef)
          || !input.summary || input.summary.includes('\0') || redactSensitiveText(input.summary) !== input.summary
          || Buffer.byteLength(input.summary) > 64 * 1024 || !SAFE_REF.test(input.runRef)
          || !SAFE_REF.test(input.stageId) || input.canonicalCardRef !== workflowCardId(input.runRef, input.stageId)) {
          throw new CanonicalResultIntegrationError('canonical result input is invalid');
        }
        const result: CanonicalStageResult = {
          summary: input.summary,
          artifacts: normalizeArtifacts(input.artifacts),
          changed: normalizeArtifacts(input.changed),
          checkpoints: normalizeCheckpoints(input.checkpoints),
          resultHash: input.resultHash,
        };
        if (canonicalStageResultHash(result) !== input.resultHash) throw new CanonicalResultIntegrationError('result hash differs');
        const fingerprint = hash({
          operationKey: input.operationKey, subject: input.subject, runRef: input.runRef,
          stageRef: input.stageRef, stageId: input.stageId, attemptRef: input.attemptRef,
          canonicalCardRef: input.canonicalCardRef, result,
        });
        const state = readState(statePath);
        let record = state.records.find((item) => item.operationKey === input.operationKey
          || (item.subject === input.subject && item.runRef === input.runRef && item.stageId === input.stageId));
        if (record && record.fingerprint !== fingerprint) throw new CanonicalResultIntegrationError('result replay payload differs');
        if (record?.state === 'canonical-committed') {
          await verifyCanonical(record);
          return { status: 'replayed' as const, resultHash: record.result.resultHash };
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
            attemptBaseCommit, attemptCommit: null, integrationBaseCommit, integrationCommit: null, result, state: 'intent',
          };
          state.records.push(record);
          saveState(statePath, state);
        }

        if (record.state === 'intent' || record.state === 'attempt-committed') {
          const attemptPath = absolute(input.worktreePath, 'worktreePath');
          const expectedAttemptPath = planAttemptWorktreePath(worktreeRoot, input.runRef, input.attemptRef);
          if (attemptPath !== expectedAttemptPath || !childOf(worktreeRoot, attemptPath) || !existsSync(attemptPath)) {
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
            const lineage = await ensureLineage(input.runRef);
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
          const lineage = await ensureLineage(input.runRef);
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
        const wire = { ...record.result, integrationCommit: record.integrationCommit, runRef: input.runRef, stageId: input.stageId, attemptRef: input.attemptRef };
        const encoded = JSON.stringify({ runRef: input.runRef, cardRef: input.canonicalCardRef, result: wire });
        if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) throw new CanonicalResultIntegrationError('canonical card result exceeds its bound');
        const card = runPy(coordinationRoot, CANONICAL_RESULT_CARD_SCRIPT, encoded);
        if (card.exitCode !== 0) throw new CanonicalResultIntegrationError(card.stderr.trim() || card.stdout.trim() || 'canonical card mutation failed');
        const parsed = JSON.parse(card.stdout.trim()) as { oldPath: string; resultPath: string; changed: boolean };
        const resultPath = `queue/done/${input.canonicalCardRef}.md`;
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
            'commit', '-m', `chore(queue): integrate managed result ${input.canonicalCardRef}`, '--only', '--', ...changedPaths,
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
        return { status: 'integrated' as const, resultHash: input.resultHash };
      });
    },
  };
}
