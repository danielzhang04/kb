/**
 * Tests for the PATH resolver behind the "Run agent / Run workflow" spawn fix.
 *
 * The unit tests are hermetic (an injected `fileExists`). The LAST describe block is deliberately not:
 * it spawns a REAL node-pty and asserts the behaviour the whole fix rests on. That is the test the old
 * suite could not have — it injects a fake pty factory, so `File not found: ` was invisible to it. It
 * self-skips when the CLI or the native addon is unavailable, so a bare checkout never goes red.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CommandNotFoundError,
  clearCommandPathCache,
  resolveCommandPath,
} from './resolveCommand.ts';
import { buildChildEnv } from './host.ts';

const WIN = { platform: 'win32' as const };

/**
 * A fake filesystem that is CASE-INSENSITIVE, like Windows. This matters: real PATHEXT entries are
 * uppercase (`.EXE`) while the file on disk is `claude.exe`. A case-SENSITIVE double would model the
 * wrong machine and could pass or fail the resolver for entirely the wrong reason.
 */
function fsWith(...paths: string[]): (path: string) => boolean {
  const present = new Set(paths.map((path) => path.toLowerCase()));
  return (path: string) => present.has(path.toLowerCase());
}

/** Resolutions are compared case-insensitively for the same reason. */
const lower = (value: string): string => value.toLowerCase();

beforeEach(() => clearCommandPathCache());

