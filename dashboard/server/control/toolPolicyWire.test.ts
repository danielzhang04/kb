/**
 * IR-1 regression suite — the workflow profile -> `--allowedTools` wire.
 *
 * Before 2026-07-20 this chain was severed in two places: `PlanProposal` had no `profile` field (the
 * workflow's profile fed only `deriveProposalId`'s hash preimage and was then dropped), and
 * `resolveToolPolicy` took an `ExecutionProfile` — a routing type with no tool fields — and had no
 * production caller. A run therefore spawned with NO `--allowedTools` flag at all. These tests assert
 * on the actual argv the adapter builds, and that an unresolvable profile refuses instead of spawning.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createClaudeWorkerAdapter,
  createWorkflowToolPolicyResolver,
  ToolPolicyRefusal,
  type ClaudeSpawnRequest,
} from './claudeWorkerAdapter.ts';
import { FORBIDDEN_WORKFLOW_TOOLS } from './environment.ts';
import {
  PLAN_PROPOSAL_SCHEMA,
  proposalContentHash,
  validatePlanProposal,
  type PlanProposal,
  type ProposalRegistry,
} from './proposal.ts';
import type { ExecutionProfile } from './policy.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import type { WorkflowDef } from '../workflows/defs.ts';

const WORKER_PROFILE: ExecutionProfile = {
  id: 'worker:claude:claude-sonnet',
  role: 'worker',
  runtime: 'claude',
  model: 'claude-sonnet',
  capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
};

const REGISTRY: ProposalRegistry = {
  runtimes: { claude: ['claude-opus', 'claude-sonnet'] },
  skills: [],
  workflowProfiles: ['research', 'gmail-triage', 'drive-author', 'producer'],
};

/** A minimal valid proposal. `profile` is added per-test so the profile-less shape stays exercised. */
function proposalFixture(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: PLAN_PROPOSAL_SCHEMA,
    proposalId: 'wf-fixture-1',
    project: 'kb-ops',
    title: 'Triage the inbox',
    summary: 'Triage.',
    manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
    scope: { read: ['orgs/kb-ops'], write: ['orgs/kb-ops/output'] },
    governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
    stages: [{
      id: 'triage',
      title: 'Triage',
      action: 'research:triage',
      target: 'orgs/kb-ops/output',
      workOrder: 'Triage the inbox.',
      riskTier: 'T2',
      dependsOn: [],
      worker: { runtime: 'claude', model: 'claude-sonnet' },
      requiredSkills: [],
      scope: { read: ['orgs/kb-ops'], write: ['orgs/kb-ops/output'] },
      artifacts: [],
      checkpoints: [],
      humanGates: [],
    }],
    ...extra,
  };
}

function executeInput(workflowProfile: string | null) {
  return {
    operationKey: 'automatic-attempt:attempt-1',
    subject: 'kb-ops',
    runRef: 'run-1',
    stageRef: 'stage-1',
    attemptRef: 'attempt-1',
    sessionRef: 'session-1',
    worktreePath: '/srv/worktrees/run-1/attempt-1',
    profile: WORKER_PROFILE,
    workflowProfile,
    skills: [] as readonly string[],
    action: 'research:triage',
    target: 'orgs/kb-ops/output',
    workOrder: 'Triage the inbox.',
    readScope: ['orgs/kb-ops'] as readonly string[],
    writeScope: ['orgs/kb-ops/output'] as readonly string[],
    checkpoints: [] as readonly string[],
  };
}

