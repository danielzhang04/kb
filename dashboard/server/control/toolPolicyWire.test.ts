import { describe, expect, it } from 'vitest';
import {
  createAttemptToolPolicyIdResolver,
  createWorkflowToolPolicyResolver,
  ToolPolicyRefusal,
} from './claudeLaunchPolicy.ts';
import { createAttemptSessionAdapter } from './attemptSessionAdapter.ts';
import { mapWindowsLaunchRecipe } from '../pty/launcherProfiles.ts';
import type { ExecutionProfile } from './policy.ts';
import type { ProposalStage } from './proposal.ts';
import type {
  ApprovedAttemptDeclaration,
  AttemptBinding,
  AttemptBindingPort,
  AttemptOperationRecord,
  HostStartReceipt,
  ObservedExit,
  PortResult,
  PtyCapabilityProbe,
  SessionHost,
  SessionHostRequest,
  SessionSink,
} from '../pty/contracts.ts';

/**
 * THE END-TO-END TOOL-POLICY WIRE: proposal profile -> the policy the dashboard resolves -> the
 * `toolPolicyId` NAME the declaration carries -> the broker recipe table entry that name selects ->
 * the argv the child is actually launched with.
 *
 * The declaration may carry no argv ([C-S2]), so the tool cap survives that hop ONLY as a name the
 * broker re-resolves on its own side. That makes the two resolvers a distributed invariant with no
 * single owner, and the whole point of this suite is that the PRODUCTION wiring — the very
 * `resolveClaudePolicyId` `activation.ts` installs, not a resolver written for a test — is what closes
 * it. A wiring that computes a policy and then discards it (the W6.5 regression) fails here.
 */

const PROFILES = [
  { id: 'research', allowedTools: ['Read', 'Grep', 'Glob'] },
  { id: 'implementation', allowedTools: ['Read', 'Edit', 'Write'] },
];

const WINDOWS_ENVIRONMENT = {
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\service',
  APPDATA: 'C:\\Users\\service\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
  TEMP: 'C:\\Temp',
  PATH: 'ignored',
};

const PROFILE: ExecutionProfile & { runtime: 'claude' } = {
  id: 'claude-worker', role: 'worker', runtime: 'claude', model: 'claude-sonnet',
  capabilities: ['read', 'write-approved-scope', 'emit-events'],
};

function stage(workflowProfile: string): ProposalStage {
  return {
    id: 'review-stage', title: 'Review stage', action: 'review:code', target: 'dashboard/server/control',
    workOrder: 'Review the adapter.', riskTier: 'T1', dependsOn: [],
    worker: { runtime: 'claude', model: 'claude-sonnet' },
    requiredSkills: ['code-review'], scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
    artifacts: [{ id: 'review-report', path: 'dashboard/review.md', description: 'Review result.' }],
    checkpoints: [{ id: 'tests-green', label: 'Focused tests pass.' }], humanGates: [], workflowProfile,
  };
}

function declaration(workflowProfile: string): ApprovedAttemptDeclaration {
  return {
    operationKey: `op-${'a'.repeat(64)}`,
    subject: 'operator@example.test', runRef: 'run-11111111-1111-4111-8111-111111111111',
    stageRef: 'stage-22222222-2222-4222-8222-222222222222',
    attemptRef: 'attempt-33333333-3333-4333-8333-333333333333',
    sessionRef: 'session-55555555-5555-4555-8555-555555555555',
    rootId: 'worktrees', relativeCwd: 'agent-one', cols: 120, rows: 40,
    profile: PROFILE, workflowProfile, skills: ['code-review'],
    action: 'review:code', target: 'dashboard/server/control', workOrder: 'Review the adapter.',
    readScope: ['dashboard'], writeScope: ['dashboard/server/control'],
    checkpoints: ['tests-green'], proposalStage: stage(workflowProfile), project: 'dashboard-v3',
    expectsIterationOutcome: false,
  } as ApprovedAttemptDeclaration;
}

