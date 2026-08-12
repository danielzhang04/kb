/**
 * D2.8 — the files-only stop floor: the dashboard-down-safe coarse-stop layer that never needs the
 * Broker (design §3.1/§6; docs/specs/2026-07-16-dashboard-design.md). Four primitives:
 *
 *  - `writeStop(session, deps)` — writes the repo-root `STOP` sentinel that `scripts/preamble.py`
 *    checks at the start of every loop/task (fleet-wide, nuclear halt).
 *  - `requestStop(cardId, session, deps)` — walks a `working` card through the D1.3 steering-floor
 *    ladder (`working` -> `stop-requested` -> `halting`) via the governed `scripts/cards.py` module
 *    path (same shelling pattern as `dashboard/server/write/launch.ts`'s `CARD_OP_SCRIPT`).
 *  - `pauseCadence(name, session, deps)` — writes the `queue/paused/<name>` presence-only sentinel
 *    that `scripts/dispatch.py#due()` (D1.1) checks to suppress a single cadence's next beat.
 *  - `sigkillBackstop(pid, ladder, deps)` — the Q8 escalation ladder (60s grace -> `interrupt()`-
 *    equivalent -> SIGKILL at +30s more) for a card that never self-halts. Pure function of elapsed
 *    time against an injected clock — no real sleeps, ever.
 *
 * WHY `writeStop` NEVER touches git: unlike `requestStop`/`pauseCadence` (queue/ coordination writes,
 * routed to `ops` per CLAUDE.md's branch rule), the `STOP` sentinel is documented elsewhere
 * (docs/plans/2026-07-15-agentic-os-m1.md's manual-verification note: "Do not commit the STOP file")
 * as a deliberately UNCOMMITTED, purely-local file. That is what makes it the dashboard-down-safe
 * layer: it works even when git/network is broken, can't be silently reverted by a rebase, and (unlike
 * a coordination write) must be creatable even when the fleet is ALREADY frozen or the daily budget is
 * blown — so, also unlike `dashboard/server/write/launch.ts`, none of these four primitives run
 * `assertFleetRunnable()` first. Gating a STOP-THE-FLEET action behind "is the fleet currently
 * runnable" would be backwards: an operator must be able to hit stop precisely when the fleet is
 * already in a bad state. Every primitive here is still strictly WebAuthn-session-gated
 * (`verifySession`) — the invariant is "session-gated", not "preamble-gated".
 *
 * `requestStop` and `pauseCadence` DO route their writes to `ops` via `git pull --rebase origin ops`
 * -> stage-only-the-changed-path -> commit -> push, retrying a rejected push after re-reading state
 * (CLAUDE.md: "a rejected push means: re-read state, reconcile, retry") — same `OpsGitRunner` DI shape
 * as `dashboard/server/audit/log.ts` / `dashboard/server/trace/commit.ts`, redefined locally here per
 * this codebase's established convention of NOT sharing that type across write-surface modules.
 *
 * Hermetic by construction: `PyRunner` and `OpsGitRunner` are injected (no test ever shells a real
 * `py`/`git` binary or touches the network — see `floor.test.ts`), and `sigkillBackstop` takes an
 * injected clock (`now`) and an injected `kill` function (no test ever sends a real OS signal).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { verifySession } from '../auth/session.ts';
import type { SessionClaims, SessionConfig } from '../auth/session.ts';
import { createAsyncGitRunner, withOpsTransaction } from '../write/asyncGit.ts';
import type { OpsGitRunner } from '../write/asyncGit.ts';
import { pushOpsWithReconcile } from '../write/opsPushRetry.ts';

/** The bearer session token plus the config needed to verify it (mirrors `launch.ts`'s shape). */
export interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

/** A gate failure shared by every session-gated primitive in this module. */
export type Unauthenticated = { ok: false; reason: 'unauthenticated'; detail: string };

/** Session-gate every state-changing action in this module. No preamble/fleet-runnable check — see
 *  the module docstring for why a stop control must work even when the fleet is already frozen. */
