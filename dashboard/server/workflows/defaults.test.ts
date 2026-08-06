/**
 * Hermetic tests for the PURE default-assignment resolver. No filesystem, no roster read: every test
 * hands `resolveWorkflowDefaults` an explicit roster, so each precedence rung is pinned in isolation and
 * each test name states the rule it enforces.
 */
import { describe, expect, it } from 'vitest';
import type { AgentRosterEntry } from '../agents/roster.ts';
import type { WorkflowDef, WorkflowStageDef } from './defs.ts';
import { renderWorkflowPriming, resolveWorkflowDefaults, stagesInDependencyOrder } from './defaults.ts';

function agent(overrides: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
  return {
    displayName: overrides.id,
    shortRef: 1,
    role: 'work',
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
    sources: [],
    effective: { runtime: 'claude', model: 'claude-sonnet-5', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: true,
    runnerBound: true,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ...overrides,
  };
}

function stage(overrides: Partial<WorkflowStageDef> & { id: string }): WorkflowStageDef {
  return {
    title: `stage ${overrides.id}`,
    action: 'draft:thing',
    target: 'orgs/demo/output',
    workOrder: 'do the thing',
    dependsOn: [],
    riskTier: 'T2',
    declaredRiskTier: 'T2',
    classifiedFloor: 'T1',
    ...overrides,
  };
}

function def(overrides: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    id: 'demo-run',
    project: 'demo',
    title: 'Demo run',
    profile: 'producer',
    readScope: [],
    parameters: [],
    description: 'demo',
    stages: [stage({ id: 's1' })],
    ...overrides,
  };
}

describe('resolveWorkflowDefaults — manager precedence', () => {
  it('a DECLARED manager wins over governedBy (the explicit executable assignment is the override)', () => {
    const roster = [agent({ id: 'gov-agent' }), agent({ id: 'boss', defaultProfile: 'manager:claude:x' })];
    const defaults = resolveWorkflowDefaults(
      def({ governedBy: 'gov-agent', manager: { agentId: 'boss', profileId: 'manager:claude:explicit' } }),
      roster,
    );
    expect(defaults.manager).toEqual({
      agentId: 'boss',
      profileId: 'manager:claude:explicit',
      model: 'claude-sonnet-5',
      source: 'declared',
    });
  });

  it('governedBy resolves the manager when no manager is declared', () => {
    const roster = [agent({ id: 'fyt-runner', role: 'manage', defaultProfile: 'manager:codex:gpt-5.6-sol' })];
    const defaults = resolveWorkflowDefaults(def({ governedBy: 'fyt-runner' }), roster);
    expect(defaults.manager).toEqual({
      agentId: 'fyt-runner',
      profileId: 'manager:codex:gpt-5.6-sol',
      model: 'claude-sonnet-5',
      source: 'governed-by',
    });
  });

  it('governedBy naming an agent that is NOT declared falls through instead of fabricating one', () => {
    const roster = [agent({ id: 'ghost', declared: false, projects: ['demo'] })];
    expect(resolveWorkflowDefaults(def({ governedBy: 'ghost' }), roster).manager).toBeNull();
  });

  it('picks the project-manager when EXACTLY ONE declared manager-role agent serves that project', () => {
    const roster = [
      agent({ id: 'boss', role: 'manage', projects: ['demo'], defaultProfile: 'manager:claude:m' }),
      agent({ id: 'hand', role: 'work', projects: ['demo'] }),
      agent({ id: 'other-boss', role: 'manage', projects: ['elsewhere'] }),
    ];
    expect(resolveWorkflowDefaults(def(), roster).manager).toEqual({
      agentId: 'boss',
      profileId: 'manager:claude:m',
      model: 'claude-sonnet-5',
      source: 'project-manager',
    });
  });

  it('AMBIGUITY — two declared manager-role agents in the project resolves to null, never a guess', () => {
    const roster = [
      agent({ id: 'boss-a', role: 'manage', projects: ['demo'] }),
      agent({ id: 'boss-b', role: 'manager', projects: ['demo'] }),
    ];
    expect(resolveWorkflowDefaults(def(), roster).manager).toBeNull();
  });

  it('falls back to the SOLE declared project agent when the project has no manager-role agent', () => {
    const roster = [
      agent({ id: 'lonely', role: 'work', projects: ['demo'], defaultProfile: 'worker:claude:w' }),
      agent({ id: 'stranger', role: 'manage', projects: ['elsewhere'] }),
    ];
    expect(resolveWorkflowDefaults(def(), roster).manager).toEqual({
      agentId: 'lonely',
      profileId: 'worker:claude:w',
      model: 'claude-sonnet-5',
      source: 'sole-project-agent',
    });
  });

  it('a project with ZERO declared agents resolves manager null and every stage null WITHOUT throwing', () => {
    const roster = [agent({ id: 'elsewhere-agent', projects: ['other'] })];
    const defaults = resolveWorkflowDefaults(
      def({ stages: [stage({ id: 'triage' }), stage({ id: 'report', dependsOn: ['triage'] })] }),
      roster,
    );
    expect(defaults).toEqual({ manager: null, stages: { triage: null, report: null } });
  });

  it('an EMPTY roster resolves everything to null without throwing', () => {
    expect(resolveWorkflowDefaults(def(), [])).toEqual({ manager: null, stages: { s1: null } });
  });
});

