/**
 * Headless Codex managed sessions. This is the broker-facing sibling of codexExecAdapter: it uses
 * the same pinned `codex exec --json` process engine, projects only allowlisted operational events,
 * and contains process/observer failures at the daemon boundary.
 */
import type { ManagedChild, ManagedSessionAdapter, ManagedStartSpec } from './broker.ts';
import {
  buildCodexExecArgs,
  defaultCodexExecSpawner,
  type CodexExecProcess,
  type CodexExecSpawner,
} from './codexExecAdapter.ts';
import { buildWorkerEnv, defaultKillTree, type KillTree } from './claudeWorkerAdapter.ts';
import { normalizeOperationalEvent, type PrivateOperationalEvent, type PublicOperationalEvent } from './publicEvents.ts';

const DEFAULT_STDERR_TAIL_CHARS = 4_000;

export interface CodexSessionLaunch {
  cwd: string;
  model: string;
}

export interface CodexSessionAdapterOptions {
  resolveLaunch(spec: ManagedStartSpec): CodexSessionLaunch;
  spawn?: CodexExecSpawner;
  killTree?: KillTree;
  parentEnv?: Record<string, string | undefined>;
  envAllowlist?: readonly string[];
  stderrTailChars?: number;
  resolveThread?: (spec: ManagedStartSpec) => string | null;
  recordThread?: (spec: ManagedStartSpec, threadId: string) => void;
}

/** Map one live-proven Codex JSONL event into the private event envelope. */
export function mapCodexEventToPrivate(event: unknown): PrivateOperationalEvent[] {
  if (!event || typeof event !== 'object') return [];
  const row = event as Record<string, unknown>;
  if (row.type === 'thread.started') return [{ kind: 'lifecycle', state: 'started', detail: null }];
  if (row.type === 'turn.started') return [{ kind: 'lifecycle', state: 'turn-started', detail: null }];
  if (row.type === 'item.completed' && row.item && typeof row.item === 'object') {
    const item = row.item as Record<string, unknown>;
    return item.type === 'agent_message' && typeof item.text === 'string'
      ? [{ kind: 'message', visible: true, text: item.text }]
      : [];
  }
  if (row.type === 'turn.completed') return [{ kind: 'lifecycle', state: 'succeeded', detail: null }];
  if (row.type === 'turn.failed') {
    const error = row.error && typeof row.error === 'object' ? row.error as Record<string, unknown> : {};
    return [{ kind: 'lifecycle', state: 'failed', detail: typeof error.message === 'string' ? error.message : null }];
  }
  return [];
}

/** Parse one JSONL row and normalize every projected event through the redacting public allowlist. */
export function mapCodexStreamLine(line: string): PublicOperationalEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  const events: PublicOperationalEvent[] = [];
  for (const event of mapCodexEventToPrivate(parsed)) {
    const normalized = normalizeOperationalEvent(event);
    if (normalized) events.push(normalized);
  }
  return events;
}

function threadIdFromLine(line: string): string | null {
  try {
    const row = JSON.parse(line.trim()) as Record<string, unknown>;
    return row.type === 'thread.started' && typeof row.thread_id === 'string' && row.thread_id.trim()
      ? row.thread_id
      : null;
  } catch {
    return null;
  }
}

/** Create a Codex ManagedSessionAdapter on the same pinned engine as one-shot Codex workers. */
export function createCodexSessionAdapter(options: CodexSessionAdapterOptions): ManagedSessionAdapter {
  const spawner = options.spawn ?? defaultCodexExecSpawner;
  const killTree = options.killTree ?? defaultKillTree;
  const stderrTailChars = options.stderrTailChars ?? DEFAULT_STDERR_TAIL_CHARS;

  return {
    start(spec, observer): ManagedChild {
      const launch = options.resolveLaunch(spec);
      const threadId = options.resolveThread?.(spec) ?? null;
      const proc: CodexExecProcess = spawner({
        args: buildCodexExecArgs({ model: launch.model, worktreePath: launch.cwd, threadId }),
        cwd: launch.cwd,
        env: buildWorkerEnv(options.parentEnv, options.envAllowlist),
      });
      let pending = '';
      let stderrTail = '';
      let exited = false;
      let stopped = false;
      let emittedThread = false;
      let recordFailure: string | null = null;
      let recording = Promise.resolve();

      const emit = (line: string): void => {
        const emitted = threadIdFromLine(line);
        if (!emittedThread && emitted) {
          emittedThread = true;
          try {
            recording = Promise.resolve(options.recordThread?.(spec, emitted)).catch((error) => {
              recordFailure = `codex session could not record its emitted thread: ${error instanceof Error ? error.message : String(error)}`;
            });
          } catch (error) {
            recordFailure = `codex session could not record its emitted thread: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        for (const event of mapCodexStreamLine(line)) {
          try { observer.onEvent(event); } catch { /* observer failures never reach the daemon */ }
        }
      };
      const terminate = (): void => {
        if (typeof proc.pid === 'number') {
          try { killTree(proc.pid); return; } catch { /* fall through to direct child */ }
        }
        try { proc.kill(); } catch { /* best effort */ }
      };
      const observeExit = (code: number | null, error: string | null): void => {
        void recording.then(() => {
          try { observer.onExit(code, recordFailure ?? error); } catch { /* child is gone; contain observer */ }
        }).catch((recordError) => {
          try { observer.onExit(code, `codex session thread finalization failed: ${String(recordError)}`); } catch { /* contain */ }
        });
      };

      proc.onStdout((chunk) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) emit(line);
      });
      proc.onStderr((chunk) => { stderrTail = (stderrTail + chunk).slice(-stderrTailChars); });
      proc.onExit((code) => {
        if (exited) return;
        exited = true;
        if (pending) { emit(pending); pending = ''; }
        observeExit(code, code === 0 ? null : (stderrTail.trim() || `codex session exited with code ${code ?? 'null'}`));
      });
      proc.onError?.((error) => {
        if (exited) return;
        exited = true;
        observeExit(null, error instanceof Error ? error.message : 'codex session process error');
      });

      try {
        proc.writeStdin(spec.approvedPrompt);
        proc.endStdin();
      } catch (error) {
        if (!exited) {
          exited = true;
          observeExit(null, error instanceof Error ? error.message : 'codex session stdin failed');
        }
      }

      return {
        stop() {
          if (stopped) return;
          stopped = true;
          terminate();
        },
      };
    },
  };
}