describe('PlanProposal.profile carries the workflow profile as data', () => {
  it('admits a declared server-owned profile and surfaces it on the validated value', () => {
    const parsed = validatePlanProposal(proposalFixture({ profile: 'gmail-triage' }), REGISTRY);
    expect(parsed.ok).toBe(true);
    expect((parsed as { ok: true; value: PlanProposal }).value.profile).toBe('gmail-triage');
  });

  it('refuses a profile that is not in the server-owned closed set', () => {
    const parsed = validatePlanProposal(proposalFixture({ profile: 'anything-goes' }), REGISTRY);
    expect(parsed.ok).toBe(false);
    expect((parsed as { ok: false; detail: string }).detail).toContain('not a server-owned workflow execution profile');
  });

  it('refuses a declared profile when the registry publishes no profile list (absent list admits nothing)', () => {
    const parsed = validatePlanProposal(proposalFixture({ profile: 'gmail-triage' }), { runtimes: REGISTRY.runtimes, skills: [] });
    expect(parsed.ok).toBe(false);
  });

  it('still admits a proposal that declares no profile, and does not materialise the key', () => {
    const parsed = validatePlanProposal(proposalFixture(), REGISTRY);
    expect(parsed.ok).toBe(true);
    const value = (parsed as { ok: true; value: PlanProposal }).value;
    expect(value.profile).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(value, 'profile')).toBe(false);
  });
});

describe('proposal identity and hashing are unchanged by the new field', () => {
  /**
   * A definition fixture that predates this change. `deriveProposalId` (workflows/compile.ts) already
   * had `profile` in its hash preimage, so adding the field as DATA must not move the id — a changed id
   * would orphan every stored proposal. These are the literal pre-change outputs.
   */
  const DEF: WorkflowDef = {
    id: 'email-triage',
    project: 'kb-ops',
    title: 'Email triage',
    profile: 'gmail-triage',
    // No declared readScope: the effective scope is exactly [orgs/kb-ops], the pre-Layer-A behaviour.
    readScope: [],
    description: 'Triage the inbox into four tiers.',
    stages: [{
      id: 'triage',
      title: 'Triage',
      action: 'research:triage',
      target: 'orgs/kb-ops/output',
      workOrder: 'Triage the inbox.',
      riskTier: 'T2',
      dependsOn: [],
      // Not part of the id preimage — recorded here only to satisfy WorkflowStageDef.
      declaredRiskTier: 'T2',
      classifiedFloor: 'T2',
    }],
  };

  it('deriveProposalId is stable and covers the effective read scope (Layer A re-anchor)', () => {
    const compiled = compileWorkflowDef(DEF, { registry: {
      runtimes: { claude: ['claude-opus', 'claude-sonnet'] },
      skills: [],
      repositories: {
        forProject() { throw new Error('project is not registered'); },
        resolve() { throw new Error('repository binding identity is stale or unknown'); },
      },
    } });
    expect(compiled.ok).toBe(true);
    // Layer A (2026-07-21) deliberately added the effective read scope to deriveProposalId's preimage so
    // a changed read scope forces re-approval (docs/specs/2026-07-21-worker-read-scope-design.md §4.2).
    // That is a ONE-TIME identity re-anchor of every proposal; the value below is the new stable id for
    // this fixture (effective read scope = [orgs/kb-ops]). It must stay byte-pinned from here on.
    expect((compiled as { ok: true; value: PlanProposal }).value.proposalId)
      .toBe('wf-b3e84d195edda5aa7aa5fcb94381c5ef4e6a462dfc74e840');
  });

  it('the content hash of a profile-less proposal is unchanged', () => {
    const parsed = validatePlanProposal(proposalFixture(), REGISTRY);
    const value = (parsed as { ok: true; value: PlanProposal }).value;
    // Recorded from the pre-change implementation for this exact fixture.
    expect(proposalContentHash(value)).toBe('b6c77a00e80f585668aa9c0ebe44c7ff18fd5bdc314238e33e4500923fa89721');
  });

  it('declaring a profile changes the content hash (it is real data, not decoration)', () => {
    const bare = validatePlanProposal(proposalFixture(), REGISTRY) as { ok: true; value: PlanProposal };
    const withProfile = validatePlanProposal(proposalFixture({ profile: 'gmail-triage' }), REGISTRY) as { ok: true; value: PlanProposal };
    expect(proposalContentHash(withProfile.value)).not.toBe(proposalContentHash(bare.value));
  });
});

