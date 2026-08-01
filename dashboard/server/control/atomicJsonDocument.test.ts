import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createAtomicJsonDocument } from './atomicJsonDocument.ts';

const roots: string[] = [];
const moduleUrl = new URL('./atomicJsonDocument.ts', import.meta.url).href;

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'atomic-json-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

function document(path: string, lockTimeoutMs = 100) {
  return createAtomicJsonDocument<{ revision: number }>({
    path,
    empty: () => ({ revision: 0 }),
    validate: (value: unknown): asserts value is { revision: number } => {
      if (!value || typeof value !== 'object' || !Number.isSafeInteger((value as { revision?: unknown }).revision)) throw new Error('invalid');
    },
    error: (message) => new Error(message),
    maxBytes: 1_024,
    lockTimeoutMs,
  });
}

function child(script: string, path: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '-e', script, path, moduleUrl], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    processHandle.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    processHandle.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    processHandle.once('error', reject);
    processHandle.once('exit', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const childPrelude = `
const [path, moduleUrl] = process.argv.slice(1);
const { createAtomicJsonDocument } = await import(moduleUrl);
const document = createAtomicJsonDocument({
  path,
  empty: () => ({ revision: 0 }),
  validate: (value) => { if (!value || !Number.isSafeInteger(value.revision)) throw new Error('invalid'); },
  error: (message) => new Error(message),
  maxBytes: 1024,
  lockTimeoutMs: 30,
});
`;

describe('createAtomicJsonDocument SQLite exclusion', () => {
  it('serializes mutation and atomically publishes the JSON document', async () => {
    const path = join(root(), 'state.json');
    await document(path).mutate((value) => { value.revision += 1; });
    expect(document(path).read()).toEqual({ revision: 1 });
    expect(readFileSync(path, 'utf8')).toBe('{"revision":1}\n');
  });

  it('holds exclusion against an adversarial second OS process without any pathname lock to steal', async () => {
    const path = join(root(), 'state.json');
    await document(path).mutate(async (value) => {
      const result = await child(`${childPrelude}
try { await document.mutate((value) => { value.revision = 99; }); console.log('STOLE'); }
catch (error) { console.log(error.message); }
`, path);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('atomic document state is busy');
      expect(result.stderr).toBe('');
      value.revision = 1;
    });
    expect(document(path).read()).toEqual({ revision: 1 });
  });

  it('releases the OS-backed mutex when its owning process crashes mid-mutation', async () => {
    const path = join(root(), 'state.json');
    const crashed = await child(`${childPrelude}
await document.mutate(() => { process.exit(23); });
`, path);
    expect(crashed.code).toBe(23);
    await expect(document(path).mutate((value) => { value.revision = 2; })).resolves.toBeUndefined();
    expect(document(path).read()).toEqual({ revision: 2 });
  });

  it('fails closed rather than replacing a malformed companion mutex database', async () => {
    const path = join(root(), 'state.json');
    const mutexPath = `${path}.mutex.sqlite`;
    writeFileSync(mutexPath, 'not a sqlite database', 'utf8');
    await expect(document(path).mutate(() => undefined)).rejects.toThrow('atomic document mutex is unavailable');
    expect(readFileSync(mutexPath, 'utf8')).toBe('not a sqlite database');
  });
});
