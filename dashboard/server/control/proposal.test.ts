import { describe, expect, it } from 'vitest';
import {
  canonicalProposal,
  createProposalRevision,
  parseProposalFromAssistant,
  proposalContentHash,
  validatePlanProposal,
  validateServerCompiledPlanProposal,
} from './proposal.ts';
import type { PlanProposal, ProposalRegistry } from './proposal.ts';

const REGISTRY: ProposalRegistry = {
  runtimes: {
    claude: ['claude-opus-4-8', 'claude-sonnet-5'],
    codex: ['gpt-5.6-sol'],
  },
  skills: ['repo-analysis', 'typescript'],
};

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1',
  proposalId: 'dashboard-control',
  project: 'kb-ops',
  title: 'Dashboard control plane',
  summary: 'Compile one reviewed workflow into a governed run.',
  manager: {
    runtime: 'claude',
    model: 'claude-opus-4-8',
    requiredSkills: ['repo-analysis'],
  },
  scope: {
    read: ['CLAUDE.md', 'governance/agent-rules.md', 'orgs/kb-ops/contract.md'],
    write: ['dashboard/server/control'],
  },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [
    {
      id: 'compile',
      title: 'Compile proposal',
      action: 'implement:proposal-compiler',
      target: 'dashboard/server/control',
      workOrder: 'Implement the closed proposal compiler.',
      riskTier: 'T2',
      dependsOn: [],
      worker: { runtime: 'codex', model: 'gpt-5.6-sol' },
      requiredSkills: ['typescript'],
      scope: { read: ['dashboard/server'], write: ['dashboard/server/control'] },
      artifacts: [
        { id: 'compiler', path: 'dashboard/server/control/proposal.ts', description: 'Validated compiler module.' },
      ],
      checkpoints: [{ id: 'tests-pass', label: 'Focused tests and typecheck pass.' }],
      humanGates: [],
    },
    {
      id: 'review',
      title: 'Review compiler',
      action: 'review:proposal-compiler',
      target: 'dashboard/server/control',
      workOrder: 'Adversarially review the completed compiler.',
      riskTier: 'T2',
      dependsOn: ['compile'],
      worker: { runtime: 'claude', model: 'claude-sonnet-5' },
      requiredSkills: [],
      scope: { read: ['dashboard/server/control'], write: [] },
      artifacts: [],
      checkpoints: [],
      humanGates: [
        { id: 'accept-review', kind: 'review', prompt: 'Accept the adversarial review findings?' },
      ],
    },
  ],
};

function source(value: unknown = proposal) {
  return {
    role: 'assistant',
    state: 'complete',
    visibility: 'visible',
    text: `Planning notes are inert.\n\n\`\`\`kb.plan-proposal/v1\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`,
  };
}

