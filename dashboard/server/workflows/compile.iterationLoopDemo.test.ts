import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateServerCompiledPlanProposal } from '../control/proposal.ts';
import { loadWorkflowCompileEnvironment, loadWorkflowProfiles } from '../control/environment.ts';
import { compileWorkflowDef } from './compile.ts';
import { instantiateWorkflowDef, parseWorkflowDef } from './defs.ts';
import { loadOrgDef } from './orgDefSource.ts';

const DEF_PATH = 'orgs/faceless-youtube/workflows/iteration-loop-demo.md';
const SOURCE = loadOrgDef(DEF_PATH);
const REPO_ROOT = SOURCE.origin.slice(0, SOURCE.origin.length - DEF_PATH.split('/').join(sep).length);
const ENVIRONMENT = loadWorkflowCompileEnvironment(REPO_ROOT);
const PROOF_SLUG = 'p1-iteration-proof-static';

function compileFixture() {
  const parsed = parseWorkflowDef(SOURCE.text, {
    knownProfiles: new Set(ENVIRONMENT.registry.workflowProfiles ?? []),
  });
  if (!parsed.ok) throw new Error(parsed.detail);
  const instantiated = instantiateWorkflowDef(parsed.value, { slug: PROOF_SLUG });
  if (!instantiated.ok) throw new Error(instantiated.detail);
  const compiled = compileWorkflowDef(instantiated.value, ENVIRONMENT);
  if (!compiled.ok) throw new Error(`${compiled.reason}: ${compiled.detail}`);
  const validated = validateServerCompiledPlanProposal(compiled.value, ENVIRONMENT.registry);
  if (!validated.ok) throw new Error(validated.detail);
  return { def: instantiated.value, plan: validated.value };
}

const FIXTURE = compileFixture();
const groups = new Map((FIXTURE.plan.iterationGroups ?? []).map((group) => [group.iterationGroupId, group]));
const stages = new Map(FIXTURE.plan.stages.map((stage) => [stage.id, stage]));