describe('resolveWorkflowDefaults — stage precedence', () => {
  it('a DECLARED stage assignment beats both the stage governor and the manager default', () => {
    const roster = [
      agent({ id: 'boss', role: 'manage', projects: ['demo'] }),
      agent({ id: 'gov', projects: ['demo'] }),
      agent({ id: 'worker-x', projects: ['demo'], defaultProfile: 'worker:claude:roster-default' }),
    ];
    const defaults = resolveWorkflowDefaults(
      def({
        governedBy: 'boss',
        stages: [stage({ id: 's1', governedBy: 'gov', agentId: 'worker-x', profileId: 'worker:claude:declared' })],
      }),
      roster,
    );
    expect(defaults.stages.s1).toEqual({
      agentId: 'worker-x',
      profileId: 'worker:claude:declared',
      model: 'claude-sonnet-5',
      source: 'declared',
    });
  });

  it("a stage's own governedBy resolves it when it declares no executable assignment", () => {
    const roster = [
      agent({ id: 'fyt-runner', role: 'manage', projects: ['demo'] }),
      agent({ id: 'fyt-checker', role: 'inspect', projects: ['demo'], defaultProfile: 'worker:codex:gpt-5.6-sol' }),
    ];
    const defaults = resolveWorkflowDefaults(
      def({ governedBy: 'fyt-runner', stages: [stage({ id: 'judge-gate', governedBy: 'fyt-checker' })] }),
      roster,
    );
    expect(defaults.stages['judge-gate']).toEqual({
      agentId: 'fyt-checker',
      profileId: 'worker:codex:gpt-5.6-sol',
      model: 'claude-sonnet-5',
      source: 'stage-governed-by',
    });
  });

  it('a stage governedBy naming an UNDECLARED agent falls through to the manager, never fabricating one', () => {
    const roster = [
      agent({ id: 'boss', role: 'manage', projects: ['demo'], defaultProfile: 'manager:claude:m' }),
      agent({ id: 'phantom', declared: false, projects: ['demo'] }),
    ];
    const defaults = resolveWorkflowDefaults(
      def({ governedBy: 'boss', stages: [stage({ id: 's1', governedBy: 'phantom' })] }),
      roster,
    );
    expect(defaults.stages.s1).toEqual({
      agentId: 'boss',
      profileId: 'manager:claude:m',
      model: 'claude-sonnet-5',
      source: 'manager-default',
    });
  });

  it('an unassigned, ungoverned stage inherits the manager re-stamped as manager-default', () => {
    const roster = [agent({ id: 'boss', role: 'manage', projects: ['demo'], defaultProfile: 'manager:claude:m' })];
    const defaults = resolveWorkflowDefaults(def({ stages: [stage({ id: 'only' })] }), roster);
    expect(defaults.manager?.source).toBe('project-manager');
    expect(defaults.stages.only).toEqual({
      agentId: 'boss',
      profileId: 'manager:claude:m',
      model: 'claude-sonnet-5',
      source: 'manager-default',
    });
  });
});