describe('kb.plan-proposal/v1 validation', () => {
  it('accepts the closed schema and rejects unknown fields at every level', () => {
    expect(validatePlanProposal(proposal, REGISTRY)).toEqual({ ok: true, value: proposal });
    expect(validatePlanProposal({ ...proposal, permissionMode: 'bypass' }, REGISTRY)).toEqual({
      ok: false,
      detail: "unknown field 'permissionMode'",
    });
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], worker: { ...proposal.stages[0].worker, flags: ['--dangerously-skip-permissions'] } }],
    }, REGISTRY)).toEqual({ ok: false, detail: "stages[0].worker: unknown field 'flags'" });
  });

  it('rejects compiler-only assignments from untrusted input but admits a valid resolved snapshot internally', () => {
    const managerAssignment = {
      agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager:claude:claude-opus-4-8', runtime: 'claude' as const, model: 'claude-opus-4-8',
    };
    const stageAssignment = {
      agentId: 'fyt-production', declarationPath: 'agents/fyt-production.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex' as const, model: 'gpt-5.6-sol',
    };
    const compiled = {
      ...proposal,
      manager: { ...proposal.manager, assignment: managerAssignment },
      stages: [{ ...proposal.stages[0], assignment: stageAssignment }, proposal.stages[1]],
    };
    expect(validatePlanProposal(compiled, REGISTRY)).toEqual({ ok: false, detail: "manager: unknown field 'assignment'" });
    expect(validateServerCompiledPlanProposal(compiled, REGISTRY)).toMatchObject({ ok: true });
  });

  it('rejects a resolved snapshot whose runtime/model disagrees with manager or worker routing', () => {
    const assignment = {
      agentId: 'fyt-production', declarationPath: 'agents/fyt-production.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker:claude:claude-sonnet-5', runtime: 'claude' as const, model: 'claude-sonnet-5',
    };
    const forged = {
      ...proposal,
      stages: [{ ...proposal.stages[0], assignment }, proposal.stages[1]],
    };
    expect(validateServerCompiledPlanProposal(forged, REGISTRY)).toEqual({
      ok: false,
      detail: 'stages[0].assignment runtime/model must match worker routing',
    });
  });

  it('admits checker metadata only at the server-compiled boundary and validates its closed consistency', () => {
    const checkerAssignment = {
      agentId: 'fyt-checker', declarationPath: 'agents/fyt-checker.md', declarationHash: 'c'.repeat(64),
      profileId: 'worker:claude:claude-sonnet-5', runtime: 'claude' as const, model: 'claude-sonnet-5',
    };
    const compiled = {
      ...proposal,
      stages: [proposal.stages[0], {
        ...proposal.stages[1], assignment: checkerAssignment, workflowProfile: 'checker-readonly',
        review: { subjectStageId: 'compile', maxCreatorReworks: 1, criteria: [{ id: 'safety', description: 'No unsafe changes' }] },
        completionGate: { id: 'checker-approval', kind: 'approval' as const, prompt: 'Approve checker?', requiresReview: 'pass' as const },
      }, {
        ...proposal.stages[0], id: 'release', title: 'Release checked result', action: 'implement:release',
        workOrder: 'Release the checked result.', dependsOn: ['review'],
      }],
    };
    const registry = { ...REGISTRY, workflowProfiles: ['checker-readonly', 'producer', 'research'] };
    expect(validatePlanProposal(compiled, registry)).toMatchObject({ ok: false });
    expect(validateServerCompiledPlanProposal(compiled, registry)).toMatchObject({ ok: true });
    expect(validateServerCompiledPlanProposal({
      ...compiled,
      stages: [compiled.stages[0], { ...compiled.stages[1], review: { ...compiled.stages[1].review, subjectStageId: 'missing' } }],
    }, registry)).toMatchObject({ ok: false, detail: expect.stringMatching(/direct dependency/) });
    const checkerStage = compiled.stages[1];
    const { workflowProfile: _ignored, ...withoutProfile } = checkerStage;
    for (const invalidStage of [
      withoutProfile,
      { ...checkerStage, workflowProfile: 'producer' },
      { ...checkerStage, workflowProfile: 'research' },
    ]) {
      expect(validateServerCompiledPlanProposal({ ...compiled, stages: [compiled.stages[0], invalidStage] }, registry))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/workflowProfile 'checker-readonly'/) });
    }
    expect(validateServerCompiledPlanProposal({
      ...compiled,
      stages: [compiled.stages[0], { ...checkerStage, dependsOn: ['compile', 'release'] }, compiled.stages[2]],
    }, registry)).toMatchObject({ ok: false, detail: expect.stringMatching(/depend only on its subject/) });
    expect(validateServerCompiledPlanProposal({
      ...compiled,
      stages: [compiled.stages[0], checkerStage, compiled.stages[2], { ...checkerStage, id: 'review-again' }],
    }, registry)).toMatchObject({ ok: false, detail: expect.stringMatching(/multiple review stages/) });
    expect(validateServerCompiledPlanProposal({
      ...compiled,
      stages: [compiled.stages[0], checkerStage, compiled.stages[2], {
        ...checkerStage, id: 'review-again', dependsOn: ['review'], review: { ...checkerStage.review!, subjectStageId: 'review' },
      }],
    }, registry)).toMatchObject({ ok: false, detail: expect.stringMatching(/cannot review review stage/) });
  });

  it('admits a spend-authorization gate only from the compiler, and only on an approval gate', () => {
    const spendGate = { id: 'g2-visual-plan', kind: 'approval' as const, prompt: 'Approve the plan.', spendAuthorization: true };
    const withSpendGate = (gate: Record<string, unknown>) => ({
      ...proposal,
      stages: [{ ...proposal.stages[0], humanGates: [gate] }, proposal.stages[1]],
    });
    // An assistant/browser proposal cannot mint its own spend authorization: the field is
    // compiler-only, exactly like `review`/`completionGate`.
    expect(validatePlanProposal(withSpendGate(spendGate), REGISTRY)).toEqual({
      ok: false,
      detail: "stages[0].humanGates[0]: unknown field 'spendAuthorization'",
    });
    expect(validateServerCompiledPlanProposal(withSpendGate(spendGate), REGISTRY)).toMatchObject({ ok: true });
    // A non-approval response ('responded' on an input gate) must never read as authorizing spend.
    for (const kind of ['input', 'review', 'intervention'] as const) {
      expect(validateServerCompiledPlanProposal(withSpendGate({ ...spendGate, kind }), REGISTRY)).toEqual({
        ok: false,
        detail: "stages[0].humanGates[0].spendAuthorization requires kind 'approval'",
      });
    }
    expect(validateServerCompiledPlanProposal(withSpendGate({ ...spendGate, spendAuthorization: 'yes' }), REGISTRY)).toEqual({
      ok: false,
      detail: 'stages[0].humanGates[0].spendAuthorization must be a boolean when present',
    });
  });

  it('admits a publication-authorization gate only from the compiler, and only on an approval gate', () => {
    const publishGate = { id: 'g4-publish-private', kind: 'approval' as const, prompt: 'Approve the upload.', publicationAuthorization: true };
    const withGate = (gate: Record<string, unknown>) => ({
      ...proposal,
      stages: [{ ...proposal.stages[0], humanGates: [gate] }, proposal.stages[1]],
    });
    // Compiler-only: an assistant/browser proposal cannot mint its own T3 content-bound authorization.
    expect(validatePlanProposal(withGate(publishGate), REGISTRY)).toEqual({
      ok: false,
      detail: "stages[0].humanGates[0]: unknown field 'publicationAuthorization'",
    });
    expect(validateServerCompiledPlanProposal(withGate(publishGate), REGISTRY)).toMatchObject({ ok: true });
    for (const kind of ['input', 'review', 'intervention'] as const) {
      expect(validateServerCompiledPlanProposal(withGate({ ...publishGate, kind }), REGISTRY)).toEqual({
        ok: false,
        detail: "stages[0].humanGates[0].publicationAuthorization requires kind 'approval'",
      });
    }
    expect(validateServerCompiledPlanProposal(withGate({ ...publishGate, publicationAuthorization: 'please' }), REGISTRY)).toEqual({
      ok: false,
      detail: 'stages[0].humanGates[0].publicationAuthorization must be a boolean when present',
    });
  });

  it('admits compiler-only launch parameters as safe path segments and never from the browser', () => {
    const withParameters = (parameters: unknown) => ({ ...proposal, parameters });
    expect(validatePlanProposal(withParameters({ channel: 'the-second-take' }), REGISTRY)).toEqual({
      ok: false, detail: "unknown field 'parameters'",
    });
    expect(validateServerCompiledPlanProposal(withParameters({ channel: 'the-second-take', slug: 'st-042', slice: '2min' }), REGISTRY))
      .toMatchObject({ ok: true, value: { parameters: { channel: 'the-second-take', slug: 'st-042', slice: '2min' } } });
    // Values become path fragments downstream (the roster's work directory), so every traversal,
    // separator, device name, and non-string is refused here rather than sanitized later.
    for (const value of ['../etc', 'a/b', 'a\\b', '.', '..', 'CON', 'nul.txt', '', 42, null]) {
      expect(validateServerCompiledPlanProposal(withParameters({ channel: value }), REGISTRY)).toMatchObject({
        ok: false, detail: expect.stringMatching(/must be a safe path segment/),
      });
    }
    expect(validateServerCompiledPlanProposal(withParameters({ 'bad key': 'x' }), REGISTRY)).toMatchObject({
      ok: false, detail: expect.stringMatching(/is not a safe id/),
    });
    expect(validateServerCompiledPlanProposal(withParameters(['channel']), REGISTRY)).toMatchObject({
      ok: false, detail: 'parameters must be an object',
    });
    // A proposal without the key stays byte-identical, so stored proposals keep their content hash.
    expect(validateServerCompiledPlanProposal(proposal, REGISTRY)).toMatchObject({ ok: true });
    const validated = validateServerCompiledPlanProposal(proposal, REGISTRY);
    expect(validated.ok && validated.value).not.toHaveProperty('parameters');
  });

  it('rejects governanceRefs missing the project contract', () => {
    expect(validatePlanProposal({
      ...proposal,
      governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md'],
    }, REGISTRY)).toEqual({ ok: false, detail: "governanceRefs must include 'orgs/kb-ops/contract.md'" });
  });

  it('rejects missing dependencies, self-dependencies, duplicate ids, and cycles', () => {
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], dependsOn: ['missing'] }],
    }, REGISTRY)).toEqual({ ok: false, detail: "stage 'compile' depends on missing stage 'missing'" });
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], dependsOn: ['compile'] }],
    }, REGISTRY)).toEqual({ ok: false, detail: "stage 'compile' cannot depend on itself" });
    expect(validatePlanProposal({
      ...proposal,
      stages: [proposal.stages[0], { ...proposal.stages[1], id: 'compile' }],
    }, REGISTRY)).toEqual({ ok: false, detail: "duplicate stage id 'compile'" });
    expect(validatePlanProposal({
      ...proposal,
      stages: [
        { ...proposal.stages[0], dependsOn: ['review'] },
        { ...proposal.stages[1], dependsOn: ['compile'] },
      ],
    }, REGISTRY)).toEqual({ ok: false, detail: 'proposal stage graph contains a cycle' });
  });

  it.each([
    '/absolute/path',
    'C:/windows/path',
    '../outside',
    'dashboard/../governance',
    'dashboard\\server',
    '.',
    'dashboard//server',
    '.git/config',
    'dashboard/AUX/file',
  ])('rejects unsafe repo-relative references: %s', (path) => {
    const candidate = { ...proposal, governanceRefs: [path] };
    expect(validatePlanProposal(candidate, REGISTRY)).toMatchObject({ ok: false });
  });

  it('validates runtime/model pairs and every required skill against injected registries', () => {
    expect(validatePlanProposal({
      ...proposal,
      manager: { ...proposal.manager, model: 'claude-unknown' },
    }, REGISTRY)).toEqual({ ok: false, detail: "manager.model 'claude-unknown' is not registered for runtime 'claude'" });
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], worker: { runtime: 'shell', model: 'arbitrary' } }],
    }, REGISTRY)).toEqual({ ok: false, detail: "stages[0].worker.runtime 'shell' is not registered" });
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], requiredSkills: ['unknown-skill'] }],
    }, REGISTRY)).toEqual({ ok: false, detail: "stages[0].requiredSkills[0] 'unknown-skill' is not registered" });
  });

  it('keeps execution-facing action and target fields declarative', () => {
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], action: '--dangerously-skip-permissions' }],
    }, REGISTRY)).toEqual({ ok: false, detail: 'stages[0].action must be a safe action identifier' });
    expect(validatePlanProposal({
      ...proposal,
      stages: [{ ...proposal.stages[0], action: 'implement:x; rm -rf .' }],
    }, REGISTRY)).toEqual({ ok: false, detail: 'stages[0].action must be a safe action identifier' });
  });

  it('enforces non-empty and bounded collections/text without coercion', () => {
    expect(validatePlanProposal({ ...proposal, stages: [] }, REGISTRY)).toMatchObject({ ok: false });
    expect(validatePlanProposal({ ...proposal, title: 'x'.repeat(201) }, REGISTRY)).toEqual({
      ok: false,
      detail: 'title must be at most 200 characters',
    });
    expect(validatePlanProposal({ ...proposal, governanceRefs: [] }, REGISTRY)).toEqual({
      ok: false,
      detail: 'governanceRefs must contain 1-32 items',
    });
    expect(validatePlanProposal({
      ...proposal,
      stages: [0, 1, 2].map((index) => ({
        ...proposal.stages[0],
        id: `stage-${index}`,
        workOrder: 'x'.repeat(64 * 1024),
      })),
    }, REGISTRY)).toEqual({ ok: false, detail: 'proposal must be at most 131072 bytes' });
  });
});

