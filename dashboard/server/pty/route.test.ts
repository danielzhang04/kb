/**
 * Hermetic tests for the persistent-session `/api/pty` WebSocket route + its REST companions. A fake
 * socket, preamble runner, audit sink, and PtyHost exercise the real gate/relay code and the real
 * persistent-session registry without a real ConPTY, audit write, STOP file, or git operation.
 *
 * Load-bearing order: Origin/Host -> fleet preamble -> session -> (open path only) cap -> create/attach.
 * Every allowed-origin attempt writes exactly one audit row. A socket close now DETACHES (the shell keeps
 * running); the shell dies only on an explicit close frame, a shell exit, or the shutdown drain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from './host.ts';
import { createPersistentSessionRegistry } from './persistentSessions.ts';
import type { PersistentSessionRegistry } from './persistentSessions.ts';
import { declaredWorkflowDefPath } from '../workflows/routes.ts';
import {
  buildSpawnCommand,
  handlePtyConnection,
  makePtyRouteContext,
  parseSpawnParams,
  registerPtyRoute,
  sessionParamFromUrl,
  tokenFromSubprotocol,
  workflowPrimingFileName,
} from './route.ts';
import type { PtyRouteContext, PtySocketLike } from './route.ts';
import { CommandNotFoundError } from './resolveCommand.ts';

/** The absolute path the tests' claude resolver returns. Hermetic: no test needs the CLI installed, and
 *  its ABSOLUTENESS is itself the property under test (node-pty cannot spawn a bare name). */
const FAKE_CLAUDE = process.platform === 'win32' ? 'C:\\fake\\bin\\claude.exe' : '/fake/bin/claude';

const SECRET = Buffer.from('pty-route-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const ALLOWED = ['http://localhost:4317'];
const OPEN_REQ: HostOpenRequest = { requestId: '', cwd: '/repo', cols: 80, rows: 24 };

function validToken(sub = 'operator-1'): string {
  return mintSession(sub, SESSION_CONFIG).token;
}

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}

function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

function recordingAppendAudit(): {
  fn: (repoRoot: string, event: AuditEvent) => AuditRow;
  rows: Array<{ repoRoot: string; event: AuditEvent }>;
} {
  const rows: Array<{ repoRoot: string; event: AuditEvent }> = [];
  const fn = (repoRoot: string, event: AuditEvent): AuditRow => {
    rows.push({ repoRoot, event });
    return { ts: 'fixed-ts', ...event };
  };
  return { fn, rows };
}

