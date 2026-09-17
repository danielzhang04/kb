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

export interface HumanResponseInput {
  actor: HumanResponseActor;
  requestRef: string;
  expectedRevision: number;
  decision: OperatorDecision;
  idempotencyKey: string;
  response?: string | null;
  origin: string;
  /** Free text explaining the decision. Required (non-empty after trim, <=2000 chars) from EVERY actor,
   *  including `daniel` and a request that sends no `X-KB-Actor` header at all. */
  reason: string;
  /** The `X-KB-Actor` claim for this request — self-asserted, never an authority input. */
  actorLabel: Actor;
  /** T5 [design:4.4/4.5]: the `{payload, signature}` signed-approval body, required only when this
   *  request's run is `publish`/`spend`-tagged. Unvalidated here — `options.verifyApproval` (T3's
   *  `authority/approval.ts#verifyApproval`, bound to this route + entityRef) is the sole judge. */
  approval?: unknown;
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
  | { ok: false; status: 400 | 403 | 404 | 409 | 500 | 503; error: string; gateKind?: string; resolveUrl?: string };

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
  /** T5 [design:4.4/4.5]: the governing tag set for the run this request belongs to. REQUIRED — unlike
   *  `verifyApproval`, this is never defaulted to "no tags": a caller that forgets to wire it would
   *  silently exempt every publish/spend run from the signed channel, which is exactly the "fail open"
   *  this design exists to rule out. */
  workflowTags: (actorSubject: string, runRef: string) => Awaitable<ReadonlySet<string>>;
  /** T3's `authority/approval.ts#verifyApproval`, already bound to this route + entityRef by the caller.
   *  Absent ⇒ any run whose tags actually require signing is refused `503 approval-unavailable`. */
  verifyApproval?: (approval: unknown) => Awaitable<{ ok: true } | { ok: false; status: 403 | 409 | 503; error: string }>;
  /** The route + entity this escalation is bound to, for the refusal audit row. Same pair the caller
   *  already bound `verifyApproval` to; absent only in unit tests that assert the refusal STATUS. */
  escalationBinding?: { route: string; entityRef: string };
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
      // rule.
      //
      // REQUIRED FROM EVERY ACTOR, unconditionally (security review 2026-09-16, HIGH-1). The predecessor
      // asked only `boss`/`worker:<id>` for one, which made the rule opt-in by the party it constrains:
      // omit the header, misspell it, or send it twice and `parseActor` returns `unknown`, the reason
      // wall disappears, and any gate resolves with no justification recorded at all. A self-asserted
      // header must never change what a request is allowed to do (spec 4.3/5) — not what it is allowed
      // to omit either. If a browser exemption is ever wanted it must key on something unforgeable
      // (session subject, auth mode), never on a request header.
      const reasonInput = input.reason;
      if (typeof reasonInput !== 'string'
        || reasonInput.length > MAX_REASON_LENGTH || reasonInput.trim().length === 0) {
        return { ok: false, status: 400, error: 'reason-required' };
      }
      const reasonTrimmed = reasonInput.trim().slice(0, MAX_REASON_LENGTH);
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

      // T3_KINDS/`t3` is RETAINED [design:4.5] — the audit row below still records that this was a
      // T3-class decision. What changed is which channel proves it: not a per-request assertion-based ceremony
      // keyed off `request.kind`, but the boss-intervention rule keyed off the RUN's workflow tags. A
      // T3-kind decision on an untagged run now proceeds on the open class, exactly like an ordinary one.
      const t3 = T3_KINDS.has(request.kind);

      // T4 [design:4.3] — WHO resolved this, over what channel, and why. `attribution` reflects the SAME
      // bound identity `audit/log.ts#attributed` stamps onto the row below; `tailnetIdentity` is `null`
      // whenever there is none to attach (win32-desktop, or no request has bound one — see
      // `auth/operator.ts#BoundAttribution`).
      const attribution = currentAttribution();
      const tailnetIdentity = attribution && 'login' in attribution ? attributionLabel(attribution) : null;

