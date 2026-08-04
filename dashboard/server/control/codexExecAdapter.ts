/**
 * One-shot, headless Codex worker execution. Each work order becomes `codex exec`; continuity is
 * supplied by the runtime's own thread store through the injected resolve/record hooks. Like the
 * Claude adapter, process exit plus the runtime's explicit terminal event is the only completion
 * authority: worker prose alone can never complete an attempt.
 */
import { spawn as spawnChildProcess } from 'node:child_process';
import {
  boundSummary,
  buildWorkerEnv,
  buildWorkerPrompt,
  defaultKillTree,
  type KillTree,
} from './claudeWorkerAdapter.ts';
import type { WorkerAdapter, WorkerExecutionResult, ExecutionUsage } from './execution.ts';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_STDERR_TAIL_CHARS = 4_000;
const DEFAULT_SUMMARY_MAX_CHARS = 60_000;
const MAX_AGENT_INSTRUCTION_CHARS = 64 * 1024;
const ZERO_USAGE: ExecutionUsage = { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 };

/** A spawn request for one headless `codex exec` child; env has already been allowlist-filtered. */
export interface CodexExecSpawnRequest {
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}

/** Minimal injected process seam. It keeps the adapter hermetic under test. */
export interface CodexExecProcess {
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  onError?(cb: (error: Error) => void): void;
  writeStdin(text: string): void;
  endStdin(): void;
  pid?: number;
  kill(): void;
}

export type CodexExecSpawner = (request: CodexExecSpawnRequest) => CodexExecProcess;

export interface CodexExecAdapterOptions {
  /** The process seam; injected by tests so no real Codex CLI is ever spawned there. */
  spawner?: CodexExecSpawner;
  /** Reaps the full worker tree on a hard stop. */
  killTree?: KillTree;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Returns the prior runtime thread for this run/agent pair, or null for a fresh turn. */
  resolveThread?: (runRef: string, agentId: string) => string | null;
  /** Persists a thread emitted by `thread.started`; defaults to a no-op until Task 2 wires storage. */
  recordThread?: (runRef: string, agentId: string, threadId: string) => void;
}

/** Clamp an untrusted usage value to the `ExecutionUsage` integer envelope. */
function safeCount(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.min(Math.floor(numberValue), Number.MAX_SAFE_INTEGER);
}

/**
 * Codex's `turn.completed.usage` maps directly to subscription-accounted execution usage. Cached
 * and reasoning-token counters remain runtime detail, not additional billable input/output totals.
 */
function extractUsage(event: Record<string, unknown>): ExecutionUsage {
  const usage = event.usage && typeof event.usage === 'object' ? event.usage as Record<string, unknown> : {};
  return {
    inputTokens: safeCount(usage.input_tokens),
    outputTokens: safeCount(usage.output_tokens),
    costUsdMicros: 0,
  };
}

interface ParsedCodexStream {
  terminalEvent: Record<string, unknown> | null;
  threadId: string | null;
  finalMessage: string;
}

/** Parse tolerated JSONL noise, retaining only the live-proven Codex event shapes. */
function parseCodexStream(stdout: string): ParsedCodexStream {
  let terminalEvent: Record<string, unknown> | null = null;
  let threadId: string | null = null;
  let finalMessage = '';
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const row = event as Record<string, unknown>;
    if (row.type === 'thread.started' && threadId === null && typeof row.thread_id === 'string' && row.thread_id.trim()) {
      threadId = row.thread_id;
      continue;
    }
    if (row.type === 'item.completed' && row.item && typeof row.item === 'object') {
      const item = row.item as Record<string, unknown>;
      if (item.type === 'agent_message' && typeof item.text === 'string') finalMessage = item.text;
      continue;
    }
    if (row.type === 'turn.completed') terminalEvent = row;
  }
  return { terminalEvent, threadId, finalMessage };
}

