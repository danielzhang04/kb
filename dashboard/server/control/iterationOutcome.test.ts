import { describe, expect, it } from 'vitest';
import {
  parseIterationOutcome,
  type IterationOutcomeContract,
} from './iterationOutcome.ts';
import type { ProposalIterationRole, ProposalIterationVerdict } from './proposal.ts';
import type { IterationPosition, IterationRequest } from './types.ts';

const iterationCriteria = [
  { id: 'safety', description: 'No unsafe changes.' },
  { id: 'evidence', description: 'Claims are supported.' },
];

function iterationContract(
  role: ProposalIterationRole,
  verdicts: ProposalIterationVerdict[],
  terminalVerdicts: ProposalIterationVerdict[] = [],
  options: {
    kind?: IterationRequest['kind'];
    currentPositions?: IterationPosition[];
    unresolvedFindingRefs?: string[];
  } = {},
): IterationOutcomeContract {
  const participantId = `${role}-participant`;
  return {
    iterationGroup: {
      iterationGroupId: `${role}-group`,
      participants: [
        { participantId: 'source', stageRef: 'source-stage', role: 'contributor', perspective: 'Source', mandate: 'Supply work.' },
        { participantId, stageRef: `${role}-stage`, role, perspective: 'Check', mandate: 'Apply the criteria.' },
      ],
      routes: [{
        routeId: `${role}-route`,
        senderParticipantId: 'source',
        recipientParticipantId: participantId,
        requestKinds: [options.kind ?? 'review'],
        baseResolutionStageIds: ['source-stage'],
      }],
      activation: { seedParticipantId: 'source', seedArtifactIds: ['artifact'] },
      initialStepId: `${role}-step`,
      schedule: [
        { stepId: `${role}-step`, routeId: `${role}-route`, cycle: 'current' },
        ...verdicts.filter((verdict) => !terminalVerdicts.includes(verdict) && verdict !== 'fulfilled' && verdict !== 'parked')
          .map((verdict, index) => ({
            stepId: `${role}-after-${index}`,
            routeId: `${role}-route`,
            after: { stepId: `${role}-step`, participantId, verdict },
            cycle: 'next' as const,
          })),
      ],
      artifacts: ['artifact'],
      criteria: iterationCriteria,
      maxCycles: 2,
      cycleUnit: 'one check',
      terminalAuthorities: terminalVerdicts.map((verdict) => ({
        participantId,
        verdict: verdict as 'accept' | 'pass' | 'consensus' | 'complete',
      })),
    },
    request: {
      schema: 'kb.iteration-request/v1',
      requestRef: `${role}-request`,
      iterationLoopRef: `${role}-loop`,
      routeId: `${role}-route`,
      senderParticipantId: 'source',
      recipientParticipantId: participantId,
      kind: options.kind ?? 'review',
      cycle: 1,
      inputGenerationRefs: ['generation-1'],
      baseCommit: 'a'.repeat(40),
      artifactHashes: { artifact: 'b'.repeat(64) },
      criteria: iterationCriteria,
      unresolvedFindingRefs: options.unresolvedFindingRefs ?? [],
      preservedInvariants: [],
      nextAcceptanceCheck: 'Apply the authored criteria.',
      instructions: 'Return one closed outcome.',
    },
    currentPositions: options.currentPositions ?? [],
  };
}

function iterationOutcome(
  contractValue: IterationOutcomeContract,
  verdict: ProposalIterationVerdict,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema: 'kb.iteration-outcome/v1',
    requestRef: contractValue.request.requestRef,
    iterationLoopRef: contractValue.request.iterationLoopRef,
    participantId: contractValue.request.recipientParticipantId,
    cycle: contractValue.request.cycle,
    verdict,
    inputGenerationRefs: contractValue.request.inputGenerationRefs,
    criteria: iterationCriteria.map((criterion) => ({ criterionId: criterion.id, verdict: 'pass', findingIds: [] })),
    findings: [],
    positions: [],
    recordedDissent: [],
    summary: 'The participant completed its declared iteration responsibility.',
    ...overrides,
  });
}

