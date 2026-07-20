/**
 * INERT, NOT-ACTIVATED — Phase 0 executor activation, build only. Companion to
 * `claudeWorkerAdapter.ts`: it implements `ManagedSessionAdapter.start` (broker.ts) so the
 * daemon-owned `ManagedSessionBroker` can, once activated, run a managed `claude` session. Nothing in
 * the running daemon constructs this yet, and no `claude` subprocess is spawned until Daniel's separate
 * human-reviewed activation step. Tests always inject a fake spawner — no real CLI runs.
 *
 * The broker hands the adapter a closed `ManagedStartSpec` (runRef, sessionRef, role, profileId, and an
 * already-APPROVED prompt) and an observer. The adapter resolves cwd/model/tool-cap/env from the
 * server-owned profile id (never from the spec), spawns the child, parses the stream-json transcript,
 * maps each event to a REDACTED `PublicOperationalEvent` via the existing `normalizeOperationalEvent`
 * allowlist projection, and streams them to `observer.onEvent`. On child exit it calls
 * `observer.onExit(code, error)`; `ManagedChild.stop()` terminates the child via the same SIGKILL the
 * worker adapter / `runTrackedProcess` use.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import type { ManagedSessionAdapter, ManagedStartSpec, ManagedChild } from './broker.ts';
import { normalizeOperationalEvent, type PublicOperationalEvent, type PrivateOperationalEvent } from './publicEvents.ts';
import {
  buildClaudeArgs,
  buildWorkerEnv,
  encodeStreamJsonUserMessage,
  defaultClaudeSpawner,
  defaultKillTree,
  type ClaudeSpawner,
  type ClaudeToolPolicy,
  type KillTree,
} from './claudeWorkerAdapter.ts';

const DEFAULT_STDERR_TAIL_CHARS = 4_000;

/** The launch parameters resolved from a spec's server-owned profile id — never smuggled by the caller. */
export interface ClaudeSessionLaunch {
  cwd: string;
  model: string;
  allowedTools: readonly string[];
  permissionMode: string;
}

export interface ClaudeSessionAdapterOptions {
  /**
   * Resolve the launch parameters for a managed session from its closed spec. Activation supplies the
   * real profile-id → {cwd, model, tool cap} mapping; tests supply a fake. The spec carries no cwd, env,
   * flags, tools, or permission mode by design (broker.ts) — this is the ONLY place they are decided.
   */
  resolveLaunch(spec: ManagedStartSpec): ClaudeSessionLaunch;
  spawn?: ClaudeSpawner;
  /** The tree-kill seam used by `stop()`. Defaults to `defaultKillTree`. */
  killTree?: KillTree;
  parentEnv?: Record<string, string | undefined>;
  envAllowlist?: readonly string[];
  stderrTailChars?: number;
}

/**
 * Map ONE parsed stream-json event to zero or more private operational events (an assistant turn can
 * carry several content blocks). Redaction, bounding, and the public allowlist are applied afterward by
 * `normalizeOperationalEvent`, so this only has to shape the fields.
 */
