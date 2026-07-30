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

  // The spend gate is the one place where a refusal became approvable, so it is exercised from the
  // attacker's side: every way of reaching `allow` WITHOUT the gate's own recorded approval must fail.
  describe('declared spend authorization', () => {
    it('keeps undeclared spend a non-overridable refusal', () => {
      for (const patch of [
        { requestsSpending: true },
        { requestsSpending: true, spendAuthorization: 'none' as const },
        // A junk value is not a partial authorization: the switch default refuses.
        { requestsSpending: true, spendAuthorization: 'approved ' as unknown as 'approved' },
        { requestsSpending: true, spendAuthorization: true as unknown as 'approved' },
      ]) {
        expect(evaluateExecutionPolicy({ ...request, ...patch }, environment)).toMatchObject({
          disposition: 'refuse', reason: 'real-spending-forbidden',
        });
      }
    });

    it('pauses a declared-but-unapproved spend gate for a human instead of refusing it', () => {
      expect(evaluateExecutionPolicy({ ...request, requestsSpending: true, spendAuthorization: 'pending' }, environment))
        .toMatchObject({ disposition: 'waiting-human', reason: 'declared-spend-gate-awaiting-human-authorization' });
    });

    it('admits spend only on the recorded approval, and still inside the ordinary envelope', () => {
      expect(evaluateExecutionPolicy({ ...request, requestsSpending: true, spendAuthorization: 'approved' }, environment))
        .toMatchObject({ disposition: 'allow', reason: 'inside-approved-envelope' });
      // An approved spend gate is not a skeleton key: every other refusal still fires beneath it.
      expect(evaluateExecutionPolicy({
        ...request, requestsSpending: true, spendAuthorization: 'approved', requestsCredentials: true,
      }, environment)).toMatchObject({ disposition: 'refuse', reason: 'credentials-as-objects-forbidden' });
      expect(evaluateExecutionPolicy({
        ...request, requestsSpending: true, spendAuthorization: 'approved', target: 'governance/risk-tiers.md',
        scope: { read: ['.'], write: ['governance'] },
      }, environment)).toMatchObject({ disposition: 'refuse', reason: 'human-owned-governance-target' });
      expect(evaluateExecutionPolicy({
        ...request, requestsSpending: true, spendAuthorization: 'approved', target: 'orgs/other/output',
      }, environment)).toMatchObject({ disposition: 'waiting-human', reason: 'target-outside-approved-write-scope' });
      expect(evaluateExecutionPolicy({
        ...request, requestsSpending: true, spendAuthorization: 'approved', approvedHash: 'older',
      }, environment)).toMatchObject({ disposition: 'waiting-human', reason: 'proposal-revision-not-approved' });
    });

    it('leaves a non-spending stage untouched whatever its authorization state says', () => {
      // Authorization state alone never grants anything: with no spend requested the decision is the
      // pre-existing one, so a stage cannot smuggle capability in by claiming to be authorized.
      for (const spendAuthorization of ['none', 'pending', 'approved'] as const) {
        expect(evaluateExecutionPolicy({ ...request, spendAuthorization }, environment))
          .toMatchObject({ disposition: 'allow', reason: 'inside-approved-envelope' });
      }
    });
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
