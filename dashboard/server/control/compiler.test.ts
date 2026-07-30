import { describe, expect, it } from 'vitest';
import { compileApprovedProposal, type CompileEnvironment } from './compiler.ts';
import type { PlanProposal } from './proposal.ts';

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1', proposalId: 'synthetic', project: 'kb-ops', title: 'Synthetic', summary: 'Two stages.',
  manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [
    {
      id: 'one', title: 'One', action: 'test:one', target: 'dashboard/server', workOrder: 'Run stage one.', riskTier: 'T2', dependsOn: [],
      worker: { runtime: 'codex', model: 'codex-safe' }, requiredSkills: ['tests'],
      scope: { read: ['dashboard'], write: ['dashboard/server'] },
      artifacts: [{ id: 'result', path: 'dashboard/server/result.txt', description: 'Synthetic result.' }], checkpoints: [], humanGates: [],
    },
    {
      id: 'two', title: 'Two', action: 'test:two', target: 'dashboard/src', workOrder: 'Run stage two.', riskTier: 'T2', dependsOn: ['one'],
      worker: { runtime: 'codex', model: 'codex-safe' }, requiredSkills: [],
      scope: { read: ['dashboard'], write: ['dashboard/src'] }, artifacts: [], checkpoints: [],
      humanGates: [{ id: 'review', kind: 'review', prompt: 'Review stage two.' }],
    },
  ],
};

