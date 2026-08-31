// P6 W2 [design:435] — the pure run-read service extracted from the control run-read handlers
// (`control/routes.ts` `GET /api/control/runs`, `/:runRef`, `/:runRef/events`) plus the human-response
// respond handler (`/api/control/human-requests/:requestRef/respond`, the §2 `control/routes.ts` gate).
// Each function reproduces today's success + refusal matrix over injected ports: the `401 unauthenticated`
// gate, the `includeArchived` default projection, the `ControlResult` not-ok mapping, the numeric event
// cursor wall, the events ETag/304, and the respond body wall. W6.2 makes the routes thin; W2 only BUILDS
// the service + its characterization test. No route file edited.

import { OPERATOR_SUBJECT } from '../auth/mode.ts';
import type { ServiceReply } from './scheduleService.ts';

/** The ONE place cross-subject reach is decided (`control/routes.ts#readScopeForSubject`), reproduced so
 *  the service does not import the whole route module: only a verified operator reads all subjects. */
function readScopeForSubject(sub: string | null | undefined): ReadScope {
  return sub === OPERATOR_SUBJECT ? 'all-subjects' : 'own-subject';
}

/** A `ControlResult`-shaped read: ok carries a value; not-ok carries a reason/detail and a mapped status. */
export type ControlReadResult<T> =
  | { readonly ok: true; readonly value: T; readonly replayed?: boolean }
  | { readonly ok: false; readonly reason: string; readonly detail?: unknown };

export type ReadScope = 'own-subject' | 'all-subjects';

/** The event-replay page the events handler returns; any shape carrying the `revision` the ETag uses. */
export interface EventPage { readonly revision: string; readonly [key: string]: unknown }

export interface RunReadPort {
  listRuns(subject: string, scope: ReadScope): readonly unknown[];
  getRun(subject: string, runRef: string, scope: ReadScope): ControlReadResult<{ readonly [key: string]: unknown }>;
  /** `statusOf(result)` — the shipped not-ok → HTTP status mapping. */
  statusOf(result: { readonly ok: false; readonly reason: string }): number;
  /** The lifecycle kind of a run row, used for the `includeArchived` default filter. */
  lifecycleKind(run: unknown): string;
  workflowRefIndex(subject: string, scope: ReadScope): Map<string, string>;
  runDto(run: unknown): { runRef: string; title: string; proposalRef: string } & Record<string, unknown>;
  runDisplay(dto: unknown, workflows: Map<string, string>): unknown;
  runDetailDto(subject: string, detail: unknown, scope: ReadScope): unknown;
  executionPosture(): unknown;
  /** `projectRunEvents.replay(...)` — the event page projection. */
  replayEvents(input: { subject: string; runRef: string; scope: ReadScope; afterCursor: number; limit: number; stageRef: string | null }): Promise<EventPage>;
}

function safeQueryInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** GET /api/control/runs — the archived-by-default projection. */
export function listRuns(port: RunReadPort, subject: string | null, query: { includeArchived?: unknown }): ServiceReply {
  if (!subject) return { status: 401, body: { error: 'unauthenticated' } };
  const scope = readScopeForSubject(subject);
  const workflows = port.workflowRefIndex(subject, scope);
  const includeArchived = query.includeArchived === '1';
  const runs = port.listRuns(subject, scope)
    .filter((run) => includeArchived || port.lifecycleKind(run) !== 'archived');
  return { status: 200, body: { runs: runs.map((run) => port.runDisplay(port.runDto(run), workflows)) } };
}

/** GET /api/control/runs/:runRef — detail + execution posture, or the mapped not-ok result. */
export function getRunDetail(port: RunReadPort, subject: string | null, runRef: string): ServiceReply {
  if (!subject) return { status: 401, body: { error: 'unauthenticated' } };
  const scope = readScopeForSubject(subject);
  const detail = port.getRun(subject, runRef, scope);
  if (!detail.ok) return { status: port.statusOf(detail), body: { error: detail.reason, detail: detail.detail } };
  return {
    status: 200,
    body: { ok: true, value: port.runDetailDto(subject, detail.value, scope), replayed: detail.replayed ?? false, execution: port.executionPosture() },
  };
}

