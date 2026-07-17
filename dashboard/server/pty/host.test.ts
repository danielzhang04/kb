/**
 * D3.2 — the PTY host. Every test injects a fake `node-pty` factory (see `host.ts`'s DI rationale) —
 * no test loads the native ConPTY addon or spawns a real shell. Fully hermetic.
 *
 * Two load-bearing invariants are proven here: the spawned shell's env is built from an explicit
 * allowlist that EXCLUDES push credentials + `CLAUDE_CODE_OAUTH_TOKEN` even when they are present in
 * the host's own env; and every session is process-group-tracked so a scoped stop kills its group.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildChildEnv,
  createPtyHost,
  isDeniedEnvName,
  DEFAULT_ENV_ALLOWLIST,
} from './host.ts';
import type { PtyFactory, PtyHandle, PtySpawnOptions } from './host.ts';

/** A fake PTY handle recording writes/resizes/kills and exposing its callbacks so a test can drive
 *  data/exit manually — no real child process is ever spawned. */
function fakeHandle(pid = 1000) {
  let dataCb: ((chunk: string) => void) | undefined;
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | undefined;
  let killed = 0;
  const writes: string[] = [];
  const handle: PtyHandle = {
    pid,
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    write(data) {
      writes.push(data);
    },
    resize() {},
    kill() {
      killed += 1;
    },
  };
  return {
    handle,
    emitData: (chunk: string) => dataCb?.(chunk),
    emitExit: (code: number) => exitCb?.({ exitCode: code }),
    killCount: () => killed,
    writes,
  };
}

/** Records every spawn (file, args, opts) and hands back the queued handles. */
function recordingFactory(handles: PtyHandle[] = []) {
  const calls: Array<{ file: string; args: string[]; opts: PtySpawnOptions }> = [];
  let i = 0;
  const factory: PtyFactory = (file, args, opts) => {
    calls.push({ file, args, opts });
    return handles[i++] ?? fakeHandle().handle;
  };
  return { factory, calls };
}

describe('buildChildEnv — explicit allowlist excludes push creds + CLAUDE_CODE_OAUTH_TOKEN', () => {
  it('copies allowlisted vars and drops every credential even when present in the parent env', () => {
    const parentEnv: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      SystemRoot: 'C:\\Windows',
      TERM: 'xterm-256color',
      // Credentials that MUST NOT reach the shell:
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret-value',
      ANTHROPIC_API_KEY: 'sk-should-not-appear',
      GITHUB_TOKEN: 'ghp_pushcredential',
      GH_TOKEN: 'gho_pushcredential',
      GIT_ASKPASS: '/path/to/askpass',
      GIT_PASSWORD: 'hunter2',
    };

    const env = buildChildEnv(parentEnv);

    // Allowlisted, non-secret vars pass through.
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect(env.TERM).toBe('xterm-256color');

    // Not one credential survives.
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.GIT_PASSWORD).toBeUndefined();

    // Nothing secret-shaped hides under any key.
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain('oauth-secret-value');
    expect(serialized).not.toContain('sk-should-not-appear');
    expect(serialized).not.toContain('ghp_pushcredential');
    expect(serialized).not.toContain('hunter2');
  });

  it('a credential name can never leak even if it is mistakenly added to the allowlist (denylist wins)', () => {
    const parentEnv = { PATH: '/bin', GITHUB_TOKEN: 'ghp_leak' };
    // Someone widens the allowlist to include a credential name — the denylist still removes it.
    const env = buildChildEnv(parentEnv, [...DEFAULT_ENV_ALLOWLIST, 'GITHUB_TOKEN']);
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });

  it('isDeniedEnvName catches exact names, substrings, and case variants', () => {
    expect(isDeniedEnvName('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true);
    expect(isDeniedEnvName('github_token')).toBe(true);
    expect(isDeniedEnvName('MY_GITHUB_TOKEN')).toBe(true);
    expect(isDeniedEnvName('SomeApiKey')).toBe(true);
    expect(isDeniedEnvName('PATH')).toBe(false);
    expect(isDeniedEnvName('TERM')).toBe(false);
  });
});