function fakeSocket() {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const listeners: {
    message: Array<(data: unknown) => void>;
    close: Array<() => void>;
    error: Array<(err?: unknown) => void>;
  } = { message: [], close: [], error: [] };
  let readyState = 1;

  const sock: PtySocketLike = {
    OPEN: 1,
    get readyState() {
      return readyState;
    },
    send(data) {
      sent.push(data);
    },
    close(code, reason) {
      closes.push({ code, reason });
      readyState = 3;
      for (const cb of [...listeners.close]) cb();
    },
    on(event, cb) {
      if (event === 'message') listeners.message.push(cb as (data: unknown) => void);
      else if (event === 'close') listeners.close.push(cb as () => void);
      else listeners.error.push(cb as (err?: unknown) => void);
    },
  };

  const emit = (event: 'message' | 'close' | 'error', value?: unknown): void => {
    if (event === 'message') for (const cb of [...listeners.message]) cb(value);
    else if (event === 'close') for (const cb of [...listeners.close]) cb();
    else for (const cb of [...listeners.error]) cb(value);
  };

  const controls = (): Array<Record<string, unknown>> =>
    sent.flatMap((raw) => {
      try {
        return [JSON.parse(raw) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

  return { sock, sent, closes, emit, controls };
}

function fakePtyHost(options: { spawnError?: Error; sessionId?: string } = {}) {
  const opens: HostOpenRequest[] = [];
  const stops: string[] = [];
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const dataCallbacks: Array<(chunk: string) => void> = [];
  const exitCallbacks: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  const sessionId = options.sessionId ?? 'pty-test-1';
  let live = false;

  const handle: PtyHandle = {
    pid: 4242,
    onData(cb) {
      dataCallbacks.push(cb);
    },
    onExit(cb) {
      exitCallbacks.push(cb);
    },
    write(data) {
      writes.push(data);
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill() {
      live = false;
    },
  };

  const host: PtyHost = {
    open(request): PtySession {
      opens.push(request);
      if (options.spawnError) throw options.spawnError;
      live = true;
      return { sessionId, handle };
    },
    stop(id) {
      stops.push(id);
      const existed = live && id === sessionId;
      live = false;
      return existed;
    },
    stopAll() {
      live = false;
    },
    sessions() {
      return live ? [sessionId] : [];
    },
  };

  return {
    host,
    opens,
    stops,
    writes,
    resizes,
    emitData: (chunk: string) => dataCallbacks.forEach((cb) => cb(chunk)),
    emitExit: (exitCode = 0) => exitCallbacks.forEach((cb) => cb({ exitCode })),
  };
}

/** Temp directories created by a test; swept after each so no priming file or fixture repo survives. */
const scratchDirs: string[] = [];
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (scratchDirs.length > 0) rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
});

function harness(options: {
  preamble?: PreambleRunner;
  host?: ReturnType<typeof fakePtyHost>;
  registry?: PersistentSessionRegistry;
  maxConcurrent?: number;
  appendAudit?: PtyRouteContext['appendAudit'];
  resolveAgentFile?: PtyRouteContext['resolveAgentFile'];
  resolveWorkflowFile?: PtyRouteContext['resolveWorkflowFile'];
  resolveClaudeFile?: PtyRouteContext['resolveClaudeFile'];
  repoRoot?: string;
  workflowPrimingRoot?: string;
} = {}): {
  ctx: PtyRouteContext;
  audit: ReturnType<typeof recordingAppendAudit>;
  host: ReturnType<typeof fakePtyHost>;
  registry: PersistentSessionRegistry;
  preambleCalls: () => number;
} {
  const audit = recordingAppendAudit();
  const host = options.host ?? fakePtyHost();
  const registry = options.registry ?? createPersistentSessionRegistry();
  const run = options.preamble ?? okPreamble();
  let calls = 0;
  const runPreamble: PreambleRunner = (repoRoot) => {
    calls += 1;
    return run(repoRoot);
  };
  const ctx = makePtyRouteContext({
    repoRoot: options.repoRoot ?? '/repo',
    sessionConfig: SESSION_CONFIG,
    allowedOrigins: ALLOWED,
    ptyHost: host.host,
    registry,
    runPreamble,
    appendAudit: options.appendAudit ?? audit.fn,
    maxConcurrent: options.maxConcurrent,
    // Hermetic by default: NO agent id and NO workflow ref resolves unless a test supplies the allowlist
    // explicitly, so a spawn test can never accidentally depend on this checkout's own `agents/` or
    // `orgs/**/workflows/` trees.
    resolveAgentFile: options.resolveAgentFile ?? (() => null),
    resolveWorkflowFile: options.resolveWorkflowFile ?? (() => null),
    // Never the repo, never the real daemon state root: a temp directory per test.
    workflowPrimingRoot: options.workflowPrimingRoot ?? scratchDir('kb-pty-priming-'),
    // Hermetic: a FIXED absolute path, so no test depends on this machine having the claude CLI
    // installed. Tests that care about the not-found branch inject a thrower.
    resolveClaudeFile: options.resolveClaudeFile ?? (() => FAKE_CLAUDE),
  });
  return { ctx, audit, host, registry, preambleCalls: () => calls };
}

function req(headers: Record<string, string | undefined>, url = '/api/pty') {
  return { headers, url } as unknown as Parameters<typeof handlePtyConnection>[1];
}

const GOOD_HEADERS = (token?: string): Record<string, string | undefined> => ({
  host: 'localhost:4317',
  origin: 'http://localhost:4317',
  'sec-websocket-protocol': token ? `kb-pty.v1, ${token}` : 'kb-pty.v1',
});

describe('tokenFromSubprotocol / sessionParamFromUrl', () => {
  it('reads only the second offered value after kb-pty.v1', () => {
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'kb-pty.v1, tok-abc' } })).toBe('tok-abc');
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'other, tok-abc' } })).toBeUndefined();
    expect(tokenFromSubprotocol({ headers: {} })).toBeUndefined();
  });

  it('reads the optional attach session id off the upgrade URL query', () => {
    expect(sessionParamFromUrl('/api/pty?session=pty-9')).toBe('pty-9');
    expect(sessionParamFromUrl('/api/pty')).toBeUndefined();
    expect(sessionParamFromUrl(undefined)).toBeUndefined();
  });
});

