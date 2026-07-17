import { describe, it, expect } from 'vitest';
import { SessionOwner } from './index.ts';
import type { SessionHandle, SpawnSpec, SpawnerContext } from './index.ts';
import { makeCliSessionSpawner, CLI_FALLBACK_ARGS } from './fallback.ts';
import type { CliChild } from './fallback.ts';

const okPreamble = () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
const spec: SpawnSpec = { cardId: 'kb-0009', prompt: 'PROMPT-TEXT' };

/** A recording SDK spawner that THROWS on construction — models the SDK/OAuth path being unavailable. */
const throwingSdkSpawner = () => {
  throw new Error('SDK unavailable (package missing / OAuth handshake failed)');
};

/** A recording CLI spawner so we can assert the degrade path was taken. */
function recordingCli() {
  const calls: SpawnSpec[] = [];
  const spawner = (s: SpawnSpec, ctx: SpawnerContext): SessionHandle => {
    calls.push(s);
    return {
      id: ctx.sessionId,
      kind: 'broker-cli',
      cardId: s.cardId,
      card: s.card,
      createdAt: 0,
      live: true,
      interrupt() {},
      sigterm() {},
      sigkill() {},
      steer() {},
    };
  };
  return { spawner, calls };
}

describe('broker/fallback — first-class CLI-subprocess degrade path', () => {
  it('degrades to CLI-subprocess-only when there is NO OAuth token (SDK path unavailable)', () => {
    const cli = recordingCli();
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: okPreamble,
      oauthToken: undefined, // no token → SDK path not taken
      sdkSpawner: throwingSdkSpawner as never,
      cliSpawner: cli.spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.via).toBe('cli');
      expect(outcome.handle.kind).toBe('broker-cli');
    }
    expect(cli.calls).toHaveLength(1);
  });

  it('degrades to CLI when the SDK spawner THROWS on construction even WITH a token present', () => {
    const cli = recordingCli();
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: okPreamble,
      oauthToken: 'fake-oauth-token-NEVER-real',
      sdkSpawner: throwingSdkSpawner as never,
      cliSpawner: cli.spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.via).toBe('cli');
    expect(cli.calls).toHaveLength(1);
  });

  it('takes the SDK path only when an OAuth token AND a working SDK spawner are both present', () => {
    const cli = recordingCli();
    const sdkHandle = (s: SpawnSpec, ctx: SpawnerContext): SessionHandle => ({
      id: ctx.sessionId,
      kind: 'broker-sdk',
      cardId: s.cardId,
      card: s.card,
      createdAt: 0,
      live: true,
      interrupt() {},
      sigterm() {},
      sigkill() {},
      steer() {},
    });
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: okPreamble,
      oauthToken: 'fake-oauth-token-NEVER-real',
      sdkSpawner: sdkHandle,
      cliSpawner: cli.spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.via).toBe('sdk');
      expect(outcome.handle.kind).toBe('broker-sdk');
    }
    expect(cli.calls).toHaveLength(0); // CLI fallback NOT used when SDK path is available
  });

  it('the CLI spawner writes the prompt to STDIN (never argv) and maps control primitives to signals', () => {
    const signals: string[] = [];
    let stdinText = '';
    const fakeChild: CliChild = {
      pid: 111,
      writeStdin(t) {
        stdinText += t;
      },
      endStdin() {},
      signal(sig) {
        signals.push(sig);
      },
      onExit() {},
    };
    const spawner = makeCliSessionSpawner(() => fakeChild);
    const handle = spawner(spec, { sessionId: 's', repoRoot: '/repo' });

    // Prompt reached stdin, and the argv is the fixed streaming-session argv with NO prompt in it.
    expect(stdinText).toBe('PROMPT-TEXT');
    expect([...CLI_FALLBACK_ARGS]).not.toContain('PROMPT-TEXT');

    handle.interrupt();
    handle.sigterm();
    handle.sigkill();
    expect(signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
  });
});