/** GET /api/control/runs/:runRef/events — authorize, then the numeric cursor wall, then the ETag/304 page. */
export async function replayRunEvents(
  port: RunReadPort,
  subject: string | null,
  runRef: string,
  query: { after?: unknown; limit?: unknown; stageRef?: unknown },
  ifNoneMatch: string | undefined,
): Promise<ServiceReply> {
  if (!subject) return { status: 401, body: { error: 'unauthenticated' } };
  const scope = readScopeForSubject(subject);
  const run = port.getRun(subject, runRef, scope);
  if (!run.ok) return { status: 404 };
  const after = safeQueryInteger(query.after, 0);
  const limit = safeQueryInteger(query.limit, 200);
  if (after === null || limit === null || limit < 1 || limit > 250) {
    return { status: 400, body: { error: 'invalid-event-cursor' } };
  }
  const page = await port.replayEvents({
    subject, runRef, scope, afterCursor: after, limit,
    stageRef: typeof query.stageRef === 'string' && query.stageRef.length > 0 ? query.stageRef : null,
  });
  const etag = `"${page.revision}"`;
  if (ifNoneMatch === etag) return { status: 304, etag };
  return { status: 200, etag, body: page };
}

// --- Human-response respond (`control/routes.ts` gate, §2) --------------------------------------------

export interface RespondResult {
  readonly ok: boolean;
  readonly status: number;
  readonly error?: string;
  readonly value?: unknown;
  readonly replayed?: boolean;
  readonly gateKind?: string;
  readonly resolveUrl?: string;
}

export interface RespondPort {
  respond(input: {
    actor: { kind: 'operator'; subject: string };
    requestRef: string;
    expectedRevision: number;
    decision: string;
    idempotencyKey: string;
    response: string | null;
    origin: string;
    ceremonyAssertion: { ceremonyId: string; response: unknown } | undefined;
    challengeExpiresAt: string | undefined;
  }): Promise<RespondResult>;
}

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }
function intOf(value: unknown): number { return typeof value === 'number' && Number.isInteger(value) ? value : 0; }

const RESPOND_DECISIONS = ['responded', 'approved', 'rejected', 'changes-requested'];

/** POST /api/control/human-requests/:requestRef/respond — the closed body wall then the gate service. */
export async function respondHumanRequestRoute(
  port: RespondPort,
  subject: string | null,
  requestRef: string,
  body: unknown,
  origin: unknown,
): Promise<ServiceReply> {
  if (!subject) return { status: 401, body: { error: 'unauthenticated' } };
  const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const decision = str(input.decision);
  if (!RESPOND_DECISIONS.includes(decision) || intOf(input.expectedRevision) < 1 || !str(input.idempotencyKey)) {
    return { status: 400, body: { error: 'invalid-human-response' } };
  }
  const result = await port.respond({
    actor: { kind: 'operator', subject },
    requestRef,
    expectedRevision: intOf(input.expectedRevision),
    decision,
    idempotencyKey: str(input.idempotencyKey),
    response: input.response == null ? null : str(input.response),
    origin: str(origin),
    ceremonyAssertion: input.ceremonyId == null || input.assertion == null ? undefined : { ceremonyId: str(input.ceremonyId), response: input.assertion },
    challengeExpiresAt: input.challengeExpiresAt == null ? undefined : str(input.challengeExpiresAt),
  });
  if (!result.ok) {
    return {
      status: result.status,
      body: {
        error: result.status === 404 ? 'not-found' : result.error,
        ...(result.gateKind ? { gateKind: result.gateKind } : {}),
        ...(result.resolveUrl ? { resolveUrl: result.resolveUrl } : {}),
      },
    };
  }
  return { status: 200, body: { ok: true, value: result.value, replayed: result.replayed } };
}
