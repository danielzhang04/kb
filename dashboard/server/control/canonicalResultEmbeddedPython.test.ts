import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPyRunner } from '../write/launch.ts';
import { CARD_RESPOND_SCRIPT } from '../write/cardRespond.ts';
import { CANONICAL_RESULT_VERIFY_SCRIPT } from './canonicalResultIntegrator.ts';

// The canonical card mutation is no longer a `cards.py` heredoc: the integrator validates in TypeScript
// and PUBLISHES the walk as serial `card-transition` intents, whose `cards` port appends the fenced
// Result via `CARD_RESPOND_SCRIPT`'s `append_section` then transitions the card. This file proves the
// SURVIVING runtime contract: the TS-built Result block, appended by `CARD_RESPOND_SCRIPT`, is
// BYTE-IDENTICAL to what `CANONICAL_RESULT_VERIFY_SCRIPT` re-proves from the committed ops card. The
// writer-side validation (identity, fence balance, ambiguity, dependency-done, idempotent replay) now
// lives in `canonicalResultIntegrator.test.ts`; the verifier-side defenses stay here.

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

// The exact sorted-key compact serializer the integrator uses to build the Result block. It matches
// Python's `json.dumps(..., sort_keys=True, separators=(",",":"), ensure_ascii=False)` — the byte
// equality VERIFY asserts is the whole point of this file.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** The Result block the integrator hands the `cards` port as `write.block` (section `Result`). */
function resultBlock(wire: unknown): string {
  return `\`\`\`kb.canonical-stage-result/v1\n${canonical(wire)}\n\`\`\``;
}

function run(root: string, script: string, value: Record<string, unknown> = operation) {
  return defaultPyRunner(root, script, JSON.stringify(value));
}

/** Run `CARD_RESPOND_SCRIPT` exactly as the reconciliation `cards` port does: append the block under the
 *  `## <section>` heading, then take the single transition. `cardId` is the BARE id (the port strips the
 *  path), so this mirrors `realPorts.ts`. */
function respond(root: string, op: { section?: string; block?: string; transitions: string[] }) {
  return defaultPyRunner(root, CARD_RESPOND_SCRIPT, JSON.stringify({
    cardId: 'wf-runtime-stage',
    section: op.section ?? null,
    block: op.block ?? '',
    transitions: op.transitions,
    claimOwner: null,
  }));
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

  it.runIf(haveRuntime)('the TS-built Result block, appended by the cards port, verifies byte-for-byte', () => {
    const root = runtimeRoot();
    const working = join(root, 'queue', 'working', 'wf-runtime-stage.md');
    writeFileSync(working, cardText('working', '## Work order\n\nProduce the report.'));

    // The publisher's `cards` port: append the Result block under `## Result`, then transition to `done`.
    const mutated = respond(root, { section: 'Result', block: resultBlock(result), transitions: ['done'] });
    expect(mutated.exitCode, mutated.stderr).toBe(0);

    const done = join(root, 'queue', 'done', 'wf-runtime-stage.md');
    expect(readFileSync(done, 'utf8')).toContain(result.summary);
    expect(existsSync(working)).toBe(false);

    // Re-read from the working tree...
    const verified = run(root, CANONICAL_RESULT_VERIFY_SCRIPT);
    expect(verified.exitCode, verified.stderr).toBe(0);

    // ...and from an immutable ops commit, exactly as the integrator's `verifyCanonical` does.
    const publishedCommit = commitCurrentQueue(root);
    const published = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, { ...operation, gitCommit: publishedCommit });
    expect(published.exitCode, published.stderr).toBe(0);

    // The pin holds against later mutable edits: the committed bytes are what matters.
    writeFileSync(done, readFileSync(done, 'utf8').replace(result.summary, 'newer mutable summary'));
    commitCurrentQueue(root);
    const pinned = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, { ...operation, gitCommit: publishedCommit });
    expect(pinned.exitCode, pinned.stderr).toBe(0);
  });

  it.runIf(haveRuntime)('refuses to treat a local-only Result card as published', () => {
    const root = runtimeRoot();
    const working = join(root, 'queue', 'working', 'wf-runtime-stage.md');
    writeFileSync(working, cardText('working', '## Work order\n\nProduce the report.'));
    const publishedCommit = commitCurrentQueue(root);

    // Mutate to `done` locally but do NOT commit that move — the pinned commit still holds the working card.
    expect(respond(root, { section: 'Result', block: resultBlock(result), transitions: ['done'] }).exitCode).toBe(0);
    const verified = run(root, CANONICAL_RESULT_VERIFY_SCRIPT, { ...operation, gitCommit: publishedCommit });
    expect(verified.exitCode).not.toBe(0);
    expect(verified.stderr).toContain('published canonical result card is missing or ambiguous');
  });

  it.runIf(haveRuntime)('the verifier rejects an unbalanced fence in the committed card', () => {
    const root = runtimeRoot();
    writeFileSync(join(root, 'queue', 'done', 'wf-runtime-stage.md'), cardText('done', [
      '## Work order',
      '',
      '```markdown',
      'This fence never closes.',
    ].join('\n')));
    const checked = run(root, CANONICAL_RESULT_VERIFY_SCRIPT);
    expect(checked.exitCode).not.toBe(0);
    expect(checked.stderr).toContain('committed canonical result has unbalanced fenced content');
  });

  it.runIf(haveRuntime)('the verifier rejects duplicate structural Result headings', () => {
    const root = runtimeRoot();
    writeFileSync(join(root, 'queue', 'done', 'wf-runtime-stage.md'), cardText('done', [
      '## Result',
      '',
      'first',
      '',
      '## Result',
      '',
      'second',
    ].join('\n')));
    const checked = run(root, CANONICAL_RESULT_VERIFY_SCRIPT);
    expect(checked.exitCode).not.toBe(0);
    expect(checked.stderr).toContain('committed canonical Result section is missing or ambiguous');
  });

  it.runIf(haveRuntime)('the verifier rejects incomplete, changed, or trailing canonical Result content', () => {
    const cases = [
      ['incomplete', '## Result\n\n```kb.canonical-stage-result/v1\n{}'],
      ['different payload', '## Result\n\n```kb.canonical-stage-result/v1\n{}\n```'],
      ['trailing content', [
        '## Result',
        '',
        '```kb.canonical-stage-result/v1',
        canonical(result),
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
