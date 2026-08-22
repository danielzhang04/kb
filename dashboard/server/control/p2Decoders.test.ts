import { describe, expect, it } from 'vitest';
import { decodeRun, decodeRunIdentityFields, decodeRunnableRef, decodeStoredRun } from './p2Decoders.ts';

describe('P2 closed-shape runtime decoders', () => {
  it('accepts only server-shaped Agent and Workflow references', () => {
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }))
      .toEqual({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' });
    expect(decodeRunnableRef({
      type: 'workflow', id: 'video-run', project: 'faceless-youtube',
      sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
    })).toEqual({
      type: 'workflow', id: 'video-run', project: 'faceless-youtube',
      sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
    });
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: '../grader.md' })).toBeNull();
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md', host: 'vm' })).toBeNull();
  });

  it('rejects missing, malformed, and extra run identity fields', () => {
    const valid = {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'vm', terminalOutcome: null, completedAt: null, archivedFrom: null,
    };
    expect(decodeRunIdentityFields(valid)).toEqual(valid);
    expect(decodeRunIdentityFields({ ...valid, executionHost: 'browser' })).toBeNull();
    expect(decodeRunIdentityFields({ ...valid, terminalOutcome: 'ok', completedAt: null })).toBeNull();
    expect(decodeRunIdentityFields({ ...valid, sourcePath: 'agents/forged.md' })).toBeNull();
  });

  it('closes the complete Run and StoredRun shapes at transport and persistence boundaries', () => {
    const run = {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'vm', terminalOutcome: null, completedAt: null, archivedFrom: null,
      runRef: 'run-1', predecessorRunRef: null, title: 'Grade', proposalRef: 'proposal-1',
      proposalRevision: 1, proposalHash: 'a'.repeat(64), publicationState: 'published',
      lifecycle: { kind: 'running', deployPause: null }, version: 3,
      managerSessionRef: 'session-1', managerGeneration: 1, managerAssignment: null,
      agentWorkspaceLaunch: null, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:01:00.000Z',
    };
    expect(decodeRun(run)).toEqual(run);
    expect(decodeRun({ ...run, injected: true })).toBeNull();
    const stored = {
      ...run, subject: 'operator', launchOperationKey: null, launchOperationFingerprint: null,
      archiveOperationKey: null, archiveOperationFingerprint: null, activationReceipts: [],
      authorizedFailedRunReconciliation: null,
    };
    expect(decodeStoredRun(stored)).toEqual(stored);
    expect(decodeStoredRun({ ...stored, ownerSubject: 'forged' })).toBeNull();
  });
});