/** Records the request the port hands the host; the receipt never resolves — the recipe is the subject. */
function recordingHost(): { host: SessionHost; requests: SessionHostRequest[] } {
  const requests: SessionHostRequest[] = [];
  const host: SessionHost = {
    async probe(): Promise<PtyCapabilityProbe> {
      return {
        available: true, host: 'desktop', transport: 'local-node-pty', launchers: ['claude'],
        roots: ['worktrees'], epochId: 'epoch-11111111111111111111111111111111',
        checkedAt: '2026-08-23T00:00:00.000Z',
      };
    },
    create(request: SessionHostRequest, _sink: SessionSink) {
      requests.push(request);
      return {
        receipt: new Promise<PortResult<HostStartReceipt>>(() => {}),
        exit: new Promise<ObservedExit>(() => {}),
      };
    },
    async attach() { return { ok: true as const, value: { attachmentId: 'att-1' } }; },
    async write() { return { ok: true as const, value: { accepted: 0 } }; },
    async resize() { return { ok: true as const, value: undefined }; },
    async close() { return { ok: false as const, refusal: 'not-found' as const, detail: null }; },
    async listEpochs() { return []; },
    async drainEpoch() { return { ok: true as const, value: undefined }; },
  } as unknown as SessionHost;
  return { host, requests };
}

function noBindings(): AttemptBindingPort {
  return {
    async bind() { return { ok: true as const, value: { revision: 1 } }; },
    async readOperation(): Promise<AttemptOperationRecord | null> { return null; },
    async writeOperation(record: AttemptOperationRecord) { return { ok: true as const, value: record }; },
    byRun(): readonly AttemptBinding[] { return []; },
    bySession() { return null; },
  } as unknown as AttemptBindingPort;
}

describe('the end-to-end wire: proposal profile -> resolved policy -> recipe table entry', () => {
  it('names a recipe-table entry that reproduces the policy the dashboard resolved', async () => {
    const resolveClaudePolicy = createWorkflowToolPolicyResolver({ profiles: PROFILES });
    const { host, requests } = recordingHost();
    const adapter = createAttemptSessionAdapter({
      host,
      bindings: noBindings(),
      resolveClaudePolicy,
      // The PRODUCTION wiring, byte-for-byte as `activation.ts` installs it.
      resolveClaudePolicyId: createAttemptToolPolicyIdResolver(
        createWorkflowToolPolicyResolver({ profiles: PROFILES }),
      ),
      repoRoot: 'C:/kb',
    });

    adapter.begin(declaration('implementation'));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(requests).toHaveLength(1);
    const { recipe } = requests[0];
    // The declaration carries a NAME, never argv.
    expect(recipe.toolPolicyId).toBe('implementation');
    expect(Object.keys(recipe)).not.toContain('args');

    // The broker's recipe table, resolving that same name on its own side.
    const launch = mapWindowsLaunchRecipe(requests[0], {
      environment: WINDOWS_ENVIRONMENT,
      rootPath: 'C:\\worktrees',
      claudeProfiles: PROFILES,
      claudeScopes: { implementation: { readScope: ['dashboard'], writeScope: ['dashboard/server/control'] } },
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const allowedTools = launch.value.args[launch.value.args.indexOf('--allowedTools') + 1];
    expect(allowedTools).toBe('Read,Edit,Write');
    expect(launch.value.args).toContain('--permission-mode');
    // The proposal's OTHER profile is a different cap, so the join is real and not a coincidence.
    expect(allowedTools).not.toBe(PROFILES[0].allowedTools.join(','));
  });

  it('refuses a policy id the recipe table would not reproduce', () => {
    const resolveId = createAttemptToolPolicyIdResolver(
      createWorkflowToolPolicyResolver({ profiles: PROFILES }),
    );
    expect(resolveId({
      workflowProfile: 'implementation',
      policy: { allowedTools: ['Read', 'Edit', 'Write'], permissionMode: 'default' },
    })).toBe('implementation');
    // A dashboard-side cap the table does not reproduce would launch the worker uncapped-by-surprise.
    expect(() => resolveId({
      workflowProfile: 'implementation',
      policy: { allowedTools: ['Read', 'Edit', 'Write', 'Bash'], permissionMode: 'default' },
    })).toThrow(ToolPolicyRefusal);
    expect(() => resolveId({
      workflowProfile: 'implementation',
      policy: { allowedTools: ['Read', 'Edit', 'Write'], permissionMode: 'acceptEdits' },
    })).toThrow(ToolPolicyRefusal);
  });
});