describe('parseSpawnParams / buildSpawnCommand — the "Run agent" admission rules', () => {
  it('treats an absent spawn pair as the ordinary shell open', () => {
    expect(parseSpawnParams('/api/pty')).toEqual({ ok: true, spawn: null });
    expect(parseSpawnParams(undefined)).toEqual({ ok: true, spawn: null });
    expect(parseSpawnParams('/api/pty?session=pty-9')).toEqual({ ok: true, spawn: null });
  });

  it('accepts only the three exact known modes with exactly their required companion parameter', () => {
    expect(parseSpawnParams('/api/pty?spawn=claude')).toEqual({ ok: true, spawn: { mode: 'claude' } });
    expect(parseSpawnParams('/api/pty?spawn=agent&agent=fyt-runner')).toEqual({
      ok: true,
      spawn: { mode: 'agent', agentId: 'fyt-runner' },
    });
    expect(parseSpawnParams('/api/pty?spawn=workflow&workflow=video-run')).toEqual({
      ok: true,
      spawn: { mode: 'workflow', workflowRef: 'video-run' },
    });
  });

  it('refuses every malformed, ambiguous, or attach-combined spawn request', () => {
    expect(parseSpawnParams('/api/pty?spawn=bash')).toEqual({ ok: false, reason: 'unknown-spawn-mode' });
    expect(parseSpawnParams('/api/pty?agent=fyt-runner')).toEqual({ ok: false, reason: 'unknown-spawn-mode' });
    expect(parseSpawnParams('/api/pty?spawn=agent')).toEqual({ ok: false, reason: 'agent-required' });
    expect(parseSpawnParams('/api/pty?spawn=agent&agent=')).toEqual({ ok: false, reason: 'agent-required' });
    expect(parseSpawnParams('/api/pty?spawn=claude&agent=fyt-runner')).toEqual({ ok: false, reason: 'agent-not-allowed' });
    // An attach reuses a live shell and spawns nothing; silently ignoring a spawn there would be a lie.
    expect(parseSpawnParams('/api/pty?session=pty-9&spawn=claude')).toEqual({ ok: false, reason: 'spawn-with-attach' });
  });

  it('refuses every malformed or cross-wired WORKFLOW spawn request', () => {
    expect(parseSpawnParams('/api/pty?spawn=workflow')).toEqual({ ok: false, reason: 'workflow-required' });
    expect(parseSpawnParams('/api/pty?spawn=workflow&workflow=')).toEqual({ ok: false, reason: 'workflow-required' });
    expect(parseSpawnParams('/api/pty?spawn=workflow&agent=fyt-runner')).toEqual({ ok: false, reason: 'agent-not-allowed' });
    expect(parseSpawnParams('/api/pty?spawn=workflow&workflow=video-run&agent=fyt-runner')).toEqual({ ok: false, reason: 'agent-not-allowed' });
    expect(parseSpawnParams('/api/pty?spawn=claude&workflow=video-run')).toEqual({ ok: false, reason: 'workflow-not-allowed' });
    expect(parseSpawnParams('/api/pty?spawn=agent&agent=fyt-runner&workflow=video-run')).toEqual({ ok: false, reason: 'workflow-not-allowed' });
    // A BARE workflow= is NOT an ordinary shell open — same rule a bare agent= has always had.
    expect(parseSpawnParams('/api/pty?workflow=video-run')).toEqual({ ok: false, reason: 'unknown-spawn-mode' });
    expect(parseSpawnParams('/api/pty?session=pty-9&spawn=workflow&workflow=video-run')).toEqual({ ok: false, reason: 'spawn-with-attach' });
  });

  it('builds an ARGV ARRAY, with the server-resolved priming path as its own element', () => {
    const stub = () => FAKE_CLAUDE;
    expect(buildSpawnCommand({ mode: 'claude' }, null, stub)).toEqual({ file: FAKE_CLAUDE, args: [] });
    expect(buildSpawnCommand({ mode: 'agent', agentId: 'fyt-runner' }, '/repo/agents/fyt-runner.md', stub)).toEqual({
      file: FAKE_CLAUDE,
      args: ['--append-system-prompt-file', '/repo/agents/fyt-runner.md'],
    });
    expect(buildSpawnCommand({ mode: 'workflow', workflowRef: 'video-run' }, '/state/pty-priming/workflow-video-run.md', stub)).toEqual({
      file: FAKE_CLAUDE,
      args: ['--append-system-prompt-file', '/state/pty-priming/workflow-video-run.md'],
    });
  });

  /**
   * THE REGRESSION PIN for the live "Run agent / Run workflow dies instantly" defect.
   *
   * The bare name `claude` reached node-pty, whose ConPTY agent does not PATHEXT-search an
   * extensionless name, and every spawn failed with an empty `File not found: `. Shell tabs were
   * unaffected because the default shell is `ComSpec`, already absolute. `file` must therefore be an
   * ABSOLUTE path in every spawn mode — not the bare command name.
   */
  it('emits an ABSOLUTE file, never the bare command name, in every spawn mode', () => {
    const stub = () => FAKE_CLAUDE;
    for (const command of [
      buildSpawnCommand({ mode: 'claude' }, null, stub),
      buildSpawnCommand({ mode: 'agent', agentId: 'a' }, '/repo/agents/a.md', stub),
      buildSpawnCommand({ mode: 'workflow', workflowRef: 'w' }, '/state/w.md', stub),
    ]) {
      expect(command.file).not.toBe('claude');
      expect(isAbsolute(command.file)).toBe(true);
    }
  });

  it('propagates a not-found resolution instead of falling back to the bare name', () => {
    const missing = () => {
      throw new CommandNotFoundError('claude', 3);
    };
    expect(() => buildSpawnCommand({ mode: 'claude' }, null, missing)).toThrow(CommandNotFoundError);
    expect(() => buildSpawnCommand({ mode: 'agent', agentId: 'a' }, '/repo/agents/a.md', missing)).toThrow(
      CommandNotFoundError,
    );
  });

  it('refuses to build a primed argv without a resolved path rather than dropping the flag', () => {
    expect(() => buildSpawnCommand({ mode: 'agent', agentId: 'x' }, null)).toThrow(/server-resolved/);
    expect(() => buildSpawnCommand({ mode: 'workflow', workflowRef: 'x' }, null)).toThrow(/server-generated/);
  });

  it('derives a deterministic per-ref priming filename that can never carry a path separator', () => {
    expect(workflowPrimingFileName('video-run')).toBe('workflow-video-run.md');
    expect(workflowPrimingFileName('video-run')).toBe(workflowPrimingFileName('video-run'));
    const hostile = workflowPrimingFileName('../../etc/passwd');
    expect(hostile).toMatch(/^workflow-[a-f0-9]{32}\.md$/);
    expect(hostile).not.toContain('/');
    expect(hostile).not.toContain('..');
  });
});

