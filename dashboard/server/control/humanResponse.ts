import { sha256Hex } from '../shared/hashing.ts';
import type { AuditEvent } from '../audit/log.ts';
import type { RespondHumanRequestInput } from './store.ts';
import type { HumanRequest, HumanRequestDecision } from './types.ts';
import { deployT3Preimage } from '../deploy/contracts.ts';
import type { DeployT3Preimage } from '../deploy/contracts.ts';
import { attributionLabel, currentAttribution } from '../auth/operator.ts';
import type { Actor } from '../authority/actor.ts';

type Awaitable<T> = T | Promise<T>;
type OperatorDecision = Exclude<HumanRequestDecision, 'auto-closed'>;

export interface HumanResponseActor {
  kind: 'operator' | 'host';
  subject: string;
}

/** `reason` bound length [design:4.3/global constraints]. */
const MAX_REASON_LENGTH = 2000;

/**
 * A `worker:<id>` or `boss` claim is a CLI actor — one operating the daemon unattended, on Daniel's
 * behalf but without him watching this specific decision. `reason` is required from them so a resolved
 * gate always carries a human-legible justification when no human was directly at the keyboard; `daniel`
 * and `unknown` may still supply one, but an absent/blank reason from either is not refused. Never an
 * authority check — `actorLabel` is self-asserted (see `authority/actor.ts`) and this only decides which
 * validation error a malformed body gets, not whether the decision is allowed.
 */
function reasonRequiredFor(actorLabel: Actor): boolean {
  return actorLabel === 'boss' || actorLabel.startsWith('worker:');
}

export interface HumanResponseInput {
  actor: HumanResponseActor;
  requestRef: string;
  expectedRevision: number;
  decision: OperatorDecision;
  idempotencyKey: string;
  response?: string | null;
  origin: string;
  ceremonyAssertion?: unknown;
  challengeExpiresAt?: string;
  /** Free text explaining the decision. Required (non-empty after trim) from a `boss`/`worker:<id>`
   *  actor; optional from `daniel`/`unknown`. See {@link reasonRequiredFor}. */
  reason: string;
  /** The `X-KB-Actor` claim for this request — self-asserted, never an authority input. */
  actorLabel: Actor;
}

export interface HumanResponseRequestContext {
  request: HumanRequest;
  runOwnerSubject: string;
}

export interface HumanResponseStorePort {
  getHumanRequest(actorSubject: string, requestRef: string): Awaitable<HumanResponseRequestContext | null>;
  isReservedIterationGate(actorSubject: string, requestRef: string): Awaitable<boolean>;
  respondHumanRequest(
    actorSubject: string,
    requestRef: string,
    input: RespondHumanRequestInput,
  ): Awaitable<{ request: HumanRequest; replayed: boolean }>;
  listHumanRequestsForRun(actorSubject: string, runRef: string): Awaitable<readonly HumanRequest[]>;
  appendResponseEvent(actorSubject: string, request: HumanRequest): Awaitable<void>;
  resumeRunAfterBoundaryAccepted(actorSubject: string, runRef: string, answeredRequest: HumanRequest): Awaitable<void>;
}

export interface HumanResponseAuditPort {
  append(event: AuditEvent): Awaitable<void>;
}

export type HumanResponseResult =
  | { ok: true; status: 200; value: HumanRequest; replayed: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string; gateKind?: string; resolveUrl?: string };

export interface HumanResponseService {
  respond(input: HumanResponseInput): Promise<HumanResponseResult>;
}

const T3_KINDS = new Set<HumanRequest['kind']>(['approval', 'review', 'governance-refusal']);

export function humanResponseDigest(input: Pick<HumanResponseInput, 'decision' | 'response'>): string {
  return sha256Hex(JSON.stringify({
    decision: input.decision,
    response: input.response ?? null,
  }));
}

function accepted(request: HumanRequest): boolean {
  return request.state === 'resolved'
    && (request.response?.decision === 'responded' || request.response?.decision === 'approved');
}

