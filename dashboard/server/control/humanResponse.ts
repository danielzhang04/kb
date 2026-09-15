import { sha256Hex } from '../shared/hashing.ts';
import type { AuditEvent } from '../audit/log.ts';
import type { RespondHumanRequestInput } from './store.ts';
import type { HumanRequest, HumanRequestDecision } from './types.ts';
import { deployT3Preimage } from '../deploy/contracts.ts';
import type { DeployT3Preimage, T3RefusalCode } from '../deploy/contracts.ts';

type Awaitable<T> = T | Promise<T>;
type OperatorDecision = Exclude<HumanRequestDecision, 'auto-closed'>;

export interface HumanResponseActor {
  kind: 'operator' | 'host';
  subject: string;
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

export interface CeremonyVerificationInput {
  assertion: unknown;
  requestRef: string;
  requestRevision: number;
  responseDigest: string;
  action: OperatorDecision;
  origin: string;
  challengeExpiresAt: string;
}

export interface HumanResponseCeremonyPort {
  verify(input: CeremonyVerificationInput): Awaitable<boolean>;
}

export type HumanResponseResult =
  | { ok: true; status: 200; value: HumanRequest; replayed: boolean }
  | { ok: false; status: 403 | 404 | 409 | 500; error: string; gateKind?: string; resolveUrl?: string };

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

/** Purpose-bound preimage signed by WebAuthn. The wire challenge is base64url(UTF8(this string)). */
export function humanResponseChallenge(input: Omit<CeremonyVerificationInput, 'assertion'>): string {
  return `kb.human-response.v1.${Buffer.from(JSON.stringify({
    requestRef: input.requestRef,
    requestRevision: input.requestRevision,
    responseDigest: input.responseDigest,
    action: input.action,
    origin: input.origin,
    challengeExpiresAt: input.challengeExpiresAt,
  }), 'utf8').toString('base64url')}`;
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
  ceremony?: HumanResponseCeremonyPort;
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

      const t3 = T3_KINDS.has(request.kind);
      if (t3) {
        if (!options.ceremony) return { ok: false, status: 403, error: 'ceremony-unavailable' };
        if (input.ceremonyAssertion == null) return { ok: false, status: 403, error: 'ceremony-invalid' };
        const challengeExpiresAt = input.challengeExpiresAt ?? '';
        const expiresAt = Date.parse(challengeExpiresAt);
        if (!Number.isFinite(expiresAt)) return { ok: false, status: 403, error: 'ceremony-invalid' };
        if (expiresAt <= now()) return { ok: false, status: 403, error: 'ceremony-expired' };
        let verified: boolean;
        try {
          verified = await options.ceremony.verify({
            assertion: input.ceremonyAssertion,
            requestRef: request.requestRef,
            requestRevision: request.revision,
            responseDigest: humanResponseDigest(input),
            action: input.decision,
            origin: input.origin,
            challengeExpiresAt,
          });
        } catch {
          return { ok: false, status: 403, error: 'ceremony-invalid' };
        }
        if (!verified) return { ok: false, status: 403, error: 'ceremony-invalid' };
      }

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

/** Purpose-bound deploy challenge; the wire challenge is base64url(UTF8(the recomputed preimage)). */
export function deployChallenge(preimage: DeployT3Preimage): string {
  return `kb.deploy-t3.v1.${Buffer.from(deployT3Preimage(preimage), 'utf8').toString('base64url')}`;
}

export interface DeployCeremonyPort {
  verify(input: { assertion: unknown; challenge: string; origin: string }): Awaitable<boolean>;
}

export interface DeployCeremonyContext {
  /** Absent ceremony port ⇒ `ceremony-unavailable`, exactly as `humanResponse.ts:144`. */
  ceremony?: DeployCeremonyPort;
  /** Provisioned WebAuthn credentials; zero ⇒ `ceremony-unavailable` and never a downgrade [P5-C45]. */
  credentials: () => readonly unknown[];
  /** Single-use grant CAS: `replayed` on a second consumption of the same grant ⇒ `409` [§3.3]. */
  consume: (grantKey: string) => Awaitable<'fresh' | 'replayed'>;
  now?: () => number;
}

export interface DeployCeremonyRequest {
  /** The binding tuple, already recomputed server-side from the store record. */
  preimage: DeployT3Preimage;
  assertion: unknown;
  origin: string;
  challengeExpiresAt: string;
  /** Identifies the single-use grant for the replay CAS. */
  grantKey: string;
}

export type DeployCeremonyResult =
  | { ok: true; status: 200; digest: string }
  | { ok: false; status: 403; error: T3RefusalCode }
  | { ok: false; status: 409; error: 'ceremony-replayed' };

export interface DeployCeremonyService {
  verify(request: DeployCeremonyRequest): Promise<DeployCeremonyResult>;
}

/**
 * The deploy-purpose ceremony verifier. Refusal ladder is the SHIPPED one, unchanged and never extended
 * [P5-C20]: no ceremony port or zero credentials ⇒ `403 ceremony-unavailable`; missing/unparseable/
 * unverifiable/digest-or-revision-mismatched assertion ⇒ `403 ceremony-invalid`; expired challenge ⇒
 * `403 ceremony-expired`; a replayed single-use grant ⇒ `409`. Error results carry a fixed code and the
 * attestation digest only on success — never a key, signer, challenge, or credential byte [design:527].
 */
export function createDeployCeremonyService(context: DeployCeremonyContext): DeployCeremonyService {
  const now = context.now ?? Date.now;
  return {
    async verify(request) {
      if (!context.ceremony || context.credentials().length === 0) {
        return { ok: false, status: 403, error: 'ceremony-unavailable' };
      }
      if (request.assertion == null) return { ok: false, status: 403, error: 'ceremony-invalid' };
      const expiresAt = Date.parse(request.challengeExpiresAt);
      if (!Number.isFinite(expiresAt)) return { ok: false, status: 403, error: 'ceremony-invalid' };
      if (expiresAt <= now()) return { ok: false, status: 403, error: 'ceremony-expired' };
      // The challenge is recomputed server-side from the store-derived preimage; client input is never used.
      const challenge = deployChallenge(request.preimage);
      let verified: boolean;
      try {
        verified = await context.ceremony.verify({
          assertion: request.assertion,
          challenge,
          origin: request.origin,
        });
      } catch {
        return { ok: false, status: 403, error: 'ceremony-invalid' };
      }
      if (!verified) return { ok: false, status: 403, error: 'ceremony-invalid' };
      const state = await context.consume(request.grantKey);
      if (state === 'replayed') return { ok: false, status: 409, error: 'ceremony-replayed' };
      return { ok: true, status: 200, digest: deployDigest(request.preimage) };
    },
  };
}

// =====================================================================================================
// F3 — the ITERATION-GATE T3 PURPOSE, added beside the deploy purpose [baseline-A §3, item 4b].
// `resolveIterationGateRoute` shipped as a T3-AUDITED route with T2-strength authorization: exact CAS,
// owner scope and a `riskTier: 'T3'` row, but no WebAuthn call anywhere — and the generic route
// hard-reserves these gates to it (`:125-132`), so its own ceremony could never cover them. This binds a
// third purpose, `kb.iteration-gate-t3.v1.`, over PRECISELY the tuple that route already CASes, so the
// signature covers the same state the decision was displayed against. It reuses the shipped refusal
// ladder unchanged (`ceremony-unavailable | ceremony-invalid | ceremony-expired`, and `ceremony-replayed`
// only where a single-use grant is consumed outside this service) and MINTS NO NEW CODE. Like the deploy
// purpose, the preimage is always recomputed server-side from the store record; a client-supplied
// challenge or digest is never accepted, and there is no possession/tap downgrade.
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

/** Purpose-bound challenge; the wire challenge is base64url(UTF8(the recomputed preimage)). */
export function iterationGateChallenge(preimage: IterationGateT3Preimage): string {
  return `kb.iteration-gate-t3.v1.${Buffer.from(iterationGateT3Preimage(preimage), 'utf8').toString('base64url')}`;
}

export interface IterationGateCeremonyPort {
  /**
   * Verifies one assertion against the server-recomputed challenge. The single-use property of the
   * minted ceremony id lives HERE (the pending-challenge store is consumed exactly once), so a replayed
   * ceremony id surfaces as `false` — `ceremony-invalid`, exactly as the shipped human-response path.
   */
  verify(input: { assertion: unknown; challenge: string; origin: string }): Awaitable<boolean>;
}

export interface IterationGateCeremonyContext {
  /** Absent ceremony port ⇒ `ceremony-unavailable`, exactly as `humanResponse.ts:146`. */
  ceremony?: IterationGateCeremonyPort;
  /** Provisioned WebAuthn credentials; zero ⇒ `ceremony-unavailable` and never a downgrade. */
  credentials: () => readonly unknown[];
  now?: () => number;
}

export interface IterationGateCeremonyRequest {
  /** The binding tuple, already recomputed server-side from the store record. */
  preimage: IterationGateT3Preimage;
  assertion: unknown;
}

export type IterationGateCeremonyResult =
  | { ok: true; status: 200; digest: string }
  | { ok: false; status: 403; error: T3RefusalCode };

export interface IterationGateCeremonyService {
  verify(request: IterationGateCeremonyRequest): Promise<IterationGateCeremonyResult>;
}

/**
 * The iteration-gate-purpose ceremony verifier. Refusal ladder is the SHIPPED one, unchanged and never
 * extended: no ceremony port or zero credentials ⇒ `403 ceremony-unavailable`; missing/unparseable/
 * unverifiable/tuple-mismatched/replayed assertion ⇒ `403 ceremony-invalid`; expired challenge ⇒
 * `403 ceremony-expired`. Error results carry a fixed code and the decision digest only on success.
 */
export function createIterationGateCeremonyService(
  context: IterationGateCeremonyContext,
): IterationGateCeremonyService {
  const now = context.now ?? Date.now;
  return {
    async verify(request) {
      if (!context.ceremony || context.credentials().length === 0) {
        return { ok: false, status: 403, error: 'ceremony-unavailable' };
      }
      if (request.assertion == null) return { ok: false, status: 403, error: 'ceremony-invalid' };
      const expiresAt = Date.parse(request.preimage.challengeExpiresAt);
      if (!Number.isFinite(expiresAt)) return { ok: false, status: 403, error: 'ceremony-invalid' };
      if (expiresAt <= now()) return { ok: false, status: 403, error: 'ceremony-expired' };
      // Recomputed server-side from the store-derived preimage; client input is never used as challenge.
      const challenge = iterationGateChallenge(request.preimage);
      let verified: boolean;
      try {
        verified = await context.ceremony.verify({
          assertion: request.assertion,
          challenge,
          origin: request.preimage.origin,
        });
      } catch {
        return { ok: false, status: 403, error: 'ceremony-invalid' };
      }
      if (!verified) return { ok: false, status: 403, error: 'ceremony-invalid' };
      return { ok: true, status: 200, digest: iterationGateDigest(request.preimage) };
    },
  };
}