describe('createWorkflowToolPolicyResolver — the production resolver', () => {
  it('resolves gmail-triage to its server-owned allowlist', () => {
    const policy = createWorkflowToolPolicyResolver()('gmail-triage');
    expect(policy.allowedTools).toContain('mcp__google-workspace__draft_gmail_message');
    for (const forbidden of FORBIDDEN_WORKFLOW_TOOLS) expect(policy.allowedTools).not.toContain(forbidden);
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['unknown', 'anything-goes'],
  ])('refuses a %s profile id', (_label, id) => {
    expect(() => createWorkflowToolPolicyResolver()(id as string | null)).toThrow(ToolPolicyRefusal);
  });

  it('refuses a profile whose allowlist is empty rather than returning one', () => {
    const resolve = createWorkflowToolPolicyResolver({ profiles: [{ id: 'hollow', allowedTools: [] }] });
    expect(() => resolve('hollow')).toThrow(ToolPolicyRefusal);
  });

  it('refuses a profile that names a forbidden publish/send tool', () => {
    const resolve = createWorkflowToolPolicyResolver({
      profiles: [{ id: 'sneaky', allowedTools: ['Read', FORBIDDEN_WORKFLOW_TOOLS[0]] }],
    });
    expect(() => resolve('sneaky')).toThrow(ToolPolicyRefusal);
  });
});

describe('the end-to-end wire: proposal profile -> spawned argv', () => {
  it('a gmail-triage proposal produces the expected --allowedTools argv', async () => {
    const parsed = validatePlanProposal(proposalFixture({ profile: 'gmail-triage' }), REGISTRY) as { ok: true; value: PlanProposal };
    let captured: ClaudeSpawnRequest | null = null;
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: createWorkflowToolPolicyResolver(),
      spawn: (request) => {
        captured = request;
        return {
          onStdout(cb) { setTimeout(() => cb(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: {}, total_cost_usd: 0 })}\n`), 0); },
          onStderr() {},
          onExit(cb) { setTimeout(() => cb(0), 1); },
          writeStdin() {},
          endStdin() {},
          kill() {},
        };
      },
    });

    // The engine passes `proposal.profile ?? null` (execution.ts) — mirrored here exactly.
    await adapter.execute(executeInput(parsed.value.profile ?? null));

    const args = captured!.args;
    const index = args.indexOf('--allowedTools');
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe(
      'mcp__google-workspace__search_gmail_messages,'
      + 'mcp__google-workspace__get_gmail_message_content,'
      + 'mcp__google-workspace__list_gmail_labels,'
      + 'mcp__google-workspace__modify_gmail_message_labels,'
      + 'mcp__google-workspace__draft_gmail_message,'
      + 'Read,Write',
    );
    expect(args.slice(-2)).toEqual(['--permission-mode', 'default']);
  });

  it.each([
    ['a proposal that declares no profile', null],
    ['an unresolvable profile', 'anything-goes'],
  ])('REFUSES to spawn for %s', (_label, workflowProfile) => {
    const spawn = vi.fn();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: createWorkflowToolPolicyResolver(),
      spawn,
    });
    expect(() => adapter.execute(executeInput(workflowProfile))).toThrow(ToolPolicyRefusal);
    // The load-bearing assertion: no child process was ever created, capped or otherwise.
    expect(spawn).not.toHaveBeenCalled();
  });

  it('REFUSES even when an injected resolver returns an empty allowlist', () => {
    const spawn = vi.fn();
    const adapter = createClaudeWorkerAdapter({
      resolveToolPolicy: () => ({ allowedTools: [], permissionMode: 'default' }),
      spawn,
    });
    expect(() => adapter.execute(executeInput('research'))).toThrow(ToolPolicyRefusal);
    expect(spawn).not.toHaveBeenCalled();
  });
});
