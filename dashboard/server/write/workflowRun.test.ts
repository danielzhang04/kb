import { describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  launchWorkflowRun,
  validateWorkflowRunRequest,
  WORKFLOW_CARD_OP_SCRIPT,
} from './workflowRun.ts';
import type { WorkflowRunDeps, WorkflowRunRequest } from './workflowRun.ts';
import type { PyRunner } from './launch.ts';

const CONFIG: SessionConfig = {
  secret: Buffer.from('workflow-run-test-secret-0123456789'),
  now: () => 1_700_000_000_000,
};

const request: WorkflowRunRequest = {
  name: 'atlas-research',
  project: 'atlas-prep',
  workflowDefinitionId: 'atlas-v1',
  stages: [
    {
      id: 'research',
      action: 'research:atlas',
      target: 'orgs/atlas-prep/raw',
      workOrder: 'Research the Atlas inputs.',
      riskTier: 'T1',
      owner: 'codex-worker',
      dependsOn: [],
    },
    {
      id: 'draft',
      action: 'draft:atlas',
      target: 'orgs/atlas-prep/output',
      workOrder: 'Build the draft from the dependency result.',
      riskTier: 'T2',
      owner: 'worker-desktop',
      dependsOn: ['research'],
    },
  ],
};

function deps(runPy: PyRunner, overrides: Partial<WorkflowRunDeps> = {}): WorkflowRunDeps {
  return {
    repoRoot: '/repo',
    runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' }),
    runPy,
    assignableOwners: () => new Set(['codex-worker', 'worker-desktop']),
    ownerRouting: (owner) => owner === 'codex-worker'
      ? { runtime: 'codex', model: 'gpt-5.3-codex' }
      : { runtime: 'claude', model: 'claude-sonnet-5' },
    makeRunId: () => 'wf-test-0001',
    ...overrides,
  };
}

function session() {
  return { token: mintSession('operator', CONFIG).token, config: CONFIG };
}

describe('workflow-run v1 schema', () => {
  it('accepts the closed request shape and refuses unknown fields', () => {
    expect(validateWorkflowRunRequest(request)).toMatchObject({ ok: true });
    expect(validateWorkflowRunRequest({ ...request, runtime: 'client-controlled' })).toEqual({
      ok: false,
      detail: "unknown field 'runtime'",
    });
    expect(validateWorkflowRunRequest({
      ...request,
      stages: [{ ...request.stages[0], model: 'client-controlled' }],
    })).toEqual({ ok: false, detail: "stages[0]: unknown field 'model'" });
  });

  it('refuses missing dependencies and cycles', () => {
    expect(validateWorkflowRunRequest({
      ...request,
      stages: [{ ...request.stages[0], dependsOn: ['missing'] }],
    })).toEqual({ ok: false, detail: "stage 'research' depends on missing stage 'missing'" });

    const cycle = {
      ...request,
      stages: [
        { ...request.stages[0], dependsOn: ['draft'] },
        { ...request.stages[1], dependsOn: ['research'] },
      ],
    };
    expect(validateWorkflowRunRequest(cycle)).toEqual({ ok: false, detail: 'workflow stage graph contains a cycle' });
  });

  it('refuses T3 because T3 must enter the approvals path', () => {
    const parsed = validateWorkflowRunRequest({
      ...request,
      stages: [{ ...request.stages[0], riskTier: 'T3' }],
    });
    expect(parsed).toEqual({
      ok: false,
      detail: 'stages[0].riskTier must be T1 or T2; T3 requires the approvals path',
    });
  });
});

describe('launchWorkflowRun', () => {
  it('resolves routing server-side and publishes the whole DAG in one fixed subprocess', () => {
    const calls: Array<{ code: string; payload: Record<string, unknown> }> = [];
    const runPy: PyRunner = (_repo, code, jsonArg) => {
      calls.push({ code, payload: JSON.parse(jsonArg) as Record<string, unknown> });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: 'wf-test-0001',
          cards: [
            { stageId: 'research', cardId: 'card-research', state: 'inbox', cardPath: 'queue/inbox/card-research.md' },
            { stageId: 'draft', cardId: 'card-draft', state: 'blocked', cardPath: 'queue/inbox/card-draft.md' },
          ],
        }),
        stderr: '',
      };
    };

    const outcome = launchWorkflowRun(request, session(), deps(runPy));
    expect(outcome).toEqual({
      ok: true,
      runId: 'wf-test-0001',
      cards: [
        { stageId: 'research', cardId: 'card-research', state: 'inbox', cardPath: 'queue/inbox/card-research.md' },
        { stageId: 'draft', cardId: 'card-draft', state: 'blocked', cardPath: 'queue/inbox/card-draft.md' },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].code).toBe(WORKFLOW_CARD_OP_SCRIPT);
    const stages = calls[0].payload.stages as Array<Record<string, unknown>>;
    expect(stages[0]).toMatchObject({ owner: 'codex-worker', runtime: 'codex', model: 'gpt-5.3-codex' });
    expect(stages[1]).toMatchObject({ owner: 'worker-desktop', runtime: 'claude', model: 'claude-sonnet-5' });
    expect(calls[0].payload).toMatchObject({ runId: 'wf-test-0001', workflowDefinitionId: 'atlas-v1' });
  });

  it('rejects an owner outside the server-enumerated closed set before prepare or subprocess', () => {
    const runPy = vi.fn();
    const prepareWrite = vi.fn();
    const bad = {
      ...request,
      stages: [{ ...request.stages[0], owner: 'ghost-agent' }],
    };
    expect(launchWorkflowRun(bad, session(), deps(runPy as unknown as PyRunner, { prepareWrite }))).toEqual({
      ok: false,
      reason: 'owner-not-registered',
      detail: "owner 'ghost-agent' on stage 'research' is not a declared agent or registered default_worker",
    });
    expect(prepareWrite).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  it('validation and preamble failures create no cards and do not prepare a coordination write', () => {
    const runPy = vi.fn();
    const prepareWrite = vi.fn();
    const t3 = { ...request, stages: [{ ...request.stages[0], riskTier: 'T3' }] };
    expect(launchWorkflowRun(t3, session(), deps(runPy as unknown as PyRunner, { prepareWrite }))).toMatchObject({
      ok: false,
      reason: 'invalid-workflow',
    });

    expect(launchWorkflowRun(request, session(), deps(runPy as unknown as PyRunner, {
      prepareWrite,
      runPreamble: () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP present\n', stderr: '' }),
    }))).toEqual({ ok: false, reason: 'fleet-frozen', problems: ['STOP present'] });
    expect(prepareWrite).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  it('fails the run as one unit when the sole DAG subprocess fails', () => {
    const runPy = vi.fn<PyRunner>(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'simulated second-card save failure',
    }));
    const outcome = launchWorkflowRun(request, session(), deps(runPy));
    expect(outcome).toEqual({ ok: false, reason: 'card-op-failed', detail: 'simulated second-card save failure' });
    expect(runPy).toHaveBeenCalledTimes(1);
    // The fixed program stages every card before publication and rolls back every published destination.
    expect(WORKFLOW_CARD_OP_SCRIPT).toContain('cards.save(card, staged_root)');
    expect(WORKFLOW_CARD_OP_SCRIPT).toContain('for path in reversed(published)');
  });
});