describe('resolveWorkflowDefaults — model comes from the roster, never invented', () => {
  it('carries the roster entry effective.model onto every resolved assignment', () => {
    const roster = [
      agent({ id: 'boss', role: 'manage', projects: ['demo'], effective: { runtime: 'codex', model: 'gpt-5.6-sol', sourceRuntime: 'override', sourceModel: 'override' } }),
    ];
    const defaults = resolveWorkflowDefaults(def({ stages: [stage({ id: 's1' })] }), roster);
    expect(defaults.manager?.model).toBe('gpt-5.6-sol');
    expect(defaults.stages.s1?.model).toBe('gpt-5.6-sol');
  });

  it('a declared agent id with NO roster entry resolves model null rather than a fallback model', () => {
    const defaults = resolveWorkflowDefaults(
      def({ manager: { agentId: 'off-roster', profileId: 'manager:claude:x' } }),
      [],
    );
    expect(defaults.manager).toEqual({
      agentId: 'off-roster',
      profileId: 'manager:claude:x',
      model: null,
      source: 'declared',
    });
  });

  it('an empty effective model resolves to null, not an empty string', () => {
    const roster = [agent({ id: 'boss', role: 'manage', projects: ['demo'], effective: { runtime: 'claude', model: '', sourceRuntime: 'default', sourceModel: 'default' } })];
    expect(resolveWorkflowDefaults(def(), roster).manager?.model).toBeNull();
  });
});

describe('resolveWorkflowDefaults — the two real definition shapes in this repo', () => {
  /** `video-run` on ops: workflow `governedBy: fyt-runner`, a per-stage `governedBy` chain, and NO
   *  executable assignment anywhere. The whole cast must come out of the governance chain. */
  it('a governedBy-only video-run shape resolves the manager and a real PER-STAGE cast', () => {
    const roster = [
      agent({ id: 'fyt-runner', role: 'manage', projects: ['faceless-youtube'], defaultProfile: 'manager:codex:gpt-5.6-sol' }),
      agent({ id: 'fyt-preproduction', role: 'work', projects: [] }),
      agent({ id: 'fyt-checker', role: 'inspect', projects: ['faceless-youtube'], defaultProfile: 'worker:codex:gpt-5.6-sol' }),
    ];
    const defaults = resolveWorkflowDefaults(
      def({
        id: 'video-run',
        project: 'faceless-youtube',
        governedBy: 'fyt-runner',
        stages: [
          stage({ id: 'idea', governedBy: 'fyt-preproduction' }),
          stage({ id: 'research', governedBy: 'fyt-preproduction', dependsOn: ['idea'] }),
          stage({ id: 'script', governedBy: 'fyt-preproduction', dependsOn: ['research'] }),
          stage({ id: 'judge-gate', governedBy: 'fyt-checker', dependsOn: ['script'] }),
          stage({ id: 'image-review', governedBy: 'fyt-runner', dependsOn: ['judge-gate'] }),
        ],
      }),
      roster,
    );
    expect(defaults.manager).toMatchObject({ agentId: 'fyt-runner', source: 'governed-by' });
    expect(defaults.stages.idea).toMatchObject({ agentId: 'fyt-preproduction', source: 'stage-governed-by' });
    expect(defaults.stages.research).toMatchObject({ agentId: 'fyt-preproduction', source: 'stage-governed-by' });
    expect(defaults.stages.script).toMatchObject({ agentId: 'fyt-preproduction', source: 'stage-governed-by' });
    expect(defaults.stages['judge-gate']).toMatchObject({ agentId: 'fyt-checker', source: 'stage-governed-by' });
    expect(defaults.stages['image-review']).toMatchObject({ agentId: 'fyt-runner', source: 'stage-governed-by' });
  });

  /** `email-triage` in kb-ops: no manager, no governedBy, no stage assignment, and no declared agent
   *  claims the `kb-ops` project. This must resolve all-null and must never throw. */
  it('the kb-ops email-triage shape (no governance, no project agents) resolves all-null without throwing', () => {
    const roster = [agent({ id: 'fyt-runner', role: 'manage', projects: ['faceless-youtube'] })];
    const defaults = resolveWorkflowDefaults(
      def({ id: 'email-triage', project: 'kb-ops', stages: [stage({ id: 'triage', target: 'orgs/kb-ops/output' })] }),
      roster,
    );
    expect(defaults).toEqual({ manager: null, stages: { triage: null } });
  });
});

