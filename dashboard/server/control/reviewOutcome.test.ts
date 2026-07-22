import { describe, expect, it } from 'vitest';
import { parseReviewOutcome, type ReviewContract } from './reviewOutcome.ts';

const contract: ReviewContract = {
  review: {
    subjectStageId: 'create',
    maxCreatorReworks: 1,
    criteria: [
      { id: 'safety', description: 'No unsafe changes.' },
      { id: 'evidence', description: 'Claims are supported.' },
    ],
  },
};

function outcome(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'kb.review-outcome/v1',
    decision: 'pass',
    summary: 'The checked result satisfies the immutable criteria.',
    criteria: [
      { criterionId: 'safety', verdict: 'pass', findingIds: [] },
      { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
    ],
    findings: [],
    ...overrides,
  });
}

describe('parseReviewOutcome', () => {
  it('accepts the closed, authored-order pass shape', () => {
    expect(parseReviewOutcome(outcome(), contract)).toMatchObject({
      ok: true,
      value: { decision: 'pass', criteria: [{ criterionId: 'safety' }, { criterionId: 'evidence' }] },
    });
  });

  it('rejects malformed JSON, replacement characters, and unknown or missing fields', () => {
    expect(parseReviewOutcome('not json', contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/not JSON/) });
    expect(parseReviewOutcome(outcome({ summary: 'bad\uFFFDdecode' }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/UTF-8/) });
    expect(parseReviewOutcome(outcome({ extra: true }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/top-level shape/) });
    const missing = JSON.parse(outcome()) as Record<string, unknown>;
    delete missing.findings;
    expect(parseReviewOutcome(JSON.stringify(missing), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/top-level shape/) });
  });

  it('rejects recognized secret shapes before they can enter durable review receipts', () => {
    expect(parseReviewOutcome(outcome({ summary: 'Leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456' }), contract))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/summary is unsafe/) });
    expect(parseReviewOutcome(outcome({
      decision: 'fail',
      criteria: [
        { criterionId: 'safety', verdict: 'fail', findingIds: ['leak'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{
        id: 'leak', criterionId: 'safety', severity: 'blocking',
        summary: 'Token ghp_abcdefghijklmnopqrstuvwxyz1234567890AB was exposed.', evidencePaths: [],
      }],
    }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/summary is unsafe/) });
  });

  it('rejects duplicate decoded JSON object keys at top-level, criterion, and finding nesting', () => {
    const topLevel = outcome().replace('"decision":"pass"', '"decision":"pass","decision":"pass"');
    expect(parseReviewOutcome(topLevel, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate JSON object key 'decision'/) });
    const criterion = outcome().replace('"verdict":"pass"', '"verdict":"pass","verdict":"pass"');
    expect(parseReviewOutcome(criterion, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate JSON object key 'verdict'/) });
    const failed = outcome({
      decision: 'fail',
      criteria: [
        { criterionId: 'safety', verdict: 'fail', findingIds: ['unsafe-change'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{ id: 'unsafe-change', criterionId: 'safety', severity: 'blocking', summary: 'Writes exceeded scope.', evidencePaths: [] }],
    });
    const finding = failed.replace('"severity":"blocking"', '"severity":"blocking","severity":"blocking"');
    expect(parseReviewOutcome(finding, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate JSON object key 'severity'/) });
  });

  it('treats escaped-equivalent object keys as duplicates before JSON.parse can collapse them', () => {
    const escaped = outcome().replace('"decision":"pass"', '"decision":"pass","dec\\u0069sion":"pass"');
    expect(parseReviewOutcome(escaped, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate JSON object key 'decision'/) });
  });

  it('requires each immutable criterion exactly once in authored order', () => {
    expect(parseReviewOutcome(outcome({ criteria: [
      { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      { criterionId: 'safety', verdict: 'pass', findingIds: [] },
    ] }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/authored order/) });
    expect(parseReviewOutcome(outcome({ criteria: [{ criterionId: 'safety', verdict: 'pass', findingIds: [] }] }), contract))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/every authored criterion/) });
  });

  it('requires exact bidirectional finding linkage and safe evidence paths', () => {
    const failed = outcome({
      decision: 'fail',
      criteria: [
        { criterionId: 'safety', verdict: 'fail', findingIds: ['unsafe-change'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{ id: 'unsafe-change', criterionId: 'safety', severity: 'blocking', summary: 'Writes exceeded scope.', evidencePaths: ['dashboard/server/file.ts'] }],
    });
    expect(parseReviewOutcome(failed, contract)).toMatchObject({ ok: true, value: { decision: 'fail' } });
    expect(parseReviewOutcome(failed.replace('dashboard/server/file.ts', '../outside'), contract))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/evidencePaths/) });
    const unlinked = failed.replace('"findingIds":["unsafe-change"]', '"findingIds":[]');
    expect(parseReviewOutcome(unlinked, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/linked/) });
  });

  it('rejects recognized secrets embedded in otherwise safe evidence paths', () => {
    const failed = outcome({
      decision: 'fail',
      criteria: [
        { criterionId: 'safety', verdict: 'fail', findingIds: ['secret-path'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{
        id: 'secret-path', criterionId: 'safety', severity: 'blocking', summary: 'Unsafe evidence path.',
        evidencePaths: ['artifacts/ghp_abcdefghijklmnopqrstuvwxyz1234567890AB.txt'],
      }],
    });
    expect(parseReviewOutcome(failed, contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/evidencePaths/) });
    expect(parseReviewOutcome(failed.replace('ghp_abcdefghijklmnopqrstuvwxyz1234567890AB', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456'), contract))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/evidencePaths/) });
  });

  it('enforces pass, fail, and parked truth rules', () => {
    expect(parseReviewOutcome(outcome({ decision: 'pass', criteria: [
      { criterionId: 'safety', verdict: 'unverified', findingIds: [] },
      { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
    ] }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/pass requires/) });
    expect(parseReviewOutcome(outcome({ decision: 'fail', criteria: [
      { criterionId: 'safety', verdict: 'pass', findingIds: [] },
      { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
    ] }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/fail requires/) });
    expect(parseReviewOutcome(outcome({ decision: 'parked' }), contract)).toMatchObject({ ok: false, detail: expect.stringMatching(/parked requires/) });
  });
});
