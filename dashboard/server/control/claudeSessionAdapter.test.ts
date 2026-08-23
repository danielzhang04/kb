import { describe, expect, it, vi } from 'vitest';
import {
  mapStreamEventToPrivate,
  mapStreamLine,
  createClaudeSessionAdapter,
  type ClaudeSessionLaunch,
} from './claudeSessionAdapter.ts';
import type { ClaudeProcess, ClaudeSpawnRequest } from './claudeWorkerAdapter.ts';
import { DENIED_ENV_FRAGMENTS } from './childEnv.ts';
import type { ManagedStartSpec } from './broker.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';

const LAUNCH: ClaudeSessionLaunch = {
  cwd: '/srv/worktrees/run-1',
  model: 'claude-sonnet',
  allowedTools: ['Read', 'Bash'],
  permissionMode: 'default',
};

const SPEC: ManagedStartSpec = {
  runRef: 'run-1',
  sessionRef: 'session-1',
  role: 'worker',
  profileId: 'worker-claude-sonnet',
  approvedPrompt: 'AUTHORITATIVE WORK ORDER (follow these instructions):\nDo the thing.',
};

const FAKE_PID = 5353;

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

function observerHarness() {
  const events: PublicOperationalEvent[] = [];
  const exits: Array<{ code: number | null; error: string | null }> = [];
  return {
    events,
    exits,
    observer: {
      onEvent: (event: PublicOperationalEvent) => { events.push(event); },
      onExit: (code: number | null, error: string | null) => { exits.push({ code, error }); },
    },
  };
}

describe('mapStreamEventToPrivate', () => {
  it('maps a system init event to a lifecycle started event', () => {
    expect(mapStreamEventToPrivate({ type: 'system', subtype: 'init' })).toEqual([
      { kind: 'lifecycle', state: 'init', detail: null },
    ]);
  });

  it('maps assistant text and tool_use blocks, skipping unnameable tool_result blocks', () => {
    const events = mapStreamEventToPrivate({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'hello there' },
        { type: 'tool_use', name: 'Read', input: {} },
      ] },
    });
    expect(events).toEqual([
      { kind: 'message', visible: true, text: 'hello there' },
      { kind: 'tool', name: 'Read', status: 'started' },
    ]);
    const toolResult = mapStreamEventToPrivate({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } });
    expect(toolResult).toEqual([]);
  });

  it('projects NOTHING from user-type events, even a top-level text block', () => {
    // Defence in depth against a wire-format change: today Claude Code delivers tool output as
    // `tool_result` blocks (skipped for lack of a tool name), but if it ever hoisted that output
    // into a top-level `text` block on a user message it would be persisted verbatim as an event
    // summary. Only `assistant` events narrate; user events are echoes of worker output.
    expect(mapStreamEventToPrivate({
      type: 'user',
      message: { content: [{ type: 'text', text: 'code 123456 for user@example.com' }] },
    })).toEqual([]);
    expect(mapStreamLine(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'code 123456 for user@example.com' }] },
    }))).toEqual([]);
  });

  it('maps a success result to lifecycle succeeded and an error result to lifecycle failed', () => {
    expect(mapStreamEventToPrivate({ type: 'result', subtype: 'success', is_error: false, result: 'ok' }))
      .toEqual([{ kind: 'lifecycle', state: 'succeeded', detail: 'ok' }]);
    expect(mapStreamEventToPrivate({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'bad' }))
      .toEqual([{ kind: 'lifecycle', state: 'failed', detail: 'bad' }]);
  });

  it('fails closed on a result event missing subtype and is_error', () => {
    expect(mapStreamEventToPrivate({ type: 'result', result: 'unverified' }))
      .toEqual([{ kind: 'lifecycle', state: 'failed', detail: 'unverified' }]);
  });

  it('ignores unknown or malformed events', () => {
    expect(mapStreamEventToPrivate(null)).toEqual([]);
    expect(mapStreamEventToPrivate({ type: 'nonsense' })).toEqual([]);
  });
});

