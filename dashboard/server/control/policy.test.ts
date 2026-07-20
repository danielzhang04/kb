import { describe, expect, it } from 'vitest';
import { classifyActionRisk, evaluateExecutionPolicy, type PolicyEnvironment, type PolicyRequest } from './policy.ts';

const environment: PolicyEnvironment = {
  profiles: [{
    id: 'codex-worker-safe', role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol',
    capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
  }],
  curatedSkills: new Set(['tests']),
  contractText: '# contract\n\nEverything queues-for-me.',
  governanceContents: {
    'CLAUDE.md': 'constitution',
    'governance/agent-rules.md': 'rules',
    'governance/risk-tiers.md': 'risk tiers',
    'orgs/kb-ops/contract.md': 'contract',
  },
};

const request: PolicyRequest = {
  project: 'kb-ops', riskTier: 'T2', role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol',
  target: 'dashboard/server/control', requiredSkills: ['tests'],
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  proposalHash: 'abc', approvedHash: 'abc',
};

describe('evaluateExecutionPolicy', () => {
  it('uses a closed server-owned action namespace registry', () => {
    expect(classifyActionRisk('wiki:refresh')).toEqual({ disposition: 'allowed', minimumTier: 'T1' });
    expect(classifyActionRisk('test:synthetic')).toEqual({ disposition: 'allowed', minimumTier: 'T2' });
    expect(classifyActionRisk('deploy:production')).toEqual({ disposition: 'allowed', minimumTier: 'T3' });
    expect(classifyActionRisk('agent-invented:surprise')).toEqual({
      disposition: 'forbidden', reason: 'action-not-in-server-owned-registry',
    });
    expect(classifyActionRisk('credentials:copy')).toEqual({ disposition: 'forbidden', reason: 't4-capability-forbidden' });
  });

  it('allows only an exactly-approved stage inside a server-owned profile and scope', () => {
    expect(evaluateExecutionPolicy(request, environment)).toMatchObject({
      disposition: 'allow', reason: 'inside-approved-envelope', profile: { id: 'codex-worker-safe' },
    });
  });

  it.each([
    [{ approvedHash: 'older' }, 'proposal-revision-not-approved', 'waiting-human'],
    [{ target: '../outside' }, 'unsafe-target', 'refuse'],
    [{ target: 'governance/risk-tiers.md', scope: { read: ['.'], write: ['governance'] } }, 'human-owned-governance-target', 'refuse'],
    [{ target: 'orgs/other/output' }, 'target-outside-approved-write-scope', 'waiting-human'],
    [{ requestsCredentials: true }, 'credentials-as-objects-forbidden', 'refuse'],
    [{ requestsSpending: true }, 'real-spending-forbidden', 'refuse'],
    [{ requestsPublication: true }, 'external-publication-requires-t3-approval', 'waiting-human'],
    [{ riskTier: 'T3' }, 't3-content-bound-approval-required', 'waiting-human'],
    [{ requiredSkills: ['learned-unreviewed'] }, 'skill-not-curated:learned-unreviewed', 'refuse'],
    [{ model: 'browser-supplied-model' }, 'runtime-model-profile-not-allowed', 'refuse'],
  ] as const)('fails closed for %j', (patch, reason, disposition) => {
    expect(evaluateExecutionPolicy({ ...request, ...patch } as PolicyRequest, environment)).toMatchObject({ reason, disposition });
  });

  it('requires the global and project governance references to be present and loaded', () => {
    expect(evaluateExecutionPolicy({ ...request, governanceRefs: ['CLAUDE.md'] }, environment)).toMatchObject({
      disposition: 'waiting-human', reason: 'missing-executable-governance-reference',
    });
  });

  it('binds the decision to governance, contract, profiles, and approved scope', () => {
    const first = evaluateExecutionPolicy(request, environment).policyHash;
    const changed = evaluateExecutionPolicy(request, { ...environment, contractText: `${environment.contractText}\nnew rule` }).policyHash;
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(changed).not.toBe(first);
  });
});