describe('agent-primed spawn (Run agent)', () => {
  const ALLOWLIST: PtyRouteContext['resolveAgentFile'] = (repoRoot, agentId) =>
    agentId === 'fyt-runner' ? `${repoRoot}/agents/fyt-runner.md` : null;

  it('spawns claude primed with the SERVER-resolved declaration path, in the repo the daemon serves', async () => {
    const h = harness({ resolveAgentFile: ALLOWLIST });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken()), '/api/pty?spawn=agent&agent=fyt-runner'), h.ctx);

    expect(h.host.opens).toHaveLength(1);
    expect(h.host.opens[0].command).toEqual({
      file: FAKE_CLAUDE,
      args: ['--append-system-prompt-file', '/repo/agents/fyt-runner.md'],
    });
    expect(h.host.opens[0].cwd).toBe('/repo'); // never a client-supplied cwd
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'opened',
      detail: { spawn: 'agent', agentId: 'fyt-runner' },
    });
  });

  it('spawns a plain claude with no priming argument for the toggle\'s other position', async () => {
    const h = harness({ resolveAgentFile: ALLOWLIST });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken()), '/api/pty?spawn=claude'), h.ctx);

    expect(h.host.opens[0].command).toEqual({ file: FAKE_CLAUDE, args: [] });
    expect(h.audit.rows[0].event).toMatchObject({ result: 'opened', detail: { spawn: 'claude' } });
  });

  /**
   * The live failure wrote `spawn-failed` with `error: "File not found: "` — an EMPTY name that told
   * nobody anything. A missing CLI must now be refused BEFORE the spawn, under its own name, and must
   * never reach the pty host.
   */
  it('refuses with a NAMED reason when claude is not on the child PATH, and spawns nothing', async () => {
    const h = harness({
      resolveAgentFile: ALLOWLIST,
      resolveClaudeFile: () => {
        throw new CommandNotFoundError('claude', 7);
      },
    });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken()), '/api/pty?spawn=agent&agent=fyt-runner'), h.ctx);

    expect(h.host.opens).toHaveLength(0); // nothing was ever spawned
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'claude-not-found-on-path',
      detail: { command: 'claude', searchedDirs: 7 },
    });
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'claude-not-found-on-path' });
    expect(ws.closes[0]?.reason).toBe('claude-not-found-on-path');
  });

  it('leaves the default shell open byte-identical when no spawn parameter is present', async () => {
    const h = harness({ resolveAgentFile: ALLOWLIST });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    expect(h.host.opens[0].command).toBeUndefined();
    expect(h.audit.rows[0].event).toMatchObject({ result: 'opened', detail: { spawn: 'shell' } });
  });

  /**
   * The session LIST has to say what each session is, not just that it exists. Without it an embedded
   * console (an agent's own detail) cannot tell "the shell already primed for this agent" from "somebody
   * else's shell", so remounting that surface would spawn a second one — and every leaked shell is one
   * the Terminal's tabs can no longer open, since the 8-terminal cap is daemon-wide.
   */
  it('records what each session was opened as, so the list can be matched to an entity', async () => {
    const registry = createPersistentSessionRegistry();
    const primed = harness({ resolveAgentFile: ALLOWLIST, registry, host: fakePtyHost({ sessionId: 'pty-agent' }) });
    await handlePtyConnection(
      fakeSocket().sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=agent&agent=fyt-runner'),
      primed.ctx,
    );
    const plain = harness({ resolveAgentFile: ALLOWLIST, registry, host: fakePtyHost({ sessionId: 'pty-shell' }) });
    await handlePtyConnection(fakeSocket().sock, req(GOOD_HEADERS(validToken())), plain.ctx);

    const byId = new Map(registry.list('operator-1').map((s) => [s.sessionId, s]));
    expect(byId.get('pty-agent')).toMatchObject({ kind: 'agent', targetRef: 'fyt-runner' });
    // The login shell names no entity and must not be adoptable by any surface looking for one.
    expect(byId.get('pty-shell')).toMatchObject({ kind: 'shell', targetRef: null });
  });

  it('refuses an agent id that is not on the roster BEFORE anything is spawned', async () => {
    const h = harness({ resolveAgentFile: ALLOWLIST });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken()), '/api/pty?spawn=agent&agent=not-an-agent'), h.ctx);

    expect(h.host.opens).toHaveLength(0);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unknown-agent' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'unknown-agent', detail: { agentId: 'not-an-agent' } });
  });

  it('refuses a traversing id without ever handing it to the resolver as a path', async () => {
    const seen: string[] = [];
    const h = harness({
      resolveAgentFile: (_root, agentId) => {
        seen.push(agentId);
        return null; // the real allowlist rejects it; this proves nothing is spawned either way
      },
    });
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=agent&agent=..%2F..%2Fetc%2Fpasswd'),
      h.ctx,
    );

    expect(seen).toEqual(['../../etc/passwd']); // reaches the ALLOWLIST, never a join
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unknown-agent' });
  });

  it('refuses an unknown spawn mode without consulting the roster or the cap', async () => {
    const resolver = vi.fn(() => '/repo/agents/fyt-runner.md');
    const h = harness({ resolveAgentFile: resolver });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken()), '/api/pty?spawn=bash'), h.ctx);

    expect(resolver).not.toHaveBeenCalled();
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'bad-spawn-request' });
    expect(h.audit.rows[0].event).toMatchObject({ result: 'bad-spawn-request', detail: { reason: 'unknown-spawn-mode' } });
  });

  it('refuses a spawn request before the session gate has passed nothing — auth still wins', async () => {
    const resolver = vi.fn(() => '/repo/agents/fyt-runner.md');
    const h = harness({ resolveAgentFile: resolver });
    const ws = fakeSocket();
    // No bearer in the subprotocol: the session refusal must come first, and no roster read may happen.
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(), '/api/pty?spawn=agent&agent=fyt-runner'), h.ctx);

    expect(resolver).not.toHaveBeenCalled();
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unauthenticated' });
  });
});

