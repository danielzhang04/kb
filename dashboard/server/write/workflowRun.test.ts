import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { createInternalServiceCaller } from '../control/activation.ts';
import {
  launchWorkflowRun,
  activateManagedRootCards,
  MANAGED_ROOT_ACTIVATION_SCRIPT,
  validateWorkflowRunRequest,
  WORKFLOW_CARD_OP_SCRIPT,
  workflowCardId,
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

describe('workflow-run v1 schema', async () => {
  it('accepts the closed request shape and refuses unknown fields', async () => {
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

  it('refuses missing dependencies and cycles', async () => {
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

  it('refuses T3 because T3 must enter the approvals path', async () => {
    const t3 = { ...request, stages: [{ ...request.stages[0], riskTier: 'T3' }] };
    const refusal = {
      ok: false,
      detail: 'stages[0].riskTier must be T1 or T2; T3 requires the approvals path',
    };
    expect(validateWorkflowRunRequest(t3)).toEqual(refusal);
    // The admission must be opted INTO. Absent, empty, and falsy option objects all keep the refusal, so a
    // caller that never reasoned about T3 cannot publish a T3 card by accident.
    expect(validateWorkflowRunRequest(t3, {})).toEqual(refusal);
    expect(validateWorkflowRunRequest(t3, { admitApprovalBoundT3: false })).toEqual(refusal);
    expect(validateWorkflowRunRequest(t3, { admitApprovalBoundT3: undefined })).toEqual(refusal);
  });

  it('admits an approval-bound T3 stage only on the managed approvals path', async () => {
    // The approvals path is the ONLY caller that sets this: control/launch.ts, after
    // compileApprovedProposal bound the stage to an exact approved revision AND to the stage's own
    // declared publication-authorization gate. The card still publishes blocked, and the upload is still
    // held by that gate at the stage's entry boundary.
    const t3 = { ...request, stages: [{ ...request.stages[0], riskTier: 'T3' as const }] };
    const admitted = validateWorkflowRunRequest(t3, { admitApprovalBoundT3: true });
    expect(admitted).toMatchObject({ ok: true });
    expect(admitted.ok && admitted.value.stages[0].riskTier).toBe('T3');
    // Malformed and out-of-namespace tiers stay refused even on the approvals path.
    for (const riskTier of ['T4', 't3', 'T3 ', '', null, 3]) {
      expect(validateWorkflowRunRequest(
        { ...request, stages: [{ ...request.stages[0], riskTier }] },
        { admitApprovalBoundT3: true },
      )).toMatchObject({ ok: false });
    }
  });

  it('carries the managed T3 admission through launchWorkflowRun and refuses it unmanaged', async () => {
    const t3 = { ...request, stages: [{ ...request.stages[0], riskTier: 'T3' as const }] };
    const cardId = workflowCardId('wf-test-0001', 'research');
    const runPy = vi.fn(() => ({
      exitCode: 0,
      stdout: JSON.stringify({
        runId: 'wf-test-0001',
        cards: [{ stageId: 'research', cardId, state: 'blocked', cardPath: `queue/inbox/${cardId}.md` }],
      }),
      stderr: '',
    }));
    expect(await launchWorkflowRun(t3, session(), deps(runPy, { publishBlocked: true, admitApprovalBoundT3: true })))
      .toMatchObject({ ok: true });
    // Card-publication mode alone does NOT confer T3 admission: admitApprovalBoundT3 is a hard opt-in, so a
    // future managed-mode caller cannot inherit the right to admit an upload stage by turning publication off.
    const publishBlockedOnly = vi.fn(() => ({ exitCode: 0, stdout: '{}', stderr: '' }));
    expect(await launchWorkflowRun(t3, session(), deps(publishBlockedOnly, { publishBlocked: true }))).toMatchObject({
      ok: false,
      reason: 'invalid-workflow',
      detail: 'stages[0].riskTier must be T1 or T2; T3 requires the approvals path',
    });
    expect(publishBlockedOnly).not.toHaveBeenCalled();
    // Without managed mode — the shape every non-approvals caller has — the same request is refused before
    // any card operation runs.
    const unmanaged = vi.fn(() => ({ exitCode: 0, stdout: '{}', stderr: '' }));
    expect(await launchWorkflowRun(t3, session(), deps(unmanaged))).toMatchObject({
      ok: false,
      reason: 'invalid-workflow',
      detail: 'stages[0].riskTier must be T1 or T2; T3 requires the approvals path',
    });
    expect(unmanaged).not.toHaveBeenCalled();
  });
});

describe('launchWorkflowRun', async () => {
  it('routes registered default_worker stages from policy without requiring agents/<owner>.md', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'workflow-default-worker-'));
    mkdirSync(join(repoRoot, 'governance'), { recursive: true });
    writeFileSync(join(repoRoot, 'governance', 'model-routing.yaml'), `version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases: { sonnet: claude-sonnet-5 }
    known_models: [claude-sonnet-5]
  codex:
    default_worker: codex-worker
    known_models: [gpt-5.6-sol]
role_default: { runtime: claude, model: sonnet }
`);
    const calls: Array<Record<string, unknown>> = [];
    const runPy: PyRunner = (_repo, _code, jsonArg) => {
      const payload = JSON.parse(jsonArg) as Record<string, unknown>;
      calls.push(payload);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: 'wf-test-0001',
          cards: [
            { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'inbox', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
            { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
          ],
        }),
        stderr: '',
      };
    };

    const outcome = await launchWorkflowRun(request, session(), deps(runPy, {
      repoRoot,
      ownerRouting: undefined,
    }));

    expect(outcome.ok).toBe(true);
    const stages = calls[0].stages as Array<Record<string, unknown>>;
    expect(stages[0]).toMatchObject({ owner: 'codex-worker', runtime: 'codex', model: 'gpt-5.6-sol' });
    expect(stages[1]).toMatchObject({ owner: 'worker-desktop', runtime: 'claude', model: 'claude-sonnet-5' });
  });

  it('resolves routing server-side and publishes the whole DAG in one fixed subprocess', async () => {
    const calls: Array<{ code: string; payload: Record<string, unknown> }> = [];
    const runPy: PyRunner = (_repo, code, jsonArg) => {
      calls.push({ code, payload: JSON.parse(jsonArg) as Record<string, unknown> });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: 'wf-test-0001',
          cards: [
            { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'inbox', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
            { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
          ],
        }),
        stderr: '',
      };
    };

    const outcome = await launchWorkflowRun(request, session(), deps(runPy));
    expect(outcome).toEqual({
      ok: true,
      runId: 'wf-test-0001',
      cards: [
        { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'inbox', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
        { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].code).toBe(WORKFLOW_CARD_OP_SCRIPT);
    const stages = calls[0].payload.stages as Array<Record<string, unknown>>;
    expect(stages[0]).toMatchObject({ owner: 'codex-worker', runtime: 'codex', model: 'gpt-5.3-codex' });
    expect(stages[1]).toMatchObject({ owner: 'worker-desktop', runtime: 'claude', model: 'claude-sonnet-5' });
    expect(calls[0].payload).toMatchObject({ runId: 'wf-test-0001', workflowDefinitionId: 'atlas-v1' });
  });

  it('publishes dashboard-managed cards blocked with an inert exclusive-controller marker', async () => {
    let payload: Record<string, unknown> | null = null;
    const runPy: PyRunner = (_repo, code, jsonArg) => {
      payload = JSON.parse(jsonArg) as Record<string, unknown>;
      expect(code).toContain('card.meta["execution-controller"] = "dashboard"');
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: 'wf-test-0001',
          cards: [
            { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'blocked', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
            { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
          ],
        }),
        stderr: '',
      };
    };

    const outcome = await launchWorkflowRun(request, session(), deps(runPy, { publishBlocked: true }));

    expect(outcome.ok && outcome.cards.map((card) => card.state)).toEqual(['blocked', 'blocked']);
    expect(payload).toMatchObject({ managed: true });
    expect(WORKFLOW_CARD_OP_SCRIPT).toContain('if op["managed"] or card.meta["depends-on"]');
    const runnerSource = readFileSync(fileURLToPath(new URL('../../../scripts/agent_runner.ps1', import.meta.url)), 'utf8');
    expect(runnerSource).toContain('if (not card.meta.get("execution-controller")');
    const dispatchSource = readFileSync(fileURLToPath(new URL('../../../scripts/dispatch.py', import.meta.url)), 'utf8');
    expect(dispatchSource).toMatch(/deps = child\.meta\.get\("depends-on"\) or \[\][\s\S]*if not deps:[\s\S]*continue/);
  });

  it('uses immutable approved stage routing instead of a drifted owner default', async () => {
    let payload: Record<string, unknown> | null = null;
    const runPy: PyRunner = (_repo, _code, jsonArg) => {
      payload = JSON.parse(jsonArg) as Record<string, unknown>;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: 'wf-test-0001',
          cards: [
            { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'inbox', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
            { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
          ],
        }),
        stderr: '',
      };
    };

    const outcome = await launchWorkflowRun(request, session(), deps(runPy, {
      ownerRouting: () => ({ runtime: 'claude', model: 'drifted-default' }),
      stageRouting: (stage) => stage.id === 'research'
        ? { runtime: 'codex', model: 'approved-codex' }
        : { runtime: 'claude', model: 'approved-claude' },
    }));

    expect(outcome.ok).toBe(true);
    const stages = (payload as unknown as { stages: Array<Record<string, unknown>> }).stages;
    expect(stages.map((stage) => [stage.runtime, stage.model])).toEqual([
      ['codex', 'approved-codex'],
      ['claude', 'approved-claude'],
    ]);
  });

  it('rejects an owner outside the server-enumerated closed set before prepare or subprocess', async () => {
    const runPy = vi.fn();
    const prepareWrite = vi.fn();
    const bad = {
      ...request,
      stages: [{ ...request.stages[0], owner: 'ghost-agent' }],
    };
    expect(await launchWorkflowRun(bad, session(), deps(runPy as unknown as PyRunner, { prepareWrite }))).toEqual({
      ok: false,
      reason: 'owner-not-registered',
      detail: "owner 'ghost-agent' on stage 'research' is not a declared agent or registered default_worker",
    });
    expect(prepareWrite).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  // --- launch caller authentication: the WebAuthn token gate (HTTP) vs. the internal service caller (bridge) ---

  // A runPy that publishes the two-stage DAG successfully — used to prove a call reaches PAST the auth gate.
  const okDagRunPy: PyRunner = () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      runId: 'wf-test-0001',
      cards: [
        { stageId: 'research', cardId: 'wf-9b91ad52f99f63f91e0cbd97', state: 'inbox', cardPath: 'queue/inbox/wf-9b91ad52f99f63f91e0cbd97.md' },
        { stageId: 'draft', cardId: 'wf-3b727f072438eb3bf76b26bc', state: 'blocked', cardPath: 'queue/inbox/wf-3b727f072438eb3bf76b26bc.md' },
      ],
    }),
    stderr: '',
  });

  it('rejects a launch with no session token and no internal caller (the HTTP-equivalent unauthenticated path, unchanged)', async () => {
    const runPy = vi.fn(okDagRunPy);
    const outcome = await launchWorkflowRun(request, { token: undefined, config: CONFIG }, deps(runPy));
    expect(outcome).toEqual({ ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' });
    expect(runPy).not.toHaveBeenCalled();
  });

  it('rejects a launch bearing a tampered/invalid session token and no internal caller', async () => {
    const runPy = vi.fn(okDagRunPy);
    const outcome = await launchWorkflowRun(request, { token: 'not.a-valid-token', config: CONFIG }, deps(runPy));
    expect(outcome).toMatchObject({ ok: false, reason: 'unauthenticated' });
    expect(runPy).not.toHaveBeenCalled();
  });

  it('authorizes a launch by a sanctioned internal service caller with NO token (the bridge path)', async () => {
    const runPy = vi.fn(okDagRunPy);
    // The caller must be MINTED by the activation-gated constructor — its identity is an unforgeable brand,
    // not a shape. A hand-built object of the same shape is rejected (see the next two tests).
    const saved = process.env.DASHBOARD_EXECUTION_ACTIVATED;
    process.env.DASHBOARD_EXECUTION_ACTIVATED = '1';
    try {
      const caller = createInternalServiceCaller('dashboard-engine');
      const outcome = await launchWorkflowRun(
        request,
        { token: undefined, config: CONFIG, internalService: caller },
        deps(runPy),
      );
      expect(outcome.ok).toBe(true);
      expect(runPy).toHaveBeenCalledTimes(1);
    } finally {
      if (saved === undefined) delete process.env.DASHBOARD_EXECUTION_ACTIVATED;
      else process.env.DASHBOARD_EXECUTION_ACTIVATED = saved;
    }
  });

  it('does NOT accept a correctly-shaped hand-built lookalike as an internal caller (unforgeable brand)', async () => {
    const runPy = vi.fn(okDagRunPy);
    // The exact object the adversarial review flagged: right kind, right subject, but NOT minted by the
    // gated constructor. Under the WeakSet brand it is not an internal caller, so the launch falls through
    // to the token gate and is rejected — a future route that threaded body data into `internalService`
    // could no longer open a bypass.
    const outcome = await launchWorkflowRun(
      request,
      { token: undefined, config: CONFIG, internalService: { kind: 'internal-service-caller', subject: 'dashboard-engine' } as never },
      deps(runPy),
    );
    expect(outcome).toEqual({ ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' });
    expect(runPy).not.toHaveBeenCalled();
  });

  it('does NOT accept a malformed bypass object as an internal caller (strict shape, not loose truthiness)', async () => {
    const runPy = vi.fn(okDagRunPy);
    // A hostile/truthy object missing the exact discriminant must NOT bypass the token gate.
    const outcome = await launchWorkflowRun(
      request,
      { token: undefined, config: CONFIG, internalService: { kind: 'not-the-kind', subject: 'x' } as never },
      deps(runPy),
    );
    expect(outcome).toEqual({ ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' });
    expect(runPy).not.toHaveBeenCalled();
  });

  it('validation and preamble failures create no cards and do not prepare a coordination write', async () => {
    const runPy = vi.fn();
    const prepareWrite = vi.fn();
    const t3 = { ...request, stages: [{ ...request.stages[0], riskTier: 'T3' }] };
    expect(await launchWorkflowRun(t3, session(), deps(runPy as unknown as PyRunner, { prepareWrite }))).toMatchObject({
      ok: false,
      reason: 'invalid-workflow',
    });

    expect(await launchWorkflowRun(request, session(), deps(runPy as unknown as PyRunner, {
      prepareWrite,
      runPreamble: () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP present\n', stderr: '' }),
    }))).toEqual({ ok: false, reason: 'fleet-frozen', problems: ['STOP present'] });
    expect(prepareWrite).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  it('fails the run as one unit when the sole DAG subprocess fails', async () => {
    const runPy = vi.fn<PyRunner>(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'simulated second-card save failure',
    }));
    const outcome = await launchWorkflowRun(request, session(), deps(runPy));
    expect(outcome).toEqual({ ok: false, reason: 'card-op-failed', detail: 'simulated second-card save failure' });
    expect(runPy).toHaveBeenCalledTimes(1);
    // The fixed program stages every card before publication and rolls back every published destination.
    expect(WORKFLOW_CARD_OP_SCRIPT).toContain('cards.save(card, staged_root)');
    expect(WORKFLOW_CARD_OP_SCRIPT).toContain('for path in reversed(published)');
  });
});

describe('managed canonical root activation', async () => {
  it('commits and pushes the exact blocked root before rereading committed bytes, then replays idempotently', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'managed-activation-'));
    const cardRef = 'wf-9b91ad52f99f63f91e0cbd97';
    const cardPath = join(repoRoot, 'queue', 'inbox', `${cardRef}.md`);
    mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
    writeFileSync(cardPath, 'state: blocked\nexecution-controller: dashboard\n');
    const calls: string[][] = [];
    const runGit = (_root: string, args: string[]): string => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'show') return readFileSync(cardPath, 'utf8');
      return '';
    };
    let changed = true;
    const runPy: PyRunner = (_root, code, raw) => {
      expect(code).toBe(MANAGED_ROOT_ACTIVATION_SCRIPT);
      const operation = JSON.parse(raw) as { mode: 'probe' | 'apply' };
      if (operation.mode === 'apply' && changed) writeFileSync(cardPath, 'state: inbox\nexecution-controller: dashboard\n');
      const result = { exitCode: 0, stderr: '', stdout: JSON.stringify({
        cards: [{ cardRef, path: `queue/inbox/${cardRef}.md`, completed: false, changed }],
      }) };
      if (operation.mode === 'apply') changed = false;
      return result;
    };

    expect(await activateManagedRootCards({
      repoRoot, runRef: 'wf-test-0001', cardRefs: [cardRef], runGit, runPy,
      authorizeAfterPrepare: () => { calls.push(['authorize']); },
      reassertAfterReconcile: () => { calls.push(['reassert']); },
    }))
      .toEqual({ replayed: false, cardPaths: [`queue/inbox/${cardRef}.md`] });
    // No push was rejected, so the reconcile re-proof never ran: it is a retry-path proof, not a second
    // authorization of the happy path.
    expect(calls.some((args) => args[0] === 'reassert')).toBe(false);
    expect(calls.findIndex((args) => args[0] === 'authorize'))
      .toBeGreaterThan(calls.findIndex((args) => args[0] === 'pull'));
    const commit = calls.findIndex((args) => args[0] === 'commit');
    const push = calls.findIndex((args) => args[0] === 'push');
    const reread = calls.findIndex((args) => args[0] === 'show');
    expect(commit).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(commit);
    expect(reread).toBeGreaterThan(push);

    calls.length = 0;
    expect(await activateManagedRootCards({
      repoRoot, runRef: 'wf-test-0001', cardRefs: [cardRef], runGit, runPy, reassertAfterReconcile: () => {},
    }))
      .toEqual({ replayed: true, cardPaths: [`queue/inbox/${cardRef}.md`] });
    expect(calls.some((args) => args[0] === 'commit')).toBe(false);
    expect(calls.findIndex((args) => args[0] === 'show')).toBeGreaterThan(calls.findIndex((args) => args[0] === 'push'));
  });

  it('requires remote proof for a terminal root and leaves its canonical done path untouched', async () => {
    const cardRef = 'wf-9b91ad52f99f63f91e0cbd97';
    const repoRoot = mkdtempSync(join(tmpdir(), 'managed-terminal-root-'));
    const donePath = join(repoRoot, 'queue', 'done', `${cardRef}.md`);
    mkdirSync(join(repoRoot, 'queue', 'done'), { recursive: true });
    writeFileSync(donePath, 'state: done\nexecution-controller: dashboard\n');
    const seen: string[] = [];
    const runGit = (_root: string, args: string[]): string => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'show') return 'state: done\nexecution-controller: dashboard\n';
      seen.push(args[0]);
      return '';
    };
    const runPy: PyRunner = (_root, _code, _raw) => {
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({
        cards: [{ cardRef, path: `queue/done/${cardRef}.md`, completed: true, changed: false }],
      }) };
    };
    const verifyCompletedRoots = vi.fn(async () => {});
    await expect(activateManagedRootCards({
      repoRoot, runRef: 'wf-test-0001', cardRefs: [cardRef], runGit, runPy, verifyCompletedRoots,
      reassertAfterReconcile: () => {},
    })).resolves.toEqual({ replayed: true, cardPaths: [`queue/done/${cardRef}.md`] });
    expect(verifyCompletedRoots).toHaveBeenCalledWith({ runRef: 'wf-test-0001', cardRefs: [cardRef] });
    expect(seen).not.toContain('commit');
  });

  it('fails closed when a proved terminal root changes before apply', async () => {
    const cardRef = 'wf-9b91ad52f99f63f91e0cbd97';
    let calls = 0;
    const runPy: PyRunner = (_root, _code, _raw) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({
      cards: [{ cardRef, path: calls++ === 0 ? `queue/done/${cardRef}.md` : `queue/inbox/${cardRef}.md`, completed: calls === 1, changed: false }],
    }) });
    await expect(activateManagedRootCards({
      repoRoot: '/repo', runRef: 'wf-test-0001', cardRefs: [cardRef], runGit: (_root, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '', runPy,
      verifyCompletedRoots: async () => {}, reassertAfterReconcile: () => {},
    })).rejects.toThrow('completion state changed');
  });

  it('refuses a dirty index before card mutation', async () => {
    const runPy = vi.fn<PyRunner>();
    const runGit = (_root: string, args: string[]): string => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'diff') return 'queue/inbox/residue.md\0';
      return '';
    };
    await expect(activateManagedRootCards({
      repoRoot: '/repo', runRef: 'wf-test-0001', cardRefs: ['wf-9b91ad52f99f63f91e0cbd97'], runGit, runPy,
      reassertAfterReconcile: () => {},
    })).rejects.toThrow(/dirty index/);
    expect(runPy).not.toHaveBeenCalled();
  });

  /**
   * F3 — the reconcile re-proof is REQUIRED, not optional. The publication below reconciles and retries a
   * lost push race; a caller that forgot the re-proof would publish an activation under a canonical head
   * nothing authorized. Refusing at entry makes that structurally impossible instead of relying on every
   * caller to remember.
   */
  it('refuses at entry when no reconcile re-proof is supplied, before touching git or python', async () => {
    const runPy = vi.fn<PyRunner>();
    const runGit = vi.fn((_root: string, _args: string[]) => 'ops\n');
    await expect(activateManagedRootCards({
      repoRoot: '/repo', runRef: 'wf-test-0001', cardRefs: ['wf-9b91ad52f99f63f91e0cbd97'], runGit, runPy,
      authorizeAfterPrepare: () => {},
    })).rejects.toThrow(/requires a reassertAfterReconcile re-proof/);
    expect(runGit).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  /**
   * F1 — a lost push race must re-run the PURE re-proof, never the side-effecting authorization. The
   * activation's `authorizeAfterPrepare` emits a T3 `control-run-activate-authorize` audit row (with its
   * own nested commit+push) and takes the activation claim; running it per reconcile would produce three
   * authorize rows and three claims for ONE authorization.
   */
  it('re-proves purely on every reconcile while authorizing exactly once across two lost push races', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'managed-activation-race-'));
    const cardRef = 'wf-9b91ad52f99f63f91e0cbd97';
    const cardPath = join(repoRoot, 'queue', 'inbox', `${cardRef}.md`);
    mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
    writeFileSync(cardPath, 'state: blocked\nexecution-controller: dashboard\n');
    const order: string[] = [];
    let pushes = 0;
    const runGit = (_root: string, args: string[]): string => {
      order.push(args.join(' '));
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'show') return readFileSync(cardPath, 'utf8');
      if (args[0] === 'push' && pushes++ < 2) {
        const stderr = ' ! [rejected]        ops -> ops (non-fast-forward)';
        throw Object.assign(new Error(`git push exited with code 1: ${stderr}`), { status: 1, stdout: '', stderr });
      }
      return '';
    };
    const runPy: PyRunner = (_root, _code, raw) => {
      const operation = JSON.parse(raw) as { mode: 'probe' | 'apply' };
      if (operation.mode === 'apply') writeFileSync(cardPath, 'state: inbox\nexecution-controller: dashboard\n');
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({
        cards: [{ cardRef, path: `queue/inbox/${cardRef}.md`, completed: false, changed: true }],
      }) };
    };
    const authorizeAfterPrepare = vi.fn(() => { order.push('AUTHORIZE(audit row + claim)'); });
    const reassertAfterReconcile = vi.fn(() => { order.push('reassert'); });

    await expect(activateManagedRootCards({
      repoRoot, runRef: 'wf-test-0001', cardRefs: [cardRef], runGit, runPy,
      authorizeAfterPrepare, reassertAfterReconcile,
    })).resolves.toEqual({ replayed: false, cardPaths: [`queue/inbox/${cardRef}.md`] });

    // ONE authorize for one act, however many races were lost; one pure re-proof per reconcile.
    expect(authorizeAfterPrepare).toHaveBeenCalledTimes(1);
    expect(reassertAfterReconcile).toHaveBeenCalledTimes(2);
    // ...and the authorization happened once, BEFORE the first push, never between retries.
    expect(order.filter((step) => step.startsWith('AUTHORIZE'))).toHaveLength(1);
    const firstPush = order.indexOf('push origin ops');
    expect(order.indexOf('AUTHORIZE(audit row + claim)')).toBeLessThan(firstPush);
    expect(order.slice(firstPush)).toEqual([
      'push origin ops', 'rev-parse --abbrev-ref HEAD', 'pull --rebase origin ops', 'reassert',
      'push origin ops', 'rev-parse --abbrev-ref HEAD', 'pull --rebase origin ops', 'reassert',
      'push origin ops', `show HEAD:queue/inbox/${cardRef}.md`,
    ]);
  });

  /**
   * F2 — the idempotent-replay branch pushes without creating a commit. Its reconcile still PULLS, and a
   * `pull --rebase` on a checkout that is no longer `ops` rebases an unrelated HEAD and can leave this
   * shared checkout mid-rebase (the 2026-07-30 jam class). The checkout guard must precede that pull.
   */
  it('guards the checkout before the replay branch reconciles a rejected push', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'managed-replay-race-'));
    const cardRef = 'wf-9b91ad52f99f63f91e0cbd97';
    const cardPath = join(repoRoot, 'queue', 'inbox', `${cardRef}.md`);
    mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
    writeFileSync(cardPath, 'state: inbox\nexecution-controller: dashboard\n');
    const order: string[] = [];
    let pushes = 0;
    const runGit = (_root: string, args: string[]): string => {
      order.push(args.join(' '));
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'show') return readFileSync(cardPath, 'utf8');
      if (args[0] === 'push' && pushes++ === 0) {
        const stderr = 'hint: Updates were rejected because the tip of your current branch is behind';
        throw Object.assign(new Error(`git push exited with code 1: ${stderr}`), { status: 1, stdout: '', stderr });
      }
      return '';
    };
    // `changed: false` everywhere — the replay branch, which commits nothing.
    const runPy: PyRunner = () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({
      cards: [{ cardRef, path: `queue/inbox/${cardRef}.md`, completed: false, changed: false }],
    }) });
    const reassertAfterReconcile = vi.fn(() => { order.push('reassert'); });

    await expect(activateManagedRootCards({
      repoRoot, runRef: 'wf-test-0001', cardRefs: [cardRef], runGit, runPy, reassertAfterReconcile,
    })).resolves.toEqual({ replayed: true, cardPaths: [`queue/inbox/${cardRef}.md`] });

    expect(order.some((step) => step === 'commit')).toBe(false);
    const firstPush = order.indexOf('push origin ops');
    expect(order.slice(firstPush)).toEqual([
      'push origin ops',
      // The guard, THEN the pull — never a pull onto an unproven checkout.
      'rev-parse --abbrev-ref HEAD', 'pull --rebase origin ops', 'reassert',
      'push origin ops', `show HEAD:queue/inbox/${cardRef}.md`,
    ]);
    expect(reassertAfterReconcile).toHaveBeenCalledTimes(1);
  });
});
