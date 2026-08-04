import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCodexExecAdapter,
  type CodexExecProcess,
  type CodexExecSpawnRequest,
} from './codexExecAdapter.ts';
import type { ExecutionProfile } from './policy.ts';

const CODEX_PROFILE: ExecutionProfile = {
  id: 'worker-codex',
  role: 'worker',
  runtime: 'codex',
  model: 'gpt-5.3-codex',
  capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
};
const FAKE_PID = 4242;

/** A hermetic Codex child the test drives directly; no real CLI is ever spawned. */
function fakeProcess() {
  let stdout: (chunk: string) => void = () => {};
  let stderr: (chunk: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  let error: (err: Error) => void = () => {};
  const stdin: string[] = [];
  const proc: CodexExecProcess = {
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

function executeInput(overrides: Partial<Parameters<ReturnType<typeof createCodexExecAdapter>['execute']>[0]> = {}) {
  return {
    operationKey: 'automatic-attempt:attempt-1',
    subject: 'faceless-youtube',
    runRef: 'run-1',
    stageRef: 'stage-1',
    attemptRef: 'attempt-1',
    sessionRef: 'session-1',
    worktreePath: '/srv/worktrees/run-1/attempt-1',
    profile: CODEX_PROFILE,
    workflowProfile: 'producer' as string | null,
    skills: [] as readonly string[],
    action: 'produce:story',
    target: 'orgs/faceless-youtube/output',
    workOrder: 'Do the thing.',
    readScope: ['orgs/faceless-youtube'] as readonly string[],
    writeScope: ['orgs/faceless-youtube/output'] as readonly string[],
    checkpoints: [] as readonly string[],
    assignment: {
      agentId: 'fyt-codex', declarationPath: 'agents/fyt-codex.md', declarationHash: 'a'.repeat(64),
      profileId: CODEX_PROFILE.id, runtime: CODEX_PROFILE.runtime, model: CODEX_PROFILE.model,
    },
    instructionMarkdown: '# Bound worker\nDo not publish.',
    ...overrides,
  };
}

function probeEvents(message = 'PROBE-A-OK'): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: '019fce84-thread' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: message } }),
    JSON.stringify({ type: 'turn.completed', usage: {
      input_tokens: 14913, cached_input_tokens: 11008, cache_write_input_tokens: 0,
      output_tokens: 9, reasoning_output_tokens: 0,
    } }),
  ].join('\n') + '\n';
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('createCodexExecAdapter.execute', () => {
  it('spawns a first turn with the pinned headless argv and sends the prompt only over stdin', async () => {
    const fake = fakeProcess();
    let captured: CodexExecSpawnRequest | null = null;
    const adapter = createCodexExecAdapter({ spawner: (request) => { captured = request; return fake.proc; } });
    const promise = adapter.execute(executeInput());
    fake.emitStdout(probeEvents());
    fake.emitExit(0);

    await expect(promise).resolves.toMatchObject({
      state: 'succeeded', summary: 'PROBE-A-OK', usage: { inputTokens: 14913, outputTokens: 9, costUsdMicros: 0 },
      artifacts: [], checkpoints: [],
    });
    expect(captured!.cwd).toBe('/srv/worktrees/run-1/attempt-1');
    expect(captured!.args).toEqual([
      'exec', '-', '--json', '--model', 'gpt-5.3-codex', '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never',
      '-c', 'forced_login_method="chatgpt"',
      '-c', 'mcp_servers={}',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"',
      '--cd', '/srv/worktrees/run-1/attempt-1',
    ]);
    expect(fake.stdin.join('')).toContain('AUTHORITATIVE WORK ORDER');
    expect(captured!.args.join(' ')).not.toContain('AUTHORITATIVE WORK ORDER');
    expect(fake.proc.endStdin).toHaveBeenCalledOnce();
  });

  it('resumes a recorded thread with the resume-compatible pinned flags', async () => {
    const fake = fakeProcess();
    let captured: CodexExecSpawnRequest | null = null;
    const adapter = createCodexExecAdapter({
      resolveThread: (runRef, agentId) => {
        expect([runRef, agentId]).toEqual(['run-1', 'fyt-codex']);
        return '019fce84-prior-thread';
      },
      spawner: (request) => { captured = request; return fake.proc; },
    });
    const promise = adapter.execute(executeInput());
    fake.emitStdout(probeEvents());
    fake.emitExit(0);
    await promise;

    expect(captured!.args).toEqual([
      'exec', 'resume', '019fce84-prior-thread', '-', '--json',
      '-c', 'model=gpt-5.3-codex',
      '--ask-for-approval', 'never',
      '-c', 'forced_login_method="chatgpt"',
      '-c', 'mcp_servers={}',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"',
    ]);
    expect(captured!.args).not.toContain('--cd');
    expect(captured!.args).not.toContain('--sandbox');
  });

  it('records the emitted thread id from the JSONL stream', async () => {
    const fake = fakeProcess();
    const recordThread = vi.fn();
    const adapter = createCodexExecAdapter({ recordThread, spawner: () => fake.proc });
    const promise = adapter.execute(executeInput());
    fake.emitStdout(probeEvents());
    fake.emitExit(0);
    await promise;
    expect(recordThread).toHaveBeenCalledWith('run-1', 'fyt-codex', '019fce84-thread');
  });

  it('fails with the stderr tail on a nonzero exit', async () => {
    const fake = fakeProcess();
    const adapter = createCodexExecAdapter({ spawner: () => fake.proc });
    const promise = adapter.execute(executeInput());
    fake.emitStderr('codex denied the request');
    fake.emitExit(2);
    await expect(promise).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('codex denied the request') });
  });

  it('tree-kills and fails when the timeout fires', async () => {
    vi.useFakeTimers();
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createCodexExecAdapter({ spawner: () => fake.proc, killTree, timeoutMs: 5_000 });
    const promise = adapter.execute(executeInput());
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(promise).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('timed out after 5000ms') });
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
  });

  it('tree-kills and fails when stdout exceeds the output cap', async () => {
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createCodexExecAdapter({ spawner: () => fake.proc, killTree, maxOutputBytes: 8 });
    const promise = adapter.execute(executeInput());
    fake.emitStdout('x'.repeat(64));
    await expect(promise).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('exceeded the 8-byte cap') });
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
  });

  it('fails closed when the stream has no turn.completed terminal event', async () => {
    const fake = fakeProcess();
    const adapter = createCodexExecAdapter({ spawner: () => fake.proc });
    const promise = adapter.execute(executeInput());
    fake.emitStdout(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'claimed completion' } }) + '\n');
    fake.emitExit(0);
    await expect(promise).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('no turn.completed') });
  });
});
