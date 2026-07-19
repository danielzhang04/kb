/**
 * D2.7 — the vibe-code chat box's server-side spawn path: a chat box that spawns a REAL
 * `claude --print --output-format stream-json` child process against the kb. This is a **live prompt
 * with fleet reach (RCE-equivalent)** — free-form text here can do anything the operator's own
 * `claude` session could do — so every invariant below is load-bearing, not cosmetic.
 *
 * Gate order, enforced by `spawnVibe` before a single byte of a `claude` child process exists:
 *   1. **Preamble gate FIRST** — `assertFleetRunnable()` (D2.6, imported verbatim, never
 *      reimplemented). A STOP-frozen fleet, a set `ANTHROPIC_API_KEY`, or a breached budget all
 *      refuse identically, and nothing downstream (session check, rate limiter, spawner) is even
 *      evaluated. Mirrors `dashboard/server/write/launch.ts`'s `gate()` ordering exactly — a frozen
 *      fleet must not be re-activated by an RCE-equivalent spawn regardless of who is asking.
 *   2. **WebAuthn session gate** — `verifySession()` (D2.1, imported verbatim). Missing, malformed,
 *      expired, or bad-signature tokens are all rejected the same way, before any spawn.
 *   3. **Rate-limit + lockout** (D2.9's `rateLimit`/`lockout`, imported verbatim from
 *      `server/security/ratelimit.ts`), keyed by the verified session subject — a burst of vibe-spawns
 *      from one operator throttles, then locks out, independent of any one write endpoint's own logic.
 *   4. **Spawn.** Only past all three gates does `deps.spawn` (injectable; the real default shells
 *      `claude --print --output-format stream-json`) get called.
 *
 * Every call to `spawnVibe` — whether it is refused at gate 1, 2, or 3, or actually spawns — writes
 * EXACTLY ONE audit row via `appendAudit()` (D2.9, imported verbatim from `server/audit/log.ts`,
 * never reimplemented): an independent, append-only, git-committed trail of every attempted and
 * actual RCE-equivalent spawn, regardless of outcome.
 *
 * The subprocess call is injectable (`VibeSpawner`, same DI shape/rationale as `OpsGitRunner` in
 * `server/audit/log.ts` and `PyRunner` in `server/write/launch.ts`) so every test is hermetic: no
 * real `claude` binary is ever shelled by the test suite. `ANTHROPIC_API_KEY` stays unset — the
 * default spawner never sets it explicitly, it only inherits `process.env`, whose absence of that
 * key is already a precondition of the preamble gate having passed.
 *
 * Stream-json parsing reuses existing D0.3/D0.7 primitives rather than re-deriving them: `parseRecord`
 * (`server/planeB/tailer.ts`) parses one JSONL line into a `TranscriptRecord`, and `foldRecords`
 * (`src/lib/timelineModel.ts`) folds the accumulated records into the SAME `TimelineModel` the live
 * tail and static replay already share — a vibe-code session renders through that one code path too.
 */
import { spawn as spawnChildProcess } from 'node:child_process';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditRow, OpsGitRunner } from '../audit/log.ts';
import { rateLimit, lockout } from '../security/ratelimit.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import { parseRecord } from '../planeB/tailer.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { foldRecords } from '../../src/lib/timelineModel.ts';
import type { TimelineModel } from '../../src/lib/timelineModel.ts';

/** The bearer session token plus the config needed to verify it (mirrors `write/launch.ts`'s shape). */
export interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

/** A minimal handle onto a live `claude --print --output-format stream-json` child process. */
export interface VibeProcess {
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  writeStdin(text: string): void;
  endStdin(): void;
  /** Stop wiring — the D2.8 stop floor / a client disconnect kills the child through this. */
  kill(): void;
}

/** Spawns `claude` with `args` under `cwd`. Injected for hermetic tests — never a real CLI. */
export type VibeSpawner = (args: string[], cwd: string) => VibeProcess;

// The dashboard daemon is single-process. Track every accepted child (including injected runtime
// adapters) so Fastify/PM2 shutdown can terminate live work before the process exits.
const activeVibeProcesses = new Set<VibeProcess>();

function stopTrackedProcess(proc: VibeProcess): void {
  activeVibeProcesses.delete(proc);
  try { proc.kill(); } catch { /* best-effort drain; shutdown must continue through every child */ }
}

/** Stop all live Composer/vibe children during daemon shutdown. Returns the number signaled. */
export function drainVibeProcesses(): number {
  const active = [...activeVibeProcesses];
  for (const proc of active) stopTrackedProcess(proc);
  return active.length;
}

/**
 * Default spawner: the real `claude --print --output-format stream-json` CLI-subprocess path
 * (independent of the SDK/OAuth route — D3's Broker is a separate, gated codepath). The prompt is
 * written to stdin (never appended to argv) so it never appears in a process listing. No `env`
 * override is passed — the child inherits `process.env` verbatim, so `ANTHROPIC_API_KEY` stays
 * however the (already preamble-gated) parent process has it: unset, per CLAUDE.md subscription
 * billing.
 */
