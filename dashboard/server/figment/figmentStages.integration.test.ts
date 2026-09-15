import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIGMENT_STAGES } from './figmentStages.ts';

/**
 * E2/M3 lockstep check: `FIGMENT_STAGES` must equal the live Python `STAGES` tuple in
 * `figment_train.py`, read by importing the module by path (never re-typed by hand here)
 * and printing it back as JSON. No pod, no ComfyUI, no network — this only imports the
 * module far enough to read one module-level constant.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FIGMENT_TRAIN_SCRIPT = join(REPO_ROOT, 'orgs', 'figment', 'pipeline', 'figment_train.py');

const configuredPython = process.env.FIGMENT_TEST_PYTHON_EXECUTABLE;
if (configuredPython === undefined || !isAbsolute(configuredPython)) {
  throw new Error('FIGMENT_TEST_PYTHON_EXECUTABLE must name an absolute test interpreter');
}
const PYTHON_EXECUTABLE = resolve(configuredPython);

describe('FIGMENT_STAGES mirrors figment_train.py STAGES', () => {
  it('is byte-for-byte the same ordered list as the live Python constant', () => {
    const script = [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("figment_train", r"${FIGMENT_TRAIN_SCRIPT}")`,
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'print(json.dumps(list(module.STAGES)))',
    ].join('\n');
    const stdout = execFileSync(PYTHON_EXECUTABLE, ['-I', '-B', '-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000,
    });
    const pythonStages: unknown = JSON.parse(stdout);
    expect(pythonStages).toEqual([...FIGMENT_STAGES]);
  });
});