describe('workflow-primed spawn (Run workflow)', () => {
  /**
   * A scratch repo whose definition has ZERO executable assignment — no `manager:`, no stage
   * `agentId`/`profileId`. That is the shape of ALL FIVE real definitions in this repo today, so it is
   * the shape that must spawn cleanly. Governance (`governedBy`) is what names the cast.
   */
  function zeroAssignmentRepo(options: { withAgents?: boolean } = {}): string {
    const repoRoot = scratchDir('kb-pty-workflow-repo-');
    const workflows = join(repoRoot, 'orgs', 'kb-ops', 'workflows');
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      join(workflows, 'email-triage.md'),
      [
        '---', 'id: email-triage', 'project: kb-ops', 'title: Email triage (draft-only)', 'profile: gmail-triage',
        'governedBy: chief',
        'stages:',
        '  - id: triage', '    title: Triage the inbox', '    action: research:email-triage',
        '    target: orgs/kb-ops/output', '    riskTier: T2', '    workOrder: triage it',
        '  - id: report', '    title: Write the report', '    action: draft:triage-report',
        '    target: orgs/kb-ops/output', '    workOrder: write it', '    dependsOn: [triage]',
        '    governedBy: scribe',
        '---', 'body', '',
      ].join('\n'),
      'utf8',
    );
    if (options.withAgents) {
      const agents = join(repoRoot, 'agents');
      mkdirSync(agents, { recursive: true });
      for (const [id, role] of [['chief', 'manage'], ['scribe', 'work']]) {
        writeFileSync(
          join(agents, `${id}.md`),
          ['---', `id: ${id}`, `role: ${role}`, 'runtime: claude', 'model: claude-sonnet-5', 'projects: [kb-ops]', 'runner-bound: true', '---', 'Bounded declaration.', ''].join('\n'),
          'utf8',
        );
      }
    }
    return repoRoot;
  }

  it('spawns claude primed with a GENERATED file outside the repo, naming the resolved cast', async () => {
    const repoRoot = zeroAssignmentRepo({ withAgents: true });
    const primingRoot = scratchDir('kb-pty-priming-out-');
    // The REAL allowlist and the REAL priming writer — only the repo root and the state root are scratch.
    const h = harness({ repoRoot, workflowPrimingRoot: primingRoot, resolveWorkflowFile: declaredWorkflowDefPath });
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=workflow&workflow=email-triage'),
      h.ctx,
    );

    expect(h.host.opens).toHaveLength(1);
    const command = h.host.opens[0].command as { file: string; args: readonly string[] };
    expect(command.file).toBe(FAKE_CLAUDE);
    expect(command.args[0]).toBe('--append-system-prompt-file');
    const primingPath = command.args[1];
    expect(primingPath).toBe(join(primingRoot, 'workflow-email-triage.md'));
    expect(primingPath.startsWith(repoRoot)).toBe(false); // NEVER inside the repo
    expect(h.host.opens[0].cwd).toBe(repoRoot); // still the repo the daemon serves

    const primed = readFileSync(primingPath, 'utf8');
    expect(primed).toContain('# Governing agent — workflow: Email triage (draft-only)');
    expect(primed).toContain('HEAD, GOVERNING agent');
    expect(primed).toContain('- workflow ref: email-triage');
    expect(primed).toContain('- definition (repo-relative): orgs/kb-ops/workflows/email-triage.md');
    expect(primed).toContain('- default manager: chief (claude-sonnet-5) [governed-by]');
    expect(primed).toContain('triage — Triage the inbox — research:email-triage → chief (claude-sonnet-5) [manager-default]');
    expect(primed).toContain('report — Write the report — draft:triage-report → scribe (claude-sonnet-5) [stage-governed-by]');
    expect(primed).toContain('CONVERSATIONALLY');
    expect(primed).not.toContain('CLAUDE_CODE_OAUTH_TOKEN'); // no credential name ever reaches the file

    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'opened',
      detail: { spawn: 'workflow', workflowRef: 'email-triage' },
    });
  });

  it('spawns CLEANLY for a def with no resolvable cast, printing the honest refusal per stage', async () => {
    // Zero declared agents in the project: manager null, every stage null. The spawn must still succeed.
    const repoRoot = zeroAssignmentRepo();
    const primingRoot = scratchDir('kb-pty-priming-empty-');
    const h = harness({ repoRoot, workflowPrimingRoot: primingRoot, resolveWorkflowFile: declaredWorkflowDefPath });
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=workflow&workflow=email-triage'),
      h.ctx,
    );

    expect(h.host.opens).toHaveLength(1);
    expect(h.registry.liveCount()).toBe(1);
    const primed = readFileSync((h.host.opens[0].command as { args: readonly string[] }).args[1], 'utf8');
    expect(primed).toContain('- default manager: no default agent resolvable');
    expect(primed).toContain('triage — Triage the inbox — research:email-triage → no default agent resolvable');
    expect(primed).toContain('report — Write the report — draft:triage-report → no default agent resolvable');
    expect(h.audit.rows[0].event).toMatchObject({ result: 'opened', detail: { spawn: 'workflow' } });
  });

  it('refuses an unknown workflow ref BEFORE anything is spawned or written', async () => {
    const primingRoot = scratchDir('kb-pty-priming-unknown-');
    const h = harness({ workflowPrimingRoot: primingRoot }); // default allowlist resolves nothing
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=workflow&workflow=not-a-workflow'),
      h.ctx,
    );

    expect(h.host.opens).toHaveLength(0);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unknown-workflow' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'unknown-workflow', detail: { workflowRef: 'not-a-workflow' } });
  });

  it('refuses a traversing ref without ever handing it to a path join', async () => {
    const seen: string[] = [];
    const h = harness({
      resolveWorkflowFile: (_root, ref) => {
        seen.push(ref);
        return null;
      },
    });
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken()), '/api/pty?spawn=workflow&workflow=..%2F..%2Fetc%2Fpasswd'),
      h.ctx,
    );

    expect(seen).toEqual(['../../etc/passwd']); // reaches the ALLOWLIST, never a join
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unknown-workflow' });
  });

  it('refuses a workflow spawn before authentication has passed — auth still wins', async () => {
    const resolver = vi.fn(() => '/repo/orgs/kb-ops/workflows/email-triage.md');
    const h = harness({ resolveWorkflowFile: resolver });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(), '/api/pty?spawn=workflow&workflow=email-triage'), h.ctx);

    expect(resolver).not.toHaveBeenCalled();
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unauthenticated' });
  });
});