const environment: CompileEnvironment = {
  defaultWorkers: { codex: 'codex-worker', claude: 'worker-desktop' },
  policy: {
    profiles: [
      { id: 'manager-claude', role: 'manager', runtime: 'claude', model: 'claude-opus', capabilities: ['read', 'emit-events'] },
      { id: 'worker-codex', role: 'worker', runtime: 'codex', model: 'codex-safe', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
    ],
    curatedSkills: new Set(['tests']), contractText: 'queues-for-me',
    governanceContents: {
      'CLAUDE.md': 'constitution', 'governance/agent-rules.md': 'rules', 'governance/risk-tiers.md': 'risk tiers', 'orgs/kb-ops/contract.md': 'contract',
    },
  },
};

/**
 * A T3 upload stage. `gates` decides whether it declares its own content-bound publication
 * authorization — the ONE thing that can release the T3 wait, and the difference between a launchable
 * run and the original fail-closed park.
 */
function withUpload(gates: PlanProposal['stages'][number]['humanGates']): PlanProposal {
  return {
    ...proposal,
    stages: [
      proposal.stages[0],
      {
        id: 'upload', title: 'Upload', action: 'publish:private-upload', target: 'dashboard/src',
        workOrder: 'Upload the finished cut as private.', riskTier: 'T3', dependsOn: ['one'],
        worker: { runtime: 'codex', model: 'codex-safe' }, requiredSkills: [],
        scope: { read: ['dashboard'], write: ['dashboard/src'] }, artifacts: [], checkpoints: [],
        humanGates: gates,
      },
    ],
  };
}

const PUBLICATION_GATE: PlanProposal['stages'][number]['humanGates'] = [
  { id: 'g4-publish', kind: 'approval', prompt: 'Approve the private upload.', publicationAuthorization: true },
];

describe('compileApprovedProposal', () => {
  it('derives owners server-side and preserves the DAG', () => {
    const result = compileApprovedProposal(proposal, 'abc', 'abc', environment);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.workflow).not.toBeNull();
    if (!result.value.workflow) return;
    expect(result.value.workflow.stages.map((stage) => [stage.id, stage.owner, stage.dependsOn])).toEqual([
      ['one', 'codex-worker', []], ['two', 'codex-worker', ['one']],
    ]);
    // Declared gates are NOT reported to the launch path. They are born at their own stage boundary in
    // `execution.ts#stageBoundary`; a launch-visible list is what let launch mint all of them up front,
    // under titles the engine does not recognise, so every gate needed approving twice.
    expect(result.value).not.toHaveProperty('humanGates');
    expect(result.value.stagePolicies.every((policy) => policy.releasableByStageGate === false)).toBe(true);
  });

  it('publishes an approval-bound T3 stage into the card DAG and leaves its wait to the stage gate', () => {
    const result = compileApprovedProposal(withUpload(PUBLICATION_GATE), 'abc', 'abc', environment);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // Runnable: the T3 stage no longer withholds the whole card DAG, so the run can launch at all.
    expect(result.value.workflow).not.toBeNull();
    expect(result.value.workflow?.stages.map((stage) => [stage.id, stage.riskTier]))
      .toEqual([['one', 'T2'], ['upload', 'T3']]);
    // Compiling authorizes NOTHING: the stage's policy is still a wait, and only the recorded approval of
    // its own gate at its own boundary can clear it. A `waiting-human` here that reads as `allow` would be
    // an unauthorized publication.
    const upload = result.value.stagePolicies.find((policy) => policy.stageId === 'upload');
    expect(upload?.decision).toMatchObject({ disposition: 'waiting-human', reason: 't3-content-bound-approval-required' });
    expect(upload?.releasableByStageGate).toBe(true);
  });

  it('keeps a T3 stage with no publication gate fail-closed: no card DAG, launch-blocking wait', () => {
    for (const gates of [
      [] as PlanProposal['stages'][number]['humanGates'],
      // A gate on the stage that does not claim publication authority releases nothing.
      [{ id: 'g4-look', kind: 'review', prompt: 'Look at the cut.' }],
      // Nor does an approval gate that leaves the flag off.
      [{ id: 'g4-publish', kind: 'approval', prompt: 'Approve the private upload.' }],
    ] satisfies Array<PlanProposal['stages'][number]['humanGates']>) {
      const result = compileApprovedProposal(withUpload(gates), 'abc', 'abc', environment);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.value.workflow).toBeNull();
      const upload = result.value.stagePolicies.find((policy) => policy.stageId === 'upload');
      expect(upload?.decision).toMatchObject({ disposition: 'waiting-human', reason: 't3-content-bound-approval-required' });
      expect(upload?.releasableByStageGate).toBe(false);
    }
  });

  it('never treats a wait the publication gate cannot clear as releasable', () => {
    // The gate is declared, but the stage waits for a reason no human approval of that gate resolves:
    // an executable governance reference is missing. It must keep blocking the launch.
    const missingGovernance: PlanProposal = {
      ...withUpload(PUBLICATION_GATE),
      governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md'],
    };
    const result = compileApprovedProposal(missingGovernance, 'abc', 'abc', environment);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.workflow).toBeNull();
    const upload = result.value.stagePolicies.find((policy) => policy.stageId === 'upload');
    expect(upload?.decision.reason).toBe('missing-executable-governance-reference');
    expect(upload?.releasableByStageGate).toBe(false);
  });

  it('classifies a read-only review target against read scope without granting worker writes', () => {
    const reviewProposal: PlanProposal = {
      ...proposal,
      stages: [
        proposal.stages[0],
        {
          ...proposal.stages[1],
          action: 'review:one',
          scope: { read: ['dashboard'], write: [] },
          artifacts: [],
          checkpoints: [],
          workflowProfile: 'checker-readonly',
          review: {
            subjectStageId: 'one',
            maxCreatorReworks: 1,
            criteria: [{ id: 'quality', description: 'Stage one meets its acceptance criteria.' }],
          },
        },
      ],
    };

    const result = compileApprovedProposal(reviewProposal, 'abc', 'abc', environment);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.stagePolicies[1].decision).toMatchObject({
      disposition: 'allow',
      reason: 'inside-approved-envelope',
    });
    expect(reviewProposal.stages[1].scope.write).toEqual([]);
  });

  it('marks unapproved work waiting-human and refuses unbound, widened, and artifact-out-of-scope work', () => {
    const unapproved = compileApprovedProposal(proposal, 'new', 'old', environment);
    expect(unapproved).toMatchObject({ ok: true });
    if (unapproved.ok) expect(unapproved.value.stagePolicies[0].decision.disposition).toBe('waiting-human');
    const unbound = { ...environment, defaultWorkers: {} };
    expect(compileApprovedProposal(proposal, 'abc', 'abc', unbound)).toMatchObject({ ok: false, reason: 'runtime-unbound' });
    const widened = { ...proposal, stages: [{ ...proposal.stages[0], scope: { read: ['governance'], write: ['dashboard/server'] } }] };
    expect(compileApprovedProposal(widened, 'abc', 'abc', environment)).toMatchObject({ ok: false, reason: 'scope-widening-refused' });
    const badArtifact = { ...proposal, stages: [{ ...proposal.stages[0], artifacts: [{ ...proposal.stages[0].artifacts[0], path: 'dashboard/src/out.txt' }] }] };
    expect(compileApprovedProposal(badArtifact, 'abc', 'abc', environment)).toMatchObject({ ok: false, reason: 'artifact-scope-refused' });
  });

  it('refuses an action outside the shared server-owned registry before card publication', () => {
    const unknown = { ...proposal, stages: [{ ...proposal.stages[0], action: 'agent-invented:surprise' }] };
    expect(compileApprovedProposal(unknown, 'abc', 'abc', environment)).toMatchObject({
      ok: false,
      reason: 'action-capability-refused',
      detail: "stage 'one': action-not-in-server-owned-registry",
    });
  });
});