describe('iteration-loop-demo workflow definition (compiled proof)', () => {
  it('compiles the demo into pairwise judge exhaustion and no-progress groups with explicit cycle units and bounds', () => {
    expect(FIXTURE.def.executionMode).toBe('validation-slice');
    expect(FIXTURE.def.maxConcurrency).toBeGreaterThanOrEqual(2);
    expect(FIXTURE.plan.maxConcurrency).toBe(FIXTURE.def.maxConcurrency);
    expect(FIXTURE.def.launchParameters).toEqual({ slug: PROOF_SLUG });
    expect(FIXTURE.plan.manager.assignment).toMatchObject({
      agentId: 'fyt-runner',
      profileId: 'manager:codex:gpt-5.6-sol',
      runtime: 'codex',
      model: 'gpt-5.6-sol',
    });
    expect([...groups]).toEqual([
      ['pair-fix-accept', expect.objectContaining({
        maxCycles: 2,
        cycleUnit: 'One rework, its fulfilled artifact response, and the successor check verdict; the check closes the cycle.',
        terminalAuthorities: [{ participantId: 'pair-checker', verdict: 'accept' }],
      })],
      ['judge-rework-pass', expect.objectContaining({
        maxCycles: 2,
        cycleUnit: 'One producer generation followed by the judge verdict on that exact generation.',
        terminalAuthorities: [{ participantId: 'readiness-judge', verdict: 'pass' }],
      })],
      ['exhaust-with-residue', expect.objectContaining({
        maxCycles: 1,
        cycleUnit: 'One unavailable-source generation followed by one source-id verdict.',
        terminalAuthorities: [{ participantId: 'source-judge', verdict: 'pass' }],
      })],
      ['no-progress-park', expect.objectContaining({
        maxCycles: 2,
        cycleUnit: 'One required-output generation followed by one byte-progress check.',
        terminalAuthorities: [{ participantId: 'progress-checker', verdict: 'pass' }],
      })],
    ]);
    expect(new Set(FIXTURE.plan.stages.map((stage) => stage.assignment?.agentId))).toEqual(
      new Set(['fyt-story', 'fyt-checker']),
    );
    expect(FIXTURE.plan.stages.some((stage) => stage.assignment?.agentId === 'fyt-runner')).toBe(false);
    expect(groups.get('pair-fix-accept')).toMatchObject({
      activation: { seedParticipantId: 'pair-producer', seedArtifactIds: ['pair-status'] },
      initialStepId: 'pair-check', artifacts: ['pair-status'],
      criteria: [{ id: 'status-fixed' }],
      routes: [
        { routeId: 'pair-to-checker', senderParticipantId: 'pair-producer', recipientParticipantId: 'pair-checker', requestKinds: ['check'] },
        { routeId: 'pair-to-producer', senderParticipantId: 'pair-checker', recipientParticipantId: 'pair-producer', requestKinds: ['rework'] },
      ],
    });
    expect(groups.get('judge-rework-pass')).toMatchObject({
      activation: { seedParticipantId: 'readiness-producer', seedArtifactIds: ['readiness-json'] },
      initialStepId: 'readiness-review', artifacts: ['readiness-json'],
      criteria: [{ id: 'readiness-ready' }],
      routes: [
        { routeId: 'readiness-to-judge', requestKinds: ['review'] },
        { routeId: 'readiness-to-producer', requestKinds: ['rework'] },
      ],
    });
    expect(groups.get('exhaust-with-residue')).toMatchObject({
      activation: { seedParticipantId: 'source-producer', seedArtifactIds: ['unavailable-source'] },
      initialStepId: 'source-review', artifacts: ['unavailable-source'],
      criteria: [{ id: 'source-id-present' }],
      routes: [
        { routeId: 'source-to-judge', requestKinds: ['review'] },
        { routeId: 'source-to-producer', requestKinds: ['rework'] },
      ],
    });
    expect(groups.get('exhaust-with-residue')?.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: 'source-producer', mandate: expect.stringContaining('Never fabricate') }),
      expect.objectContaining({ participantId: 'source-judge', mandate: expect.stringContaining('missing-source-id') }),
    ]));
    expect(groups.get('no-progress-park')).toMatchObject({
      activation: { seedParticipantId: 'progress-producer', seedArtifactIds: ['no-progress-output'] },
      initialStepId: 'progress-review', artifacts: ['no-progress-output'],
      criteria: [{ id: 'required-output-changed' }],
      routes: [
        { routeId: 'progress-to-checker', requestKinds: ['review'] },
        { routeId: 'progress-to-producer', requestKinds: ['rework'] },
      ],
    });
  });

  it('marks the exact machine cycle boundary on every demo schedule', () => {
    expect(groups.get('pair-fix-accept')?.schedule).toEqual([
      { stepId: 'pair-check', routeId: 'pair-to-checker', after: { stepId: 'pair-rework', participantId: 'pair-producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'pair-rework', routeId: 'pair-to-producer', after: { stepId: 'pair-check', participantId: 'pair-checker', verdict: 'rework' }, cycle: 'current' },
    ]);
    expect(groups.get('judge-rework-pass')?.schedule).toEqual([
      { stepId: 'readiness-review', routeId: 'readiness-to-judge', after: { stepId: 'readiness-rework', participantId: 'readiness-producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'readiness-rework', routeId: 'readiness-to-producer', after: { stepId: 'readiness-review', participantId: 'readiness-judge', verdict: 'fail' }, cycle: 'current' },
    ]);
    expect(groups.get('exhaust-with-residue')?.schedule).toEqual([
      { stepId: 'source-review', routeId: 'source-to-judge', after: { stepId: 'source-rework', participantId: 'source-producer', verdict: 'fulfilled' }, cycle: 'current' },
      { stepId: 'source-rework', routeId: 'source-to-producer', after: { stepId: 'source-review', participantId: 'source-judge', verdict: 'fail' }, cycle: 'next' },
    ]);
    expect(groups.get('no-progress-park')?.schedule).toEqual([
      { stepId: 'progress-review', routeId: 'progress-to-checker', after: { stepId: 'progress-rework', participantId: 'progress-producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'progress-rework', routeId: 'progress-to-producer', after: { stepId: 'progress-review', participantId: 'progress-checker', verdict: 'fail' }, cycle: 'current' },
    ]);
  });

  it('rejects a negative compile fixture whose reachable schedule cycle has no next boundary', () => {
    const nextFreePair = SOURCE.text.replace(
      '      - stepId: pair-check\n        routeId: pair-to-checker\n        after:\n          stepId: pair-rework\n          participantId: pair-producer\n          verdict: fulfilled\n        cycle: next',
      '      - stepId: pair-check\n        routeId: pair-to-checker\n        after:\n          stepId: pair-rework\n          participantId: pair-producer\n          verdict: fulfilled\n        cycle: current',
    );
    expect(nextFreePair).not.toBe(SOURCE.text);
    expect(parseWorkflowDef(nextFreePair, {
      knownProfiles: new Set(ENVIRONMENT.registry.workflowProfiles ?? []),
    })).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/reachable schedule cycle.*cycle.*next boundary/i),
    });
  });

  it('keeps every demo stage local T2 and free of external or spend capabilities', () => {
    const localRoot = `orgs/faceless-youtube/output/iteration-loop-demo/${PROOF_SLUG}`;
    const profiles = new Map(loadWorkflowProfiles().map((profile) => [profile.id, profile.allowedTools]));
    const scanner = profiles.get('scanner');
    const checker = profiles.get('checker-readonly');
    expect(scanner).toEqual(['Read', 'Glob', 'Grep', 'Write']);
    expect(checker).toEqual(['Read', 'Glob', 'Grep']);
    expect(FIXTURE.plan.profile).toBe('scanner');
    expect(FIXTURE.plan.stages).toHaveLength(8);
    for (const stage of FIXTURE.plan.stages) {
      expect(stage.riskTier).toBe('T2');
      expect(stage.target === localRoot || stage.target.startsWith(`${localRoot}/`)).toBe(true);
      expect(stage.scope.write).toEqual([stage.target]);
      const expectedProfile = stage.assignment?.agentId === 'fyt-checker' ? 'checker-readonly' : 'scanner';
      expect(stage.workflowProfile).toBe(expectedProfile);
      expect(profiles.get(expectedProfile)?.some((tool) => /Web|mcp__|Bash|image|voice|publish|spend/i.test(tool))).toBe(false);
      expect(stage.humanGates).toEqual([]);
      expect(stage.action).not.toMatch(/^(publish|publication|deploy|release|spend|purchase|payment|money|credentials?):/);
      expect(`${stage.title}\n${stage.workOrder}`).not.toMatch(/WebSearch|WebFetch|network call|external action|image generation|voiceover|upload|publish|spend authorization/i);
      for (const artifact of stage.artifacts) {
        expect(artifact.path.startsWith(`${localRoot}/`)).toBe(true);
      }
    }
  });

  it('allows one group to park while a sibling group is mid-cycle', () => {
    const exhaust = groups.get('exhaust-with-residue')!;
    const noProgress = groups.get('no-progress-park')!;
    expect(FIXTURE.plan.maxConcurrency).toBeGreaterThanOrEqual(2);
    expect(exhaust.activation).toEqual({ seedParticipantId: 'source-producer', seedArtifactIds: ['unavailable-source'] });
    expect(noProgress.activation).toEqual({ seedParticipantId: 'progress-producer', seedArtifactIds: ['no-progress-output'] });
    expect(exhaust.schedule.map((step) => step.stepId)).toEqual(['source-review', 'source-rework']);
    expect(noProgress.schedule.map((step) => step.stepId)).toEqual(['progress-review', 'progress-rework']);
    expect(stages.get('source-producer')?.dependsOn).toEqual([]);
    expect(stages.get('no-progress-producer')?.dependsOn).toEqual([]);

    const groupByStage = new Map([...groups.values()].flatMap((group) =>
      group.participants.map((participant) => [participant.stageRef, group.iterationGroupId] as const)));
    for (const group of groups.values()) {
      const localStages = new Set(group.participants.map((participant) => participant.stageRef));
      for (const participant of group.participants) {
        expect(stages.get(participant.stageRef)?.dependsOn.every((dependency) => localStages.has(dependency))).toBe(true);
      }
      for (const route of group.routes) {
        expect(route.baseResolutionStageIds.every((stageId) => localStages.has(stageId))).toBe(true);
        expect(route.baseResolutionStageIds.every((stageId) => groupByStage.get(stageId) === group.iterationGroupId)).toBe(true);
      }
    }
  });

  it('makes the no-progress producer return a byte-identical required output', () => {
    const stage = stages.get('no-progress-producer');
    const group = groups.get('no-progress-park');
    expect(stage?.artifacts).toEqual([{
      id: 'no-progress-output',
      path: `orgs/faceless-youtube/output/iteration-loop-demo/${PROOF_SLUG}/no-progress-park/required-output.json`,
      description: 'The fixed required output whose rework attempt must remain byte-identical.',
    }]);
    expect(stage?.workOrder).toContain('write the existing required-output.json bytes back byte-for-byte unchanged');
    expect(stage?.workOrder).toContain("regardless of the rework request's instructions");
    expect(stage?.workOrder).toContain('Do not normalize whitespace, change a byte, or omit the write');
    expect(group?.participants.find((participant) => participant.participantId === 'progress-producer')?.mandate)
      .toContain("DOMINATES conflicting request text: on rework, write the required output byte-for-byte unchanged regardless of the rework request's instructions");
    expect(stages.get('progress-checker')?.workOrder).toContain('request rework without prescribing replacement bytes');
    expect(stages.get('progress-checker')?.workOrder).not.toMatch(/requiring a byte change/i);
    expect(group?.routes.find((route) => route.routeId === 'progress-to-producer')?.requestKinds).toEqual(['rework']);
  });
});
