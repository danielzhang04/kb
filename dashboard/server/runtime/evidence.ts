import { sha256Hex } from '../shared/hashing.ts';
import { existsSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePython } from './python.ts';

export interface EvidencePayload {
  schema: 'kb.phase1-evidence/v1';
  key: string;
  passed: boolean;
  release: { commit: string; artifactSha256: string };
  host: { machineIdSha256: string; bootId: string };
  command: string[];
  startedAt: string;
  finishedAt: string;
  rawOutput: { file: string; sha256: string };
}

export interface EvidenceCommand {
  key: string;
  releaseCommit: string;
  artifactSha256: string;
  rawFile: string;
  reportFile: string;
  command: string[];
  cwd: string;
  evidenceDirectory?: string;
}

export interface EvidenceRunResult { exitCode: number; stdout: string; stderr: string; }
export interface EvidenceIo {
  now(): Date;
  run(command: readonly string[], cwd: string): Promise<EvidenceRunResult>;
  realpath(path: string): string;
  machineId(): string;
  bootId(): string;
  writeExclusiveAndFsync(path: string, value: string): void;
  writeCanonicalExclusiveAndFsync(path: string, payload: EvidencePayload): void;
}

/** The non-secret host observations required by the deferred Linux surface probe. */
export interface UnsupportedVmSurfacesProbeIo {
  mainPid(): number;
  cmdline(pid: number): string;
  descendantPids(pid: number): number[];
}

const EVIDENCE_KEYS = new Set(['schema', 'key', 'passed', 'release', 'host', 'command', 'startedAt', 'finishedAt', 'rawOutput']);
const RELEASE_KEYS = new Set(['commit', 'artifactSha256']);
const HOST_KEYS = new Set(['machineIdSha256', 'bootId']);
const RAW_OUTPUT_KEYS = new Set(['file', 'sha256']);
const SECRET_FLAG = /^--?(?:token|secret|password|passkey|credential|api-key|access-key|authorization)(?:=.*)?$/i;
const SECRET_VALUE = /(?:authorization\s*:|-----BEGIN .*PRIVATE KEY-----|(?:token|secret|password|session)[A-Za-z0-9_]*=)/i;
const URL_EMBEDDED_CREDENTIAL = /^[a-z][a-z0-9+.-]*:\/\/[^\s\/@:]+:[^\s\/@]+@/i;
const BARE_BEARER = /^bearer\s+\S+$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TOKEN_PREFIX = /^(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)$/i;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}

