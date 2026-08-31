/** Dashboard-down-safe fleet STOP and process escalation primitives. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifySession } from '../auth/session.ts';
import type { SessionClaims, SessionConfig } from '../auth/session.ts';

export interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

export type Unauthenticated = { ok: false; reason: 'unauthenticated'; detail: string };

function checkSession(session: SessionInput): { ok: true; claims: SessionClaims } | Unauthenticated {
  if (!session.token) return { ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' };
  const check = verifySession(session.token, session.config);
  return check.ok
    ? { ok: true, claims: check.claims }
    : { ok: false, reason: 'unauthenticated', detail: check.reason };
}

export interface FloorDeps {
  repoRoot: string;
}

export type WriteStopOutcome = { ok: true; path: string } | Unauthenticated;

/** Fleet-wide STOP remains local and uncommitted so it works while coordination is unavailable. */
export function writeStop(session: SessionInput, deps: FloorDeps): WriteStopOutcome {
  const gated = checkSession(session);
  if (!gated.ok) return gated;
  mkdirSync(deps.repoRoot, { recursive: true });
  writeFileSync(
    join(deps.repoRoot, 'STOP'),
    `STOP — fleet frozen via dashboard stop floor at ${new Date().toISOString()} (session sub: ${gated.claims.sub})\n`,
    'utf8',
  );
  return { ok: true, path: 'STOP' };
}

export interface StopLadder {
  requestedAt: number;
  graceMs?: number;
  escalateMs?: number;
}

export const Q8_GRACE_MS = 60_000;
export const Q8_ESCALATE_MS = 30_000;

export type BackstopAction = 'none' | 'interrupt' | 'sigkill';

export interface SigkillBackstopDeps {
  now?: () => number;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

const defaultKill = (pid: number, signal: NodeJS.Signals): void => {
  process.kill(pid, signal);
};

/** Bounded Q8 escalation: grace, soft interrupt, then SIGKILL. */
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
