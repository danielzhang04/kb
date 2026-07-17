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
import { verifySession } from '../auth/session';
import type { SessionConfig } from '../auth/session';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate';
import type { PreambleRunner } from '../write/preambleGate';
import { appendAudit as defaultAppendAudit } from '../audit/log';
import type { AppendAuditOptions, AuditRow, OpsGitRunner } from '../audit/log';
import { rateLimit, lockout } from '../security/ratelimit';
import type { LockoutGuard } from '../security/ratelimit';
import { parseRecord } from '../planeB/tailer';
import type { TranscriptRecord } from '../planeB/tailer';
import { foldRecords } from '../../src/lib/timelineModel';
import type { TimelineModel } from '../../src/lib/timelineModel';

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
  appendAudit?: (repoRoot: string, event: Parameters<typeof defaultAppendAudit>[1], options?: AppendAuditOptions) => AuditRow;
  runGit?: OpsGitRunner;
  now?: () => Date;
}

export type VibeSpawnOutcome =
  | { ok: true; kill: () => void }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; detail: string }
  | { ok: false; reason: 'rate-limited'; retryAfterMs: number }
  | { ok: false; reason: 'locked-out'; retryAfterMs: number };

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
export function spawnVibe(
  prompt: string,
  session: SessionInput,
  handlers: VibeHandlers,
  deps: VibeDeps,
): VibeSpawnOutcome {
  const appendAuditFn = deps.appendAudit ?? defaultAppendAudit;

  function audited(outcome: VibeSpawnOutcome, owner?: string): VibeSpawnOutcome {
    const detail: Record<string, unknown> = { promptLength: prompt.length };
    if (!outcome.ok && 'problems' in outcome) detail.problems = outcome.problems;
    if (!outcome.ok && 'detail' in outcome) detail.refusalDetail = outcome.detail;
    if (!outcome.ok && 'retryAfterMs' in outcome) detail.retryAfterMs = outcome.retryAfterMs;
    appendAuditFn(
      deps.repoRoot,
      {
        action: 'vibe-spawn',
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
    return audited({ ok: false, reason: 'fleet-frozen', problems: preambleResult.problems });
  }

  // 2. WebAuthn session gate — checked only after the preamble passes.
  if (!session.token) {
    return audited({ ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' });
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return audited({ ok: false, reason: 'unauthenticated', detail: check.reason });
  }
  const owner = check.claims.sub;

  // 3. Rate-limit + lockout, keyed by the verified session subject.
  const guard = deps.rateLimitGuard ?? defaultVibeRateLimitGuard;
  const decision = guard.check(owner);
  if (!decision.allowed) {
    return audited(
      {
        ok: false,
        reason: decision.reason === 'locked-out' ? 'locked-out' : 'rate-limited',
        retryAfterMs: decision.retryAfterMs,
      },
      owner,
    );
  }

  // 4. Spawn — the ONLY point in this function a real `claude` child process is created.
  const spawner = deps.spawn ?? defaultVibeSpawner;
  const proc = spawner(['--print', '--output-format', 'stream-json'], deps.repoRoot);

  const buffer = createStreamJsonBuffer();
  const allRecords: TranscriptRecord[] = [];
  proc.onStdout((chunk) => {
    const newRecords = buffer.push(chunk);
    if (newRecords.length === 0) return;
    allRecords.push(...newRecords);
    handlers.onDelta(foldRecords(allRecords), newRecords);
  });
  if (handlers.onStderr) proc.onStderr(handlers.onStderr);
  proc.onExit((code) => handlers.onExit?.(code));

  proc.writeStdin(prompt);
  proc.endStdin();

  return audited({ ok: true, kill: () => proc.kill() }, owner);
}