/** Matches Python `json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\\n'`. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(value)).replace(/[^\x00-\x7f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

function sha256(value: string): string { return sha256Hex(value); }
function sameKeys(value: unknown, expected: Set<string>): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === expected.size
    && Object.keys(value as Record<string, unknown>).every((key) => expected.has(key));
}

function canonicalUtc(value: string): void {
  if (!CANONICAL_UTC.test(value) || new Date(value).toISOString() !== value) throw new Error('timestamp must be canonical millisecond UTC');
}

export function safeCommand(command: readonly string[]): string[] {
  if (!Array.isArray(command) || command.length === 0 || command.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error('evidence command must be nonempty argv');
  }
  for (const item of command) {
    if (/[\x00-\x1f\x7f]/.test(item)) throw new Error('control character in evidence command');
    if (SECRET_FLAG.test(item) || SECRET_VALUE.test(item) || URL_EMBEDDED_CREDENTIAL.test(item)
      || BARE_BEARER.test(item) || JWT.test(item) || TOKEN_PREFIX.test(item)) {
      throw new Error('credential value in evidence command');
    }
  }
  return [...command];
}

function requireEvidencePath(path: string, directory: string, label: string): void {
  const resolvedDirectory = resolve(directory);
  const resolvedPath = resolve(path);
  if (dirname(resolvedPath) !== resolvedDirectory || basename(resolvedPath) !== basename(path)) {
    throw new Error(`${label} must be a package-local regular filename`);
  }
}

function preflight(input: EvidenceCommand): void {
  const allowed = new Set(['key', 'releaseCommit', 'artifactSha256', 'rawFile', 'reportFile', 'command', 'cwd', 'evidenceDirectory']);
  const required = ['key', 'releaseCommit', 'artifactSha256', 'rawFile', 'reportFile', 'command', 'cwd'];
  if (Object.keys(input).some((key) => !allowed.has(key)) || required.some((key) => !(key in input))) {
    throw new Error('closed evidence command input required');
  }
  const directory = input.evidenceDirectory ?? dirname(input.rawFile);
  requireEvidencePath(input.rawFile, directory, 'raw output');
  requireEvidencePath(input.reportFile, directory, 'evidence report');
  if (resolve(input.rawFile) === resolve(input.reportFile)) throw new Error('raw output and report must differ');
  if (existsSync(input.rawFile) || existsSync(input.reportFile)) throw new Error('evidence output already exists');
  if (!KEY.test(input.key) || !SHA1.test(input.releaseCommit) || !SHA256.test(input.artifactSha256)) throw new Error('invalid evidence identity');
  safeCommand(input.command);
}

export function buildEvidencePayload(input: Omit<EvidenceCommand, 'cwd'> & {
  passed: boolean; startedAt: string; finishedAt: string; rawSha256: string; machineId: string; bootId: string;
}): EvidencePayload {
  const allowed = new Set([
    'key', 'releaseCommit', 'artifactSha256', 'rawFile', 'reportFile', 'command', 'cwd', 'evidenceDirectory',
    'passed', 'startedAt', 'finishedAt', 'rawSha256', 'machineId', 'bootId',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('closed evidence payload input required');
  canonicalUtc(input.startedAt);
  canonicalUtc(input.finishedAt);
  if (new Date(input.finishedAt) < new Date(input.startedAt) || !KEY.test(input.key) || !SHA1.test(input.releaseCommit)
    || !SHA256.test(input.artifactSha256) || !SHA256.test(input.rawSha256) || !UUID.test(input.bootId) || typeof input.passed !== 'boolean') {
    throw new Error('invalid evidence identity or time range');
  }
  const directory = input.evidenceDirectory ?? dirname(input.rawFile);
  requireEvidencePath(input.rawFile, directory, 'raw output');
  requireEvidencePath(input.reportFile, directory, 'evidence report');
  return {
    schema: 'kb.phase1-evidence/v1',
    key: input.key,
    passed: input.passed,
    release: { commit: input.releaseCommit, artifactSha256: input.artifactSha256 },
    host: { machineIdSha256: sha256(input.machineId), bootId: input.bootId },
    command: safeCommand(input.command),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    rawOutput: { file: basename(input.rawFile), sha256: input.rawSha256 },
  };
}

export function parseClosedEvidence(raw: string): EvidencePayload {
  const value: unknown = JSON.parse(raw);
  if (!sameKeys(value, EVIDENCE_KEYS) || canonicalJson(value) !== raw) throw new Error('closed canonical evidence required');
  const payload = value as Record<string, unknown>;
  if (payload.schema !== 'kb.phase1-evidence/v1' || typeof payload.passed !== 'boolean' || !sameKeys(payload.release, RELEASE_KEYS)
    || !sameKeys(payload.host, HOST_KEYS) || !sameKeys(payload.rawOutput, RAW_OUTPUT_KEYS) || !Array.isArray(payload.command)) {
    throw new Error('unsupported evidence payload');
  }
  const release = payload.release as Record<string, unknown>;
  const host = payload.host as Record<string, unknown>;
  const rawOutput = payload.rawOutput as Record<string, unknown>;
  if (typeof payload.key !== 'string' || typeof payload.startedAt !== 'string' || typeof payload.finishedAt !== 'string'
    || typeof release.commit !== 'string' || typeof release.artifactSha256 !== 'string' || typeof host.machineIdSha256 !== 'string'
    || typeof host.bootId !== 'string' || typeof rawOutput.file !== 'string' || typeof rawOutput.sha256 !== 'string') throw new Error('evidence scalar types are invalid');
  buildEvidencePayload({
    key: payload.key, passed: payload.passed, releaseCommit: release.commit, artifactSha256: release.artifactSha256,
    command: payload.command as string[], startedAt: payload.startedAt, finishedAt: payload.finishedAt,
    rawFile: rawOutput.file, reportFile: rawOutput.file === 'report.json' ? 'other.json' : 'report.json',
    rawSha256: rawOutput.sha256, machineId: 'validated-only', bootId: host.bootId,
  });
  if (!SHA256.test(host.machineIdSha256) || basename(rawOutput.file) !== rawOutput.file) throw new Error('invalid evidence digest');
  return value as unknown as EvidencePayload;
}

function writeExclusiveAndFsync(path: string, value: string): void {
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, value, 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

async function run(command: readonly string[], cwd: string): Promise<EvidenceRunResult> {
  return await new Promise((resolveResult, reject) => {
    const [file, ...args] = command;
    const child = spawn(file, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
  });
}

export const productionEvidenceIo: EvidenceIo = {
  now: () => new Date(),
  run,
  realpath: realpathSync,
  machineId: () => readFileSync('/etc/machine-id', 'utf8').trim(),
  bootId: () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
  writeExclusiveAndFsync,
  writeCanonicalExclusiveAndFsync: (path, payload) => writeExclusiveAndFsync(path, canonicalJson(payload)),
};

async function writeEvidence(
  input: EvidenceCommand,
  io: EvidenceIo,
  execute: () => Promise<EvidenceRunResult>,
): Promise<EvidencePayload> {
  preflight(input);
  const startedAt = io.now().toISOString();
  const child = await execute();
  const python = resolvePython('linux');
  const pythonIdentity = await io.run([
    python.command, ...python.prefixArgs, '-c', 'import os,sys;print(os.path.realpath(sys.executable));print(sys.version.split()[0])',
  ], input.cwd);
  const [pythonRealpath = '', pythonVersion = ''] = pythonIdentity.stdout.split(/\r?\n/);
  const runtime = {
    node: { realpath: io.realpath(process.execPath), version: process.version },
    python: {
      command: python.command,
      realpath: pythonRealpath,
      version: pythonVersion,
      exitCode: pythonIdentity.exitCode,
      stderr: pythonIdentity.stderr,
    },
  };
  const raw = `${JSON.stringify({ commandExitCode: child.exitCode, stdout: child.stdout, stderr: child.stderr, runtime }, null, 2)}\n`;
  io.writeExclusiveAndFsync(input.rawFile, raw);
  const payload = buildEvidencePayload({
    ...input,
    // An unresolved host identity is not trustworthy Gate-2 evidence even if the requested argv passed.
    passed: child.exitCode === 0 && pythonIdentity.exitCode === 0,
    startedAt,
    finishedAt: io.now().toISOString(),
    rawSha256: sha256(raw),
    machineId: io.machineId(),
    bootId: io.bootId(),
  });
  io.writeCanonicalExclusiveAndFsync(input.reportFile, payload);
  return payload;
}

export async function runEvidenceCommand(input: EvidenceCommand, io: EvidenceIo = productionEvidenceIo): Promise<EvidencePayload> {
  return writeEvidence(input, io, () => io.run(input.command, input.cwd));
}

function hasForbiddenVmExecutable(cmdline: string): boolean {
  return /(?:^|[\0\\/])(?:powershell|schtasks)\.exe(?:$|[\0\\/])/i.test(cmdline);
}

function hasAgentCliChild(cmdline: string): boolean {
  return /(?:^|[\0\\/])claude(?:\.exe)?(?:$|[\0\\/])/i.test(cmdline);
}

function procDescendants(mainPid: number): number[] {
  const parents = new Map<number, number[]>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const fields = readFileSync(`/proc/${name}/stat`, 'utf8').trim().split(' ');
      const pid = Number(name);
      const parent = Number(fields[3]);
      if (Number.isInteger(pid) && Number.isInteger(parent)) {
        const children = parents.get(parent) ?? [];
        children.push(pid);
        parents.set(parent, children);
      }
    } catch {
      // Processes can exit between directory enumeration and read; absence is not evidence of a child.
    }
  }
  const descendants: number[] = [];
  const pending = [...(parents.get(mainPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.pop()!;
    descendants.push(pid);
    pending.push(...(parents.get(pid) ?? []));
  }
  return descendants;
}

export const productionUnsupportedVmSurfacesProbeIo: UnsupportedVmSurfacesProbeIo = {
  mainPid: () => {
    const mainPid = Number(process.env.DASHBOARD_MAIN_PID);
    if (!Number.isInteger(mainPid) || mainPid <= 0) throw new Error('DASHBOARD_MAIN_PID is required for the unsupported-surface probe');
    return mainPid;
  },
  cmdline: (pid) => readFileSync(`/proc/${pid}/cmdline`, 'utf8'),
  descendantPids: procDescendants,
};

async function runUnsupportedVmSurfacesProbe(
  input: EvidenceCommand,
  io: EvidenceIo,
  probe: UnsupportedVmSurfacesProbeIo,
): Promise<EvidencePayload> {
  return writeEvidence(input, io, async () => {
    const mainPid = probe.mainPid();
    const mainPidHasForbiddenExecutable = hasForbiddenVmExecutable(probe.cmdline(mainPid));
    const agentCliChildPids = probe.descendantPids(mainPid).filter((pid) => hasAgentCliChild(probe.cmdline(pid)));
    const passed = !mainPidHasForbiddenExecutable && agentCliChildPids.length === 0;
    const stdout = `${JSON.stringify({ mainPid, mainPidHasForbiddenExecutable, agentCliChildPids })}\n`;
    return {
      exitCode: passed ? 0 : 1,
      stdout,
      stderr: passed ? '' : 'unsupported VM surface probe failed',
    };
  });
}

function cliInput(argv: string[], internalCommand?: string[]): EvidenceCommand {
  const divider = internalCommand ? argv.length : argv.indexOf('--');
  if (divider < 0) throw new Error('evidence command requires -- followed by argv');
  const options = argv.slice(0, divider);
  const command = internalCommand ?? argv.slice(divider + 1);
  if (options.length !== 10 || command.length === 0) throw new Error('invalid evidence command arguments');
  const values = new Map<string, string>();
  for (let index = 0; index < options.length; index += 2) {
    const flag = options[index];
    const value = options[index + 1];
    if (!['--key', '--release-commit', '--artifact-sha256', '--raw', '--report'].includes(flag) || values.has(flag) || !value) {
      throw new Error('invalid evidence command arguments');
    }
    values.set(flag, value);
  }
  return {
    key: values.get('--key')!,
    releaseCommit: values.get('--release-commit')!,
    artifactSha256: values.get('--artifact-sha256')!,
    rawFile: values.get('--raw')!,
    reportFile: values.get('--report')!,
    command,
    cwd: process.cwd(),
  };
}

export async function runEvidenceCli(
  argv: string[],
  io: EvidenceIo = productionEvidenceIo,
  probe: UnsupportedVmSurfacesProbeIo = productionUnsupportedVmSurfacesProbeIo,
): Promise<EvidencePayload> {
  if (argv[0] === 'probe-unsupported-surfaces') {
    return runUnsupportedVmSurfacesProbe(cliInput(argv.slice(1), ['probe-unsupported-surfaces']), io, probe);
  }
  return runEvidenceCommand(cliInput(argv), io);
}

async function main(argv: string[]): Promise<void> {
  const payload = await runEvidenceCli(argv);
  process.stdout.write(canonicalJson(payload));
  if (!payload.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
