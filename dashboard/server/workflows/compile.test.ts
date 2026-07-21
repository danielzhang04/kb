import { describe, expect, it } from 'vitest';
import { parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';
import { canonicalProposal, validatePlanProposal, validateServerCompiledPlanProposal } from '../control/proposal.ts';
import type { RuntimeSkillRegistry } from '../control/environment.ts';
import type { ExecutionProfile } from '../control/policy.ts';
import type { DeclaredAgentDetail } from '../agents/roster.ts';

const REGISTRY: RuntimeSkillRegistry = {
  runtimes: {
    claude: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    codex: ['gpt-5.6-sol'],
  },
  skills: [],
  // The proposal validator fails CLOSED on `profile`: an absent or empty list admits nothing, so a
  // registry without this field refuses every compiled proposal. The fixture must publish the same
  // closed set the def parser validates against.
  workflowProfiles: ['research', 'gmail-triage', 'drive-author', 'producer', 'checker-readonly'],
};

// Derived, not restated — the def parser and the proposal validator must agree on the closed set,
// and a second literal is exactly where the two would silently drift apart.
const KNOWN = new Set(REGISTRY.workflowProfiles);

function def(frontmatter: string, body = 'Do the thing carefully.'): WorkflowDef {
  const parsed = parseWorkflowDef(`---\n${frontmatter}\n---\n\n${body}\n`, { knownProfiles: KNOWN });
  if (!parsed.ok) throw new Error(`fixture invalid: ${parsed.detail}`);
  return parsed.value;
}

const SINGLE = def([
  'id: research-brief',
  'project: kb-ops',
  'title: Research brief',
  'profile: research',
  'stages:',
  '  - id: brief',
  '    title: Research a topic',
  '    action: research:web-brief',
  '    target: orgs/kb-ops/output',
  '    riskTier: T2',
].join('\n'));

const PROFILES: ExecutionProfile[] = [
  { id: 'manager:claude:claude-opus-4-8', role: 'manager', runtime: 'claude', model: 'claude-opus-4-8', capabilities: ['read', 'emit-events'] },
  { id: 'manager:claude:claude-sonnet-5', role: 'manager', runtime: 'claude', model: 'claude-sonnet-5', capabilities: ['read', 'emit-events'] },
  { id: 'worker:codex:gpt-5.6-sol', role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
  { id: 'worker:claude:claude-sonnet-5', role: 'worker', runtime: 'claude', model: 'claude-sonnet-5', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
];

function declared(
  id: string,
  defaultProfile: string,
  allowedProfiles: string[],
  runtime: 'claude' | 'codex',
  model: string,
): DeclaredAgentDetail {
  return {
    id, role: null, runtime, model, defaultProfile, allowedProfiles, runnerBound: true, description: null,
    projects: ['kb-ops'], source: `agents/${id}.md`, instructionMarkdown: '',
    sourceHash: id === 'fyt-runner' ? 'a'.repeat(64) : 'b'.repeat(64), codebasePaths: [], workflowPaths: [],
  };
}

function bindingEnvironment(overrides: Partial<Parameters<typeof compileWorkflowDef>[1]> = {}) {
  return {
    registry: REGISTRY,
    declaredAgents: new Map<string, DeclaredAgentDetail>([
      ['fyt-runner', declared('fyt-runner', 'manager:claude:claude-opus-4-8', ['manager:claude:claude-opus-4-8', 'manager:claude:claude-sonnet-5'], 'claude', 'claude-opus-4-8')],
      ['fyt-production', declared('fyt-production', 'worker:codex:gpt-5.6-sol', ['worker:codex:gpt-5.6-sol', 'worker:claude:claude-sonnet-5'], 'codex', 'gpt-5.6-sol')],
    ]),
    executionProfiles: PROFILES,
    availableRuntimes: new Set<'claude' | 'codex'>(['claude', 'codex']),
    ...overrides,
  };
}

const ASSIGNED = def([
  'id: assigned-research', 'project: kb-ops', 'title: Assigned research', 'profile: research',
  'manager:', '  agentId: fyt-runner', '  profileId: manager:claude:claude-opus-4-8',
  'stages:',
  '  - id: brief', '    title: Research a topic', '    action: research:web-brief', '    target: orgs/kb-ops/output', '    riskTier: T2',
  '    agentId: fyt-production', '    profileId: worker:claude:claude-sonnet-5',
].join('\n'));

const CHECKER = def([
  'id: checker', 'project: kb-ops', 'title: Checker', 'profile: research',
  'stages:',
  '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
  '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
  '    agentId: fyt-production', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly',
  '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1', '      criteria:', '        - id: safety', '          description: No unsafe changes',
  '    completionGate:', '      id: checker-approval', '      kind: approval', '      prompt: Approve checker result?', '      requiresReview: pass',
].join('\n'));

describe('compileWorkflowDef', () => {
  it('compiles to a proposal that passes the real proposal validator (round-trip)', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const validated = validatePlanProposal(compiled.value as unknown, REGISTRY);
    expect(validated.ok).toBe(true);
  });

  // `compile.ts:121` copies `profile: def.profile` onto the compiled proposal. That single line is the
  // entire payload of commit 1dde89a, and deleting it left the whole suite green: without it the
  // declared profile reaches deriveProposalId's hash preimage and NOTHING else, so the worker spawns
  // with no --allowedTools — a capability cap that reads as enforced while capping nothing. The
  // preimage copy is well defended (the byte-pinned id in toolPolicyWire.test.ts catches its removal);
  // the DATA copy was not defended at all. These assertions are on the compiled proposal, deliberately,
  // because an assertion on the PARSED definition passes identically with the production line deleted.
  it('carries the declared profile onto the compiled proposal as data, not only into the id hash', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.profile).toBe('research');
    // The definition and the proposal must agree; asserting only the definition proves nothing here.
    expect(compiled.value.profile).toBe(SINGLE.profile);
    // And it must survive the real validator, which is what the worker adapter ultimately reads.
    const validated = validatePlanProposal(compiled.value as unknown, REGISTRY);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.profile).toBe('research');
  });

  it('derives a stable, deterministic proposalId from definition content', () => {
    const a = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    const b = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.proposalId).toBe(b.value.proposalId);
    expect(a.value.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
  });

  it('keeps legacy compiled values and canonical bytes unchanged when no assignment is authored', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.proposalId).toBe('wf-78d8c202e12f24dae7dde78ccec42caa14edfe6013b79563');
    expect(compiled.value.manager).not.toHaveProperty('assignment');
    expect(compiled.value.stages[0]).not.toHaveProperty('assignment');
    expect(canonicalProposal(compiled.value)).toContain('"proposalId":"wf-78d8c202e12f24dae7dde78ccec42caa14edfe6013b79563"');
  });

  it('resolves manager and stage assignments into immutable snapshots and routes from the selected profiles', () => {
    const compiled = compileWorkflowDef(ASSIGNED, bindingEnvironment());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.manager).toMatchObject({ runtime: 'claude', model: 'claude-opus-4-8', assignment: {
      agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager:claude:claude-opus-4-8',
    } });
    // fyt-production defaults to Codex, but this allowed selected worker profile deliberately switches it
    // to Claude. The profile, not the agent id/default, supplies proposal routing.
    expect(compiled.value.stages[0]).toMatchObject({ worker: { runtime: 'claude', model: 'claude-sonnet-5' }, assignment: {
      agentId: 'fyt-production', profileId: 'worker:claude:claude-sonnet-5', runtime: 'claude', model: 'claude-sonnet-5',
    } });
    expect(validatePlanProposal(compiled.value, REGISTRY)).toMatchObject({ ok: false });
    expect(validateServerCompiledPlanProposal(compiled.value, REGISTRY)).toMatchObject({ ok: true });
    const differentSelectedProfile = compileWorkflowDef({
      ...ASSIGNED,
      stages: [{ ...ASSIGNED.stages[0], profileId: 'worker:codex:gpt-5.6-sol' }],
    }, bindingEnvironment());
    expect(differentSelectedProfile.ok).toBe(true);
    if (!differentSelectedProfile.ok) return;
    expect(differentSelectedProfile.value.proposalId).not.toBe(compiled.value.proposalId);
  });

  it('compiles checker metadata into compiler-only proposal fields and includes it in proposal identity', () => {
    const compiled = compileWorkflowDef(CHECKER, bindingEnvironment());
    expect(compiled).toMatchObject({ ok: true, value: { stages: [
      {}, {
        workflowProfile: 'checker-readonly',
        review: { subjectStageId: 'create', maxCreatorReworks: 1, criteria: [{ id: 'safety' }] },
        completionGate: { id: 'checker-approval', kind: 'approval', requiresReview: 'pass' },
      },
    ] } });
    if (!compiled.ok) return;
    expect(validatePlanProposal(compiled.value, REGISTRY)).toMatchObject({ ok: false });
    expect(validateServerCompiledPlanProposal(compiled.value, REGISTRY)).toMatchObject({ ok: true });
    const changed = compileWorkflowDef({
      ...CHECKER,
      stages: [CHECKER.stages[0], { ...CHECKER.stages[1], review: { ...CHECKER.stages[1].review!, maxCreatorReworks: 2 } }],
    }, bindingEnvironment());
    expect(changed.ok && changed.value.proposalId).not.toBe(compiled.value.proposalId);
  });

  it('refuses a checker workflow profile missing from the compile registry', () => {
    expect(compileWorkflowDef(CHECKER, bindingEnvironment({ registry: { ...REGISTRY, workflowProfiles: ['research'] } })))
      .toMatchObject({ ok: false, reason: 'stage-workflow-profile-unavailable' });
  });

  it('defends against programmatic review stages without the checker-readonly workflow profile', () => {
    const checkerStage = CHECKER.stages[1];
    const { workflowProfile: _ignored, ...withoutProfile } = checkerStage;
    for (const invalidStage of [
      withoutProfile,
      { ...checkerStage, workflowProfile: 'producer' },
      { ...checkerStage, workflowProfile: 'research' },
    ]) {
      expect(compileWorkflowDef({ ...CHECKER, stages: [CHECKER.stages[0], invalidStage] }, bindingEnvironment()))
        .toMatchObject({ ok: false, reason: 'review-workflow-profile-required' });
    }
  });

  it('fails closed for missing bindings, wrong roles, unknown/non-bound/project-mismatched agents, and disallowed/default-mismatched profiles', () => {
    expect(compileWorkflowDef(ASSIGNED, { registry: REGISTRY })).toMatchObject({ ok: false, reason: 'assignment-binding-environment-missing' });
    const wrongRole = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], profileId: 'manager:claude:claude-opus-4-8' }] };
    const wrongRoleAgents = bindingEnvironment();
    wrongRoleAgents.declaredAgents.get('fyt-production')!.allowedProfiles!.push('manager:claude:claude-opus-4-8');
    expect(compileWorkflowDef(wrongRole, wrongRoleAgents)).toMatchObject({ ok: false, reason: 'assigned-profile-role-mismatch' });
    const unknown = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], agentId: 'missing-agent' }] };
    expect(compileWorkflowDef(unknown, bindingEnvironment())).toMatchObject({ ok: false, reason: 'assigned-agent-not-declared' });
    const nonBound = bindingEnvironment();
    nonBound.declaredAgents.get('fyt-production')!.runnerBound = false;
    expect(compileWorkflowDef(ASSIGNED, nonBound)).toMatchObject({ ok: false, reason: 'assigned-agent-not-runner-bound' });
    const otherProject = bindingEnvironment();
    otherProject.declaredAgents.get('fyt-production')!.projects = ['faceless-youtube'];
    expect(compileWorkflowDef(ASSIGNED, otherProject)).toMatchObject({ ok: false, reason: 'assigned-agent-project-mismatch' });
    const disallowed = bindingEnvironment();
    disallowed.declaredAgents.get('fyt-production')!.allowedProfiles = ['worker:codex:gpt-5.6-sol'];
    expect(compileWorkflowDef(ASSIGNED, disallowed)).toMatchObject({ ok: false, reason: 'assigned-profile-not-allowed' });
    const badDefault = bindingEnvironment();
    badDefault.declaredAgents.get('fyt-production')!.defaultProfile = 'worker:claude:claude-sonnet-5';
    expect(compileWorkflowDef(ASSIGNED, badDefault)).toMatchObject({ ok: false, reason: 'assigned-default-profile-mismatch' });
  });

  it('rejects a manager or worker whose declared default profile has the wrong logical role', () => {
    const managerDefaultWorker = bindingEnvironment();
    const manager = managerDefaultWorker.declaredAgents.get('fyt-runner')!;
    manager.defaultProfile = 'worker:codex:gpt-5.6-sol';
    manager.allowedProfiles = ['manager:claude:claude-opus-4-8', 'worker:codex:gpt-5.6-sol'];
    manager.runtime = 'codex';
    manager.model = 'gpt-5.6-sol';
    expect(compileWorkflowDef(ASSIGNED, managerDefaultWorker))
      .toMatchObject({ ok: false, reason: 'assigned-default-profile-role-mismatch' });

    const workerDefaultManager = bindingEnvironment();
    const worker = workerDefaultManager.declaredAgents.get('fyt-production')!;
    worker.defaultProfile = 'manager:claude:claude-opus-4-8';
    worker.allowedProfiles = ['manager:claude:claude-opus-4-8', 'worker:claude:claude-sonnet-5'];
    worker.runtime = 'claude';
    worker.model = 'claude-opus-4-8';
    expect(compileWorkflowDef(ASSIGNED, workerDefaultManager))
      .toMatchObject({ ok: false, reason: 'assigned-default-profile-role-mismatch' });
  });

  it('fails when the selected assignment runtime has no available adapter and snapshots rather than retaining declaration references', () => {
    const unavailable = bindingEnvironment({ availableRuntimes: new Set<'claude' | 'codex'>(['claude']) });
    const codexSelected = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], profileId: 'worker:codex:gpt-5.6-sol' }] };
    expect(compileWorkflowDef(codexSelected, unavailable)).toMatchObject({ ok: false, reason: 'assigned-runtime-unavailable' });
    const env = bindingEnvironment();
    const compiled = compileWorkflowDef(ASSIGNED, env);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    env.declaredAgents.get('fyt-production')!.sourceHash = 'c'.repeat(64);
    env.executionProfiles[3].model = 'mutated-model';
    expect(compiled.value.stages[0].assignment).toMatchObject({ declarationHash: 'b'.repeat(64), model: 'claude-sonnet-5' });
  });

  it('includes the four required governance refs', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.governanceRefs).toEqual([
      'CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md',
    ]);
  });

  it('preserves the effective risk tier (a floor lifted above a declared T1 survives compilation)', () => {
    const lowered = def([
      'id: r', 'project: kb-ops', 'title: R', 'profile: research', 'stages:',
      '  - id: brief', '    title: Brief', '    action: research:web-brief', '    target: orgs/kb-ops/output', '    riskTier: T1',
    ].join('\n'));
    const compiled = compileWorkflowDef(lowered, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.stages[0].riskTier).toBe('T2');
    expect(validatePlanProposal(compiled.value as unknown, REGISTRY).ok).toBe(true);
  });

  it('routes the manager to opus and workers to sonnet from the registry', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.manager).toMatchObject({ runtime: 'claude', model: 'claude-opus-4-8' });
    expect(compiled.value.stages[0].worker).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5' });
  });

  it('fails when the registry has no claude models to route', () => {
    const compiled = compileWorkflowDef(SINGLE, { registry: { runtimes: { codex: ['gpt-5.6-sol'] }, skills: [] } });
    expect(compiled.ok).toBe(false);
  });
});
