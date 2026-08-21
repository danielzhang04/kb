import { describe, expect, it } from 'vitest';
import {
  migrateRunIdentities,
  resolveLegacyRunIdentity,
  type LegacyRunIdentityInput,
} from './runIdentity.ts';

const agent = { id: 'fyt-runner', sourcePath: 'agents/fyt-runner.md' as const, declarationHash: 'a'.repeat(64) };
const workflow = {
  id: 'video-run', project: 'faceless-youtube',
  sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' as const,
  declarationHash: 'b'.repeat(64), proposalRef: 'proposal-1', proposalRevision: 3, proposalHash: 'c'.repeat(64),
};

function input(overrides: Partial<LegacyRunIdentityInput> = {}): LegacyRunIdentityInput {
  return {
    runRef: 'run-1', location: 'runs[0]', executionHost: 'vm',
    agentWorkspaceLaunch: null,
    proposal: { proposalRef: 'proposal-1', proposalRevision: 3, proposalHash: 'c'.repeat(64) },
    agentDeclarations: [agent], workflowDefinitions: [workflow],
    workflowLaunchAudits: [{ runRef: 'run-1', workflowId: 'video-run', project: 'faceless-youtube', sourcePath: workflow.sourcePath, declarationHash: workflow.declarationHash }],
    ...overrides,
  };
}

describe('migrateRunIdentityV1', () => {
  it('resolves agent provenance only through the declared immutable path and hash', () => {
    const source = input({
      proposal: null,
      agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: agent.declarationHash },
    });
    const clone = JSON.parse(JSON.stringify(source));
    const result = resolveLegacyRunIdentity(source);
    expect(result).toEqual({ ok: true, value: {
      owner: { type: 'agent', id: 'fyt-runner', sourcePath: 'agents/fyt-runner.md' },
      executionHost: 'vm', terminalOutcome: null, completedAt: null, archivedFrom: null,
    } });
    expect(source).toEqual(clone);
  });

  it('requires exactly one matching agent declaration provenance', () => {
    const zero = input({ proposal: null, agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: agent.declarationHash }, agentDeclarations: [] });
    const multiple = input({ proposal: null, agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: agent.declarationHash }, agentDeclarations: [agent, { ...agent }] });
    const mismatchedHash = input({ proposal: null, agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: 'd'.repeat(64) } });
    expect(resolveLegacyRunIdentity(zero)).toEqual({ ok: false, reason: 'agent-provenance-required', candidates: [] });
    expect(resolveLegacyRunIdentity(multiple)).toMatchObject({ ok: false, reason: 'agent-provenance-required' });
    expect(resolveLegacyRunIdentity(mismatchedHash)).toEqual({ ok: false, reason: 'agent-provenance-required', candidates: [] });
  });

  it('requires one workflow definition and matching launch audit provenance', () => {
    expect(resolveLegacyRunIdentity(input())).toMatchObject({ ok: true, value: { owner: { type: 'workflow', id: 'video-run' } } });
    expect(resolveLegacyRunIdentity(input({ workflowLaunchAudits: [] }))).toEqual({ ok: false, reason: 'workflow-launch-audit-required', candidates: [] });
    const duplicate = { ...workflow, id: 'video-run-copy' };
    expect(resolveLegacyRunIdentity(input({
      workflowDefinitions: [workflow, duplicate],
      workflowLaunchAudits: [
        { runRef: 'run-1', workflowId: workflow.id, project: workflow.project, sourcePath: workflow.sourcePath, declarationHash: workflow.declarationHash },
        { runRef: 'run-1', workflowId: duplicate.id, project: duplicate.project, sourcePath: duplicate.sourcePath, declarationHash: duplicate.declarationHash },
      ],
    }))).toMatchObject({ ok: false, reason: 'ambiguous-workflow-provenance' });
  });

  it('returns a bounded sorted report without mutating source input on success or abort', () => {
    const source = [
      input({ runRef: 'run-z', agentWorkspaceLaunch: null, proposal: null }),
      input({ runRef: 'run-a', agentWorkspaceLaunch: null, proposal: null }),
      input({ runRef: 'run-ok', proposal: null, agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: agent.declarationHash } }),
    ];
    const clone = JSON.parse(JSON.stringify(source));
    const migrated = migrateRunIdentities(source, 1);
    expect(migrated.report).toEqual({
      migration: 'migrateRunIdentityV1', total: 3, migrated: 1, truncated: true,
      errors: [{ runRef: 'run-a', location: 'runs[0]', candidates: [], reason: 'run-owner-migration-required' }],
    });
    expect(source).toEqual(clone);
  });

  it('preserves a quarantine location in the resolved identity item', () => {
    const source = [input({
      runRef: 'run-quarantined', location: 'quarantine[0].run', proposal: null,
      agentWorkspaceLaunch: { agentId: agent.id, declarationPath: agent.sourcePath, declarationHash: agent.declarationHash },
    })];
    const clone = JSON.parse(JSON.stringify(source));
    expect(migrateRunIdentities(source)).toMatchObject({
      items: [{ runRef: 'run-quarantined', location: 'quarantine[0].run', value: { owner: { type: 'agent', id: agent.id } } }],
    });
    expect(source).toEqual(clone);
  });
});
