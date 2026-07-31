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

  // The T3/publication gate is the second approvable boundary, and the only thing that releases a
  // `publish:` stage. Exercised from the attacker's side exactly like the spend gate above: every way of
  // reaching `allow` WITHOUT that stage's own recorded approval must still park or refuse.
  describe('declared publication (content-bound T3) authorization', () => {
    it('keeps an UNDECLARED publication or T3 stage a permanent human wait', () => {
      for (const patch of [
        { requestsPublication: true },
        { requestsPublication: true, publicationAuthorization: 'none' as const },
        { requestsPublication: true, publicationAuthorization: 'approved ' as unknown as 'approved' },
        { requestsPublication: true, publicationAuthorization: true as unknown as 'approved' },
      ]) {
        expect(evaluateExecutionPolicy({ ...request, ...patch }, environment)).toMatchObject({
          disposition: 'waiting-human', reason: 'external-publication-requires-t3-approval',
        });
      }
      for (const patch of [
        { riskTier: 'T3' as const },
        { riskTier: 'T3' as const, publicationAuthorization: 'none' as const },
        { riskTier: 'T3' as const, publicationAuthorization: 'pending' as const },
      ]) {
        expect(evaluateExecutionPolicy({ ...request, ...patch }, environment)).toMatchObject({
          disposition: 'waiting-human',
        });
      }
    });

    it('names the declared gate while it is unapproved instead of refusing it', () => {
      expect(evaluateExecutionPolicy({ ...request, requestsPublication: true, publicationAuthorization: 'pending' }, environment))
        .toMatchObject({ disposition: 'waiting-human', reason: 'declared-publication-gate-awaiting-human-authorization' });
      expect(evaluateExecutionPolicy({
        ...request, riskTier: 'T3', publicationAuthorization: 'pending',
      }, environment)).toMatchObject({ disposition: 'waiting-human', reason: 't3-content-bound-approval-required' });
    });

    it('releases a T3 publishing stage ONLY on the recorded approval, still inside the ordinary envelope', () => {
      // This is the G4 path: the approval recorded against the publish stage's own declared gate IS the
      // content-bound T3 approval the policy has always demanded.
      expect(evaluateExecutionPolicy({
        ...request, riskTier: 'T3', requestsPublication: true, publicationAuthorization: 'approved',
      }, environment)).toMatchObject({ disposition: 'allow', reason: 'inside-approved-envelope' });

      // An approved publication gate is not a skeleton key: every other boundary still fires beneath it.
      for (const [patch, expected] of [
        [{ requestsCredentials: true }, { disposition: 'refuse', reason: 'credentials-as-objects-forbidden' }],
        [{ requestsSpending: true }, { disposition: 'refuse', reason: 'real-spending-forbidden' }],
        [{ target: 'orgs/other/output' }, { disposition: 'waiting-human', reason: 'target-outside-approved-write-scope' }],
        [{ approvedHash: 'older' }, { disposition: 'waiting-human', reason: 'proposal-revision-not-approved' }],
        [{ requiredSkills: ['learned-unreviewed'] }, { disposition: 'refuse', reason: 'skill-not-curated:learned-unreviewed' }],
        [{ model: 'browser-supplied-model' }, { disposition: 'refuse', reason: 'runtime-model-profile-not-allowed' }],
      ] as const) {
        expect(evaluateExecutionPolicy({
          ...request, riskTier: 'T3', requestsPublication: true, publicationAuthorization: 'approved', ...patch,
        } as PolicyRequest, environment)).toMatchObject(expected);
      }
    });

    it('leaves a non-publishing stage untouched whatever its authorization state claims', () => {
      for (const publicationAuthorization of ['none', 'pending', 'approved'] as const) {
        expect(evaluateExecutionPolicy({ ...request, publicationAuthorization }, environment))
          .toMatchObject({ disposition: 'allow', reason: 'inside-approved-envelope' });
      }
    });

    it('does not let a publication approval stand in for a spend approval, or the reverse', () => {
      expect(evaluateExecutionPolicy({
        ...request, requestsSpending: true, publicationAuthorization: 'approved',
      }, environment)).toMatchObject({ disposition: 'refuse', reason: 'real-spending-forbidden' });
      expect(evaluateExecutionPolicy({
        ...request, riskTier: 'T3', requestsPublication: true, spendAuthorization: 'approved',
      }, environment)).toMatchObject({ disposition: 'waiting-human', reason: 'external-publication-requires-t3-approval' });
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
