import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkerPrompt,
  buildClaudeArgs,
  buildReadScopeSettings,
  buildWorkerEnv,
  encodeStreamJsonUserMessage,
  parseWorkerStream,
  createClaudeWorkerAdapter,
  ToolPolicyRefusal,
  type ClaudeProcess,
  type ClaudeSpawnRequest,
  type ClaudeToolPolicy,
} from './claudeWorkerAdapter.ts';
import { DENIED_ENV_FRAGMENTS } from '../pty/host.ts';
import type { ExecutionProfile } from './policy.ts';

const WORKER_PROFILE: ExecutionProfile = {
  id: 'worker-claude-sonnet',
  role: 'worker',
  runtime: 'claude',
  model: 'claude-sonnet',
  capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
};

const TOOL_POLICY: ClaudeToolPolicy = { allowedTools: ['Read', 'Write', 'WebSearch'], permissionMode: 'default' };

const FAKE_PID = 4242;

/** A hermetic fake claude child the test drives directly — no real CLI is ever spawned. */
function fakeProcess() {
  let stdout: (chunk: string) => void = () => {};
  let stderr: (chunk: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  let error: (err: Error) => void = () => {};
  const stdin: string[] = [];
  const proc: ClaudeProcess = {
    onStdout(cb) { stdout = cb; },
    onStderr(cb) { stderr = cb; },
    onExit(cb) { exit = cb; },
    onError(cb) { error = cb; },
    pid: FAKE_PID,
    writeStdin(text) { stdin.push(text); },
    endStdin: vi.fn(),
    kill: vi.fn(),
  };
  return {
    proc,
    stdin,
    emitStdout: (chunk: string) => stdout(chunk),
    emitStderr: (chunk: string) => stderr(chunk),
    emitExit: (code: number | null) => exit(code),
    emitError: (err: Error) => error(err),
  };
}

function executeInput(overrides: Partial<Parameters<ReturnType<typeof createClaudeWorkerAdapter>['execute']>[0]> = {}) {
  return {
    operationKey: 'automatic-attempt:attempt-1',
    subject: 'kb-ops',
    runRef: 'run-1',
    stageRef: 'stage-1',
    attemptRef: 'attempt-1',
    sessionRef: 'session-1',
    worktreePath: '/srv/worktrees/run-1/attempt-1',
    profile: WORKER_PROFILE,
    workflowProfile: 'research' as string | null,
    skills: [] as readonly string[],
    action: 'research:brief',
    target: 'orgs/kb-ops/output',
    workOrder: 'Do the thing.',
    readScope: ['orgs/kb-ops'] as readonly string[],
    writeScope: ['orgs/kb-ops/output'] as readonly string[],
    checkpoints: [] as readonly string[],
    ...overrides,
  };
}

function successLine(result: string, usage?: Record<string, unknown>, cost = 0): string {
  return `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, usage: usage ?? { input_tokens: 10, output_tokens: 5 }, total_cost_usd: cost })}\n`;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('buildWorkerPrompt', () => {
  it('leads with the authoritative work order', () => {
    const prompt = buildWorkerPrompt({ workOrder: 'Ship the feature.', readScope: ['a'], writeScope: ['b'] });
    expect(prompt.startsWith('AUTHORITATIVE WORK ORDER (follow these instructions):\nShip the feature.')).toBe(true);
  });

  it('states read and write scope', () => {
    const prompt = buildWorkerPrompt({ workOrder: 'x', readScope: ['orgs/a', 'orgs/b'], writeScope: ['orgs/a/out'] });
    expect(prompt).toContain('READ SCOPE — you may read only these paths:\n- orgs/a\n- orgs/b');
    expect(prompt).toContain('WRITE SCOPE — you may write only these paths:\n- orgs/a/out');
  });

  it('renders (none) for empty scope rather than a dangling label', () => {
    const prompt = buildWorkerPrompt({ workOrder: 'x', readScope: [], writeScope: [] });
    expect(prompt).toContain('READ SCOPE — you may read only these paths:\n- (none)');
  });

  it('omits the inert boundary entirely when there are no dependencies or feedback', () => {
    const prompt = buildWorkerPrompt({ workOrder: 'x', readScope: ['a'], writeScope: ['b'] });
    expect(prompt).not.toContain('INERT CONTEXT BOUNDARY');
    expect(prompt).not.toContain('END INERT CONTEXT');
  });

  it('wraps dependency results and feedback inside an explicit inert boundary', () => {
    const prompt = buildWorkerPrompt({
      workOrder: 'x',
      readScope: ['a'],
      writeScope: ['b'],
      dependencyResults: [{ from: 'stage-upstream', summary: 'produced foo.md' }],
      feedback: 'prefer terse output',
    });
    const boundaryIdx = prompt.indexOf('INERT CONTEXT BOUNDARY');
    expect(boundaryIdx).toBeGreaterThan(-1);
    // Everything inert appears AFTER the boundary opens and BEFORE it closes.
    expect(prompt).toContain('### stage-upstream');
    expect(prompt).toContain('produced foo.md');
    expect(prompt).toContain('OPERATOR FEEDBACK:\nprefer terse output');
    expect(prompt.indexOf('### stage-upstream')).toBeGreaterThan(boundaryIdx);
    expect(prompt.indexOf('END INERT CONTEXT')).toBeGreaterThan(prompt.indexOf('produced foo.md'));
  });

  it('has no parameter for card Evidence, so Evidence can never enter the prompt', () => {
    // The function signature accepts no evidence — passing it via an unknown key is ignored.
    const prompt = buildWorkerPrompt({ workOrder: 'x', readScope: ['a'], writeScope: ['b'], ...( { evidence: 'SECRET EVIDENCE PAYLOAD' } as object) });
    expect(prompt).not.toContain('SECRET EVIDENCE PAYLOAD');
    expect(prompt).not.toContain('Evidence');
  });
});

describe('buildClaudeArgs', () => {
  it('pins the stream-json flags then routing and the profile tool cap', () => {
    expect(buildClaudeArgs({ model: 'claude-opus', toolPolicy: TOOL_POLICY })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-opus',
      '--allowedTools', 'Read,Write,WebSearch',
      '--permission-mode', 'default',
    ]);
  });

  // REGRESSION (2026-07-20): the previous assertion here codified the defect — an empty allowlist
  // dropped the flag and the worker inherited permission-mode defaults, i.e. spawned uncapped.
  it('refuses to build args for an empty allowlist rather than dropping the flag', () => {
    expect(() => buildClaudeArgs({ model: 'm', toolPolicy: { allowedTools: [], permissionMode: 'plan' } }))
      .toThrow(ToolPolicyRefusal);
  });

  it('refuses a malformed tool name that would corrupt the comma-joined value', () => {
    expect(() => buildClaudeArgs({ model: 'm', toolPolicy: { allowedTools: ['Read,Bash'], permissionMode: 'default' } }))
      .toThrow(ToolPolicyRefusal);
  });

  it('refuses to build args without a model', () => {
    expect(() => buildClaudeArgs({ model: '   ', toolPolicy: TOOL_POLICY })).toThrow(/model/);
  });

  it('inserts an inline --settings before routing while keeping --permission-mode trailing (C3)', () => {
    const args = buildClaudeArgs({ model: 'claude-opus', toolPolicy: TOOL_POLICY, settings: '{"permissions":{"deny":[]}}' });
    const idx = args.indexOf('--settings');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('{"permissions":{"deny":[]}}');
    // Routing positions are unchanged: --settings precedes --allowedTools, and --permission-mode is last.
    expect(idx).toBeLessThan(args.indexOf('--allowedTools'));
    expect(args.slice(-2)).toEqual(['--permission-mode', 'default']);
  });
});

describe('buildReadScopeSettings (C3 — deny complement for no-Bash profiles)', () => {
  it('emits a Read deny complement for a no-Bash scanner profile', () => {
    const settings = buildReadScopeSettings({
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      readScope: ['queue', 'dashboards', 'orgs/kb-ops'],
      writeScope: ['orgs/kb-ops/output'],
    });
    expect(settings).toBeDefined();
    expect(JSON.parse(settings!)).toEqual({
      permissions: { deny: ['Read(/dashboard/**)', 'Read(/memory/**)', 'Read(/scripts/**)'] },
    });
  });

  it('emits NOTHING for a Bash profile (producer) — git plumbing would bypass it anyway', () => {
    expect(buildReadScopeSettings({
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      readScope: ['orgs/kb-ops'],
      writeScope: ['orgs/kb-ops/output'],
    })).toBeUndefined();
  });

  it('never denies a sensitive root the stage legitimately declared in scope', () => {
    const settings = buildReadScopeSettings({
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      readScope: ['scripts'], // hypothetical: a scope that includes a normally-sensitive root
      writeScope: ['orgs/kb-ops/output'],
    });
    expect(JSON.parse(settings!).permissions.deny).not.toContain('Read(/scripts/**)');
    expect(JSON.parse(settings!).permissions.deny).toContain('Read(/dashboard/**)');
  });

  it('with repoRoot, emits BOTH the worktree-relative rule and the //-absolute companion per denied root (relative then absolute)', () => {
    const settings = buildReadScopeSettings({
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      readScope: ['queue', 'orgs/kb-ops'],
      writeScope: ['orgs/kb-ops/output'],
      repoRoot: 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops',
    });
    // Backslashes are converted to forward slashes; the drive letter is preserved; relative precedes absolute.
    expect(JSON.parse(settings!)).toEqual({
      permissions: {
        deny: [
          'Read(/dashboard/**)',
          'Read(//C:/Users/danie/kb-worktrees/dashboard-ops/dashboard/**)',
          'Read(/memory/**)',
          'Read(//C:/Users/danie/kb-worktrees/dashboard-ops/memory/**)',
          'Read(/scripts/**)',
          'Read(//C:/Users/danie/kb-worktrees/dashboard-ops/scripts/**)',
        ],
      },
    });
  });

  it('without repoRoot, emits ONLY the worktree-relative rules (byte-identical to the pre-upgrade shape)', () => {
    const settings = buildReadScopeSettings({
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      readScope: ['queue', 'orgs/kb-ops'],
      writeScope: ['orgs/kb-ops/output'],
    });
    expect(JSON.parse(settings!)).toEqual({
      permissions: { deny: ['Read(/dashboard/**)', 'Read(/memory/**)', 'Read(/scripts/**)'] },
    });
  });

  it('a forward-slash repoRoot (POSIX) needs no conversion and keeps the drive letter', () => {
    const settings = buildReadScopeSettings({
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      readScope: ['queue'],
      writeScope: ['orgs/kb-ops/output'],
      repoRoot: 'C:/Users/danie/kb/', // trailing slash trimmed, no double-slash before the root
    });
    expect(JSON.parse(settings!).permissions.deny).toContain('Read(//C:/Users/danie/kb/dashboard/**)');
    expect(JSON.parse(settings!).permissions.deny).not.toContain('Read(//C:/Users/danie/kb//dashboard/**)');
  });
});

describe('encodeStreamJsonUserMessage', () => {
  it('encodes the prompt as a newline-terminated stream-json user message', () => {
    const line = encodeStreamJsonUserMessage('hello');
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } });
  });
});