function checkSession(session: SessionInput): { ok: true; claims: SessionClaims } | Unauthenticated {
  if (!session.token) {
    return { ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' };
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return { ok: false, reason: 'unauthenticated', detail: check.reason };
  }
  return { ok: true, claims: check.claims };
}

/** Raw result of one subprocess run (`py` or `git`). */
export interface PyRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `py -3 -c <code> <jsonArg>` under `repoRoot` and returns its exit code + stdio. Injected for
 *  hermetic tests — no test ever shells a real Python interpreter or touches a real `queue/` tree. */
export type PyRunner = (repoRoot: string, code: string, jsonArg: string) => PyRunResult;

/** Default runner: shells `py -3 -c <code> <jsonArg>`, matching `write/launch.ts#defaultPyRunner`. */
export const defaultPyRunner: PyRunner = (repoRoot, code, jsonArg) => {
  try {
    const stdout = execFileSync('py', ['-3', '-c', code, jsonArg], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    };
  }
};

/**
 * The fixed Python payload shelled by `requestStop`. Reads `{"cardId": ...}` from `sys.argv[1]`,
 * locates the card under `queue/**`, and walks it `working` -> `stop-requested` -> `halting` using
 * `scripts/cards.py`'s own `transition()` (the sole schema/legality authority — LEGAL transitions +
 * `_validate`), never a raw queue/ byte write. Prints `{"id", "path", "state"}` as its only stdout
 * line. A card not in `working` (or otherwise illegal per `cards.LEGAL`) raises `ValidationError`,
 * which surfaces as a non-zero exit — `requestStop` reports that as `card-op-failed`, never silently
 * swallowing it.
 */
export const STOP_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
queue_root = Path("queue")

matches = list(queue_root.glob(f"**/{op['cardId']}.md"))
if not matches:
    print(f"card not found: {op['cardId']}", file=sys.stderr)
    raise SystemExit(1)

card = cards.parse(matches[0])
cards.transition(card, "stop-requested", queue_root)
path = cards.transition(card, "halting", queue_root)

print(json.dumps({"id": card.meta["id"], "path": str(path), "state": card.meta["state"]}))
`.trim();

/** A git invocation runner. `args` is the full argv AFTER `git`. Injected for hermetic tests — the ONE
 *  shared, widened type from `write/asyncGit.ts` (unified with `audit/log.ts` / `trace/commit.ts`). */
export type { OpsGitRunner };

/** Default runner: the shared async git runner (spawn, off the event loop, 60s kill-timeout). gpg
 *  signing off; the repo's pre-commit hook still runs. */
export const defaultOpsGitRunner: OpsGitRunner = createAsyncGitRunner({ requireTransaction: true });

/**
 * Stage exactly `relPaths` (never `git add .`) and commit+push to `ops` via pull-rebase-push, retrying
 * a rejected push after re-reading state (CLAUDE.md: "a rejected push means: re-read state, reconcile,
 * retry"). Shared by `requestStop` and `pauseCadence` — the two coordination writes this module makes.
 */
async function commitToOps(
  repoRoot: string,
  relPaths: string[],
  message: string,
  runGit: OpsGitRunner,
  maxRetryPushes = 3,
): Promise<void> {
  await runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
  await runGit(repoRoot, ['add', '--', ...relPaths]);
  await runGit(repoRoot, ['commit', '-m', message]);

  await pushOpsWithReconcile({ repoRoot, runGit, maxRetryPushes });
}

/** Injectable dependencies shared by every primitive in this module. Every field is hermetic-test-safe. */
export interface FloorDeps {
  repoRoot: string;
  runPy?: PyRunner;
  runGit?: OpsGitRunner;
}

export type WriteStopOutcome = { ok: true; path: string } | Unauthenticated;

/**
 * Write the repo-root `STOP` sentinel (session-gated). Presence-only — `scripts/preamble.py` only
 * checks `(repoRoot / "STOP").exists()`, never reads its contents — so the body here is purely an
 * informational breadcrumb for a human reading the file, never parsed by anything. Deliberately never
 * committed to git (see module docstring). The nuclear, whole-fleet control.
 */
export function writeStop(session: SessionInput, deps: FloorDeps): WriteStopOutcome {
  const gated = checkSession(session);
  if (!gated.ok) return gated;

  mkdirSync(deps.repoRoot, { recursive: true });
  const abs = join(deps.repoRoot, 'STOP');
  writeFileSync(
    abs,
    `STOP — fleet frozen via dashboard stop floor at ${new Date().toISOString()} (session sub: ${gated.claims.sub})\n`,
    'utf8',
  );
  return { ok: true, path: 'STOP' };
}

/** Parse the one-line `{"id", "path", "state"}` JSON `STOP_CARD_SCRIPT` prints on success. */
function parseStopOpStdout(stdout: string): { id: string; path: string; state: string } {
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return JSON.parse(lastLine) as { id: string; path: string; state: string };
}

export type RequestStopOutcome =
  | { ok: true; cardId: string; cardPath: string; state: string }
  | Unauthenticated
  | { ok: false; reason: 'card-op-failed'; detail: string };

/**
 * Walk `cardId` (scoped, this-card control) `working` -> `stop-requested` -> `halting` via the
 * governed `scripts/cards.py` module path (`STOP_CARD_SCRIPT`, same shelling pattern as
 * `write/launch.ts`'s `CARD_OP_SCRIPT` — `scripts/cards.py` is a MODULE, not a CLI). On success, the
 * changed card path is a coordination write and is committed to `ops` via pull-rebase-push (retrying a
 * rejected push) — never a raw `queue/` byte write from this process, and never `git add .`.
 */
export async function requestStop(cardId: string, session: SessionInput, deps: FloorDeps): Promise<RequestStopOutcome> {
  const gated = checkSession(session);
  if (!gated.ok) return gated;

  // The card mutation and its ops commit are ONE transaction — another writer's pull/stage in between
  // would sweep or refuse this card's change.
  return withOpsTransaction(async () => {
    const runPy = deps.runPy ?? defaultPyRunner;
    const result = runPy(deps.repoRoot, STOP_CARD_SCRIPT, JSON.stringify({ cardId }));
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'card-op-failed', detail: result.stderr.trim() || result.stdout.trim() };
    }
    const { id, path, state } = parseStopOpStdout(result.stdout);

    await commitToOps(
      deps.repoRoot,
      [path],
      `chore(stop): ${id} working -> stop-requested -> halting`,
      deps.runGit ?? defaultOpsGitRunner,
    );

    return { ok: true, cardId: id, cardPath: path, state };
  });
}

export type PauseCadenceOutcome = { ok: true; path: string } | Unauthenticated;

/**
 * Write the `queue/paused/<name>` presence-only sentinel `scripts/dispatch.py#due()` (D1.1) checks to
 * suppress exactly that one cadence's next beat — files-only, never edits `HEARTBEAT.md`, and the
 * marker's contents (there are none) are never read/parsed, matching `due()`'s own contract. The write
 * is a coordination write and routes to `ops` via pull-rebase-push, same as `requestStop`.
 */
export async function pauseCadence(name: string, session: SessionInput, deps: FloorDeps): Promise<PauseCadenceOutcome> {
  const gated = checkSession(session);
  if (!gated.ok) return gated;

  return withOpsTransaction(async () => {
    const relPath = `queue/paused/${name}`;
    const abs = join(deps.repoRoot, 'queue', 'paused', name);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs)) writeFileSync(abs, '', 'utf8');

    await commitToOps(deps.repoRoot, [relPath], `chore(pause): ${name}`, deps.runGit ?? defaultOpsGitRunner);

    return { ok: true, path: relPath };
  });
}

