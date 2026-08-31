// Dashboard v3 P5 W5 — §3.7 close-ptys-and-continue. This module owns exactly the action logic: it
// assumes the T3 ceremony has already been verified by its (future W6.1) caller, and drives the one CAS
// transition that pins a deployment's session set and advances it `parked -> swapping`.
//
// Design 264/619/673: the server re-reads the live session set and refuses rather than closing a
// superset, subset, or re-derived set; any non-`ok` `closeAndWait` result (including a timeout) refuses
// the whole action and leaves the Deployment revision untouched; only an exact confirmed close advances
// the state, recorded under the `human-operator` actor.
import { sha256Hex } from '../shared/hashing.ts';
import type { ControlResult, Deployment } from '../control/types.ts';
import type { DeploymentSessionCloser } from '../pty/sessionRecord.ts';

/** Store seam: the one CAS transition this action drives. Narrower than the full control store. */
export interface DeploymentTransitionStore {
  transitionDeployment(
    subject: string,
    deploymentRef: string,
    input: {
      expectedRevision: number;
      expectedState: 'parked';
      nextState: 'swapping';
      idempotencyKey: string;
      patch: {
        blockers: string[];
        progress: { kind: 'swapping'; attemptRef: null; since: string; detail: null };
      };
    },
  ): ControlResult<Deployment>;
}

/** Re-read fresh every call — never cached, and never the pinned set fed back to itself. */
export interface LivePtySessionsPort {
  listLiveSessionIds(): Promise<readonly string[]> | readonly string[];
}

export interface CloseAndContinuePorts {
  store: DeploymentTransitionStore;
  liveSessions: LivePtySessionsPort;
  closeSessions: DeploymentSessionCloser;
  now?: () => string;
}

export interface CloseAndContinueInput {
  deploymentRef: string;
  expectedRevision: number;
  /** The exact pty session ids pinned by the caller's T3 assertion digest — the only ids ever closed. */
  sessionIds: readonly string[];
}

type StoreFailureReason = Extract<ControlResult<Deployment>, { ok: false }>['reason'];

export type CloseAndContinueResult =
  | { ok: true; deployment: Deployment; closed: readonly string[] }
  | { ok: false; refusal: 'pty-set-changed' | 'pty-not-confirmed'; detail: string }
  | { ok: false; refusal: 'invalid' | StoreFailureReason; detail: string };

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function sortedIdsDigest(ids: readonly string[]): string {
  return sha256Hex(JSON.stringify([...ids].sort()));
}

/**
 * Closes EXACTLY the T3-pinned live pty ids for a `parked` deployment, then advances it to `swapping`.
 * Refuses `pty-set-changed` the instant the live set differs from the pinned set by even one id, and
 * `pty-not-confirmed` on any non-`ok` close result (a timeout included) or a partial close — in both
 * refusal paths the store is never called, so the Deployment revision is left untouched.
 */
export async function closePtysAndContinue(
  ports: CloseAndContinuePorts,
  input: CloseAndContinueInput,
): Promise<CloseAndContinueResult> {
  if (input.sessionIds.length === 0 || new Set(input.sessionIds).size !== input.sessionIds.length) {
    return { ok: false, refusal: 'invalid', detail: 'close-ptys-and-continue requires a non-empty, deduplicated pinned session set' };
  }

  const live = [...(await ports.liveSessions.listLiveSessionIds())];
  if (!sameIdSet(live, input.sessionIds)) {
    return { ok: false, refusal: 'pty-set-changed', detail: 'the live pty session set no longer matches the pinned ids' };
  }

  const closed = await ports.closeSessions(input.sessionIds);
  if (!closed.ok || !sameIdSet(closed.value.closed, input.sessionIds)) {
    return { ok: false, refusal: 'pty-not-confirmed', detail: 'closeAndWait did not confirm every pinned session' };
  }

  const now = ports.now?.() ?? new Date().toISOString();
  const idempotencyKey = `close-ptys-and-continue:${input.deploymentRef}:${input.expectedRevision}:${sortedIdsDigest(input.sessionIds)}`;
  const transitioned = ports.store.transitionDeployment('human-operator', input.deploymentRef, {
    expectedRevision: input.expectedRevision,
    expectedState: 'parked',
    nextState: 'swapping',
    idempotencyKey,
    patch: { blockers: [], progress: { kind: 'swapping', attemptRef: null, since: now, detail: null } },
  });
  if (!transitioned.ok) return { ok: false, refusal: transitioned.reason, detail: transitioned.detail };
  return { ok: true, deployment: transitioned.value, closed: closed.value.closed };
}