function sameReplay(request: HumanRequest, input: HumanResponseInput): boolean {
  return request.response?.idempotencyKey === input.idempotencyKey
    && request.response.requestRevision === input.expectedRevision
    && request.response.decision === input.decision
    && request.response.response === (input.response ?? null);
}

export function createHumanResponseService(options: {
  store: HumanResponseStorePort;
  audit: HumanResponseAuditPort;
  now?: () => number;
}): HumanResponseService {
  const now = options.now ?? Date.now;
  const reconcile = async (actorSubject: string, request: HumanRequest): Promise<void> => {
    await options.store.appendResponseEvent(actorSubject, request);
    const requests = await options.store.listHumanRequestsForRun(actorSubject, request.runRef);
    if (requests.length > 0 && requests.every(accepted)) {
      await options.store.resumeRunAfterBoundaryAccepted(actorSubject, request.runRef, request);
    }
  };
  return {
    async respond(input) {
      if (input.actor.kind === 'host') return { ok: false, status: 403, error: 'host-human-response-refused' };
      // T4 [design:4.3/4.5]: `reason` is validated here (not only at the route body wall) so every caller
      // of this service — including a route we forget to wire, and every direct unit test — gets the same
      // rule. A `boss`/`worker:<id>` actor is operating the daemon unattended, so a blank reason is
      // refused; `daniel`/`unknown` may omit one, in which case it is coerced (never a 400) to '' capped
      // at the bound.
      const reasonInput = input.reason;
      if (reasonRequiredFor(input.actorLabel) && (typeof reasonInput !== 'string'
        || reasonInput.length > MAX_REASON_LENGTH || reasonInput.trim().length === 0)) {
        return { ok: false, status: 400, error: 'reason-required' };
      }
      const reasonTrimmed = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, MAX_REASON_LENGTH) : '';
      const context = await options.store.getHumanRequest(input.actor.subject, input.requestRef);
      if (!context) return { ok: false, status: 404, error: 'human-request-not-found' };
      const { request, runOwnerSubject } = context;
      if (request.kind !== 'intervention' && (request.gateKind === 'iteration-park'
        || await options.store.isReservedIterationGate(input.actor.subject, input.requestRef))) {
        return {
          ok: false, status: 409, error: 'iteration-gate-reserved',
          gateKind: request.gateKind ?? 'completion',
          resolveUrl: `/api/control/iteration-gates/${input.requestRef}/resolve`,
        };
      }
      if (request.response) {
        if (!sameReplay(request, input)) {
          return { ok: false, status: 409, error: 'human-response-idempotency-conflict' };
        }
        await reconcile(input.actor.subject, request);
        return { ok: true, status: 200, value: request, replayed: true };
      }
      if (request.state !== 'open' || request.revision !== input.expectedRevision) {
        return { ok: false, status: 409, error: 'request-revision-changed' };
      }

      // T2 removed the ceremony verification that used to gate a T3 kind here. `t3` is kept
      // (it still drives the audit riskTier/detail below) but authorizes nothing on its own until T5
      // wires the workflow-tag escalation rule in its place.
      const t3 = T3_KINDS.has(request.kind);

      // T4 [design:4.3] — WHO resolved this, over what channel, and why. `attribution` reflects the SAME
      // bound identity `audit/log.ts#attributed` stamps onto the row above; `tailnetIdentity` is `null`
      // whenever there is none to attach (win32-desktop, or no request has bound one — see
      // `auth/operator.ts#BoundAttribution`).
      const attribution = currentAttribution();
      const tailnetIdentity = attribution && 'login' in attribution ? attributionLabel(attribution) : null;
      const resolvedBy = {
        actor: input.actorLabel, tailnetIdentity, at: new Date(now()).toISOString(), reason: reasonTrimmed,
      };

      try {
        await options.audit.append({
          action: 'control-human-response-authorize',
          owner: input.actor.subject,
          target: request.requestRef,
          riskTier: t3 ? 'T3' : 'T2',
          result: `authorized:${input.decision}`,
          detail: {
            requestRef: request.requestRef,
            runRef: request.runRef,
            runOwnerSubject,
            requestRevision: request.revision,
            decision: input.decision,
            reason: reasonTrimmed,
            actor: input.actorLabel,
            ...(t3 ? { responseDigest: humanResponseDigest(input), origin: input.origin } : {}),
          },
        });
      } catch {
        return { ok: false, status: 500, error: 'human-response-audit-required' };
      }

      const response = await options.store.respondHumanRequest(input.actor.subject, input.requestRef, {
        expectedRevision: input.expectedRevision,
        decision: input.decision,
        idempotencyKey: input.idempotencyKey,
        response: input.response ?? null,
        resolvedBy,
      });
      await reconcile(input.actor.subject, response.request);
      return { ok: true, status: 200, value: response.request, replayed: response.replayed };
    },
  };
}