describe('buildWorkerEnv — PTY host hygiene parity', () => {
  it('strips ANTHROPIC_API_KEY and every credential-named var, keeping only allowlisted names', () => {
    const parent: Record<string, string> = {
      PATH: '/usr/bin',
      USERPROFILE: 'C:/Users/danie',
      ANTHROPIC_API_KEY: 'sk-should-never-pass',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-should-never-pass',
      GITHUB_TOKEN: 'ghp-should-never-pass',
      MY_SECRET_VALUE: 'nope',
      RANDOM_UNLISTED: 'also-nope',
    };
    const env = buildWorkerEnv(parent);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.USERPROFILE).toBe('C:/Users/danie');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.MY_SECRET_VALUE).toBeUndefined();
    expect(env.RANDOM_UNLISTED).toBeUndefined();
    // No value in the built env carries any denied credential fragment name.
    for (const name of Object.keys(env)) {
      expect(DENIED_ENV_FRAGMENTS.some((frag) => name.toUpperCase().includes(frag))).toBe(false);
    }
  });
});

describe('parseWorkerStream — mapping matrix', () => {
  it('maps a clean success with a result event to succeeded and extracts usage', () => {
    const result = parseWorkerStream(
      `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${successLine('all done', { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 40 }, 0)}`,
      '',
      0,
    );
    expect(result.state).toBe('succeeded');
    expect(result.summary).toBe('all done');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40, costUsdMicros: 0 });
    expect(result.artifacts).toEqual([]);
    expect(result.checkpoints).toEqual([]);
  });

  it('converts sub-dollar cost to micros before flooring ($0.0234 → 23400, never 0)', () => {
    const result = parseWorkerStream(successLine('done', { input_tokens: 1, output_tokens: 1 }, 0.0234), '', 0);
    expect(result.state).toBe('succeeded');
    expect(result.usage.costUsdMicros).toBe(23_400);
  });

  it('converts a multi-dollar cost to micros ($1.99 → 1990000)', () => {
    const result = parseWorkerStream(successLine('done', { input_tokens: 1, output_tokens: 1 }, 1.99), '', 0);
    expect(result.usage.costUsdMicros).toBe(1_990_000);
  });

  it('fails closed on a clean-exit result event missing subtype and is_error', () => {
    const line = `${JSON.stringify({ type: 'result', result: 'looks fine but unverified' })}\n`;
    const result = parseWorkerStream(line, '', 0);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('looks fine but unverified');
  });

  it('maps a nonzero exit to failed with a stderr tail', () => {
    const result = parseWorkerStream('', 'boom: something broke', 1);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('exited with code 1');
    expect(result.summary).toContain('boom: something broke');
  });

  it('maps a garbage / result-free stream on a clean exit to failed', () => {
    const result = parseWorkerStream('not json at all\n{"type":"assistant"}\n', 'warn', 0);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('no stream-json result event');
  });

  it('maps a result event flagged is_error to failed', () => {
    const line = `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'model refused' })}\n`;
    const result = parseWorkerStream(line, '', 0);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('model refused');
  });

  it('maps a result beginning WAITING-HUMAN: to waiting-human', () => {
    const result = parseWorkerStream(successLine('WAITING-HUMAN: need a decision on scope'), '', 0);
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toBe('WAITING-HUMAN: need a decision on scope');
  });

  it('maps a timeout to failed regardless of exit code', () => {
    const result = parseWorkerStream('', 'partial', null, { timedOut: true, timeoutMs: 1234 });
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('timed out after 1234ms');
  });

  it('maps an output-cap breach to failed', () => {
    const result = parseWorkerStream('', '', null, { exceeded: true, maxOutputBytes: 999 });
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('exceeded the 999-byte cap');
  });
});

