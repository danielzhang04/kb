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

describe('compileApprovedProposal', () => {
  it('derives owners server-side, preserves the DAG, and reports human gates', () => {
    const result = compileApprovedProposal(proposal, 'abc', 'abc', environment);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.workflow).not.toBeNull();
    if (!result.value.workflow) return;
    expect(result.value.workflow.stages.map((stage) => [stage.id, stage.owner, stage.dependsOn])).toEqual([
      ['one', 'codex-worker', []], ['two', 'codex-worker', ['one']],
    ]);
    expect(result.value.humanGates).toEqual([{ stageId: 'two', gate: proposal.stages[1].humanGates[0] }]);
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