export const defaultVibeSpawner: VibeSpawner = (args, cwd) => {
  const child = spawnChildProcess('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    onStdout(cb) {
      child.stdout?.on('data', (b: Buffer) => cb(b.toString('utf-8')));
    },
    onStderr(cb) {
      child.stderr?.on('data', (b: Buffer) => cb(b.toString('utf-8')));
    },
    onExit(cb) {
      child.on('exit', (code) => cb(code));
    },
    writeStdin(text) {
      child.stdin?.write(text);
    },
    endStdin() {
      child.stdin?.end();
    },
    kill() {
      child.kill('SIGTERM');
    },
  };
};

/** Default rate-limit config: 5 vibe-spawns/minute, locking out for 5 minutes after 3 consecutive
 *  throttles. A module-level singleton so consecutive real requests within one server process
 *  actually accumulate — tests inject their own `rateLimitGuard` (with a fake clock) instead of
 *  sharing this one, so the suite stays hermetic and deterministic. */
const defaultVibeRateLimitGuard: LockoutGuard = lockout(rateLimit({ limit: 5, windowMs: 60_000 }), {
  threshold: 3,
  lockoutMs: 5 * 60_000,
});

/** Callbacks the caller wires up to observe one vibe-code session's live output. */
export interface VibeHandlers {
  /** Called with the freshly-folded `TimelineModel` (accumulated so far) plus just the new records,
   *  every time one or more complete stream-json lines arrive. */
  onDelta: (model: TimelineModel, newRecords: TranscriptRecord[]) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

/** Injectable dependencies for `spawnVibe`. Every field is hermetic-test-safe. */
export interface VibeDeps {
  repoRoot: string;
  runPreamble?: PreambleRunner;
  spawn?: VibeSpawner;
  rateLimitGuard?: LockoutGuard;
  /** Same signature as the real `appendAudit` — inject a recording fake in tests so no real git
   *  subprocess or `ledgers/audit/**` file is ever touched by the suite. */
  appendAudit?: (repoRoot: string, event: Parameters<typeof defaultAppendAudit>[1], options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  runGit?: OpsGitRunner;
  now?: () => Date;
  /** Audit action label for this spawn (default `vibe-spawn`). Composer overrides it to `composer-turn`
   *  (review F2) so a Composer turn is a DISTINCT audit verb from a raw vibe spawn — same single sink,
   *  same exactly-one-row invariant, just a truthful action name. */
  auditAction?: string;
  /** Extra detail fields merged into this call's single audit row (alongside `promptLength`). Composer
   *  uses it to record whether the turn was a resume + a redacted resume target (review F2). */
  auditDetail?: Record<string, unknown>;
  /** An OPTIONAL extra refusal gate, run AFTER the session + rate-limit gates pass (so it is keyed by
   *  the verified subject) and BEFORE `deps.spawn` is ever called. It never REPLACES a gate — it only
   *  adds a refusal. Composer uses it to enforce the issued-id/subject resume binding (review F1). A
   *  refusal is audited exactly once (like every other refusal) and returned as `resume-denied`. */
  preSpawnGuard?: (owner: string) => { ok: true } | { ok: false; detail: string };
}

export type VibeSpawnOutcome =
  | { ok: true; kill: () => void }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; detail: string }
  | { ok: false; reason: 'rate-limited'; retryAfterMs: number }
  | { ok: false; reason: 'locked-out'; retryAfterMs: number }
  // review F1 — an additional pre-spawn refusal (Composer's issued-id/subject resume binding). Never
  // produced by the raw vibe route (which sets no `preSpawnGuard`).
  | { ok: false; reason: 'resume-denied'; detail: string };

/** Buffers raw stdout chunks into complete stream-json lines, parsing each with the shared
 *  `parseRecord` (D0.3) — malformed/partial lines never crash the session, mirroring `tailFrom`'s own
 *  defensive line handling for the same JSONL wire format. */
function createStreamJsonBuffer(): { push: (chunk: string) => TranscriptRecord[] } {
  let pending = '';
  return {
    push(chunk: string): TranscriptRecord[] {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      const records: TranscriptRecord[] = [];
      for (const line of lines) {
        const rec = parseRecord(line);
        if (rec) records.push(rec);
      }
      return records;
    },
  };
}

/**
 * Spawn (or refuse to spawn) one vibe-code `claude --print --output-format stream-json` session.
 *
 * Gate order (see module docstring): `assertFleetRunnable()` first, `verifySession()` second, the
 * rate-limit/lockout guard third — ALL THREE must pass before `deps.spawn` is ever invoked. Exactly
 * one `appendAudit()` row is written for this call regardless of which gate (if any) refused it.
 */
export async function spawnVibe(
  prompt: string,
  session: SessionInput,
  handlers: VibeHandlers,
  deps: VibeDeps,
): Promise<VibeSpawnOutcome> {
  const appendAuditFn = deps.appendAudit ?? defaultAppendAudit;

  // Exactly one audit row per call, preserved across the async boundary: every `return` path awaits this
  // once. The audit sink is now async (its git commit runs off the event loop), so `audited` awaits it
  // before handing back the outcome — keeping the audit-before-return ordering the refusal shapes rely on.
  async function audited(outcome: VibeSpawnOutcome, owner?: string): Promise<VibeSpawnOutcome> {
    // Extra caller detail (Composer's resume fields) rides in the SAME single row — never a second sink.
    const detail: Record<string, unknown> = { promptLength: prompt.length, ...deps.auditDetail };
    if (!outcome.ok && 'problems' in outcome) detail.problems = outcome.problems;
    if (!outcome.ok && 'detail' in outcome) detail.refusalDetail = outcome.detail;
    if (!outcome.ok && 'retryAfterMs' in outcome) detail.retryAfterMs = outcome.retryAfterMs;
    await appendAuditFn(
      deps.repoRoot,
      {
        action: deps.auditAction ?? 'vibe-spawn',
        owner,
        result: outcome.ok ? 'spawned' : outcome.reason,
        detail,
      },
      { runGit: deps.runGit, now: deps.now },
    );
    return outcome;
  }

  // 1. Preamble gate FIRST — a STOP-frozen / API-keyed / budget-breached fleet refuses regardless of
  //    who is asking. Nothing downstream is evaluated and no `claude` child is spawned.
  const preambleResult = assertFleetRunnable(deps.repoRoot, deps.runPreamble ?? defaultPreambleRunner);
  if (!preambleResult.ok) {
    return await audited({ ok: false, reason: 'fleet-frozen', problems: preambleResult.problems });
  }

  // 2. WebAuthn session gate — checked only after the preamble passes.
  if (!session.token) {
    return await audited({ ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' });
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return await audited({ ok: false, reason: 'unauthenticated', detail: check.reason });
  }
  const owner = check.claims.sub;

  // 3. Rate-limit + lockout, keyed by the verified session subject.
  const guard = deps.rateLimitGuard ?? defaultVibeRateLimitGuard;
  const decision = guard.check(owner);
  if (!decision.allowed) {
    return await audited(
      {
        ok: false,
        reason: decision.reason === 'locked-out' ? 'locked-out' : 'rate-limited',
        retryAfterMs: decision.retryAfterMs,
      },
      owner,
    );
  }

  // 3b. Optional pre-spawn guard (review F1): an ADDITIONAL refusal keyed by the verified subject, run
  //     only after the three gates above pass and before any spawn. Composer enforces its issued-id /
  //     subject resume binding here. This never weakens gates 1–3 — it can only refuse further.
  if (deps.preSpawnGuard) {
    const guard = deps.preSpawnGuard(owner);
    if (!guard.ok) {
      return await audited({ ok: false, reason: 'resume-denied', detail: guard.detail }, owner);
    }
  }

  // 4. Spawn — the ONLY point in this function a real `claude` child process is created.
  const spawner = deps.spawn ?? defaultVibeSpawner;
  const proc = spawner(['--print', '--verbose', '--output-format', 'stream-json'], deps.repoRoot);
  activeVibeProcesses.add(proc);

  try {
    const buffer = createStreamJsonBuffer();
    const allRecords: TranscriptRecord[] = [];
    proc.onStdout((chunk) => {
      try {
        const newRecords = buffer.push(chunk);
        if (newRecords.length === 0) return;
        allRecords.push(...newRecords);
        handlers.onDelta(foldRecords(allRecords), newRecords);
      } catch {
        // EventEmitter callback exceptions otherwise escape the request and can crash the daemon.
        // The caller owns durable failure reporting; this layer's invariant is to contain and stop.
        stopTrackedProcess(proc);
      }
    });
    if (handlers.onStderr) proc.onStderr((chunk) => {
      try {
        handlers.onStderr?.(chunk);
      } catch {
        stopTrackedProcess(proc);
      }
    });
    proc.onExit((code) => {
      activeVibeProcesses.delete(proc);
      try {
        handlers.onExit?.(code);
      } catch {
        // The child is already exiting; contain observer failures rather than crashing the daemon.
      }
    });

    proc.writeStdin(prompt);
    proc.endStdin();

    return await audited({ ok: true, kill: () => stopTrackedProcess(proc) }, owner);
  } catch (error) {
    // Once spawned, any synchronous wiring/stdin/audit failure must terminate the child. Otherwise an
    // audit sink exception can orphan a real Claude process before the caller receives its kill handle.
    stopTrackedProcess(proc);
    throw error;
  }
}