describe('untrusted assistant proposal extraction', () => {
  it('extracts exactly one fenced proposal only from completed visible assistant text', () => {
    expect(parseProposalFromAssistant(source(), REGISTRY)).toEqual({ ok: true, value: proposal });
    for (const patch of [
      { role: 'user' },
      { state: 'running' },
      { visibility: 'hidden' },
    ]) {
      expect(parseProposalFromAssistant({ ...source(), ...patch }, REGISTRY)).toMatchObject({ ok: false });
    }
  });

  it('rejects absent, unclosed, multiple, duplicate-key, and oversized proposal blocks', () => {
    expect(parseProposalFromAssistant({ ...source(), text: 'prose only' }, REGISTRY)).toEqual({
      ok: false,
      detail: 'assistant text must contain exactly one kb.plan-proposal/v1 fenced block',
    });
    const fenced = source().text;
    expect(parseProposalFromAssistant({ ...source(), text: fenced + fenced }, REGISTRY)).toEqual({
      ok: false,
      detail: 'assistant text must contain exactly one kb.plan-proposal/v1 fenced block',
    });
    expect(parseProposalFromAssistant({ ...source(), text: '```kb.plan-proposal/v1\n{}' }, REGISTRY)).toEqual({
      ok: false,
      detail: 'kb.plan-proposal/v1 fenced block is not closed',
    });
    expect(parseProposalFromAssistant({
      ...source(),
      text: '```kb.plan-proposal/v1\n{"schema":"kb.plan-proposal/v1","schema":"kb.plan-proposal/v1"}\n```',
    }, REGISTRY)).toEqual({ ok: false, detail: "proposal JSON contains duplicate key 'schema'" });
    expect(parseProposalFromAssistant({ ...source(), text: 'x'.repeat(262_145) }, REGISTRY)).toEqual({
      ok: false,
      detail: 'assistant text must be at most 262144 characters',
    });
  });

  it('does not treat a proposal-looking line inside another fence as executable data', () => {
    const text = `\`\`\`markdown\n\`\`\`kb.plan-proposal/v1\n${JSON.stringify(proposal)}\n\`\`\`\n`;
    expect(parseProposalFromAssistant({ ...source(), text }, REGISTRY)).toEqual({
      ok: false,
      detail: 'assistant text must contain exactly one kb.plan-proposal/v1 fenced block',
    });
  });
});

