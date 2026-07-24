import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPyRunner } from '../write/launch.ts';
import {
  CANONICAL_RESULT_CARD_SCRIPT,
  CANONICAL_RESULT_VERIFY_SCRIPT,
} from './canonicalResultIntegrator.ts';

const roots: string[] = [];
const cardsSource = fileURLToPath(new URL('../../../scripts/cards.py', import.meta.url));

function runtimeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'canonical-result-python-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const state of ['inbox', 'working', 'approvals', 'done']) {
    mkdirSync(join(root, 'queue', state), { recursive: true });
  }
  copyFileSync(cardsSource, join(root, 'scripts', 'cards.py'));
  return root;
}

function cardText(state: 'working' | 'done', body: string): string {
  return [
    '---',
    'id: wf-runtime-stage',
    'project: kb-ops',
    'action: verify the canonical result runtime',
    'target: dashboard/server/control/canonicalResultIntegrator.ts',
    'risk-tier: T1',
    'owner: codex-worker',
    `state: ${state}`,
    'workflow: run-runtime',
    'execution-controller: dashboard',
    'depends-on: []',
    '---',
    '',
    body,
  ].join('\n');
}

const result = {
  summary: 'Two old cards never closed with a `## Result` section.',
  artifacts: [],
  changed: [],
  checkpoints: ['verified'],
};
const operation = { cardRef: 'wf-runtime-stage', runRef: 'run-runtime', result };

function run(root: string, script: string, value: Record<string, unknown> = operation) {
  return defaultPyRunner(root, script, JSON.stringify(value));
}

function commitCurrentQueue(root: string): string {
  if (!existsSync(join(root, '.git'))) {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'canonical-test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'canonical-test@agents.local'], { cwd: root });
  }
  execFileSync('git', ['add', '--', 'queue'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: canonical card'], { cwd: root, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('canonical Result embedded Python runtime', () => {
  const probeRoot = runtimeRoot();
  const haveRuntime = defaultPyRunner(probeRoot, 'import yaml; print("ok")', '{}').exitCode === 0;
  rmSync(probeRoot, { recursive: true, force: true });
  roots.splice(roots.indexOf(probeRoot), 1);

  it('has the Python card runtime available when required by CI', () => {
    if (process.env.CI) expect(haveRuntime, 'Python and PyYAML are required in CI').toBe(true);
    else expect(true).toBe(true);
  });

  it.runIf(haveRuntime)('writes, replays, and verifies a result despite incidental Result text', () => {
    const root = runtimeRoot();
    const working = join(root, 'queue', 'working', 'wf-runtime-stage.md');
    writeFileSync(working, cardText('working', [
      '## Work order',
      '',
      'Explain why an old report mentioned `## Result` without adding that section.',
      '',
      '```markdown',
      '## Result',
      'This fenced example is inert.',
      '```',
    ].join('\n')));

    const first = run(root, CANONICAL_RESULT_CARD_SCRIPT);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ changed: true });

    const done = join(root, 'queue', 'done', 'wf-runtime-stage.md');
    expect(readFileSync(done, 'utf8')).toContain(result.summary);

    const replay = run(root, CANONICAL_RESULT_CARD_SCRIPT);
    expect(replay.exitCode, replay.stderr).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ changed: false });

    const verified = run(root, CANONICAL_RESULT_VERIFY_SCRIPT);
    expect(verified.exitCode, verified.stderr).toBe(0);

    const publishedCommit = commitCurrentQueue(root);
    const published = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, {
      ...operation,
      gitCommit: publishedCommit,
    });
    expect(published.exitCode, published.stderr).toBe(0);

    writeFileSync(done, readFileSync(done, 'utf8').replace(result.summary, 'newer mutable summary'));
    commitCurrentQueue(root);
    const pinned = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, {
      ...operation,
      gitCommit: publishedCommit,
    });
    expect(pinned.exitCode, pinned.stderr).toBe(0);
  });

  it.runIf(haveRuntime)('refuses to treat a local-only Result card as published', () => {
    const root = runtimeRoot();
    const working = join(root, 'queue', 'working', 'wf-runtime-stage.md');
    writeFileSync(working, cardText('working', '## Work order\n\nProduce the report.'));
    const publishedCommit = commitCurrentQueue(root);

    expect(run(root, CANONICAL_RESULT_CARD_SCRIPT).exitCode).toBe(0);
    const verified = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, {
      ...operation,
      gitCommit: publishedCommit,
    });
    expect(verified.exitCode).not.toBe(0);
    expect(verified.stderr).toContain('published canonical result card is missing or ambiguous');
  });

  it.runIf(haveRuntime)('rejects an unbalanced existing fence before changing the card', () => {
    const root = runtimeRoot();
    const working = join(root, 'queue', 'working', 'wf-runtime-stage.md');
    writeFileSync(working, cardText('working', [
      '## Work order',
      '',
      '```markdown',
      'This fence never closes.',
    ].join('\n')));
    const before = readFileSync(working);

    const checked = run(root, CANONICAL_RESULT_CARD_SCRIPT);

    expect(checked.exitCode).not.toBe(0);
    expect(checked.stderr).toContain('canonical card has unbalanced fenced content');
    expect(readFileSync(working)).toEqual(before);
    expect(existsSync(join(root, 'queue', 'done', 'wf-runtime-stage.md'))).toBe(false);
  });

  it.runIf(haveRuntime)('rejects duplicate structural Result headings in writer and verifier', () => {
    for (const state of ['working', 'done'] as const) {
      const root = runtimeRoot();
      const path = join(root, 'queue', state, 'wf-runtime-stage.md');
      writeFileSync(path, cardText(state, [
        '## Result',
        '',
        'first',
        '',
        '## Result',
        '',
        'second',
      ].join('\n')));
      const checked = run(root, state === 'working' ? CANONICAL_RESULT_CARD_SCRIPT : CANONICAL_RESULT_VERIFY_SCRIPT);
      expect(checked.exitCode).not.toBe(0);
      expect(checked.stderr).toContain(state === 'working'
        ? 'canonical card has ambiguous Result sections'
        : 'committed canonical Result section is missing or ambiguous');
    }
  });

  it.runIf(haveRuntime)('rejects incomplete, changed, or trailing canonical Result content', () => {
    const cases = [
      ['incomplete', '## Result\n\n```kb.canonical-stage-result/v1\n{}'],
      ['different payload', '## Result\n\n```kb.canonical-stage-result/v1\n{}\n```'],
      ['trailing content', [
        '## Result',
        '',
        '```kb.canonical-stage-result/v1',
        JSON.stringify(result, Object.keys(result).sort()),
        '```',
        '',
        'unexpected',
      ].join('\n')],
    ] as const;

    for (const [name, body] of cases) {
      const root = runtimeRoot();
      writeFileSync(join(root, 'queue', 'done', 'wf-runtime-stage.md'), cardText('done', body));
      const checked = run(root, CANONICAL_RESULT_VERIFY_SCRIPT);
      expect(checked.exitCode, name).not.toBe(0);
    }
  });
});
