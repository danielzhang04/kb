import { describe, expect, it } from 'vitest';
import { instantiateWorkflowDef, parseWorkflowDef, type WorkflowDef, type WorkflowStageDef } from './defs.ts';
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
  '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/reviews', '    workOrder: Check', '    dependsOn: [create]',
  '    agentId: fyt-production', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly',
  '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1', '      criteria:', '        - id: safety', '          description: No unsafe changes',
  '    completionGate:', '      id: checker-approval', '      kind: approval', '      prompt: Approve checker result?', '      requiresReview: pass',
  '  - id: next', '    title: Next creator', '    action: implement:next', '    target: orgs/kb-ops/output', '    workOrder: Continue', '    dependsOn: [check]',
].join('\n'));

describe('compileWorkflowDef', () => {
  it('compiles an instantiated target to the exact launched write scope', () => {
    const scoped = def([
      'id: scoped-output', 'project: kb-ops', 'title: Scoped output', 'profile: research', 'parameters: [channel, slug]',
      'stages:',
      '  - id: brief', '    title: Write only this video', '    action: research:web-brief',
      '    target: orgs/kb-ops/output/<channel>/videos/<slug>',
    ].join('\n'));
    const launched = instantiateWorkflowDef(scoped, { channel: 'the-second-take', slug: '2026-07-31-thin' });
    expect(launched).toMatchObject({ ok: true });
    if (!launched.ok) return;
    const compiled = compileWorkflowDef(launched.value, { registry: REGISTRY });
    expect(compiled).toMatchObject({ ok: true });
    if (!compiled.ok) return;
    const target = 'orgs/kb-ops/output/the-second-take/videos/2026-07-31-thin';
    expect(compiled.value.scope.write).toEqual([target]);
    expect(compiled.value.stages[0]).toMatchObject({ target, scope: { write: [target] } });
    expect(compiled.value.scope.write).not.toContain('orgs/kb-ops/output/the-second-take/videos/other-run');
  });

  it('defence-in-depth refuses a programmatic validation slice with publication capability', () => {
    const forged: WorkflowDef = {
      ...SINGLE,
      executionMode: 'validation-slice',
      stages: [{ ...SINGLE.stages[0], action: 'publish:private-upload', riskTier: 'T3' }],
    };
    expect(compileWorkflowDef(forged, { registry: REGISTRY })).toMatchObject({
      ok: false,
      reason: 'validation-slice-publication-forbidden',
    });
  });

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
    // `main` now includes the definition's read scope in the proposal-id preimage. Pin the merged
    // read-scope-aware bytes here; assignment metadata must remain absent and must not perturb them.
    expect(compiled.value.proposalId).toBe('wf-5497530df05dc94e5ba8b528c2738d84e47666f60b52a076');
    expect(compiled.value.manager).not.toHaveProperty('assignment');
    expect(compiled.value.stages[0]).not.toHaveProperty('assignment');
    expect(canonicalProposal(compiled.value)).toContain('"proposalId":"wf-5497530df05dc94e5ba8b528c2738d84e47666f60b52a076"');
  });

  describe('declared human gates', () => {
    const GATED = def([
      'id: gated-run', 'project: kb-ops', 'title: Gated run', 'profile: research', 'stages:',
      '  - id: draft', '    title: Draft', '    action: draft:thing', '    target: orgs/kb-ops/output', '    workOrder: Draft it.',
      '  - id: spend', '    title: Spend', '    action: build:images', '    target: orgs/kb-ops/output', '    workOrder: Generate.', '    dependsOn: [draft]',
      '    humanGates:', '      - id: g2-plan', '        kind: approval', '        prompt: Approve the plan.', '        spendAuthorization: true',
      '  - id: after', '    title: After', '    action: implement:after', '    target: orgs/kb-ops/output', '    workOrder: Continue.', '    dependsOn: [spend]',
      '    humanGates:', '      - id: g3-board', '        kind: approval', '        prompt: Approve the board.',
    ].join('\n'));

    it('threads the DECLARED gates onto the compiled stages instead of a hardcoded empty list', () => {
      const compiled = compileWorkflowDef(GATED, { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.stages.map((stage) => [stage.id, stage.humanGates])).toEqual([
        ['draft', []],
        ['spend', [{ id: 'g2-plan', kind: 'approval', prompt: 'Approve the plan.', spendAuthorization: true }]],
        ['after', [{ id: 'g3-board', kind: 'approval', prompt: 'Approve the board.' }]],
      ]);
      // The gates must survive the SERVER-COMPILED validator (the browser one refuses the field).
      expect(validateServerCompiledPlanProposal(JSON.parse(JSON.stringify(compiled.value)), REGISTRY)).toMatchObject({ ok: true });
    });

    it('threads publicationAuthorization into the compiled gate and into proposal identity', () => {
      const PUBLISHED = def([
        'id: publish-run', 'project: kb-ops', 'title: Publish run', 'profile: research', 'stages:',
        '  - id: verify', '    title: Verify', '    action: verify:cut', '    target: orgs/kb-ops/output', '    workOrder: Verify.',
        '  - id: publish', '    title: Publish', '    action: publish:private-upload', '    target: orgs/kb-ops/output',
        '    workOrder: Upload privately.', '    riskTier: T3', '    dependsOn: [verify]',
        '    humanGates:', '      - id: g4-publish', '        kind: approval', '        prompt: Approve the upload.',
        '        publicationAuthorization: true',
      ].join('\n'));
      const compiled = compileWorkflowDef(PUBLISHED, { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.stages.find((stage) => stage.id === 'publish')?.humanGates).toEqual([
        { id: 'g4-publish', kind: 'approval', prompt: 'Approve the upload.', publicationAuthorization: true },
      ]);
      expect(validateServerCompiledPlanProposal(JSON.parse(JSON.stringify(compiled.value)), REGISTRY)).toMatchObject({ ok: true });
      // Silently clearing the flag must change the approved identity: it decides whether that stage can
      // ever be released at all.
      const dropped = compileWorkflowDef({
        ...PUBLISHED,
        stages: PUBLISHED.stages.map((stage) => (stage.id === 'publish'
          ? { ...stage, humanGates: stage.humanGates?.map(({ publicationAuthorization: _gone, ...gate }) => gate) }
          : stage)),
      }, { registry: REGISTRY });
      expect(dropped.ok).toBe(true);
      if (!dropped.ok) return;
      expect(dropped.value.proposalId).not.toBe(compiled.value.proposalId);
    });

    it('carries the launch parameters onto the compiled proposal as data', () => {
      const compiled = compileWorkflowDef({ ...GATED, launchParameters: { channel: 'the-second-take', slug: 'st-042' } }, { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.parameters).toEqual({ channel: 'the-second-take', slug: 'st-042' });
      expect(validateServerCompiledPlanProposal(JSON.parse(JSON.stringify(compiled.value)), REGISTRY)).toMatchObject({ ok: true });
      // A definition with no launch values emits no key, so pre-existing proposals hash unchanged.
      const bare = compileWorkflowDef(GATED, { registry: REGISTRY });
      expect(bare.ok && bare.value).not.toHaveProperty('parameters');
    });

    it('binds the gates into proposal identity so a gate edit forces re-approval', () => {
      const compiled = compileWorkflowDef(GATED, { registry: REGISTRY });
      const ungated = compileWorkflowDef(
        { ...GATED, stages: GATED.stages.map(({ humanGates: _dropped, ...stage }) => stage as WorkflowStageDef) },
        { registry: REGISTRY },
      );
      const spendDropped = compileWorkflowDef(
        {
          ...GATED,
          stages: GATED.stages.map((stage) => (stage.id === 'spend'
            ? { ...stage, humanGates: stage.humanGates?.map(({ spendAuthorization: _dropped, ...gate }) => gate) }
            : stage)),
        },
        { registry: REGISTRY },
      );
      expect(compiled.ok && ungated.ok && spendDropped.ok).toBe(true);
      if (!compiled.ok || !ungated.ok || !spendDropped.ok) return;
      // Deleting a gate, or silently clearing its spend flag, must change the approved identity —
      // otherwise the run's halt structure could be edited under an existing approval.
      expect(ungated.value.proposalId).not.toBe(compiled.value.proposalId);
      expect(spendDropped.value.proposalId).not.toBe(compiled.value.proposalId);
      // ...while a definition that declares no gates keeps its historical identity exactly.
      const legacy = compileWorkflowDef(SINGLE, { registry: REGISTRY });
      expect(legacy.ok).toBe(true);
      if (!legacy.ok) return;
      expect(legacy.value.proposalId).toBe('wf-5497530df05dc94e5ba8b528c2738d84e47666f60b52a076');
    });
  });

  describe('declared artifacts', () => {
    const WITH_ARTIFACTS = def([
      'id: artifact-run', 'project: kb-ops', 'title: Artifact run', 'profile: research', 'stages:',
      '  - id: draft', '    title: Draft', '    action: draft:thing', '    target: orgs/kb-ops/output', '    workOrder: Draft it.',
      '    artifacts:',
      '      - id: script', '        path: orgs/kb-ops/output/script.md', '        description: The script.',
      '      - id: notes', '        path: orgs/kb-ops/output/notes.md', '        description: The notes.',
      '  - id: after', '    title: After', '    action: implement:after', '    target: orgs/kb-ops/output', '    workOrder: Continue.', '    dependsOn: [draft]',
    ].join('\n'));

    it('threads the DECLARED artifacts onto the compiled stages instead of a hardcoded empty list', () => {
      // The `artifacts: []` hardcode made the server-side declared-artifact check in
      // execution.ts artifact verification iterate nothing, so a successful result with no files on disk was
      // accepted as `succeeded`.
      const compiled = compileWorkflowDef(WITH_ARTIFACTS, { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.stages.map((stage) => [stage.id, stage.artifacts])).toEqual([
        ['draft', [
          { id: 'script', path: 'orgs/kb-ops/output/script.md', description: 'The script.' },
          { id: 'notes', path: 'orgs/kb-ops/output/notes.md', description: 'The notes.' },
        ]],
        ['after', []],
      ]);
      expect(validateServerCompiledPlanProposal(JSON.parse(JSON.stringify(compiled.value)), REGISTRY)).toMatchObject({ ok: true });
      // Compiled artifacts are copies, never aliases of the def's own objects.
      expect(compiled.value.stages[0].artifacts[0]).not.toBe(WITH_ARTIFACTS.stages[0].artifacts?.[0]);
    });

    it('binds artifacts into proposal identity so weakening the success bar forces re-approval', () => {
      const compiled = compileWorkflowDef(WITH_ARTIFACTS, { registry: REGISTRY });
      const dropped = compileWorkflowDef(
        { ...WITH_ARTIFACTS, stages: WITH_ARTIFACTS.stages.map(({ artifacts: _gone, ...stage }) => stage as WorkflowStageDef) },
        { registry: REGISTRY },
      );
      const narrowed = compileWorkflowDef(
        {
          ...WITH_ARTIFACTS,
          stages: WITH_ARTIFACTS.stages.map((stage) => (stage.id === 'draft'
            ? { ...stage, artifacts: stage.artifacts?.slice(0, 1) }
            : stage)),
        },
        { registry: REGISTRY },
      );
      expect(compiled.ok && dropped.ok && narrowed.ok).toBe(true);
      if (!compiled.ok || !dropped.ok || !narrowed.ok) return;
      expect(dropped.value.proposalId).not.toBe(compiled.value.proposalId);
      expect(narrowed.value.proposalId).not.toBe(compiled.value.proposalId);
      // ...while a definition that declares no artifacts keeps its historical identity exactly.
      const legacy = compileWorkflowDef(SINGLE, { registry: REGISTRY });
      expect(legacy.ok).toBe(true);
      if (!legacy.ok) return;
      expect(legacy.value.proposalId).toBe('wf-5497530df05dc94e5ba8b528c2738d84e47666f60b52a076');
    });
  });

  it('keeps ownership out of compiled routing, proposal identity, and canonical proposal bytes', () => {
    const governed = {
      ...SINGLE,
      governedBy: 'fyt-runner',
      stages: SINGLE.stages.map((stage) => ({ ...stage, governedBy: 'fyt-preproduction' })),
    };
    const before = compileWorkflowDef(SINGLE, { registry: REGISTRY });
    const after = compileWorkflowDef(governed, { registry: REGISTRY });
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value.proposalId).toBe(before.value.proposalId);
    expect(canonicalProposal(after.value)).toBe(canonicalProposal(before.value));
    expect(after.value.manager).not.toHaveProperty('assignment');
    expect(after.value.stages[0]).not.toHaveProperty('assignment');
    expect(after.value).not.toHaveProperty('governedBy');
    expect(after.value.stages[0]).not.toHaveProperty('governedBy');
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
      }, {},
    ] } });
    if (!compiled.ok) return;
    expect(compiled.value.stages[1]).toMatchObject({
      scope: { write: [] },
      artifacts: [],
      checkpoints: [],
    });
    expect(compiled.value.scope.write).toEqual(['orgs/kb-ops/output']);
    expect(compiled.value.scope.write).not.toContain('orgs/kb-ops/reviews');
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

  it('defends programmatic definitions against non-linear or nested review graphs', () => {
    const check = CHECKER.stages[1];
    const next = CHECKER.stages[2];
    const duplicate = { ...check, id: 'check-again' };
    const reviewOfReview = { ...check, id: 'review-again', dependsOn: ['check'], review: { ...check.review!, subjectStageId: 'check' } };
    const cases: Array<[WorkflowStageDef[], string]> = [
      [[CHECKER.stages[0], { ...check, dependsOn: ['create', 'next'] }, next], 'review-depends-on-subject-only'],
      [[CHECKER.stages[0], check, next, duplicate], 'duplicate-review-subject'],
      [[CHECKER.stages[0], check, reviewOfReview], 'review-of-review-not-allowed'],
    ];
    for (const [stages, reason] of cases) {
      expect(compileWorkflowDef({ ...CHECKER, stages }, bindingEnvironment())).toMatchObject({ ok: false, reason });
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

  it('emits the exact refusal diagnostic for every feasible assignment binding failure', () => {
    const unbound = bindingEnvironment();
    unbound.declaredAgents.get('fyt-production')!.runnerBound = false;
    expect(compileWorkflowDef(ASSIGNED, unbound)).toMatchObject({
      ok: false, reason: 'assigned-agent-not-runner-bound', detail: "assigned agent 'fyt-production' is not runner-bound",
    });

    const unknown = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], agentId: 'missing-agent' }] };
    expect(compileWorkflowDef(unknown, bindingEnvironment())).toMatchObject({
      ok: false, reason: 'assigned-agent-not-declared', detail: "assigned agent 'missing-agent' is not declared",
    });

    const otherProject = bindingEnvironment();
    otherProject.declaredAgents.get('fyt-production')!.projects = ['faceless-youtube'];
    expect(compileWorkflowDef(ASSIGNED, otherProject)).toMatchObject({
      ok: false, reason: 'assigned-agent-project-mismatch', detail: "assigned agent 'fyt-production' is not declared for project 'kb-ops'",
    });

    const disallowed = bindingEnvironment();
    disallowed.declaredAgents.get('fyt-production')!.allowedProfiles = ['worker:codex:gpt-5.6-sol'];
    expect(compileWorkflowDef(ASSIGNED, disallowed)).toMatchObject({
      ok: false, reason: 'assigned-profile-not-allowed', detail: "assigned profile 'worker:claude:claude-sonnet-5' is not allowed for agent 'fyt-production'",
    });

    const wrongRole = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], profileId: 'manager:claude:claude-opus-4-8' }] };
    const wrongRoleEnvironment = bindingEnvironment();
    wrongRoleEnvironment.declaredAgents.get('fyt-production')!.allowedProfiles!.push('manager:claude:claude-opus-4-8');
    expect(compileWorkflowDef(wrongRole, wrongRoleEnvironment)).toMatchObject({
      ok: false, reason: 'assigned-profile-role-mismatch', detail: "assigned execution profile 'manager:claude:claude-opus-4-8' is not a worker profile",
    });

    const codexSelected = { ...ASSIGNED, stages: [{ ...ASSIGNED.stages[0], profileId: 'worker:codex:gpt-5.6-sol' }] };
    expect(compileWorkflowDef(codexSelected, bindingEnvironment({ availableRuntimes: new Set<'claude' | 'codex'>(['claude']) }))).toMatchObject({
      ok: false, reason: 'assigned-runtime-unavailable', detail: "runtime 'codex' is unavailable for assigned profile 'worker:codex:gpt-5.6-sol'",
    });
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

  describe('effective read scope (Layer A)', () => {
    const withReadScope = (roots: string[]): WorkflowDef => def([
      'id: scan', 'project: kb-ops', 'title: Scan', 'profile: research',
      'readScope:', ...roots.map((r) => `  - ${r}`),
      'stages:',
      '  - id: brief', '    title: Brief', '    action: research:web-brief', '    target: orgs/kb-ops/output', '    riskTier: T2',
    ].join('\n'));

    it('a def WITHOUT readScope compiles to scope.read === [orgs/<project>] (default-preservation lock)', () => {
      const compiled = compileWorkflowDef(SINGLE, { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.scope.read).toEqual(['orgs/kb-ops']);
      // …mirrored identically into every stage (the pre-change plumbing shape, unchanged).
      for (const stage of compiled.value.stages) expect(stage.scope.read).toEqual(['orgs/kb-ops']);
    });

    it('unions declared roots with the own-org tree into proposal AND every stage scope.read', () => {
      const compiled = compileWorkflowDef(withReadScope(['queue', 'dashboards']), { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.scope.read).toEqual(['queue', 'dashboards', 'orgs/kb-ops']);
      for (const stage of compiled.value.stages) {
        expect(stage.scope.read).toEqual(compiled.value.scope.read);
      }
      // The compiler's widening refusal (compiler.ts:60) holds trivially: stage.read == proposal.read.
      expect(validatePlanProposal(compiled.value as unknown, REGISTRY).ok).toBe(true);
    });

    it('does not duplicate the own-org tree when it is also declared explicitly', () => {
      const compiled = compileWorkflowDef(withReadScope(['orgs/kb-ops', 'queue']), { registry: REGISTRY });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.scope.read).toEqual(['orgs/kb-ops', 'queue']);
    });

    it('compiles a scanner-profile scan def (C1) that passes the real proposal validator', () => {
      const registry: RuntimeSkillRegistry = { ...REGISTRY, workflowProfiles: [...REGISTRY.workflowProfiles!, 'scanner'] };
      const scanDef = parseWorkflowDef([
        '---',
        'id: scan', 'project: kb-ops', 'title: Scan', 'profile: scanner',
        'readScope:', '  - queue', '  - dashboards',
        'stages:',
        '  - id: report', '    title: Report', '    action: report:self-lint', '    target: orgs/kb-ops/output', '    riskTier: T1',
        '---', '', 'Scan and report.', '',
      ].join('\n'), { knownProfiles: new Set(registry.workflowProfiles) });
      expect(scanDef.ok).toBe(true);
      if (!scanDef.ok) return;
      const compiled = compileWorkflowDef(scanDef.value, { registry });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.profile).toBe('scanner');
      expect(compiled.value.scope.read).toEqual(['queue', 'dashboards', 'orgs/kb-ops']);
      expect(validatePlanProposal(compiled.value as unknown, registry).ok).toBe(true);
    });

    it('covers the effective read scope in the proposal id hash: a scope change forces re-approval', () => {
      const a = compileWorkflowDef(withReadScope(['queue']), { registry: REGISTRY });
      const b = compileWorkflowDef(withReadScope(['queue']), { registry: REGISTRY });
      const c = compileWorkflowDef(withReadScope(['queue', 'dashboards']), { registry: REGISTRY });
      expect(a.ok && b.ok && c.ok).toBe(true);
      if (!a.ok || !b.ok || !c.ok) return;
      // Stable for identical scope, different when the read scope changes.
      expect(a.value.proposalId).toBe(b.value.proposalId);
      expect(a.value.proposalId).not.toBe(c.value.proposalId);
    });
  });
});