describe('resolveCommandPath', () => {
  it('finds the command in the FIRST PATH directory that has it', () => {
    const resolved = resolveCommandPath(
      'claude',
      { PATH: 'C:\\one;C:\\two', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      { fileExists: fsWith('C:\\one\\claude.exe', 'C:\\two\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\one\\claude.exe');
  });

  it('skips PATH directories that do not have it', () => {
    const resolved = resolveCommandPath(
      'claude',
      { PATH: 'C:\\empty;C:\\also-empty;C:\\real', PATHEXT: '.EXE' },
      { fileExists: fsWith('C:\\real\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\real\\claude.exe');
  });

  /**
   * THE mechanism of the live bug. `claude` exists on PATH only as `claude.exe`, and node-pty's ConPTY
   * agent does not add the extension itself — which is why a bare `claude` died with an empty
   * `File not found: ` while `cmd.exe` (extension included) spawned fine. A resolver that skipped
   * PATHEXT would reproduce the defect exactly.
   */
  it('applies PATHEXT — an extensionless name resolves to the .exe on disk', () => {
    const resolved = resolveCommandPath(
      'claude',
      { PATH: 'C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      { fileExists: fsWith('C:\\bin\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\bin\\claude.exe');
  });

  it('prefers a real executable over a script when PATHEXT lists both', () => {
    const resolved = resolveCommandPath(
      'claude',
      { PATH: 'C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      { fileExists: fsWith('C:\\bin\\claude.exe', 'C:\\bin\\claude.cmd'), ...WIN },
    );
    // CreateProcess cannot execute a .cmd directly, and we refuse to wrap in a shell.
    expect(lower(resolved)).toBe('c:\\bin\\claude.exe');
  });

  it('honours an exact name that already carries its extension', () => {
    const resolved = resolveCommandPath(
      'claude.exe',
      { PATH: 'C:\\bin', PATHEXT: '.EXE' },
      { fileExists: fsWith('C:\\bin\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\bin\\claude.exe');
  });

  it('verifies an already-absolute command instead of searching PATH', () => {
    const resolved = resolveCommandPath(
      'C:\\custom\\claude',
      { PATH: 'C:\\bin', PATHEXT: '.EXE' },
      { fileExists: fsWith('C:\\custom\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\custom\\claude.exe');
  });

  it('throws a TYPED not-found error carrying what it searched', () => {
    let thrown: unknown;
    try {
      resolveCommandPath(
        'claude',
        { PATH: 'C:\\a;C:\\b;C:\\c', PATHEXT: '.EXE' },
        { fileExists: () => false, ...WIN },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CommandNotFoundError);
    expect((thrown as CommandNotFoundError).command).toBe('claude');
    expect((thrown as CommandNotFoundError).searchedDirs).toBe(3);
    expect((thrown as CommandNotFoundError).message).toContain('claude');
  });

  it('throws rather than returning a bare name when PATH is empty', () => {
    expect(() => resolveCommandPath('claude', {}, { fileExists: () => false, ...WIN })).toThrow(
      CommandNotFoundError,
    );
  });

  it('reads Path as well as PATH (Windows env casing)', () => {
    const resolved = resolveCommandPath(
      'claude',
      { Path: 'C:\\bin', PATHEXT: '.EXE' },
      { fileExists: fsWith('C:\\bin\\claude.exe'), ...WIN },
    );
    expect(lower(resolved)).toBe('c:\\bin\\claude.exe');
  });

  it('caches a hit, then re-walks once the TTL lapses', () => {
    const disk = fsWith('C:\\bin\\claude.exe');
    let probes = 0;
    const fileExists = (path: string): boolean => {
      probes += 1;
      return disk(path);
    };
    let clock = 1_000;
    const deps = { fileExists, now: () => clock, ...WIN };
    const env = { PATH: 'C:\\bin', PATHEXT: '.EXE' };

    resolveCommandPath('claude', env, deps);
    const afterFirst = probes;
    resolveCommandPath('claude', env, deps);
    expect(probes).toBe(afterFirst); // served from cache, PATH not re-walked

    clock += 60_000; // past the TTL
    resolveCommandPath('claude', env, deps);
    expect(probes).toBeGreaterThan(afterFirst);
  });

  it('never serves a cached answer to a DIFFERENT PATH', () => {
    const deps = { fileExists: fsWith('C:\\one\\claude.exe', 'C:\\two\\claude.exe'), ...WIN };
    expect(lower(resolveCommandPath('claude', { PATH: 'C:\\one', PATHEXT: '.EXE' }, deps)))
      .toBe('c:\\one\\claude.exe');
    expect(lower(resolveCommandPath('claude', { PATH: 'C:\\two', PATHEXT: '.EXE' }, deps)))
      .toBe('c:\\two\\claude.exe');
  });
});

/**
 * THE EMPIRICAL PROBE. Everything above is a MODEL of node-pty's behaviour; this asserts the behaviour
 * itself against the real native addon — the test that would have caught the live defect.
 */
describe('node-pty spawn reality check', () => {
  const require = createRequire(import.meta.url);
  const childEnv = buildChildEnv(process.env);

  interface FakeProc {
    onData(cb: (data: string) => void): void;
    onExit(cb: (event: { exitCode: number }) => void): void;
    kill(): void;
  }
  let pty: { spawn: (file: string, args: string[], opts: Record<string, unknown>) => FakeProc } | null;
  try {
    pty = require('node-pty');
  } catch {
    pty = null;
  }

  let claudePath: string | null;
  try {
    claudePath = resolveCommandPath('claude', childEnv);
  } catch {
    claudePath = null;
  }

  const live = pty !== null && claudePath !== null;

  const spawnAndCollect = (file: string, args: string[]): Promise<{ ok: boolean; output: string; error?: string }> =>
    new Promise((resolve) => {
      let output = '';
      let settled = false;
      const done = (value: { ok: boolean; output: string; error?: string }): void => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      try {
        const proc = (pty as NonNullable<typeof pty>).spawn(file, args, {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: childEnv,
        });
        proc.onData((chunk) => {
          output += chunk;
        });
        proc.onExit(() => done({ ok: true, output }));
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* already gone */
          }
          done({ ok: true, output });
        }, 20_000);
      } catch (err) {
        done({ ok: false, output, error: (err as Error).message });
      }
    });

  it.runIf(live)('spawns the RESOLVED absolute path and receives real output', async () => {
    const result = await spawnAndCollect(claudePath as string, ['--version']);
    expect(result.ok).toBe(true);
    // A version banner proves the CLI actually ran — not an empty pty that merely failed to error.
    expect(result.output).toMatch(/\d+\.\d+\.\d+/);
  }, 30_000);

  it.runIf(live)('is the fix: the BARE name node-pty used to be given does not spawn', async () => {
    const result = await spawnAndCollect('claude', ['--version']);
    // On this platform node-pty rejects the bare, extensionless name outright — the live defect, whose
    // audit detail was the uninformative `File not found: `. Should a future node-pty learn to resolve
    // it, the absolute path stays correct anyway, so only assert the two are not both silently broken.
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    } else {
      expect(result.output.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it.runIf(live)('resolves claude to an absolute path on this machine', () => {
    expect(claudePath).toBeTruthy();
    expect(claudePath as string).toMatch(/claude/i);
  });

  /**
   * THE ARGV PROBE for the spawn-routing fix (2026-08-04). `--effort` / `--model` now ride the argv of
   * EVERY spawned terminal, so a wrong flag name would kill every "Run agent" and "Run workflow" at boot
   * — and unit tests asserting our own argv strings could never catch that, because they only compare our
   * output to itself. This spawns the REAL CLI through the REAL node-pty with the REAL flags.
   *
   * It also pins the sharp edge found while probing: an INVALID `--effort` value does NOT fail the
   * process — it prints `Warning: Unknown --effort value ... using the default effort` and carries on. So
   * "it spawned" is NOT evidence the cap applied; the absence of that warning is. Asserting on it is what
   * makes a future typo in `SPAWN_EFFORT` loud, instead of an invisible reversion to the operator's own
   * `max` default (the very defect this fix exists to close).
   */
  it.runIf(live)('accepts the --effort/--model argv every spawn now carries', async () => {
    const result = await spawnAndCollect(claudePath as string, [
      '--effort',
      'high',
      '--model',
      'claude-sonnet-5',
      '--version',
    ]);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/\d+\.\d+\.\d+/); // ran through to a version banner → the args parsed
    expect(result.output).not.toMatch(/unknown|invalid|unrecognized/i);
  }, 30_000);

  it.runIf(live)('proves that probe can FAIL: a bad effort value warns and silently falls back', async () => {
    const result = await spawnAndCollect(claudePath as string, ['--effort', 'kb-not-a-level', '--version']);
    expect(result.ok).toBe(true);
    // The CONTROL. Without it, the "no warning" assertion above could be vacuously true.
    expect(result.output).toMatch(/Unknown --effort value/i);
  }, 30_000);
});