/** One stop-ladder's timing + origin: when the `stop-requested` clock started, and (optionally) a
 *  non-default grace/escalation window — defaults are the Q8 ladder (design doc / plan §D2.8). */
export interface StopLadder {
  /** Epoch ms when `stop-requested` was set (the ladder's t=0). */
  requestedAt: number;
  /** Grace period before the first escalation. Default 60_000 (Q8: 60s). */
  graceMs?: number;
  /** Additional time after `graceMs` before SIGKILL. Default 30_000 (Q8: +30s). */
  escalateMs?: number;
}

/** The Q8 ladder's default timings (docs/plans/2026-07-16-dashboard-implementation.md: "Q8 escalation
 *  ladder = 60s stop-requested -> interrupt() -> SIGKILL at +30s"). */
export const Q8_GRACE_MS = 60_000;
export const Q8_ESCALATE_MS = 30_000;

export type BackstopAction = 'none' | 'interrupt' | 'sigkill';

export interface SigkillBackstopDeps {
  /** Injectable clock; defaults to `Date.now`. Tests advance this instead of a real timer. */
  now?: () => number;
  /** Injectable OS-signal sender; defaults to `process.kill`. No test ever sends a real signal. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

const defaultKill = (pid: number, signal: NodeJS.Signals): void => {
  process.kill(pid, signal);
};

/**
 * The Q8 escalation ladder: a pure function of elapsed time since `ladder.requestedAt` against an
 * injected clock (no real sleeps, ever). Before `graceMs`: no-op (`'none'`) — cooperative stop hasn't
 * timed out yet. From `graceMs` to `graceMs + escalateMs`: the "interrupt() equivalent" backstop — at
 * this files-only floor there is no live Broker session handle to `interrupt()` (that's D3), so a
 * process-group `SIGTERM` is the analogous soft-stop signal. At/after `graceMs + escalateMs`: `SIGKILL`
 * — the hard backstop for a card that never self-halts (design invariant: "a card that never
 * self-halts gets SIGKILL as backstop"). Intended to be POLLED repeatedly (by a cadence/monitor outside
 * this module's scope) with the same `ladder.requestedAt` each time; calling it again once past the
 * SIGKILL threshold keeps returning `'sigkill'` (and would re-signal an already-dead pid harmlessly —
 * `process.kill` on a reaped pid throws ESRCH, which is the caller's concern, not this pure primitive's).
 */
export function sigkillBackstop(pid: number, ladder: StopLadder, deps: SigkillBackstopDeps = {}): BackstopAction {
  const now = deps.now ?? Date.now;
  const kill = deps.kill ?? defaultKill;
  const graceMs = ladder.graceMs ?? Q8_GRACE_MS;
  const escalateMs = ladder.escalateMs ?? Q8_ESCALATE_MS;
  const elapsed = now() - ladder.requestedAt;

  if (elapsed < graceMs) return 'none';
  if (elapsed < graceMs + escalateMs) {
    kill(pid, 'SIGTERM');
    return 'interrupt';
  }
  kill(pid, 'SIGKILL');
  return 'sigkill';
}
