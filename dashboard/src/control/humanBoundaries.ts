import {
  acceptsHumanRequest,
  type HumanRequestDecision,
  type HumanRequestDto,
  type RunDetailDto,
} from './controlClient';

export { acceptsHumanRequest } from './controlClient';

/** UI affordances mirror the server's release predicate; governance refusals are never overridable. */
export function decisionsForHumanRequest(kind: HumanRequestDto['kind']): HumanRequestDecision[] {
  if (kind === 'governance-refusal') return ['changes-requested'];
  if (kind === 'approval' || kind === 'review') return ['approved', 'rejected', 'changes-requested'];
  return ['responded', 'rejected', 'changes-requested'];
}

/**
 * A published run can be resumed in place only after every durable Human Request is accepted.
 * This never authorizes retry/successor creation; the server re-proves the same predicate and all
 * proposal/run CAS bindings on its existing governed `/activate` route.
 */
export function canResumePublishedRun(detail: RunDetailDto): boolean {
  return detail.run.publicationState === 'published'
    && detail.run.state === 'waiting-human'
    && detail.humanRequests.length > 0
    && detail.humanRequests.every(acceptsHumanRequest);
}

