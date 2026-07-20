import { describe, expect, it } from 'vitest';
import { parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';
import { validatePlanProposal } from '../control/proposal.ts';
import type { RuntimeSkillRegistry } from '../control/environment.ts';

const REGISTRY: RuntimeSkillRegistry = {
  runtimes: {
    claude: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    codex: ['gpt-5.6-sol'],
  },
  skills: [],
  // The proposal validator fails CLOSED on `profile`: an absent or empty list admits nothing, so a
  // registry without this field refuses every compiled proposal. The fixture must publish the same
  // closed set the def parser validates against.
  workflowProfiles: ['research', 'gmail-triage', 'drive-author', 'producer'],
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
