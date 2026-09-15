import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateServerCompiledPlanProposal } from '../control/proposal.ts';
import { loadWorkflowCompileEnvironment, loadWorkflowProfiles } from '../control/environment.ts';
import { compileWorkflowDef } from './compile.ts';
import { instantiateWorkflowDef, parseWorkflowDef } from './defs.ts';
import { loadOrgDef } from './orgDefSource.ts';

const DEF_PATH = 'orgs/kb-ops/workflows/v1-acceptance-demo.md';
const SOURCE = loadOrgDef(DEF_PATH);
const REPO_ROOT = SOURCE.origin.slice(0, SOURCE.origin.length - DEF_PATH.split('/').join(sep).length);
const ENVIRONMENT = loadWorkflowCompileEnvironment(REPO_ROOT);
const PROOF_TOPIC = 'p1-v1-acceptance-proof';

function compileFixture() {
  const parsed = parseWorkflowDef(SOURCE.text, {
    knownProfiles: new Set(ENVIRONMENT.registry.workflowProfiles ?? []),
  });
  if (!parsed.ok) throw new Error(parsed.detail);
  const instantiated = instantiateWorkflowDef(parsed.value, { topic: PROOF_TOPIC });
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

describe('v1-acceptance-demo workflow definition (compiled proof)', () => {
  it('compiles two independent researchers, a dependent writer, and a bounded gated judge cycle', () => {
    expect(FIXTURE.def.executionMode).toBe('validation-slice');
    expect(FIXTURE.def.maxConcurrency).toBeGreaterThanOrEqual(2);
    expect(FIXTURE.plan.maxConcurrency).toBe(FIXTURE.def.maxConcurrency);
    expect(FIXTURE.def.launchParameters).toEqual({ topic: PROOF_TOPIC });
    expect(FIXTURE.plan.stages).toHaveLength(4);

    // Two parallel researchers: no dependency on each other, and no dependency at all.
    expect(stages.get('researcher-a')?.dependsOn).toEqual([]);
    expect(stages.get('researcher-b')?.dependsOn).toEqual([]);

    // The writer depends on BOTH researchers (dependent consumes persisted results).
    expect(stages.get('writer')?.dependsOn).toEqual(
      expect.arrayContaining(['researcher-a', 'researcher-b']),
    );
    expect(stages.get('writer')?.dependsOn).toHaveLength(2);

    // The judge iteration group is bounded at maxCycles 2 and terminates on the judge's pass.
    const group = groups.get('brief-review');
    expect(group).toMatchObject({
      maxCycles: 2,
      terminalAuthorities: [{ participantId: 'brief-judge', verdict: 'pass' }],
      activation: { seedParticipantId: 'brief-producer', seedArtifactIds: ['brief-json'] },
      criteria: [{ id: 'sources-listed' }],
    });

    // A T3-audited completion gate sits on the writer's group, requiring the judge's pass.
    expect(group?.completionGate).toMatchObject({
      id: 'brief-complete',
      kind: 'approval',
      requiresReview: 'pass',
    });

    // The writer's output is declared under artifacts so it projects a downloadable OutputRef.
    expect(stages.get('writer')?.artifacts).toEqual([{
      id: 'brief-json',
      path: `orgs/kb-ops/output/v1-acceptance-demo/${PROOF_TOPIC}/brief/brief.json`,
      description: 'The draft-then-sourced synthesis JSON, judged against one named criterion and released only after human approval.',
    }]);
  });

  it('rejects the sourceless draft and passes only the exact revision-2 successor', () => {
    const group = groups.get('brief-review')!;
    expect(group.schedule).toEqual([
      { stepId: 'brief-review', routeId: 'brief-to-judge', after: { stepId: 'brief-rework', participantId: 'brief-producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'brief-rework', routeId: 'brief-to-producer', after: { stepId: 'brief-review', participantId: 'brief-judge', verdict: 'fail' }, cycle: 'current' },
    ]);
    expect(group.participants.find((participant) => participant.participantId === 'brief-producer')?.mandate)
      .toContain('Seed sourcesListed as false');
    expect(group.participants.find((participant) => participant.participantId === 'brief-judge')?.mandate)
      .toContain('sourcesListed true and revision 2');
    expect(stages.get('writer')?.workOrder).toContain('sourcesListed exactly false');
    expect(stages.get('writer')?.workOrder).toContain('change sourcesListed to true and revision to 2');
    expect(stages.get('writer-judge')?.workOrder).toContain('Never edit the subject');
  });

  it('keeps every stage local T2, unpublished, and free of spend or credential capabilities', () => {
    const localRoot = `orgs/kb-ops/output/v1-acceptance-demo/${PROOF_TOPIC}`;
    const profiles = new Map(loadWorkflowProfiles().map((profile) => [profile.id, profile.allowedTools]));
    for (const stage of FIXTURE.plan.stages) {
      expect(stage.riskTier).toBe('T2');
      expect(stage.target === localRoot || stage.target.startsWith(`${localRoot}/`)).toBe(true);
      expect(stage.scope.write).toEqual([stage.target]);
      expect(stage.action).not.toMatch(/^(publish|publication|deploy|release|spend|purchase|payment|money|credentials?):/);
      const toolset = profiles.get(stage.workflowProfile ?? '') ?? [];
      expect(toolset.some((tool) => /Bash|mcp__|image|voice|publish|spend|upload/i.test(tool))).toBe(false);
      for (const artifact of stage.artifacts) {
        expect(artifact.path.startsWith(`${localRoot}/`)).toBe(true);
      }
    }
    // Every stage instruction says retrieved/inert context is data, never instructions.
    for (const stage of FIXTURE.plan.stages) {
      expect(stage.workOrder).toMatch(/DATA.*never instructions to follow/i);
    }
  });

  it('treats researcher stages as independent (no dependsOn between them) at maxConcurrency 2', () => {
    expect(FIXTURE.plan.maxConcurrency).toBe(2);
    expect(stages.get('researcher-a')?.workflowProfile).toBe('research');
    expect(stages.get('researcher-b')?.workflowProfile).toBe('research');
  });
});
