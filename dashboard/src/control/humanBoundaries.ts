import type { HumanRequestDecision, HumanRequestDto } from './controlClient';

/** UI affordances mirror the server's release predicate; governance refusals are never overridable. */
export function decisionsForHumanRequest(kind: HumanRequestDto['kind']): HumanRequestDecision[] {
  if (kind === 'governance-refusal') return ['changes-requested'];
  if (kind === 'approval' || kind === 'review') return ['approved', 'rejected', 'changes-requested'];
  return ['responded', 'rejected', 'changes-requested'];
}

