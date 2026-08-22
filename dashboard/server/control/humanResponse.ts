import { createHash } from 'node:crypto';
import type { AuditEvent } from '../audit/log.ts';
import type { RespondHumanRequestInput } from './store.ts';
import type { HumanRequest, HumanRequestDecision } from './types.ts';

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
  return createHash('sha256').update(JSON.stringify({
    decision: input.decision,
    response: input.response ?? null,
  })).digest('hex');
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