describe('createClaudeWorkerAdapter.execute', () => {
  it('spawns with the built args/env/cwd, streams the prompt in, and resolves the parsed result', async () => {
    const fake = fakeProcess();
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      parentEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'nope' },
      spawn: (req) => { captured = req; return fake.proc; },
    });
    const promise = adapter.execute(executeInput());
    // Drive the fake child to completion.
    fake.emitStdout(successLine('worker finished'));
    fake.emitExit(0);
    const result = await promise;

    expect(result.state).toBe('succeeded');
    expect(result.summary).toBe('worker finished');
    expect(captured!.cwd).toBe('/srv/worktrees/run-1/attempt-1');
    expect(captured!.args).toContain('--model');
    expect(captured!.args[captured!.args.indexOf('--model') + 1]).toBe('claude-sonnet');
    expect(captured!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(captured!.env.PATH).toBe('/usr/bin');
    // The prompt went to stdin as stream-json, never argv.
    const stdinPayload = JSON.parse(fake.stdin.join('').trim());
    expect(stdinPayload.message.content[0].text).toContain('AUTHORITATIVE WORK ORDER');
    expect(captured!.args.join(' ')).not.toContain('AUTHORITATIVE WORK ORDER');
    expect(fake.proc.endStdin).toHaveBeenCalled();
  });

  it('C3: passes an inline --settings deny complement for a no-Bash (scanner) profile, env untouched', async () => {
    const fake = fakeProcess();
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => ({ allowedTools: ['Read', 'Glob', 'Grep', 'Write'], permissionMode: 'default' }),
      parentEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'nope' },
      spawn: (req) => { captured = req; return fake.proc; },
    });
    const promise = adapter.execute(executeInput({ workflowProfile: 'scanner', readScope: ['queue', 'orgs/kb-ops'], writeScope: ['orgs/kb-ops/output'] }));
    fake.emitStdout(successLine('done'));
    fake.emitExit(0);
    await promise;

    const args = captured!.args;
    const idx = args.indexOf('--settings');
    expect(idx).toBeGreaterThan(-1);
    expect(JSON.parse(args[idx + 1])).toEqual({
      permissions: { deny: ['Read(/dashboard/**)', 'Read(/memory/**)', 'Read(/scripts/**)'] },
    });
    // The env-strip invariant is unchanged — --settings does not reintroduce any credential var.
    expect(captured!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(captured!.env.PATH).toBe('/usr/bin');
  });

  it('C3: threads the adapter repoRoot into the --settings deny complement (adds the //-absolute companion)', async () => {
    const fake = fakeProcess();
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => ({ allowedTools: ['Read', 'Glob', 'Grep', 'Write'], permissionMode: 'default' }),
      parentEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'nope' },
      repoRoot: 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops',
      spawn: (req) => { captured = req; return fake.proc; },
    });
    const promise = adapter.execute(executeInput({ workflowProfile: 'scanner', readScope: ['queue', 'orgs/kb-ops'], writeScope: ['orgs/kb-ops/output'] }));
    fake.emitStdout(successLine('done'));
    fake.emitExit(0);
    await promise;

    const args = captured!.args;
    const deny = JSON.parse(args[args.indexOf('--settings') + 1]).permissions.deny as string[];
    expect(deny).toContain('Read(/dashboard/**)');
    expect(deny).toContain('Read(//C:/Users/danie/kb-worktrees/dashboard-ops/dashboard/**)');
    // Env-strip invariant unweakened.
    expect(captured!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(captured!.env.PATH).toBe('/usr/bin');
  });

  it('C3: passes NO --settings for a Bash (producer) profile', async () => {
    const fake = fakeProcess();
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => ({ allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'], permissionMode: 'default' }),
      spawn: (req) => { captured = req; return fake.proc; },
    });
    const promise = adapter.execute(executeInput({ workflowProfile: 'producer' }));
    fake.emitStdout(successLine('done'));
    fake.emitExit(0);
    await promise;
    expect(captured!.args).not.toContain('--settings');
  });

  it('tree-kills the child and resolves failed when the kill-timeout fires (fake timers)', async () => {
    vi.useFakeTimers();
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      spawn: () => fake.proc,
      killTree,
      timeoutMs: 5_000,
    });
    const promise = adapter.execute(executeInput());
    // Child never exits; advance past the kill-timeout.
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await promise;
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
    expect(fake.proc.kill).not.toHaveBeenCalled();
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('timed out after 5000ms');
  });

  it('tree-kills the child when the output cap is exceeded', async () => {
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      spawn: () => fake.proc,
      killTree,
      maxOutputBytes: 8,
    });
    const promise = adapter.execute(executeInput());
    fake.emitStdout('x'.repeat(64)); // blow past the 8-byte cap
    const result = await promise;
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('exceeded the 8-byte cap');
  });

  it('registers a cancel handle that tree-kills once and resolves a failed cancellation result', async () => {
    const fake = fakeProcess();
    const killTree = vi.fn();
    let cancel: (() => void) | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      spawn: () => fake.proc,
      killTree,
      registerCancellation: (operationKey, fn) => { expect(operationKey).toBe('automatic-attempt:attempt-1'); cancel = fn; },
    });
    const promise = adapter.execute(executeInput());
    expect(cancel).toBeTypeOf('function');
    cancel!();
    cancel!(); // idempotent — a second cancel must not kill again
    const result = await promise;
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('cancelled');
  });

  it('deregisters the cancellation on a normal completion so the registry does not leak', async () => {
    const fake = fakeProcess();
    const registry = new Map<string, () => void>();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      spawn: () => fake.proc,
      registerCancellation: (operationKey, fn) => { registry.set(operationKey, fn); },
      deregisterCancellation: (operationKey) => { registry.delete(operationKey); },
    });
    const promise = adapter.execute(executeInput());
    expect(registry.size).toBe(1); // registered at spawn
    fake.emitStdout(successLine('done'));
    fake.emitExit(0);
    await promise;
    expect(registry.size).toBe(0); // cleared on the normal settle path
  });

  it('deregisters the cancellation on an error completion so the registry does not leak', async () => {
    const fake = fakeProcess();
    const registry = new Map<string, () => void>();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => TOOL_POLICY,
      spawn: () => fake.proc,
      registerCancellation: (operationKey, fn) => { registry.set(operationKey, fn); },
      deregisterCancellation: (operationKey) => { registry.delete(operationKey); },
    });
    const promise = adapter.execute(executeInput());
    expect(registry.size).toBe(1);
    fake.emitError(new Error('spawn claude ENOENT'));
    await promise;
    expect(registry.size).toBe(0); // cleared on the error settle path too
  });

  it('resolves failed immediately on a child spawn/runtime error rather than waiting for the kill-timeout', async () => {
    const fake = fakeProcess();
    const adapter = createClaudeWorkerAdapter({ resolveToolPolicy: () => TOOL_POLICY, spawn: () => fake.proc });
    const promise = adapter.execute(executeInput());
    fake.emitError(new Error('spawn claude ENOENT'));
    const result = await promise;
    expect(result.state).toBe('failed');
    expect(result.summary).toContain('spawn claude ENOENT');
  });

  it('never invokes the process seam more than once and ignores a late exit after settling', async () => {
    const fake = fakeProcess();
    const spawn = vi.fn(() => fake.proc);
    const adapter = createClaudeWorkerAdapter({ resolveToolPolicy: () => TOOL_POLICY, spawn });
    const promise = adapter.execute(executeInput());
    fake.emitStdout(successLine('done'));
    fake.emitExit(0);
    fake.emitExit(1); // a late/duplicate exit must not change the settled result
    const result = await promise;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('succeeded');
  });
});
