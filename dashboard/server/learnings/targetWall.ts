/**
 * P4 §3.2 — the Implementer TARGET wall and the P4-C22 kind filter.
 *
 * The wall REUSES `scripts/agent_maintainer.py#validate_target_path` by EXECUTION, not by copying or
 * loading its source: a fixed Python module entry is invoked through the injected bounded process
 * runner with `{repoRoot,target}` on JSON stdin, and only the normalized JSON stdout is accepted.
 * Target text is never interpolated into Python source, an argv token, or a shell command — there is
 * no shell (`shell:false`), and the entry string below is a constant.
 *
 * After the Python wall answers, TS performs the durable-classifier and filesystem checks the design
 * requires: `classifyTarget(target) === 'durable'`, exactly one `agents/<name>.md` or
 * `routines/roles/<name>.md`, the file exists, is a regular file, and is not a symlink/reparse point.
 * `memory/<name>.md` stays legal agent-maintainer evidence but is coordination and can never enter a
 * durable PR, so it is refused here.
 *
 * This module holds NO git, write, or credential capability: its only effect is the read-only Python
 * probe and an `lstat`, both injected.
 */
import { resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { classifyTarget } from '../write/branch.ts';
import { isImplementerTargetPath, learningBatchId, isCommitSha, ContractDecodeError } from '../write/durableManifest.ts';
import {
  IMPLEMENTABLE_PROPOSAL_KINDS, PROPOSAL_CANDIDATE_CAP, proposalRecordRelpath, type ProposalRecord,
} from './contracts.ts';

/**
 * The fixed module entry. A constant: no target, repo root, or caller string is ever embedded.
 *
 * `validate_target_path(target_path, repo_root)` RAISES `TargetWallError` on refusal and RETURNS the
 * canonical posix path on success — so the entry converts both halves of that contract onto the wire:
 * a refusal becomes `{ok:false,code:'python-wall-rejected',detail}` and a pass becomes `{ok:true,
 * normalized:<the function's own return>}`. The TS side then compares `normalized` against what it
 * asked about, which is a real check only because the value comes from Python, never echoed from input.
 */
export const AGENT_MAINTAINER_WALL_ENTRY = [
  'import json,sys',
  'from scripts.agent_maintainer import validate_target_path',
  'req=json.load(sys.stdin)',
  'try:',
  '    normalized=validate_target_path(req["target"],req["repoRoot"])',
  'except Exception as error:',
  '    sys.stdout.write(json.dumps({"ok":False,"code":"python-wall-rejected","detail":str(error)[:200]}))',
  'else:',
  '    sys.stdout.write(json.dumps({"ok":True,"normalized":normalized}))',
].join('\n');

export const WALL_TIMEOUT_MS = 15_000;
export const WALL_MAX_STDOUT_BYTES = 1024 * 1024;
export const WALL_MAX_STDERR_BYTES = 64 * 1024;

export interface BoundedProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly shell: false;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

/** Runs one bounded child and resolves its stdout. Injected; this module never spawns anything. */
export type BoundedProcessRunner = (request: BoundedProcessRequest) => Promise<string>;

export interface PathFacts {
  readonly exists: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface TargetWallPorts {
  readonly runPython: BoundedProcessRunner;
  readonly lstatPath: (absolute: string) => Promise<PathFacts>;
}

export type WallRejection =
  | 'not-implementer-target'
  | 'not-durable'
  | 'python-wall-rejected'
  | 'python-output-invalid'
  | 'missing'
  | 'symlink';

export type WallResult = { ok: true; target: string } | { ok: false; reason: WallRejection };

/** `py -3 -c <entry>` on Windows, `python3 -c <same entry>` elsewhere. Never a shell string. */
export function pythonWallInvocation(platform: NodeJS.Platform | string = process.platform): {
  command: string; args: readonly string[];
} {
  return platform === 'win32'
    ? { command: 'py', args: ['-3', '-c', AGENT_MAINTAINER_WALL_ENTRY] }
    : { command: 'python3', args: ['-c', AGENT_MAINTAINER_WALL_ENTRY] };
}

/** The real filesystem port. `lstat` (never `stat`) so a symlink/reparse point is seen as itself. */
export const defaultLstatPath = async (absolute: string): Promise<PathFacts> => {
  try {
    const stats = await lstat(absolute);
    return { exists: true, isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink() };
  } catch {
    return { exists: false, isFile: false, isSymbolicLink: false };
  }
};

/**
 * Validate one Implementer target. Structural rejection happens BEFORE the Python probe, so a
 * traversal/absolute/nested path never reaches a subprocess at all.
 */
export async function validateImplementerTarget(
  repoRoot: string,
  target: string,
  ports: TargetWallPorts,
): Promise<WallResult> {
  // Classification first: `memory/<name>.md` is legal agent-maintainer evidence but is COORDINATION and
  // can never enter a durable PR, so it is reported as such rather than as a shape failure.
  if (classifyTarget(target) !== 'durable') return { ok: false, reason: 'not-durable' };
  if (!isImplementerTargetPath(target)) return { ok: false, reason: 'not-implementer-target' };

  const invocation = pythonWallInvocation();
  let stdout: string;
  try {
    stdout = await ports.runPython({
      command: invocation.command,
      args: invocation.args,
      cwd: repoRoot,
      stdin: JSON.stringify({ repoRoot, target }),
      shell: false,
      timeoutMs: WALL_TIMEOUT_MS,
      maxStdoutBytes: WALL_MAX_STDOUT_BYTES,
      maxStderrBytes: WALL_MAX_STDERR_BYTES,
    });
  } catch {
    return { ok: false, reason: 'python-output-invalid' };
  }

  let decoded: unknown;
  try { decoded = JSON.parse(stdout); } catch { return { ok: false, reason: 'python-output-invalid' }; }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { ok: false, reason: 'python-output-invalid' };
  }
  const wire = decoded as Record<string, unknown>;
  if (typeof wire['ok'] !== 'boolean') return { ok: false, reason: 'python-output-invalid' };
  // A refusal must carry the wall's own code; any other `ok:false` shape is an output the entry could
  // not have produced, so it is invalid rather than a clean rejection.
  if (wire['ok'] === false) {
    return { ok: false, reason: wire['code'] === 'python-wall-rejected' ? 'python-wall-rejected' : 'python-output-invalid' };
  }
  // `normalized` is Python's canonical RETURN. Comparing it to the requested target is a real check:
  // a renormalization (case, separator, shape) means TS and the wall do not agree on what was validated.
  if (typeof wire['normalized'] !== 'string' || wire['normalized'] !== target) {
    return { ok: false, reason: 'python-output-invalid' };
  }

  const facts = await ports.lstatPath(resolve(repoRoot, target));
  if (facts.isSymbolicLink) return { ok: false, reason: 'symlink' };
  if (!facts.exists || !facts.isFile) return { ok: false, reason: 'missing' };
  return { ok: true, target };
}

export type SkipReason = WallRejection | 'records-only-kind' | 'not-proposed';

export interface SkippedRecord {
  readonly id: string;
  readonly reason: SkipReason;
}

export interface BatchedRecord {
  readonly record: ProposalRecord;
  readonly targetPath: string;
  readonly recordPath: string;
}

/** The validated batch: exactly one PR, one `batch-id`, one `implemented-at` (§3.2). */
export interface LearningBatch {
  readonly batchId: string;
  readonly baseCommit: string;
  readonly implementedAt: string;
  readonly records: readonly BatchedRecord[];
  readonly targetPaths: readonly string[];
  readonly recordPaths: readonly string[];
  readonly relpaths: readonly string[];
}

export type BatchSelection =
  | { ok: true; batch: LearningBatch | null; skipped: readonly SkippedRecord[] }
  | { ok: false; reason: 'conflicting-targets' | 'batch-cap-exceeded'; detail: string };

export interface BatchSelectionOptions {
  readonly repoRoot: string;
  readonly baseCommit: string;
  readonly implementedAt: string;
  readonly ports: TargetWallPorts;
}

/**
 * The P4-C22 filter. `lesson` and `agent-improvement` records whose target clears the wall become
 * candidates; EVERY other record — including one of those two kinds pointing outside the wall — is
 * skipped without error, without a status change, and without touching its bytes. Zero candidates is
 * a successful no-op that opens no PR. Duplicate targets, or a target equal to any record path in the
 * input, reject the whole batch.
 */
export async function selectImplementerBatch(
  records: readonly ProposalRecord[],
  options: BatchSelectionOptions,
): Promise<BatchSelection> {
  if (!isCommitSha(options.baseCommit)) throw new ContractDecodeError('baseCommit', '40 lowercase hex required');
  const skipped: SkippedRecord[] = [];
  const candidates: BatchedRecord[] = [];
  const recordPathsInInput = new Set(records.map((record) => proposalRecordRelpath(record)));

  for (const record of records) {
    if (record.status !== 'proposed') { skipped.push({ id: record.id, reason: 'not-proposed' }); continue; }
    if (!IMPLEMENTABLE_PROPOSAL_KINDS.includes(record.kind)) {
      skipped.push({ id: record.id, reason: 'records-only-kind' });
      continue;
    }
    const wall = await validateImplementerTarget(options.repoRoot, record.target, options.ports);
    if (!wall.ok) { skipped.push({ id: record.id, reason: wall.reason }); continue; }
    candidates.push({ record, targetPath: wall.target, recordPath: proposalRecordRelpath(record) });
  }

  if (candidates.length === 0) return { ok: true, batch: null, skipped };
  if (candidates.length > PROPOSAL_CANDIDATE_CAP) {
    return { ok: false, reason: 'batch-cap-exceeded', detail: `${candidates.length} candidates exceed ${PROPOSAL_CANDIDATE_CAP}` };
  }

  const seenTargets = new Set<string>();
  for (const candidate of candidates) {
    const folded = candidate.targetPath.toLowerCase();
    if (seenTargets.has(folded)) {
      return { ok: false, reason: 'conflicting-targets', detail: `duplicate target ${candidate.targetPath}` };
    }
    seenTargets.add(folded);
    if (recordPathsInInput.has(candidate.targetPath)) {
      return { ok: false, reason: 'conflicting-targets', detail: `target equals a proposal record path: ${candidate.targetPath}` };
    }
  }

  // A batch sorts by target then id (§3.2).
  const sorted = [...candidates].sort((left, right) => (
    left.targetPath === right.targetPath
      ? left.record.id.localeCompare(right.record.id)
      : left.targetPath.localeCompare(right.targetPath)
  ));
  const targetPaths = sorted.map((entry) => entry.targetPath).sort();
  const recordPaths = sorted.map((entry) => entry.recordPath).sort();
  const relpaths = [...new Set([...targetPaths, ...recordPaths])].sort();
  const batchId = learningBatchId(options.baseCommit, sorted.map((entry) => entry.record.id));

  return {
    ok: true,
    skipped,
    batch: {
      batchId,
      baseCommit: options.baseCommit,
      implementedAt: options.implementedAt,
      records: sorted,
      targetPaths,
      recordPaths,
      relpaths,
    },
  };
}