describe('mapStreamLine — redacted public projection', () => {
  it('parses a stream-json line into normalized public events', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'progressing' }] } });
    expect(mapStreamLine(line)).toEqual([{ kind: 'message', text: 'progressing' }]);
  });

  it('returns nothing for blank or malformed lines', () => {
    expect(mapStreamLine('')).toEqual([]);
    expect(mapStreamLine('{ not json')).toEqual([]);
  });
});

describe('createClaudeSessionAdapter.start', () => {
  it('spawns with the resolved launch, streams the approved prompt in, and emits mapped events', () => {
    const fake = fakeProcess();
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeSessionAdapter({
      resolveLaunch: () => LAUNCH,
      parentEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'nope' },
      spawn: (req) => { captured = req; return fake.proc; },
    });
    const harness = observerHarness();
    const child = adapter.start(SPEC, harness.observer);

    expect(captured!.cwd).toBe('/srv/worktrees/run-1');
    expect(captured!.args[captured!.args.indexOf('--model') + 1]).toBe('claude-sonnet');
    expect(captured!.env.ANTHROPIC_API_KEY).toBeUndefined();
    for (const name of Object.keys(captured!.env)) {
      expect(DENIED_ENV_FRAGMENTS.some((frag) => name.toUpperCase().includes(frag))).toBe(false);
    }
    // Approved prompt went to stdin as stream-json, never argv.
    expect(JSON.parse(fake.stdin.join('').trim()).message.content[0].text).toContain('AUTHORITATIVE WORK ORDER');
    expect(captured!.args.join(' ')).not.toContain('AUTHORITATIVE WORK ORDER');

    // A multi-line stdout chunk is buffered and each complete line becomes an event.
    fake.emitStdout(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'step one' }] } })}\n`);
    fake.emitStdout(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })}\n`);
    expect(harness.events).toEqual([
      { kind: 'message', text: 'step one' },
      { kind: 'tool', name: 'Bash', status: 'started' },
    ]);
    expect(typeof child.stop).toBe('function');
  });

  it('flushes the final unterminated line then reports a clean exit as (0, null)', () => {
    const fake = fakeProcess();
    const adapter = createClaudeSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);
    // No trailing newline — the line must still flush on exit.
    fake.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }));
    fake.emitExit(0);
    expect(harness.events).toEqual([{ kind: 'lifecycle', state: 'succeeded', detail: 'done' }]);
    expect(harness.exits).toEqual([{ code: 0, error: null }]);
  });

  it('reports a nonzero exit with the stderr tail as the error', () => {
    const fake = fakeProcess();
    const adapter = createClaudeSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);
    fake.emitStderr('fatal: model unavailable');
    fake.emitExit(1);
    expect(harness.exits).toEqual([{ code: 1, error: 'fatal: model unavailable' }]);
  });

  it('stop() tree-kills the child exactly once', () => {
    const fake = fakeProcess();
    const killTree = vi.fn();
    const adapter = createClaudeSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc, killTree });
    const harness = observerHarness();
    const child = adapter.start(SPEC, harness.observer);
    child.stop();
    child.stop();
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(FAKE_PID);
    expect(fake.proc.kill).not.toHaveBeenCalled();
  });

  it('reports a child spawn/runtime error as an immediate exit rather than waiting', () => {
    const fake = fakeProcess();
    const adapter = createClaudeSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc });
    const harness = observerHarness();
    adapter.start(SPEC, harness.observer);
    fake.emitError(new Error('spawn claude ENOENT'));
    expect(harness.exits).toEqual([{ code: null, error: 'spawn claude ENOENT' }]);
  });

  it('contains observer.onEvent exceptions so they never reach the daemon', () => {
    const fake = fakeProcess();
    const adapter = createClaudeSessionAdapter({ resolveLaunch: () => LAUNCH, spawn: () => fake.proc, killTree: vi.fn() });
    const child = adapter.start(SPEC, {
      onEvent: () => { throw new Error('observer blew up'); },
      onExit: () => {},
    });
    expect(() => fake.emitStdout(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } })}\n`)).not.toThrow();
    child.stop();
  });
});