describe('canonical immutable revisions', () => {
  it('sorts object keys for one stable SHA-256 hash while preserving array order', () => {
    const reordered = Object.fromEntries(Object.entries(proposal).reverse()) as unknown as PlanProposal;
    expect(canonicalProposal(reordered)).toBe(canonicalProposal(proposal));
    expect(proposalContentHash(reordered)).toBe(proposalContentHash(proposal));
    expect(proposalContentHash({ ...proposal, title: 'Changed title' })).not.toBe(proposalContentHash(proposal));
    expect(proposalContentHash(proposal)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds a deeply immutable, hash-bound revision and JSON-pointer diff DTO', () => {
    const first = createProposalRevision(proposal, 1);
    const changed = { ...proposal, title: 'Dashboard run control' };
    const second = createProposalRevision(changed, 2, first);

    expect(first.previousContentHash).toBeNull();
    expect(second.previousContentHash).toBe(first.contentHash);
    expect(second.diff).toEqual({
      schema: 'kb.plan-proposal-diff/v1',
      fromContentHash: first.contentHash,
      toContentHash: second.contentHash,
      changed: true,
      changes: [{ path: '/title', before: proposal.title, after: 'Dashboard run control' }],
    });
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.proposal)).toBe(true);
    expect(Object.isFrozen(second.diff.changes)).toBe(true);
    expect(() => {
      (second.proposal as { title: string }).title = 'mutated';
    }).toThrow();
  });

  it('refuses a forged previous snapshot instead of carrying a false hash chain forward', () => {
    const first = createProposalRevision(proposal, 1);
    const forged = { ...first, contentHash: '0'.repeat(64) };
    expect(() => createProposalRevision(proposal, 2, forged)).toThrow('previous revision content hash is invalid');
  });
});