      const tags = await options.workflowTags(input.actor.subject, request.runRef);
      const signedRequired = tags.has('publish') || tags.has('spend');
      if (signedRequired) {
        const refuse = async (
          status: 403 | 409 | 503, error: string,
        ): Promise<HumanResponseResult> => {
          // EVERY refusal appends one audit row (spec §4.2) — the property `authority/gate.ts#refuse`
          // already held for a `signed`-CLASS route, and that this per-request ESCALATION did not: a
          // tagged run's gate resolution refused for want of a signature left NO trace at all, so the
          // one channel the design exists to protect was the one channel with no refusal trail.
          // Best-effort by the same rule the gate uses: an audit failure must never convert a refusal
          // into an admission.
          try {
            await options.audit.append({
              action: 'authority-approval-refused',
              owner: input.actor.subject,
              target: request.requestRef,
              riskTier: 'T3',
              result: error,
              actor: input.actorLabel,
              detail: {
                route: options.escalationBinding?.route ?? null,
                entityRef: options.escalationBinding?.entityRef ?? request.requestRef,
                runRef: request.runRef,
                tailnetIdentity,
                workflowTags: [...tags],
                reason: 'signed-approval-required',
              },
            });
          } catch { /* the refusal must land even when the row could not be written */ }
          return { ok: false, status, error };
        };
        if (!options.verifyApproval) return await refuse(503, 'approval-unavailable');
        if (input.approval == null) return await refuse(403, 'approval-required');
        const checked = await options.verifyApproval(input.approval);
        if (!checked.ok) return await refuse(checked.status, checked.error);
      }

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
            signedRequired,
            workflowTags: [...tags],
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
// =====================================================================================================
// T5 [design:4.5] — `createIterationGateCeremonyService`'s SUCCESSOR. The iteration-gate resolve route
// (`control/routes.ts#resolveIterationGateRoute`) keeps its existing CAS and refusal ladder byte for
// byte; only the verification step changes — from a browser-signature ceremony assertion over the gate's preimage
// to the SAME boss-intervention rule `createHumanResponseService#respond` enforces: an untagged run
// proceeds; a run whose `effectiveWorkflowTags` include `publish` or `spend` requires a valid signed
// approval for this route + `requestRef`.
// =====================================================================================================

export interface IterationGateAuthorityContext {
  /** The governing tag set for the run this gate belongs to. REQUIRED — see the same note on
   *  `createHumanResponseService`'s `workflowTags`. */
  workflowTags: (actorSubject: string, runRef: string) => Awaitable<ReadonlySet<string>>;
  /** T3's `authority/approval.ts#verifyApproval`, already bound to this route + entityRef by the caller. */
  verifyApproval?: (approval: unknown) => Awaitable<{ ok: true } | { ok: false; status: 403 | 409 | 503; error: string }>;
  /** Appends the escalation's refusal row. Same port and same rule as `createHumanResponseService`:
   *  every refusal on the signed channel leaves exactly one row. */
  audit?: HumanResponseAuditPort;
  /** The route + entity this escalation is bound to, for that row. */
  escalationBinding?: { route: string; entityRef: string };
}

export interface IterationGateAuthorityRequest {
  actorSubject: string;
  runRef: string;
  /** The request body's `approval` key, unvalidated — mirrors `HumanResponseInput.approval`. */
  approval: unknown;
  /** The `X-KB-Actor` claim, recorded on the refusal row. Self-asserted, never an authority input. */
  actorLabel?: Actor;
}

export type IterationGateAuthorityResult =
  | { ok: true; status: 200 }
  | { ok: false; status: 403 | 409 | 503; error: string };

export interface IterationGateAuthorityService {
  verify(request: IterationGateAuthorityRequest): Promise<IterationGateAuthorityResult>;
}

export function createIterationGateAuthorityService(
  context: IterationGateAuthorityContext,
): IterationGateAuthorityService {
  return {
    async verify(request) {
      const tags = await context.workflowTags(request.actorSubject, request.runRef);
      if (!(tags.has('publish') || tags.has('spend'))) return { ok: true, status: 200 };
      // Same refusal-row rule as `createHumanResponseService`: a tagged run's gate resolution refused
      // for want of a signature used to leave no trace at all, while every `signed`-CLASS route's
      // refusal wrote one. Best-effort — an audit failure never converts a refusal into an admission.
      const refuse = async (status: 403 | 409 | 503, error: string): Promise<IterationGateAuthorityResult> => {
        try {
          await context.audit?.append({
            action: 'authority-approval-refused',
            owner: request.actorSubject,
            target: context.escalationBinding?.entityRef ?? request.runRef,
            riskTier: 'T3',
            result: error,
            actor: request.actorLabel ?? 'unknown',
            detail: {
              route: context.escalationBinding?.route ?? null,
              entityRef: context.escalationBinding?.entityRef ?? null,
              runRef: request.runRef,
              workflowTags: [...tags],
              reason: 'signed-approval-required',
            },
          });
        } catch { /* the refusal must land even when the row could not be written */ }
        return { ok: false, status, error };
      };
      if (!context.verifyApproval) return await refuse(503, 'approval-unavailable');
      if (request.approval == null) return await refuse(403, 'approval-required');
      const checked = await context.verifyApproval(request.approval);
      if (!checked.ok) return await refuse(checked.status, checked.error);
      return { ok: true, status: 200 };
    },
  };
}