describe('makePtyRouteContext fail-closed host (N4)', () => {
  it('THROWS when no ptyHost is supplied rather than fabricating an ungated host', () => {
    // The daemon builds ONE fleet-gated host and passes it in; a context with no host would otherwise
    // silently fall back to a raw `createPtyHost` that bypasses the fleet gate. Construction must fail closed.
    expect(() => makePtyRouteContext({ sessionConfig: SESSION_CONFIG })).toThrow(/ptyHost is required/);
  });

  it('builds a context when the (gated) host is supplied', () => {
    const host = fakePtyHost();
    const ctx = makePtyRouteContext({
      sessionConfig: SESSION_CONFIG,
      allowedOrigins: ALLOWED,
      ptyHost: host.host,
    });
    expect(ctx.ptyHost).toBe(host.host);
  });
});

describe('handlePtyConnection gate ordering and audit (open path)', () => {
  it('rejects a bad Origin/Host before preamble and does not audit it as an allowed-origin attempt', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req({ host: 'evil.example', origin: 'http://evil.example', 'sec-websocket-protocol': `kb-pty.v1, ${validToken()}` }),
      h.ctx,
    );
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.preambleCalls()).toBe(0);
    expect(h.host.opens).toHaveLength(0);
    expect(h.audit.rows).toHaveLength(0);
  });

  it('runs the fleet preamble before session validation and audits fleet-frozen exactly once', async () => {
    const h = harness({ preamble: frozenPreamble('STOP file present - fleet is frozen') });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.preambleCalls()).toBe(1);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'fleet-frozen' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-open', result: 'fleet-frozen' });
  });

  it('audits an unauthenticated attempt exactly once and never spawns', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unauthenticated' });
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event.result).toBe('unauthenticated');
  });

  it('caps on LIVE SESSIONS (not sockets): a full registry refuses a new open with one audit row', async () => {
    const registry = createPersistentSessionRegistry();
    // Fill the registry to the ceiling with sessions from throwaway hosts (distinct ids).
    registry.create('filler', fakePtyHost({ sessionId: 'pty-fill-a' }).host, OPEN_REQ);
    registry.create('filler', fakePtyHost({ sessionId: 'pty-fill-b' }).host, OPEN_REQ);
    const h = harness({ registry, maxConcurrent: 2 });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-cap'))), h.ctx);
    expect(h.host.opens).toHaveLength(0); // never spawned
    expect(registry.liveCount()).toBe(2); // attach never consumed a slot
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'too-many-terminals' });
    expect(ws.closes[0]?.code).toBe(1013);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'too-many-terminals', owner: 'operator-cap' });
  });

  it('audits spawn failure exactly once and consumes no session slot', async () => {
    const host = fakePtyHost({ spawnError: new Error('ConPTY unavailable') });
    const h = harness({ host });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-spawn'))), h.ctx);
    expect(host.opens).toHaveLength(1);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'spawn-failed' });
    expect(ws.closes[0]?.code).toBe(1011);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'spawn-failed', owner: 'operator-spawn' });
  });
});