function negativeFields() {
  return {
    criteria: [
      { criterionId: 'safety', verdict: 'fail', findingIds: ['finding-1'] },
      { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
    ],
    findings: [{
      findingId: 'finding-1',
      criterionId: 'safety',
      severity: 'blocking',
      summary: 'The result still contains an unsafe change.',
      evidencePaths: ['dashboard/server/control/iterationOutcome.ts'],
    }],
  };
}

describe('parseIterationOutcome', () => {
  it('accepts a peer accept outcome bound to the exact request participant and generation', () => {
    const iteration = iterationContract('peer', ['accept'], ['accept']);
    expect(parseIterationOutcome(iterationOutcome(iteration, 'accept'), iteration)).toMatchObject({
      ok: true,
      value: {
        schema: 'kb.iteration-outcome/v1',
        requestRef: 'peer-request',
        participantId: 'peer-participant',
        inputGenerationRefs: ['generation-1'],
        verdict: 'accept',
      },
    });
  });

  it('accepts judge pass and fail mediator consensus and continue and coordinator complete', () => {
    const judge = iterationContract('judge', ['pass', 'fail'], ['pass']);
    expect(parseIterationOutcome(iterationOutcome(judge, 'pass'), judge)).toMatchObject({ ok: true, value: { verdict: 'pass' } });
    expect(parseIterationOutcome(iterationOutcome(judge, 'fail', negativeFields()), judge)).toMatchObject({ ok: true, value: { verdict: 'fail' } });

    const positions: IterationPosition[] = [
      { positionId: 'position-a', participantId: 'source', summary: 'Keep the safe implementation.', generationRefs: ['generation-1'] },
      { positionId: 'position-b', participantId: 'mediator-participant', summary: 'Retain the evidence.', generationRefs: ['generation-1'] },
    ];
    const mediator = iterationContract('mediator', ['consensus', 'continue'], ['consensus'], { currentPositions: positions });
    expect(parseIterationOutcome(iterationOutcome(mediator, 'consensus', {
      positions: [positions[0]],
      recordedDissent: [{
        dissentId: 'dissent-b', participantId: 'mediator-participant', positionId: 'position-b', summary: 'Preserved as dissent.',
      }],
    }), mediator)).toMatchObject({ ok: true, value: { verdict: 'consensus' } });
    expect(parseIterationOutcome(iterationOutcome(mediator, 'continue', negativeFields()), mediator))
      .toMatchObject({ ok: true, value: { verdict: 'continue' } });

    const coordinator = iterationContract('coordinator', ['complete'], ['complete']);
    expect(parseIterationOutcome(iterationOutcome(coordinator, 'complete'), coordinator))
      .toMatchObject({ ok: true, value: { verdict: 'complete' } });
  });

  it('accepts fulfilled as a nonterminal artifact-producing outcome without server lineage fields', () => {
    const iteration = iterationContract('contributor', ['fulfilled'], [], { kind: 'rework' });
    expect(parseIterationOutcome(iterationOutcome(iteration, 'fulfilled', { criteria: [] }), iteration)).toMatchObject({
      ok: true,
      value: { verdict: 'fulfilled', criteria: [] },
    });
  });

  it('requires fulfilled to carry no criteria verdicts', () => {
    const iteration = iterationContract('contributor', ['fulfilled'], [], { kind: 'delegate' });
    expect(parseIterationOutcome(iterationOutcome(iteration, 'fulfilled'), iteration)).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/fulfilled.*no criteria/i),
    });
  });

  it('requires judge mediator and coordinator terminal verdicts to carry every authored criterion exactly once', () => {
    for (const [role, verdict] of [['judge', 'pass'], ['mediator', 'consensus'], ['coordinator', 'complete']] as const) {
      const iteration = iterationContract(role, [verdict], [verdict]);
      const missing = [{ criterionId: 'safety', verdict: 'pass', findingIds: [] }];
      expect(parseIterationOutcome(iterationOutcome(iteration, verdict, { criteria: missing }), iteration)).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/every authored criterion/),
      });
    }
    for (const [role, verdict] of [['judge', 'fail'], ['mediator', 'continue']] as const) {
      const iteration = iterationContract(role, [verdict]);
      expect(parseIterationOutcome(iterationOutcome(iteration, verdict, {
        criteria: [{ criterionId: 'safety', verdict: 'fail', findingIds: ['finding-1'] }],
        findings: negativeFields().findings,
      }), iteration)).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/every authored criterion/),
      });
    }
    const judge = iterationContract('judge', ['pass'], ['pass']);
    expect(parseIterationOutcome(iterationOutcome(judge, 'pass', { criteria: [
      { criterionId: 'safety', verdict: 'pass', findingIds: [] },
      { criterionId: 'safety', verdict: 'pass', findingIds: [] },
    ] }), judge)).toMatchObject({ ok: false, detail: expect.stringMatching(/authored order|exactly once/) });
  });

  it('allows positions and dissent only for mediation verdicts', () => {
    const position: IterationPosition = {
      positionId: 'position-a', participantId: 'source', summary: 'Keep the safe implementation.', generationRefs: ['generation-1'],
    };
    const judge = iterationContract('judge', ['pass'], ['pass']);
    expect(parseIterationOutcome(iterationOutcome(judge, 'pass', { positions: [position] }), judge)).toMatchObject({
      ok: false, detail: expect.stringMatching(/no positions|recorded dissent/i),
    });

    const parked = iterationContract('judge', ['parked'], [], { currentPositions: [position] });
    expect(parseIterationOutcome(iterationOutcome(parked, 'parked', {
      criteria: [
        { criterionId: 'safety', verdict: 'unverified', findingIds: [] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      recordedDissent: [{ dissentId: 'dissent-a', participantId: 'source', positionId: 'position-a', summary: 'Parked dissent.' }],
    }), parked)).toMatchObject({ ok: false, detail: expect.stringMatching(/no positions|recorded dissent/i) });

    const fulfilled = iterationContract('contributor', ['fulfilled'], [], { kind: 'delegate', currentPositions: [position] });
    expect(parseIterationOutcome(iterationOutcome(fulfilled, 'fulfilled', {
      criteria: [],
      recordedDissent: [{ dissentId: 'dissent-a', participantId: 'source', positionId: 'position-a', summary: 'Fulfilled dissent.' }],
    }), fulfilled)).toMatchObject({ ok: false, detail: expect.stringMatching(/no positions|recorded dissent/i) });
  });

  it('pins the exact rejection detail for rework carrying one position (W70, Gate 4b run 3)', () => {
    // The worker prompt now states this rule (claudeWorkerAdapter.ts iterationContractLines), but the
    // server-side refusal is the actual gate: a codex checker returned "rework" with one position and
    // the run failed here, on a detail string nothing upstream had told it to expect.
    const position: IterationPosition = {
      positionId: 'position-a', participantId: 'source', summary: 'Keep the safe implementation.', generationRefs: ['generation-1'],
    };
    const peer = iterationContract('peer', ['rework']);
    expect(parseIterationOutcome(iterationOutcome(peer, 'rework', {
      ...negativeFields(),
      positions: [position],
    }), peer)).toMatchObject({
      ok: false,
      detail: 'invalid iteration outcome: rework must carry no positions or recorded dissent',
    });
  });

  it('binds mediated positions and dissent to the current server position set', () => {
    const current: IterationPosition = {
      positionId: 'position-a', participantId: 'source', summary: 'Server-known position.', generationRefs: ['generation-1'],
    };
    const mediator = iterationContract('mediator', ['consensus', 'continue'], ['consensus'], { currentPositions: [current] });
    const invented: IterationPosition = {
      positionId: 'position-x', participantId: 'source', summary: 'Invented position.', generationRefs: ['generation-1'],
    };
    expect(parseIterationOutcome(iterationOutcome(mediator, 'consensus', {
      positions: [current, invented],
    }), mediator)).toMatchObject({ ok: false, detail: expect.stringMatching(/position-x|server position set/) });
    expect(parseIterationOutcome(iterationOutcome(mediator, 'continue', {
      positions: [invented],
      findings: [{ findingId: 'gap', criterionId: 'safety', severity: 'advisory', summary: 'Evidence gap.', evidencePaths: [] }],
      criteria: [
        { criterionId: 'safety', verdict: 'pass', findingIds: ['gap'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      recordedDissent: [{ dissentId: 'dissent-x', participantId: 'source', positionId: 'position-x', summary: 'Invented dissent.' }],
    }), mediator)).toMatchObject({ ok: false, detail: expect.stringMatching(/position-x|unknown|server position set/) });
    expect(parseIterationOutcome(iterationOutcome(mediator, 'continue', {
      findings: [{ findingId: 'gap', criterionId: 'safety', severity: 'advisory', summary: 'Evidence gap.', evidencePaths: [] }],
      criteria: [
        { criterionId: 'safety', verdict: 'pass', findingIds: ['gap'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      recordedDissent: [{ dissentId: 'dissent-x', participantId: 'source', positionId: 'position-x', summary: 'Invented dissent.' }],
    }), mediator)).toMatchObject({ ok: false, detail: expect.stringMatching(/positionId is unknown/) });
  });

  it('accepts continue with passing criteria and an advisory disagreement but rejects zero findings', () => {
    const mediator = iterationContract('mediator', ['continue']);
    const disagreement = {
      criteria: [
        { criterionId: 'safety', verdict: 'pass', findingIds: ['disagreement'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{
        findingId: 'disagreement', criterionId: 'safety', severity: 'advisory' as const,
        summary: 'The peers disagree on the preferred safe implementation.', evidencePaths: [],
      }],
    };
    expect(parseIterationOutcome(iterationOutcome(mediator, 'continue', disagreement), mediator)).toMatchObject({
      ok: true, value: { verdict: 'continue' },
    });
    expect(parseIterationOutcome(iterationOutcome(mediator, 'continue'), mediator)).toMatchObject({
      ok: false, detail: expect.stringMatching(/continue requires at least one/i),
    });
  });

  it('requires complete to account for every open finding as resolved or accepted advisory residue', () => {
    const coordinator = iterationContract('coordinator', ['complete'], ['complete'], {
      unresolvedFindingRefs: ['open-a', 'open-b'],
    });
    expect(parseIterationOutcome(iterationOutcome(coordinator, 'complete'), coordinator)).toMatchObject({
      ok: false, detail: expect.stringMatching(/open-a|resolve or restate/i),
    });

    const blocking = {
      criteria: [
        { criterionId: 'safety', verdict: 'pass', findingIds: ['open-a'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{ findingId: 'open-a', criterionId: 'safety', severity: 'blocking', summary: 'Still open.', evidencePaths: [] }],
      resolvedFindingRefs: ['open-b'],
    };
    expect(parseIterationOutcome(iterationOutcome(coordinator, 'complete', blocking), coordinator)).toMatchObject({
      ok: false, detail: expect.stringMatching(/open-a|blocking/i),
    });

    const acceptedResidue = {
      criteria: [
        { criterionId: 'safety', verdict: 'pass', findingIds: ['open-b'] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ],
      findings: [{ findingId: 'open-b', criterionId: 'safety', severity: 'advisory', summary: 'Accepted residue.', evidencePaths: [] }],
      resolvedFindingRefs: ['open-a'],
    };
    expect(parseIterationOutcome(iterationOutcome(coordinator, 'complete', acceptedResidue), coordinator)).toMatchObject({
      ok: true, value: { verdict: 'complete', resolvedFindingRefs: ['open-a'] },
    });
    expect(parseIterationOutcome(iterationOutcome(coordinator, 'complete', {
      ...acceptedResidue, resolvedFindingRefs: ['invented'],
    }), coordinator)).toMatchObject({ ok: false, detail: expect.stringMatching(/request|unresolved/) });

    const judge = iterationContract('judge', ['pass'], ['pass'], { unresolvedFindingRefs: ['open-a'] });
    expect(parseIterationOutcome(iterationOutcome(judge, 'pass', { resolvedFindingRefs: ['open-a'] }), judge)).toMatchObject({
      ok: false, detail: expect.stringMatching(/only for complete and consensus/),
    });
  });

  it('rejects worker-supplied receipt refs output generations commits timestamps and hashes', () => {
    const iteration = iterationContract('peer', ['accept'], ['accept']);
    for (const [field, value] of [
      ['receiptRef', 'receipt-1'],
      ['outputGenerationRefs', ['generation-2']],
      ['baseCommit', 'a'.repeat(40)],
      ['canonicalCommit', 'b'.repeat(40)],
      ['createdAt', '2026-08-13T00:00:00.000Z'],
      ['outcomeHash', 'c'.repeat(64)],
    ] as const) {
      expect(parseIterationOutcome(iterationOutcome(iteration, 'accept', { [field]: value }), iteration)).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/top-level shape|server-owned/),
      });
    }
  });

  it('requires every mediated position to be incorporated or recorded as dissent before consensus', () => {
    const positions: IterationPosition[] = [
      { positionId: 'position-a', participantId: 'source', summary: 'Position A.', generationRefs: ['generation-1'] },
      { positionId: 'position-b', participantId: 'mediator-participant', summary: 'Position B.', generationRefs: ['generation-1'] },
    ];
    const iteration = iterationContract('mediator', ['consensus'], ['consensus'], { currentPositions: positions });
    expect(parseIterationOutcome(iterationOutcome(iteration, 'consensus', { positions: [positions[0]] }), iteration)).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/position-b|position.*dissent/i),
    });
  });

  it('rejects a verdict the participant is not authorized to issue', () => {
    const iteration = iterationContract('judge', [], []);
    expect(parseIterationOutcome(iterationOutcome(iteration, 'pass'), iteration)).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/not authorized/),
    });
  });

  it('rejects duplicate keys unknown criteria stale generations and oversized evidence for every role', () => {
    for (const [role, verdict] of [
      ['peer', 'accept'],
      ['judge', 'pass'],
      ['mediator', 'consensus'],
      ['coordinator', 'complete'],
    ] as const) {
      const iteration = iterationContract(role, [verdict], [verdict]);
      const valid = iterationOutcome(iteration, verdict);
      expect(parseIterationOutcome(valid.replace(`"verdict":"${verdict}"`, `"verdict":"${verdict}","verdict":"${verdict}"`), iteration))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate JSON object key 'verdict'/) });
      expect(parseIterationOutcome(iterationOutcome(iteration, verdict, { criteria: [
        { criterionId: 'unknown', verdict: 'pass', findingIds: [] },
        { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
      ] }), iteration)).toMatchObject({ ok: false, detail: expect.stringMatching(/authored order|unknown/) });
      expect(parseIterationOutcome(iterationOutcome(iteration, verdict, { inputGenerationRefs: ['generation-stale'] }), iteration))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/generation/i) });
      expect(parseIterationOutcome(iterationOutcome(iteration, verdict, {
        criteria: [
          { criterionId: 'safety', verdict: 'pass', findingIds: ['evidence-1'] },
          { criterionId: 'evidence', verdict: 'pass', findingIds: [] },
        ],
        findings: [{
          findingId: 'evidence-1', criterionId: 'safety', severity: 'advisory', summary: 'Supporting evidence.',
          evidencePaths: Array.from({ length: 17 }, (_, index) => `evidence/${index}.txt`),
        }],
      }), iteration)).toMatchObject({ ok: false, detail: expect.stringMatching(/evidencePaths|evidence/) });
    }
  });

  it('parses one kb iteration outcome schema without a review outcome fallback', () => {
    const iteration = iterationContract('judge', ['pass'], ['pass']);
    expect(parseIterationOutcome(JSON.stringify({
      schema: 'kb.review-outcome/v1', decision: 'pass', summary: 'Legacy shape.', criteria: [], findings: [],
    }), iteration)).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/top-level shape|kb\.iteration-outcome\/v1/),
    });
    expect(parseIterationOutcome(iterationOutcome(iteration, 'pass'), iteration)).toMatchObject({
      ok: true,
      value: { schema: 'kb.iteration-outcome/v1' },
    });
  });
});