// =====================================================================================================
// P5 W2 — the DEPLOY PURPOSE, added beside the shipped human-response T3 path [P5-C20, §3.3].
// The shipped verifier is EXTENDED IN PLACE, never rewritten: everything above this line is untouched.
// P5 binds a `deploy` purpose to `{deploymentRef, targetCommit, action}` (encoded through the closed
// `deployT3Preimage` of `deploy/contracts.ts`), reuses the same `ceremony-unavailable | ceremony-invalid
// | ceremony-expired` refusal codes, and MINTS NONE. The preimage is always recomputed server-side from
// the store record; a client-supplied challenge or digest is never accepted.
// =====================================================================================================

/** Server-side response digest for the deploy purpose: sha256 of the recomputed binding preimage. */
export function deployDigest(preimage: DeployT3Preimage): string {
  return sha256Hex(deployT3Preimage(preimage));
}

// =====================================================================================================
// F3 — the ITERATION-GATE T3 PURPOSE, added beside the deploy purpose [baseline-A §3, item 4b]. The
// preimage/digest below remain the canonical, order-stable encoding of exactly the tuple
// `resolveIterationGateRoute` CASes — still used for audit detail — even though the ceremony
// that used to verify a signature over it (T2) is gone.
// =====================================================================================================

/** The exact tuple an iteration-gate decision is signed over — the one `resolveIterationGateRoute` CASes. */
export interface IterationGateT3Preimage {
  requestRef: string;
  requestRevision: number;
  gateRef: string;
  gateKind: string | null;
  parkReason: string | null;
  iterationLoopRef: string;
  loopVersion: number;
  receiptRef: string | null;
  receiptVersion: number | null;
  /** ORDERED; the exact `loop.activeGenerationRefs` the gate was displayed against. */
  generationRefs: readonly string[];
  decision: string;
  origin: string;
  challengeExpiresAt: string;
}

/** Canonical encoding: fixed key order, so mint and verify recompute byte-identical preimages. */
export function iterationGateT3Preimage(preimage: IterationGateT3Preimage): string {
  return JSON.stringify({
    requestRef: preimage.requestRef,
    requestRevision: preimage.requestRevision,
    gateRef: preimage.gateRef,
    gateKind: preimage.gateKind,
    parkReason: preimage.parkReason,
    iterationLoopRef: preimage.iterationLoopRef,
    loopVersion: preimage.loopVersion,
    receiptRef: preimage.receiptRef,
    receiptVersion: preimage.receiptVersion,
    generationRefs: [...preimage.generationRefs],
    decision: preimage.decision,
    origin: preimage.origin,
    challengeExpiresAt: preimage.challengeExpiresAt,
  });
}

/** Server-side decision digest for the iteration-gate purpose: sha256 of the recomputed preimage. */
export function iterationGateDigest(preimage: IterationGateT3Preimage): string {
  return sha256Hex(iterationGateT3Preimage(preimage));
}
