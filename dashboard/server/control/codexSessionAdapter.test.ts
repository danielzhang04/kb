import { describe, expect, it, vi } from 'vitest';
import {
  createCodexSessionAdapter,
  mapCodexEventToPrivate,
  mapCodexStreamLine,
  type CodexSessionLaunch,
} from './codexSessionAdapter.ts';
import type { CodexExecProcess, CodexExecSpawnRequest } from './codexExecAdapter.ts';
import type { ManagedStartSpec } from './broker.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';

const LAUNCH: CodexSessionLaunch = { cwd: '/srv/worktrees/run-1', model: 'gpt-5.6-sol' };
const SPEC: ManagedStartSpec = {
  runRef: 'run-1', sessionRef: 'session-1', role: 'manager',
  profileId: 'manager:codex:gpt-5.6-sol', approvedPrompt: 'Coordinate the approved run.',
};
const FAKE_PID = 6464;

function fakeProcess() {
  let stdout: (chunk: string) => void = () => {};
  let stderr: (chunk: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  let error: (err: Error) => void = () => {};
  const stdin: string[] = [];
  const proc: CodexExecProcess = {
    onStdout(cb) { stdout = cb; }, onStderr(cb) { stderr = cb; }, onExit(cb) { exit = cb; },
    onError(cb) { error = cb; }, pid: FAKE_PID, writeStdin(text) { stdin.push(text); },
    endStdin: vi.fn(), kill: vi.fn(),
  };
  return {
    proc, stdin,
    emitStdout: (chunk: string) => stdout(chunk), emitStderr: (chunk: string) => stderr(chunk),
    emitExit: (code: number | null) => exit(code), emitError: (err: Error) => error(err),
  };
}

function observerHarness() {
  const events: PublicOperationalEvent[] = [];
  const exits: Array<{ code: number | null; error: string | null }> = [];
  return {
    events, exits,
    observer: {
      onEvent: (event: PublicOperationalEvent) => { events.push(event); },
      onExit: (code: number | null, error: string | null) => { exits.push({ code, error }); },
    },
  };
}

describe('Codex JSONL public projection', () => {
  it('maps the live-proven event shapes and redacts agent messages', () => {
    const rows = [
      { type: 'thread.started', thread_id: '019-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'token sk-12345678901234567890' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 2 } },
    ];
    expect(rows.flatMap((row) => mapCodexStreamLine(JSON.stringify(row)))).toEqual([
      { kind: 'lifecycle', state: 'started', detail: null },
      { kind: 'lifecycle', state: 'turn-started', detail: null },
      { kind: 'message', text: 'token [token redacted]' },
      { kind: 'lifecycle', state: 'succeeded', detail: null },
    ]);
  });

  it('ignores malformed, unknown, and non-message item events', () => {
    expect(mapCodexStreamLine('{bad')).toEqual([]);
    expect(mapCodexEventToPrivate({ type: 'unknown' })).toEqual([]);
    expect(mapCodexEventToPrivate({ type: 'item.completed', item: { type: 'command_execution', command: 'secret' } })).toEqual([]);
  });
});

describe('createCodexSessionAdapter.start', () => {
  it('uses pinned codex exec argv, stdin-only prompt, records the thread, and streams events', async () => {
    const fake = fakeProcess();
    const recordThread = vi.fn().mockResolvedValue(undefined);
    let captured: CodexExecSpawnRequest | null = null;
    const adapter = createCodexSessionAdapter({
      resolveLaunch: () => LAUNCH,
      parentEnv: { PATH: '/usr/bin', OPENAI_API_KEY: 'nope' },
      spawn: (request) => { captured = request; return fake.proc; },
      recordThread,
    });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);

    expect(captured!.args).toEqual([
      'exec', '-', '--json', '--model', 'gpt-5.6-sol', '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never', '-c', 'forced_login_method="chatgpt"', '-c', 'mcp_servers={}',
      '-c', 'sandbox_workspace_write.network_access=false', '-c', 'web_search="disabled"',
      '--cd', '/srv/worktrees/run-1',
    ]);
    expect(captured!.env.OPENAI_API_KEY).toBeUndefined();
    expect(fake.stdin.join('')).toBe(SPEC.approvedPrompt);
    expect(captured!.args.join(' ')).not.toContain(SPEC.approvedPrompt);

    fake.emitStdout(`${JSON.stringify({ type: 'thread.started', thread_id: '019-thread' })}\n`);
    fake.emitStdout(`${JSON.stringify({ type: 'turn.started' })}\n`);
    fake.emitStdout(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'progress' } })}\n`);
    fake.emitStdout(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } }));
    fake.emitExit(0);
    await vi.waitFor(() => expect(harness.exits).toEqual([{ code: 0, error: null }]));
    expect(recordThread).toHaveBeenCalledWith(SPEC, '019-thread');
    expect(harness.events).toEqual([
      { kind: 'lifecycle', state: 'started', detail: null },
      { kind: 'lifecycle', state: 'turn-started', detail: null },
      { kind: 'message', text: 'progress' },
      { kind: 'lifecycle', state: 'succeeded', detail: null },
    ]);
  });

  it('resumes a resolved thread and surfaces async record failure through onExit', async () => {
    const fake = fakeProcess();
    let captured: CodexExecSpawnRequest | null = null;
    const adapter = createCodexSessionAdapter({
      resolveLaunch: () => LAUNCH, resolveThread: () => 'prior-thread',
      recordThread: (() => Promise.reject(new Error('chain disk unavailable'))) as never,
      spawn: (request) => { captured = request; return fake.proc; },
    });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);
    expect(captured!.args.slice(0, 5)).toEqual(['exec', 'resume', 'prior-thread', '-', '--json']);
    fake.emitStdout(`${JSON.stringify({ type: 'thread.started', thread_id: 'next-thread' })}\n`);
    fake.emitExit(0);
    await vi.waitFor(() => expect(harness.exits[0]?.error).toContain('chain disk unavailable'));
  });

  it('reports nonzero stderr and tree-kills exactly once on stop', async () => {
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createCodexSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc, killTree });
    const harness = observerHarness();
    const child = adapter.start(SPEC, harness.observer);
    child.stop(); child.stop();
    expect(killTree).toHaveBeenCalledOnce();
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
    fake.emitStderr('codex unavailable');
    fake.emitExit(2);
    await vi.waitFor(() => expect(harness.exits).toEqual([{ code: 2, error: 'codex unavailable' }]));
  });

  it('reports a spawn/runtime error without waiting for exit', async () => {
    const fake = fakeProcess();
    const adapter = createCodexSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);
    fake.emitError(new Error('spawn codex ENOENT'));
    await vi.waitFor(() => expect(harness.exits).toEqual([{ code: null, error: 'spawn codex ENOENT' }]));
  });
});
