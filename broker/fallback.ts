/**
 * D3.3 — the Broker's FIRST-CLASS CLI-subprocess fallback (not an afterthought).
 *
 * When the SDK/OAuth session path is unavailable — no `CLAUDE_CODE_OAUTH_TOKEN`, no SDK spawner wired,
 * or the SDK failing to construct a session — the Broker degrades to the SAME mechanism the D2.7 vibe
 * box uses: a real `claude --print --input-format stream-json --output-format stream-json` child
 * process, prompt written to STDIN (never argv, so it never appears in a process listing). This module
 * reuses the SHAPE of `dashboard/server/vibe/session.ts#defaultVibeSpawner` (injectable spawner, stdin
 * prompt, no `env` override so the child inherits `process.env` verbatim — `ANTHROPIC_API_KEY` stays
 * unset per the already-passed preamble gate), adapted to return a `SessionHandle` for the handle table.
 *
 * CONTROL-PRIMITIVE MAPPING (a CLI child has no SDK `interrupt()` — this is why the SDK path is
 * preferred and the fallback is a documented degrade):
 *   - `interrupt()`  → SIGINT  (the closest soft "stop this turn" a `--print` child understands).
 *   - `sigterm()`    → SIGTERM (escalation rung 2; kills the whole child).
 *   - `sigkill()`    → SIGKILL (escalation rung 3; unconditional).
 *   - `steer(text)`  → best-effort append to the child's stream-json stdin. A one-shot `--print` child
 *     may have already closed stdin — steering a fallback session is therefore best-effort and NOT the
 *     laundering-relevant path (the tier-bump re-approval rule in broker/verbs.ts runs BEFORE any
 *     `steer()` is dispatched, so it applies identically regardless of runtime).
 *
 * CREDENTIAL RULE: the spawner passes NO `env` override; the child inherits the Broker's environment,
 * so an ambient `CLAUDE_CODE_OAUTH_TOKEN` reaches the CLI the same way it would a human's shell — never
 * materialized as an argv element, a log line, or a field on the returned handle.
 */
import { spawn as spawnChildProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { SessionHandle, SessionSpawner, SpawnSpec, SpawnerContext } from './index.ts';

/** The subset of a Node child process the fallback handle drives. Injected in tests as a fake. */
export interface CliChild {
  readonly pid?: number;
  writeStdin(text: string): void;
  endStdin(): void;
  signal(sig: NodeJS.Signals): void;
  onExit(cb: (code: number | null) => void): void;
}

/** Spawns the real `claude` CLI child. Injected for hermetic tests — never shelled by the suite. */
export type CliChildSpawner = (args: string[], cwd: string) => CliChild;

/** The exact argv the fallback shells: a streaming, steerable `--print` session (no prompt in argv). */
export const CLI_FALLBACK_ARGS = [
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
] as const;

/** Default child spawner: the real `claude` CLI (no `env` override — inherits `process.env`). */
export const defaultCliChildSpawner: CliChildSpawner = (args, cwd) => {
  const child: ChildProcessWithoutNullStreams = spawnChildProcess('claude', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  return {
    pid: child.pid,
    writeStdin(text) {
      // Best-effort: a closed/one-shot stdin throws EPIPE, which is not fatal to the daemon.
      try {
        child.stdin.write(text);
      } catch {
        /* stdin already closed — steering a one-shot fallback session is best-effort, see module doc */
      }
    },
    endStdin() {
      try {
        child.stdin.end();
      } catch {
        /* already ended */
      }
    },
    signal(sig) {
      try {
        child.kill(sig);
      } catch {
        /* already reaped — signalling a dead pid is the caller's concern, not ours */
      }
    },
    onExit(cb) {
      child.on('exit', (code) => cb(code));
    },
  };
};

/**
 * Build a `SessionHandle` backed by a CLI child. `live` starts true and flips false on the child's
 * `exit` event so `stopWatch`/verbs stop escalating a dead session. The prompt is written to stdin,
 * never argv.
 */
export function makeCliSessionSpawner(spawnChild: CliChildSpawner = defaultCliChildSpawner): SessionSpawner {
  return (spec: SpawnSpec, ctx: SpawnerContext): SessionHandle => {
    const child = spawnChild([...CLI_FALLBACK_ARGS], ctx.repoRoot);
    const handle: SessionHandle = {
      id: ctx.sessionId,
      kind: 'broker-cli',
      cardId: spec.cardId,
      card: spec.card,
      createdAt: Date.now(),
      live: true,
      interrupt() {
        child.signal('SIGINT');
      },
      sigterm() {
        child.signal('SIGTERM');
      },
      sigkill() {
        child.signal('SIGKILL');
      },
      steer(text: string) {
        child.writeStdin(text);
      },
    };
    child.onExit(() => {
      handle.live = false;
    });
    // The prompt is the session's first stream-json input line — stdin, never argv.
    child.writeStdin(spec.prompt);
    return handle;
  };
}

/** The default CLI-fallback session spawner used by `SessionOwner` when the SDK path is unavailable. */
export const defaultCliSessionSpawner: SessionSpawner = makeCliSessionSpawner();
