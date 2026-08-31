// Dashboard v3 P5 §3.1 — the Deployment service adapter [P5-C17, P5-C36, P5-C58].
//
// The single place that translates the Inbox deploy verbs into `control/store.ts` writes under the
// writer lease. Deploy (green) and Confirm (breaking) BOTH create the Deployment at `initialState:
// 'requested'` — the only state P5 ever creates at — pinning all seven `CREATE_KEYS` and reusing the
// `deploy-ready:<targetSha>` subject ref so the item id is stable across Deploy [P5-C17]. The two verbs
// differ only in which `breaking` flag admits them: a breaking candidate on `/deploy` is
// `confirm-required`; a green candidate on `/confirm` is `deploy-required` [P5-C58]. A double-clicked
// Deploy/Confirm converges on one record through `idempotencyKey = "deploy:<targetSha>"` and the
// store's create idempotency (`store.ts` create-receipt CAS). The helper `deploy` invocation is the
// route's job (W2/W6.1); this adapter owns only the store write.
import type { DeployReadyCandidate } from './contracts.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import type { ControlResult, Deployment } from '../control/types.ts';

/** The subject attributed to every deploy-critical Deployment write. */
export const DEPLOYMENT_SUBJECT = 'deployment';
const PARK_WARN_MS = 90_000; // `parkWarnAt = requestedAt + 90 s` (bounded wait, `movement:90`).

export type DeploymentServiceCode =
  | 'confirm-required'
  | 'deploy-required'
  | 'abort-not-allowed'
  | 'conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'invalid';

export class DeploymentServiceError extends Error {
  readonly status: number;
  readonly code: DeploymentServiceCode;

  constructor(status: number, code: DeploymentServiceCode, message: string = code) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'DeploymentServiceError';
  }
}

export interface DeploymentServiceOptions {
  store: ControlPlaneStore;
  /** Injected clock; defaults to wall time. Used for `requestedAt`/`parkWarnAt`/terminal stamps. */
  now?: () => Date;
}

export interface DeploymentCreateResult {
  deployment: Deployment;
  /** True when an identical Deploy/Confirm converged on the already-created record. */
  replayed: boolean;
}

/** The subject ref a deploy-ready candidate is projected under, reused verbatim by the record [P5-C17]. */
export function deployReadyRef(targetSha: string): string {
  return `deploy-ready:${targetSha}`;
}

// Derived from the store's actual result type [P5-C46/C58 idiom, per quiescence.ts:50] rather than
// hand-declared, so this stays total over every reason `ControlPlaneStore`'s Deployment methods can
// ever return — not just the four this module's own writes happen to produce today.
type StoreFail = Extract<ControlResult<Deployment>, { ok: false }>;

function refuse(result: StoreFail): DeploymentServiceError {
  switch (result.reason) {
    case 'not-found': return new DeploymentServiceError(404, 'not-found', result.detail);
    case 'invalid': return new DeploymentServiceError(400, 'invalid', result.detail);
    case 'idempotency-conflict': return new DeploymentServiceError(409, 'idempotency-conflict', result.detail);
    case 'conflict': return new DeploymentServiceError(409, 'conflict', result.detail);
    // `not-approved` / `limit` / `ineligible` belong to other control-plane subjects (proposals, run
    // activation) and `createDeployment`/`transitionDeployment` never produce them; refused as a
    // generic conflict so the mapping is total without minting a new Deployment service code.
    case 'not-approved':
    case 'limit':
    case 'ineligible':
      return new DeploymentServiceError(409, 'conflict', result.detail);
  }
}

export class DeploymentService {
  private readonly store: ControlPlaneStore;
  private readonly now: () => Date;

  constructor(options: DeploymentServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  /** Green (`breaking:false`) entry verb. A breaking candidate is refused `confirm-required`. */
  deploy(candidate: DeployReadyCandidate, previousCommit: string): DeploymentCreateResult {
    if (candidate.breaking) throw new DeploymentServiceError(409, 'confirm-required');
    return this.createFromCandidate(candidate, previousCommit);
  }

  /** Breaking (`breaking:true`) entry verb. A green candidate is refused `deploy-required`. */
  confirm(candidate: DeployReadyCandidate, previousCommit: string): DeploymentCreateResult {
    if (!candidate.breaking) throw new DeploymentServiceError(409, 'deploy-required');
    return this.createFromCandidate(candidate, previousCommit);
  }

  /**
   * Live Abort, allowed ONLY from `requested|parked` [movement:115]. Any other state is refused
   * `abort-not-allowed` (the route surfaces the swap-state `409`s); the store CAS is the second wall.
   */
  abort(deploymentRef: string, expectedRevision: number, expectedState: Deployment['state']): Deployment {
    if (expectedState !== 'requested' && expectedState !== 'parked') {
      throw new DeploymentServiceError(409, 'abort-not-allowed');
    }
    const at = this.now().toISOString();
    const result = this.store.transitionDeployment(DEPLOYMENT_SUBJECT, deploymentRef, {
      expectedRevision,
      expectedState,
      nextState: 'aborted',
      idempotencyKey: `abort:${deploymentRef}:${expectedRevision}`,
      patch: {
        abortRequestedAt: at,
        terminalOutcome: { kind: 'aborted', at, by: DEPLOYMENT_SUBJECT },
      },
    });
    if (!result.ok) throw refuse(result);
    return result.value;
  }

  /** Clear a terminal subject: `succeeded|aborted|failed → acknowledged`. NON-T3 [P5-C21]. */
  acknowledge(
    deploymentRef: string,
    expectedRevision: number,
    expectedState: 'succeeded' | 'aborted' | 'failed',
    subject: string,
  ): Deployment {
    const result = this.store.transitionDeployment(DEPLOYMENT_SUBJECT, deploymentRef, {
      expectedRevision,
      expectedState,
      nextState: 'acknowledged',
      idempotencyKey: `acknowledge:${deploymentRef}:${expectedRevision}`,
      patch: { acknowledgedBy: { subject, at: this.now().toISOString() } },
    });
    if (!result.ok) throw refuse(result);
    return result.value;
  }

  private createFromCandidate(candidate: DeployReadyCandidate, previousCommit: string): DeploymentCreateResult {
    const targetSha = candidate.sha;
    const requested = this.now();
    const requestedAt = requested.toISOString();
    const parkWarnAt = new Date(requested.getTime() + PARK_WARN_MS).toISOString();
    const result = this.store.createDeployment(DEPLOYMENT_SUBJECT, {
      deploymentRef: deployReadyRef(targetSha),
      idempotencyKey: `deploy:${targetSha}`,
      initialState: 'requested',
      targetCommit: targetSha,
      previousCommit,
      requestedAt,
      parkWarnAt,
    });
    if (!result.ok) throw refuse(result);
    return { deployment: result.value, replayed: result.replayed === true };
  }
}