it('rejects browser-supplied iteration fields that differ from the compiler-owned snapshot', () => {
  const compiled: PlanProposal = {
    ...proposal,
    stages: [proposal.stages[0], { ...proposal.stages[1], dependsOn: ['compile'] }],
    iterationGroups: [{
      iterationGroupId: 'compiler-review',
      goal: 'Produce an accepted compiler.',
      participants: [
        { participantId: 'producer', stageRef: 'compile', role: 'manager', perspective: 'Own the compiler.', mandate: 'Produce and revise the compiler.' },
        { participantId: 'judge', stageRef: 'review', role: 'judge', perspective: 'Apply the criterion.', mandate: 'Pass only a complete compiler.' },
      ],
      routes: [
        { routeId: 'to-judge', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['compile'] },
      ],
      activation: { seedParticipantId: 'producer', seedArtifactIds: ['compiler'] },
      initialStepId: 'review',
      schedule: [
        { stepId: 'review', routeId: 'to-judge', cycle: 'current' },
      ],
      artifacts: ['compiler'],
      criteria: [{ id: 'quality', description: 'Compiler is complete.' }],
      maxCycles: 3,
      cycleUnit: 'One revision and judge verdict.',
      terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }],
    }],
  };
  expect(validatePlanProposal(compiled, REGISTRY)).toEqual({
    ok: false,
    detail: "unknown field 'iterationGroups'",
  });
  expect(validateServerCompiledPlanProposal(compiled, REGISTRY)).toEqual({ ok: true, value: compiled });
  const drifted = structuredClone(compiled);
  drifted.iterationGroups![0].routes[0].baseResolutionStageIds = ['review'];
  expect(validateServerCompiledPlanProposal(drifted, REGISTRY)).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/baseResolutionStageIds|compiler-owned/),
  });

  const roleIndependent = structuredClone(compiled);
  roleIndependent.iterationGroups![0].participants[1].role = 'contributor';
  expect(validateServerCompiledPlanProposal(roleIndependent, REGISTRY)).toMatchObject({ ok: true });

  for (const empty of ['artifacts', 'seed'] as const) {
    const candidate = structuredClone(compiled);
    if (empty === 'artifacts') candidate.iterationGroups![0].artifacts = [];
    else candidate.iterationGroups![0].activation.seedArtifactIds = [];
    expect(validateServerCompiledPlanProposal(candidate, REGISTRY)).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/artifacts|seedArtifactIds/),
    });
  }

  const invalidParticipantGoal = structuredClone(compiled);
  invalidParticipantGoal.iterationGroups![0].participants[1].goal = 'A judge must not carry the accepting-manager goal.';
  expect(validateServerCompiledPlanProposal(invalidParticipantGoal, REGISTRY)).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/participant goals require an accepting manager or coordinator/),
  });

  const unusedRoute = structuredClone(compiled);
  unusedRoute.iterationGroups![0].routes.push({
    routeId: 'unused-return', senderParticipantId: 'judge', recipientParticipantId: 'producer',
    requestKinds: ['reply'], baseResolutionStageIds: ['review'],
  });
  expect(validateServerCompiledPlanProposal(unusedRoute, REGISTRY)).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/route 'unused-return'.*not referenced/),
  });

  const danglingParticipant = structuredClone(compiled);
  danglingParticipant.stages.push({
    ...proposal.stages[1], id: 'observer', title: 'Observe compiler', action: 'review:observation',
    workOrder: 'Observe only when scheduled.', dependsOn: ['compile'], humanGates: [],
  });
  danglingParticipant.iterationGroups![0].participants.push({
    participantId: 'ghost', stageRef: 'observer', role: 'contributor',
    perspective: 'Observe the compiler.', mandate: 'Contribute only when scheduled.',
  });
  expect(validateServerCompiledPlanProposal(danglingParticipant, REGISTRY)).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/participant 'ghost'.*recipient.*reachable/),
  });

  const parkedSuccessor = structuredClone(compiled);
  parkedSuccessor.iterationGroups![0].routes.push({
    routeId: 'parked-return', senderParticipantId: 'judge', recipientParticipantId: 'producer',
    requestKinds: ['reply'], baseResolutionStageIds: ['review'],
  });
  parkedSuccessor.iterationGroups![0].schedule.push({
    stepId: 'invalid-parked-successor', routeId: 'parked-return',
    after: { stepId: 'review', participantId: 'judge', verdict: 'parked' }, cycle: 'current',
  });
  expect(validateServerCompiledPlanProposal(parkedSuccessor, REGISTRY)).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/parked.*must not have.*successor/),
  });

  const gateCollision = structuredClone(compiled);
  gateCollision.stages[1] = {
    ...gateCollision.stages[1],
    assignment: {
      agentId: 'fyt-checker', declarationPath: 'agents/fyt-checker.md', declarationHash: 'c'.repeat(64),
      profileId: 'worker:claude:claude-sonnet-5', runtime: 'claude', model: 'claude-sonnet-5',
    },
    workflowProfile: 'checker-readonly',
    review: { subjectStageId: 'compile', maxCreatorReworks: 1, criteria: [{ id: 'quality', description: 'Compiler is complete.' }] },
    completionGate: { id: 'shared-completion', kind: 'approval', prompt: 'Stage approval.', requiresReview: 'pass' },
  };
  gateCollision.iterationGroups![0].completionGate = {
    id: 'shared-completion', kind: 'approval', prompt: 'Different group approval.', requiresReview: 'pass',
  };
  expect(validateServerCompiledPlanProposal(gateCollision, { ...REGISTRY, workflowProfiles: ['checker-readonly'] })).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/duplicate human gate id 'shared-completion'/),
  });
});