describe('handlePtyConnection in-process PTY relay (open path)', () => {
  it('kills the created session and releases exactly once when the opened audit throws after spawn', async () => {
    let auditCalls = 0;
    const h = harness({
      appendAudit: () => {
        auditCalls += 1;
        throw new Error('audit git push failed');
      },
    });
    const ws = fakeSocket();

    await expect(
      handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-audit-fail'))), h.ctx),
    ).resolves.toBeUndefined();

    expect(auditCalls).toBe(1);
    expect(h.host.opens).toHaveLength(1); // failure is specifically post-spawn
    expect(h.host.stops).toEqual(['pty-test-1']); // the created session was killed
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'audit-failed' });
    expect(ws.closes).toContainEqual({ code: 1011, reason: 'audit-failed' });

    // Late duplicate lifecycle events stay idempotent (no second stop / audit row).
    ws.emit('close');
    ws.emit('error', new Error('late duplicate event'));
    h.host.emitExit(1);
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(h.registry.liveCount()).toBe(0);
    expect(auditCalls).toBe(1);
  });

  it('spawns with the governed defaults, sends the session bind frame, audits opened once, and pumps bytes', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-live'))), h.ctx);

    expect(h.host.opens).toEqual([{ requestId: '', cwd: '/repo', cols: 80, rows: 24 }]);
    expect(ws.controls()).toContainEqual({ type: 'session', sessionId: 'pty-test-1' });
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'opened',
      owner: 'operator-live',
      detail: { sessionId: 'pty-test-1' },
    });
    expect(h.registry.liveCount()).toBe(1);

    h.host.emitData('hello from shell');
    expect(ws.sent).toContain('hello from shell');
    ws.emit('message', 'Get-Location\r');
    expect(h.host.writes).toContain('Get-Location\r');
    ws.emit('message', JSON.stringify({ type: 'resize', cols: 121.9, rows: 42.7 }));
    expect(h.host.resizes).toContainEqual({ cols: 121, rows: 42 });
  });

  it('buffers shell output emitted during the async opened-audit and flushes it after the audit commits', async () => {
    const h = harness();
    let releaseAudit!: () => void;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let auditReached = false;
    const slowAudit: PtyRouteContext['appendAudit'] = async (_root, event) => {
      auditReached = true;
      await auditGate;
      return { ts: 'now', ...event };
    };
    const slow = harness({ host: h.host, appendAudit: slowAudit });
    const ws = fakeSocket();
    const connection = handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-early'))), slow.ctx);
    // Deterministically reach the audit await (the handler now also awaits the locked preamble first),
    // then emit startup output while the audit is still pending.
    while (!auditReached) await new Promise((resolve) => setTimeout(resolve, 0));
    h.host.emitData('PS C:\\kb> ');
    expect(ws.sent).not.toContain('PS C:\\kb> ');
    releaseAudit();
    await connection;
    expect(ws.sent).toContain('PS C:\\kb> ');
    // Post-audit output flows directly, after the flushed backlog.
    h.host.emitData('live');
    expect(ws.sent.indexOf('PS C:\\kb> ')).toBeLessThan(ws.sent.indexOf('live'));
  });

  it('a socket close DETACHES only — the persistent shell keeps running (no host stop)', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);
    expect(h.registry.liveCount()).toBe(1);

    ws.emit('close'); // a page reload / nav-away
    ws.emit('error', new Error('late duplicate event'));
    expect(h.host.stops).toEqual([]); // never killed
    expect(h.registry.liveCount()).toBe(1); // shell still alive, still buffering
    expect(h.audit.rows).toHaveLength(1);
  });

  it('an explicit {type:close} frame kills the session and closes the socket, with no extra audit row', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    ws.emit('message', JSON.stringify({ type: 'close' }));
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.closes).toContainEqual({ code: 1000, reason: 'closed by operator' });
    expect(h.audit.rows).toHaveLength(1); // closes are not audited
  });

  it('a shell exit closes the WebSocket and removes the session from the registry', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    h.host.emitExit(0);
    expect(ws.closes).toContainEqual({ code: 1000, reason: 'shell exited' });
    expect(h.registry.liveCount()).toBe(0);
    expect(h.audit.rows).toHaveLength(1);
  });
});

describe('handlePtyConnection attach path', () => {
  it('reattaches to an existing session, auditing pty-attach and replaying scrollback after the bind frame', async () => {
    const h = harness();
    const seeded = h.registry.create('operator-1', h.host.host, OPEN_REQ);
    h.host.emitData('scrollback-line\n'); // buffered while detached

    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), `/api/pty?session=${seeded.sessionId}`),
      h.ctx,
    );

    expect(h.host.opens).toHaveLength(1); // no NEW spawn — reused the seeded session
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-attach', result: 'attached', owner: 'operator-1' });
    // Bind frame precedes the replayed scrollback.
    const bindIdx = ws.sent.findIndex((s) => s.includes('"type":"session"'));
    const replayIdx = ws.sent.indexOf('scrollback-line\n');
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(replayIdx).toBeGreaterThan(bindIdx);
  });

  it('holds attach output until the attach audit commits (fail-closed)', async () => {
    const h = harness();
    const seeded = h.registry.create('operator-1', h.host.host, OPEN_REQ);
    let releaseAudit!: () => void;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    const slowAudit: PtyRouteContext['appendAudit'] = async (_root, event) => {
      await auditGate;
      return { ts: 'now', ...event };
    };
    const slow = harness({ host: h.host, registry: h.registry, appendAudit: slowAudit });
    const ws = fakeSocket();
    const connection = handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), `/api/pty?session=${seeded.sessionId}`),
      slow.ctx,
    );
    await Promise.resolve();
    h.host.emitData('secret-before-commit');
    expect(ws.sent).not.toContain('secret-before-commit'); // nothing streams before the audit commits
    releaseAudit();
    await connection;
    expect(ws.sent).toContain('secret-before-commit'); // replayed after commit
  });

  it('refuses an unknown/not-owned session with one pty-attach session-not-found row', async () => {
    const h = harness();
    h.registry.create('someone-else', h.host.host, OPEN_REQ); // owned by another sub

    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), '/api/pty?session=pty-test-1'),
      h.ctx,
    );

    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'session-not-found' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-attach', result: 'session-not-found' });
  });
});

