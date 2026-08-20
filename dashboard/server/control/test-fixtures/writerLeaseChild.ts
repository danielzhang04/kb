import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { emptyControlPlaneDocument } from '../generated/controlPlaneSchema.ts';
import type { LockContentionRecord } from '../writerLease.ts';

const roots = new Set<string>();
const children = new Set<ChildProcessWithoutNullStreams>();
const writerLeaseModuleUrl = new URL('../writerLease.ts', import.meta.url).href;

export const CHILD_SCRIPT = String.raw`
const [mode, root, bootId, writerLeaseModuleUrl] = process.argv.slice(1);
const { WriterLeaseContentionError, acquireWriterLease } = await import(writerLeaseModuleUrl);
if (mode === 'try') {
  try {
    const lease = acquireWriterLease({ stateRoot: root, bootId });
    lease.release();
    process.exit(0);
  } catch (error) {
    process.exit(error instanceof WriterLeaseContentionError ? 17 : 19);
  }
}
let lease;
if (mode === 'hold') lease = acquireWriterLease({ stateRoot: root, bootId });
if (mode !== 'hold' && mode !== 'sleep') process.exit(18);
process.stdout.write('READY ' + process.pid + '\n');
process.stdin.resume();
process.stdin.once('end', () => {
  if (lease) lease.release();
  process.exit(0);
});
`;

export interface SpawnedLeaseFixture {
  readonly pid: number;
  readonly exitCode: number | null;
  stop(): Promise<void>;
}

export function makeLeaseRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-writer-lease-'));
  roots.add(root);
  mkdirSync(join(root, 'control'), { recursive: true, mode: 0o700 });
  return root;
}

export function makeCurrentV2RootForTest(): string {
  const root = makeLeaseRoot();
  writeFileSync(
    join(root, 'control', 'control-plane.json'),
    `${JSON.stringify(emptyControlPlaneDocument())}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return root;
}

export function writeContentionForTest(stateRoot: string, record: LockContentionRecord): void {
  const path = join(stateRoot, 'control', 'lock-contention.json');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.test.tmp`;
  writeFileSync(temp, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolvePromise(code));
  });
}

export async function spawnLeaseFixture(
  mode: 'hold' | 'sleep' | 'try',
  root: string,
  bootId: string,
): Promise<SpawnedLeaseFixture> {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', CHILD_SCRIPT, mode, root, bootId, writerLeaseModuleUrl],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  children.add(child);
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null) child.stdin.end();
    const timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 5_000);
    try { await waitForExit(child); } finally { clearTimeout(timeout); children.delete(child); }
  };

  if (mode === 'try') {
    const exitCode = await waitForExit(child);
    children.delete(child);
    return { pid: child.pid ?? -1, exitCode, stop };
  }

  const ready = new Promise<number>((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`writer lease fixture timed out; stderr=${stderr}`));
    }, 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const match = /^READY (?<pid>\d+)\r?\n/.exec(stdout);
      if (!match?.groups) return;
      clearTimeout(timeout);
      resolvePromise(Number(match.groups.pid));
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      if (!stdout.startsWith('READY ')) {
        clearTimeout(timeout);
        reject(new Error(`writer lease fixture exited ${code}; stderr=${stderr}`));
      }
    });
  });
  const pid = await ready;
  return {
    pid,
    get exitCode() { return child.exitCode; },
    stop,
  };
}

afterEach(async () => {
  for (const child of [...children]) {
    if (child.exitCode === null) child.kill();
    try { await waitForExit(child); } catch {}
    children.delete(child);
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});
