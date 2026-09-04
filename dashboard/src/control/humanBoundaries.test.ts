import { describe, expect, it } from 'vitest';
import type { HumanRequestDto, RunDetailDto } from './controlClient';
import { acceptsHumanRequest, canResumePublishedRun } from './humanBoundaries';

function request(
  kind: HumanRequestDto['kind'],
  decision: NonNullable<HumanRequestDto['response']>['decision'],
  state: HumanRequestDto['state'] = 'resolved',
): HumanRequestDto {
  return {
    requestRef: `request-${kind}`,
    runRef: 'run-1',
    // A request's display fields describe its OWNING RUN — see HumanRequestDto.
    displayName: 'Owning run',
    shortRef: 1,
    stageRef: null,
    kind,
    revision: 1,
    state,
    title: 'Human boundary',
    prompt: 'May this run continue?',
    // Server-built plain language; the machine's own words above are the technical detail.
    ask: 'Owning run needs your sign-off before it can go any further.',
    technicalDetail: 'Human boundary\n\nMay this run continue?',
    response: state === 'resolved'
      ? {
          requestRevision: 1,
          decision,
          respondedBy: 'operator',
          idempotencyKey: `human-response:request-1:1:${decision}`,
          response: null,
          respondedAt: '2026-07-24T03:58:56.782Z',
        }
      : null,
    createdAt: '2026-07-24T03:00:00.000Z',
    updatedAt: '2026-07-24T03:58:56.782Z',
  };
}

function detailWith(humanRequests: HumanRequestDto[], overrides: Record<string, unknown> = {}): RunDetailDto {
  return {
    run: {
      publicationState: 'published',
      state: 'waiting-human',
      ...overrides,
    },
    humanRequests,
  } as unknown as RunDetailDto;
}

describe('accepted Human Request boundaries', () => {
  it('mirrors the server decision semantics', () => {
    expect(acceptsHumanRequest(request('intervention', 'responded'))).toBe(true);
    expect(acceptsHumanRequest(request('input', 'approved'))).toBe(true);
    expect(acceptsHumanRequest(request('approval', 'responded'))).toBe(false);
    expect(acceptsHumanRequest(request('review', 'approved'))).toBe(true);
    expect(acceptsHumanRequest(request('review', 'changes-requested'))).toBe(false);
    expect(acceptsHumanRequest(request('intervention', 'rejected'))).toBe(false);
    expect(acceptsHumanRequest(request('governance-refusal', 'approved'))).toBe(false);
    expect(acceptsHumanRequest(request('intervention', 'responded', 'open'))).toBe(false);
  });

  it('offers in-place resume only for a published waiting run with at least one accepted request', () => {
    const accepted = request('intervention', 'responded');
    expect(canResumePublishedRun(detailWith([accepted]))).toBe(true);
    expect(canResumePublishedRun(detailWith([]))).toBe(false);
    expect(canResumePublishedRun(detailWith([request('approval', 'responded')]))).toBe(false);
    expect(canResumePublishedRun(detailWith([accepted], { state: 'running' }))).toBe(false);
    expect(canResumePublishedRun(detailWith([accepted], { state: 'succeeded' }))).toBe(false);
    expect(canResumePublishedRun(detailWith([accepted], { publicationState: 'waiting-human' }))).toBe(false);
  });
});