describe('registerPtyRoute REST session endpoints', () => {
  async function restApp(
    registry: PersistentSessionRegistry,
    resolveAgentFile: PtyRouteContext['resolveAgentFile'] = () => null,
    resolveWorkflowFile: PtyRouteContext['resolveWorkflowFile'] = () => null,
  ) {
    const app = Fastify({ logger: false });
    const host = fakePtyHost();
    const ctx = makePtyRouteContext({
      repoRoot: '/repo',
      sessionConfig: SESSION_CONFIG,
      allowedOrigins: ALLOWED,
      ptyHost: host.host,
      registry,
      runPreamble: okPreamble(),
      appendAudit: recordingAppendAudit().fn,
      resolveAgentFile,
      resolveWorkflowFile,
      workflowPrimingRoot: scratchDir('kb-pty-priming-rest-'),
    });
    await registerPtyRoute(app, ctx);
    await app.ready();
    return app;
  }

  /**
   * Admission control on the UPGRADE REQUEST itself: an unknown agent or a malformed spawn mode is a
   * plain HTTP 400 and no WebSocket is ever established. `/api/pty` answers 404 to an ordinary (non
   * upgrade) GET, so a 400 here is unambiguous proof the hook refused before the route body.
   */
  it('400s an unknown agent id and a malformed spawn mode on the upgrade, and lets a known agent through', async () => {
    const app = await restApp(
      createPersistentSessionRegistry(),
      (repoRoot, agentId) => (agentId === 'fyt-runner' ? `${repoRoot}/agents/fyt-runner.md` : null),
    );
    try {
      const unknown = await app.inject({ method: 'GET', url: '/api/pty?spawn=agent&agent=ghost' });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toEqual({ error: 'unknown-agent' });

      const traversal = await app.inject({ method: 'GET', url: '/api/pty?spawn=agent&agent=..%2F..%2Fsecrets' });
      expect(traversal.statusCode).toBe(400);

      const badMode = await app.inject({ method: 'GET', url: '/api/pty?spawn=bash' });
      expect(badMode.statusCode).toBe(400);
      expect(badMode.json()).toMatchObject({ error: 'bad-spawn-request', reason: 'unknown-spawn-mode' });

      // A roster-known agent clears admission; the non-upgrade GET then falls through to the route's
      // own 404, which is exactly what proves the hook did NOT refuse it.
      const allowed = await app.inject({ method: 'GET', url: '/api/pty?spawn=agent&agent=fyt-runner' });
      expect(allowed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('400s an unknown workflow ref on the upgrade, and lets an allowlisted ref through', async () => {
    const app = await restApp(
      createPersistentSessionRegistry(),
      () => null,
      (repoRoot, ref) => (ref === 'email-triage' ? `${repoRoot}/orgs/kb-ops/workflows/email-triage.md` : null),
    );
    try {
      const unknown = await app.inject({ method: 'GET', url: '/api/pty?spawn=workflow&workflow=ghost' });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toEqual({ error: 'unknown-workflow' });

      const traversal = await app.inject({ method: 'GET', url: '/api/pty?spawn=workflow&workflow=..%2F..%2Fsecrets' });
      expect(traversal.statusCode).toBe(400);
      expect(traversal.json()).toEqual({ error: 'unknown-workflow' });

      const missingRef = await app.inject({ method: 'GET', url: '/api/pty?spawn=workflow' });
      expect(missingRef.statusCode).toBe(400);
      expect(missingRef.json()).toMatchObject({ error: 'bad-spawn-request', reason: 'workflow-required' });

      const crossWired = await app.inject({ method: 'GET', url: '/api/pty?spawn=claude&workflow=email-triage' });
      expect(crossWired.statusCode).toBe(400);
      expect(crossWired.json()).toMatchObject({ error: 'bad-spawn-request', reason: 'workflow-not-allowed' });

      // An allowlisted ref clears admission; the non-upgrade GET then falls through to the route's 404.
      const allowed = await app.inject({ method: 'GET', url: '/api/pty?spawn=workflow&workflow=email-triage' });
      expect(allowed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET /api/pty/sessions requires a bearer and lists only the caller-owned sessions', async () => {
    const registry = createPersistentSessionRegistry();
    registry.create('owner-1', fakePtyHost({ sessionId: 'pty-a' }).host, OPEN_REQ);
    registry.create('owner-2', fakePtyHost({ sessionId: 'pty-b' }).host, OPEN_REQ);
    const app = await restApp(registry);
    try {
      const noAuth = await app.inject({ method: 'GET', url: '/api/pty/sessions' });
      expect(noAuth.statusCode).toBe(401);

      const res = await app.inject({
        method: 'GET',
        url: '/api/pty/sessions',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { sessions: Array<{ sessionId: string }> };
      expect(body.sessions.map((s) => s.sessionId)).toEqual(['pty-a']); // owner-2's session is not visible
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/pty/sessions/:id kills an owned session, 404s unknown/foreign/malformed ids', async () => {
    const registry = createPersistentSessionRegistry();
    const ownHost = fakePtyHost({ sessionId: 'pty-own' });
    registry.create('owner-1', ownHost.host, OPEN_REQ);
    registry.create('owner-2', fakePtyHost({ sessionId: 'pty-foreign' }).host, OPEN_REQ);
    const app = await restApp(registry);
    try {
      const noAuth = await app.inject({ method: 'DELETE', url: '/api/pty/sessions/pty-own' });
      expect(noAuth.statusCode).toBe(401);

      const foreign = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/pty-foreign',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(foreign.statusCode).toBe(404); // owner-1 cannot close owner-2's session
      expect(registry.liveCount()).toBe(2);

      const malformed = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/not-a-valid-id', // fails SESSION_ID_RE (no pty- prefix)
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(malformed.statusCode).toBe(404);

      const ok = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/pty-own',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ ok: true });
      expect(registry.liveCount()).toBe(1); // owner-2's session survives
    } finally {
      await app.close();
    }
  });
});