describe('createPtyHost — spawns node-pty with the constrained env; the shell never sees a credential', () => {
  it('passes the allowlist-filtered env to the pty factory, excluding push creds + OAuth token', () => {
    const { factory, calls } = recordingFactory([fakeHandle().handle]);
    const host = createPtyHost({
      ptyFactory: factory,
      parentEnv: {
        PATH: '/usr/bin',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-pass',
        GITHUB_TOKEN: 'ghp_must-not-pass',
      },
      shell: '/bin/bash',
      sessionId: () => 'pty-1',
    });

    host.open({ requestId: 'req-1', cols: 80, rows: 24, cwd: '/repo' });

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('/bin/bash');
    expect(calls[0].opts.cwd).toBe('/repo');
    expect(calls[0].opts.cols).toBe(80);
    expect(calls[0].opts.env.PATH).toBe('/usr/bin');
    expect(calls[0].opts.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(calls[0].opts.env.GITHUB_TOKEN).toBeUndefined();
    // The child env is a fresh object, never the parent env by reference.
    expect(Object.keys(calls[0].opts.env)).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });
});

describe('createPtyHost — process-group tracking (a scoped stop kills the whole group)', () => {
  it('tracks each session and a scoped stop kills exactly that session, forgetting it', () => {
    const h1 = fakeHandle(101);
    const h2 = fakeHandle(102);
    const { factory } = recordingFactory([h1.handle, h2.handle]);
    let n = 0;
    const host = createPtyHost({ ptyFactory: factory, sessionId: () => `pty-${(n += 1)}` });

    const s1 = host.open({ requestId: 'r1', cols: 80, rows: 24, cwd: '/repo' });
    const s2 = host.open({ requestId: 'r2', cols: 80, rows: 24, cwd: '/repo' });
    expect(host.sessions().sort()).toEqual(['pty-1', 'pty-2']);

    // Scoped stop kills s1's process group (handle.kill terminates the ConPTY child tree) and forgets it.
    const stopped = host.stop(s1.sessionId);
    expect(stopped).toBe(true);
    expect(h1.killCount()).toBe(1);
    expect(h2.killCount()).toBe(0);
    expect(host.sessions()).toEqual(['pty-2']);

    // Stopping an unknown / already-stopped session is a no-op that reports false.
    expect(host.stop(s1.sessionId)).toBe(false);
    expect(host.stop('nope')).toBe(false);

    // stopAll reaps the remainder.
    host.stopAll();
    expect(h2.killCount()).toBe(1);
    expect(host.sessions()).toEqual([]);
    void s2;
  });

  it('a session that exits on its own is reaped from tracking (no orphan lingers)', () => {
    const h1 = fakeHandle();
    const { factory } = recordingFactory([h1.handle]);
    const host = createPtyHost({ ptyFactory: factory, sessionId: () => 'pty-x' });

    host.open({ requestId: 'r', cols: 80, rows: 24, cwd: '/repo' });
    expect(host.sessions()).toEqual(['pty-x']);

    h1.emitExit(0);
    expect(host.sessions()).toEqual([]);
    // A scoped stop after a self-exit is a no-op (already gone).
    expect(host.stop('pty-x')).toBe(false);
  });

  it('wires stdout data through to a consumer and writes input to the child', () => {
    const h1 = fakeHandle();
    const { factory } = recordingFactory([h1.handle]);
    const host = createPtyHost({ ptyFactory: factory, sessionId: () => 'pty-io' });

    const session = host.open({ requestId: 'r', cols: 80, rows: 24, cwd: '/repo' });
    const onData = vi.fn();
    session.handle.onData(onData);
    h1.emitData('hello from the shell');
    expect(onData).toHaveBeenCalledWith('hello from the shell');

    session.handle.write('ls -la\n');
    expect(h1.writes).toEqual(['ls -la\n']);
  });
});