export function mapStreamEventToPrivate(event: unknown): PrivateOperationalEvent[] {
  if (!event || typeof event !== 'object') return [];
  const record = event as Record<string, unknown>;
  const type = record.type;

  if (type === 'system') {
    return [{ kind: 'lifecycle', state: typeof record.subtype === 'string' ? record.subtype : 'started', detail: null }];
  }

  // ASSISTANT ONLY. `user` events in the stream-json transcript are the harness echoing tool_result
  // blocks back into the conversation — worker output, not agent narration. Today those blocks are
  // skipped below because they carry no tool name, but that is a property of Claude Code's current
  // wire format, not of this code: if a tool result were ever hoisted into a top-level `text` block
  // on a user message, the loop below would mark it `visible: true` and persist it verbatim as an
  // event summary. Gating on `assistant` makes the safety local instead of borrowed. Nothing is lost
  // — a user message has no `tool_use` blocks, and its text is the operator's own approved prompt,
  // which the caller already holds.
  if (type === 'assistant') {
    const message = (record.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    const out: PrivateOperationalEvent[] = [];
    if (Array.isArray(content)) {
      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') {
          out.push({ kind: 'message', visible: true, text: block.text });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          out.push({ kind: 'tool', name: block.name, status: 'started' });
        }
        // Every other block type — tool_result, thinking, images — is dropped. Only `text` and
        // `tool_use` are projected, so an unrecognized block can never become an event payload.
      }
    }
    return out;
  }

  if (type === 'result') {
    // Fail-closed: success requires BOTH the explicit success subtype and a non-error flag. A result event
    // missing either field maps to a failed lifecycle rather than masquerading as succeeded.
    const isSuccess = record.subtype === 'success' && record.is_error !== true;
    const detail = typeof record.result === 'string' ? record.result : null;
    return [{ kind: 'lifecycle', state: isSuccess ? 'succeeded' : 'failed', detail }];
  }

  return [];
}

/** Parse one stream-json line into the redacted public events it yields (malformed lines yield none). */
export function mapStreamLine(line: string): PublicOperationalEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const events: PublicOperationalEvent[] = [];
  for (const priv of mapStreamEventToPrivate(parsed)) {
    const normalized = normalizeOperationalEvent(priv);
    if (normalized) events.push(normalized);
  }
  return events;
}

/**
 * Create the inert Claude managed-session adapter. Same spawn machinery as the worker adapter; the
 * approved prompt is streamed in as stream-json, transcript events are streamed out to the observer,
 * and `stop()` SIGKILLs the child.
 */
export function createClaudeSessionAdapter(options: ClaudeSessionAdapterOptions): ManagedSessionAdapter {
  const spawner = options.spawn ?? defaultClaudeSpawner;
  const killTree = options.killTree ?? defaultKillTree;
  const stderrTailChars = options.stderrTailChars ?? DEFAULT_STDERR_TAIL_CHARS;

  return {
    start(spec, observer): ManagedChild {
      const launch = options.resolveLaunch(spec);
      const toolPolicy: ClaudeToolPolicy = { allowedTools: launch.allowedTools, permissionMode: launch.permissionMode };
      const args = buildClaudeArgs({ model: launch.model, toolPolicy });
      const env = buildWorkerEnv(options.parentEnv, options.envAllowlist);
      const proc = spawner({ args, cwd: launch.cwd, env });

      let pending = '';
      let stderrTail = '';
      let exited = false;
      let stopped = false;

      const emit = (line: string): void => {
        for (const event of mapStreamLine(line)) {
          try { observer.onEvent(event); } catch { /* observer failures never propagate into the daemon */ }
        }
      };

      // Reap the whole process tree, not just the direct child. Invoked at most once (stop guard).
      const terminate = (): void => {
        if (typeof proc.pid === 'number') {
          try { killTree(proc.pid); return; } catch { /* fall through to the direct-child kill */ }
        }
        try { proc.kill(); } catch { /* best-effort; the durable stop request is already recorded */ }
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
        const error = code === 0 ? null : (stderrTail.trim() || `claude session exited with code ${code ?? 'null'}`);
        try { observer.onExit(code, error); } catch { /* the child is gone; contain observer failures */ }
      });
      // A child-level spawn/runtime error finalizes immediately rather than waiting on an exit that won't come.
      proc.onError?.((error) => {
        if (exited) return;
        exited = true;
        try { observer.onExit(null, error instanceof Error ? error.message : 'claude session process error'); } catch { /* contain */ }
      });

      try {
        proc.writeStdin(encodeStreamJsonUserMessage(spec.approvedPrompt));
        proc.endStdin();
      } catch (error) {
        if (!exited) {
          exited = true;
          try { observer.onExit(null, error instanceof Error ? error.message : 'claude session stdin failed'); } catch { /* contain */ }
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