describe('stagesInDependencyOrder / renderWorkflowPriming', () => {
  it('orders stages by dependency, keeping declared order among ready stages', () => {
    const ordered = stagesInDependencyOrder(
      def({
        stages: [
          stage({ id: 'c', dependsOn: ['b'] }),
          stage({ id: 'a' }),
          stage({ id: 'b', dependsOn: ['a'] }),
        ],
      }),
    );
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('names the workflow, its repo-relative path, its parameters, and the resolved cast inline', () => {
    const roster = [
      agent({ id: 'fyt-runner', role: 'manage', projects: ['faceless-youtube'], defaultProfile: 'manager:codex:gpt-5.6-sol' }),
      agent({ id: 'fyt-checker', role: 'inspect', projects: ['faceless-youtube'] }),
    ];
    const definition = def({
      id: 'video-run',
      project: 'faceless-youtube',
      title: 'Produce one video',
      governedBy: 'fyt-runner',
      parameters: ['channel', 'slug'],
      stages: [stage({ id: 'idea' }), stage({ id: 'judge-gate', governedBy: 'fyt-checker', dependsOn: ['idea'] })],
    });
    const text = renderWorkflowPriming(definition, resolveWorkflowDefaults(definition, roster), 'orgs/faceless-youtube/workflows/video-run.md');

    expect(text).toContain('# Governing agent — workflow: Produce one video');
    expect(text).toContain('- workflow ref: video-run');
    expect(text).toContain('- definition (repo-relative): orgs/faceless-youtube/workflows/video-run.md');
    expect(text).toContain('- default manager: fyt-runner (claude-sonnet-5) [governed-by]');
    expect(text).toContain('- channel');
    expect(text).toContain('- slug');
    expect(text).toContain('idea — stage idea — draft:thing → fyt-runner (claude-sonnet-5) [manager-default]');
    expect(text).toContain('judge-gate — stage judge-gate — draft:thing → fyt-checker (claude-sonnet-5) [stage-governed-by]');
    expect(text).toContain('HEAD, GOVERNING agent');
    expect(text).toContain('CONVERSATIONALLY');
  });

  it('prints an honest "no default agent resolvable" line instead of inventing a cast', () => {
    const definition = def({ id: 'email-triage', project: 'kb-ops', title: 'Email triage', stages: [stage({ id: 'triage' })] });
    const text = renderWorkflowPriming(definition, resolveWorkflowDefaults(definition, []), 'orgs/kb-ops/workflows/email-triage.md');
    expect(text).toContain('- default manager: no default agent resolvable');
    expect(text).toContain('triage — stage triage — draft:thing → no default agent resolvable');
    expect(text).toContain('(none — this workflow declares no launch parameters)');
  });
});