function failedResult(summary: string, usage: ExecutionUsage, maxChars: number): WorkerExecutionResult {
  return { state: 'failed', summary: boundSummary(summary, maxChars) || 'codex worker failed', usage, artifacts: [], checkpoints: [] };
}

/**
 * Build a pinned Codex argv. `resume` restores the stored cwd and sandbox and rejects `--cd` and
 * `--sandbox` (live-proven by codex_dispatch.py), so only the fresh path supplies those flags.
 */
export function buildCodexExecArgs(input: { model: string; worktreePath: string; threadId: string | null }): string[] {
  const model = input.model.trim();
  if (!model) throw new Error('codex worker routing has no model');
  const pinnedConfig = [
    '-c', 'forced_login_method="chatgpt"',
    '-c', 'mcp_servers={}',
    '-c', 'sandbox_workspace_write.network_access=false',
    '-c', 'web_search="disabled"',
  ];
  if (input.threadId) {
    return [
      'exec', 'resume', input.threadId, '-', '--json',
      '-c', `model=${model}`,
      '--ask-for-approval', 'never',
      ...pinnedConfig,
    ];
  }
  return [
    'exec', '-', '--json', '--model', model, '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    ...pinnedConfig,
    '--cd', input.worktreePath,
  ];
}

/** Real Codex process spawn; tests always inject the seam above. */
export const defaultCodexExecSpawner: CodexExecSpawner = (request) => {
  const child = spawnChildProcess('codex', [...request.args], {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    get pid() { return child.pid; },
    onStdout(cb) { child.stdout?.on('data', (chunk: Buffer) => cb(chunk.toString('utf8'))); },
    onStderr(cb) { child.stderr?.on('data', (chunk: Buffer) => cb(chunk.toString('utf8'))); },
    onExit(cb) { child.on('close', (code) => cb(code)); },
    onError(cb) { child.on('error', (error: Error) => cb(error)); },
    writeStdin(text) { child.stdin?.write(text); },
    endStdin() { child.stdin?.end(); },
    kill() { child.kill('SIGKILL'); },
  };
};

/** Create the one-shot headless Codex worker adapter. */
export function createCodexExecAdapter(options: CodexExecAdapterOptions = {}): WorkerAdapter {
  const spawner = options.spawner ?? defaultCodexExecSpawner;
  const killTree = options.killTree ?? defaultKillTree;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const resolveThread = options.resolveThread ?? (() => null);
  const recordThread = options.recordThread ?? (() => {});

  return {
    execute(input) {
      if ((input.assignment === undefined) !== (input.instructionMarkdown === undefined)) {
        throw new Error('codex worker requires assignment and declaration instructions together');
      }
      if (input.assignment && (
        input.assignment.runtime !== input.profile.runtime
        || input.assignment.model !== input.profile.model
        || input.assignment.profileId !== input.profile.id
        || input.instructionMarkdown === undefined
        || input.instructionMarkdown.trim() === ''
        || input.instructionMarkdown.length > MAX_AGENT_INSTRUCTION_CHARS
        || input.instructionMarkdown.includes('\0')
      )) {
        throw new Error('codex worker requires verified assignment provenance and safe declaration instructions');
      }
      // Assigned roster stages are the normal path. The profile fallback preserves the legacy WorkerAdapter
      // contract until Task 3 makes roster assignment mandatory at activation.
      const agentId = input.assignment?.agentId ?? input.profile.id;
      const threadId = resolveThread(input.runRef, agentId);
      const args = buildCodexExecArgs({ model: input.profile.model, worktreePath: input.worktreePath, threadId });
      const prompt = buildWorkerPrompt({
        workOrder: input.workOrder,
        readScope: input.readScope,
        writeScope: input.writeScope,
        ...(!threadId && input.instructionMarkdown !== undefined ? { agentDeclarationMarkdown: input.instructionMarkdown } : {}),
        ...(input.reviewContract ? { reviewContract: input.reviewContract } : {}),
      });

      return new Promise<WorkerExecutionResult>((resolvePromise) => {
        const proc = spawner({ args, cwd: input.worktreePath, env: buildWorkerEnv() });
        const stdoutChunks: string[] = [];
        let stdoutBytes = 0;
        let stderrTail = '';
        let settled = false;
        let timedOut = false;
        let exceeded = false;

        const terminate = (): void => {
          if (typeof proc.pid === 'number') {
            try { killTree(proc.pid); return; } catch { /* fall through to the direct child */ }
          }
          try { proc.kill(); } catch { /* the child may already be gone */ }
        };
        const finalize = (code: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const parsed = parseCodexStream(stdoutChunks.join(''));
          void (async () => {
            if (parsed.threadId) {
              try {
                // The callback is void-compatible, while activation supplies the chain store's Promise.
                await Promise.resolve(recordThread(input.runRef, agentId, parsed.threadId));
              } catch (error) {
                resolvePromise(failedResult(
                  `codex worker could not record its emitted thread: ${error instanceof Error ? error.message : String(error)}`,
                  ZERO_USAGE,
                  DEFAULT_SUMMARY_MAX_CHARS,
                ));
                return;
              }
            }
            const tail = stderrTail.trim();
            if (timedOut) {
              resolvePromise(failedResult(`codex worker timed out after ${timeoutMs}ms and was killed. ${tail}`, ZERO_USAGE, DEFAULT_SUMMARY_MAX_CHARS));
              return;
            }
            if (exceeded) {
              resolvePromise(failedResult(`codex worker output exceeded the ${maxOutputBytes}-byte cap and was killed. ${tail}`, ZERO_USAGE, DEFAULT_SUMMARY_MAX_CHARS));
              return;
            }
            const usage = parsed.terminalEvent ? extractUsage(parsed.terminalEvent) : ZERO_USAGE;
            if (code !== 0) {
              resolvePromise(failedResult(`codex worker exited with code ${code ?? 'null'}. ${tail}`, usage, DEFAULT_SUMMARY_MAX_CHARS));
              return;
            }
            if (!parsed.terminalEvent) {
              resolvePromise(failedResult(`codex worker produced no turn.completed terminal event. ${tail}`, ZERO_USAGE, DEFAULT_SUMMARY_MAX_CHARS));
              return;
            }
            resolvePromise({
              state: 'succeeded',
              summary: boundSummary(parsed.finalMessage || 'codex worker completed without a final agent message.', DEFAULT_SUMMARY_MAX_CHARS),
              usage,
              artifacts: [],
              checkpoints: [],
            });
          })().catch((error) => {
            resolvePromise(failedResult(
              `codex worker thread finalization failed: ${error instanceof Error ? error.message : String(error)}`,
              ZERO_USAGE,
              DEFAULT_SUMMARY_MAX_CHARS,
            ));
          });
        };
        const timer = setTimeout(() => {
          timedOut = true;
          terminate();
          finalize(null);
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();

        proc.onError?.((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(failedResult(`codex worker process error: ${error instanceof Error ? error.message : String(error)}`, ZERO_USAGE, DEFAULT_SUMMARY_MAX_CHARS));
        });
        proc.onStdout((chunk) => {
          stdoutBytes += Buffer.byteLength(chunk, 'utf8');
          if (stdoutBytes > maxOutputBytes) {
            exceeded = true;
            terminate();
            finalize(null);
            return;
          }
          stdoutChunks.push(chunk);
        });
        proc.onStderr((chunk) => { stderrTail = (stderrTail + chunk).slice(-DEFAULT_STDERR_TAIL_CHARS); });
        proc.onExit((code) => finalize(code));
        try {
          proc.writeStdin(prompt);
          proc.endStdin();
        } catch {
          terminate();
          finalize(null);
        }
      });
    },
  };
}
