/**
 * C2 — the pure artifact-type registry (the convergence spine). These tests pin the seed prompts, the
 * per-kind draft schemas, and the deploy mapping so a later edit can't silently break the contract the
 * convergence UI (C3) and the deploy dispatcher (C4) depend on.
 *
 * The registry is PURE: no I/O, no network, no React, no Date.now. Every assertion below is deterministic.
 * The one place the server is ground truth — the coordination-vs-durable split — is cross-checked against
 * the exact prefixes `server/write/branch.ts#classifyTarget` uses (queue/ ledgers/ traces/ → coordination,
 * everything else durable), mirrored locally in the registry (a client-pure module may not import a server
 * module).
 */
import { describe, expect, it } from 'vitest';
import {
  seedTemplate,
  validateDraft,
  toDeploy,
  ARTIFACT_KINDS,
  type ArtifactKind,
  type TaskDraft,
  type SkillDraft,
  type WorkflowDraft,
  type ProjectDraft,
  type AgentDraft,
} from './artifactTypes';
import { parseWorkflowDef } from '../../server/workflows/defs';

function workflow(over: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    filename: 'nightly.md',
    project: 'kb',
    profile: 'research',
    body: 'steps',
    stages: [{ id: 'stage-1', action: 'research', target: 'orgs/kb', workOrder: 'Do the work', riskTier: 'T2', dependsOn: [] }],
    ...over,
  };
}

describe('composer/artifactTypes — seeds', () => {
  it('idea_seed_asks_for_type_disambiguation', () => {
    const seed = seedTemplate('idea', 'a bot that watches the queue and pings me');
    // Idea-first is binding: the unknown seed must ask the model to help decide which type the idea
    // wants to become, and must name the four v1 kinds.
    expect(seed).toMatch(/which (type|kind)/i);
    for (const kind of ['task', 'workflow', 'skill', 'project', 'agent']) {
      expect(seed.toLowerCase()).toContain(kind);
    }
    // The operator's idea text is woven into the seed so the first turn has context.
    expect(seed).toContain('a bot that watches the queue and pings me');
    // C7 un-defers `agent`: the disambiguation seed now offers it as a fifth convergence target.
    expect(seed.toLowerCase()).toContain('agent');
  });

  it('every concrete kind has a house-authored seed carrying its deploy contract', () => {
    for (const kind of ARTIFACT_KINDS) {
      const seed = seedTemplate(kind, 'my idea');
      expect(seed.length).toBeGreaterThan(0);
      expect(seed).toContain('my idea');
    }
  });
});

describe('composer/artifactTypes — draft schemas', () => {
  it('task_draft_maps_to_launch_fields', () => {
    const draft: TaskDraft = {
      project: 'm1-dashboard',
      action: 'build',
      target: 'src/foo.ts',
      riskTier: 'T2',
      body: 'do the thing',
    };
    expect(validateDraft('task', draft)).toEqual([]);
    const plan = toDeploy('task', draft);
    // A Task maps to exactly the fields LaunchControls POSTs to /api/write/launch (server truth:
    // scripts/cards.py#_validate REQUIRED project/action/target/risk-tier).
    expect(plan.launchFields).toEqual({
      project: 'm1-dashboard',
      action: 'build',
      target: 'src/foo.ts',
      riskTier: 'T2',
      body: 'do the thing',
    });
  });

  it('task draft reports problems for missing fields and a bad risk tier', () => {
    const bad: TaskDraft = { project: '', action: '', target: '', riskTier: 'T9' as TaskDraft['riskTier'], body: '' };
    const problems = validateDraft('task', bad);
    const fields = problems.map((p) => p.field);
    expect(fields).toContain('project');
    expect(fields).toContain('action');
    expect(fields).toContain('target');
    expect(fields).toContain('riskTier');
  });

  it('skill_draft_requires_name_and_description_frontmatter', () => {
    const ok: SkillDraft = { name: 'Queue Watcher', description: 'pings on new inbox cards', body: '# body' };
    expect(validateDraft('skill', ok)).toEqual([]);

    const missing: SkillDraft = { name: '', description: '', body: '' };
    const fields = validateDraft('skill', missing).map((p) => p.field);
    // registry/skills.ts reads exactly `name` + `description` frontmatter — both are required.
    expect(fields).toContain('name');
    expect(fields).toContain('description');
  });

  it('workflow_draft_requires_canonical_filename_and_profile', () => {
    const ok: WorkflowDraft = workflow();
    expect(validateDraft('workflow', ok)).toEqual([]);

    const badName = validateDraft('workflow', workflow({ filename: 'wf_nightly.md' }));
    expect(badName.map((p) => p.field)).toContain('filename');

    const missingProfile = validateDraft('workflow', workflow({ profile: '' }));
    expect(missingProfile.map((p) => p.field)).toContain('profile');

    const badBody = validateDraft('workflow', workflow({ body: '' }));
    expect(badBody.map((p) => p.field)).toContain('body');
  });

  it('project_draft_renders_four_template_files', () => {
    const draft: ProjectDraft = { name: 'atlas', date: '2026-07-17' };
    expect(validateDraft('project', draft)).toEqual([]);
    const plan = toDeploy('project', draft);

    // Primary action is ONE file — the rendered _index.md (Daniel's v1 decision: multi-file artifacts
    // deploy the primary file only; the other three ride along as followUps the UI can offer as saves).
    expect(plan.relpath).toBe('orgs/atlas/_index.md');
    expect(plan.content).toContain('atlas — index');
    expect(plan.content).not.toContain('{{name}}');

    const all = [plan, ...(plan.followUps ?? [])];
    expect(all.map((f) => f.relpath).sort()).toEqual([
      'orgs/atlas/HEARTBEAT.md',
      'orgs/atlas/STATE.md',
      'orgs/atlas/_index.md',
      'orgs/atlas/contract.md',
    ]);
    // Placeholders are fully substituted across every rendered file.
    for (const f of all) {
      expect(f.content).not.toContain('{{name}}');
      expect(f.content).not.toContain('{{date}}');
    }
    // {{date}} was actually filled where the template uses it (STATE.md).
    const state = all.find((f) => f.relpath.endsWith('STATE.md'))!;
    expect(state.content).toContain('2026-07-17');
  });

  it('invalid_draft_reports_problems_and_blocks_deploy', () => {
    const bad: SkillDraft = { name: '', description: '', body: '' };
    const problems = validateDraft('skill', bad);
    expect(problems.length).toBeGreaterThan(0);
    // Deploy is blocked at the registry level: toDeploy refuses an invalid draft rather than emitting a
    // half-formed plan the UI might send to a governed endpoint.
    expect(() => toDeploy('skill', bad)).toThrow();
  });
});

describe('composer/artifactTypes — deploy mapping', () => {
  it('toDeploy_task_is_coordination_others_durable', () => {
    const task = toDeploy('task', {
      project: 'p',
      action: 'a',
      target: 't',
      riskTier: 'T1',
      body: '',
    });
    expect(task.kind).toBe('task');
    expect(task.branchClass).toBe('coordination');
    expect(task.endpoint).toBe('launch');
    // Agreement with classifyTarget: a coordination relpath starts with one of queue/ ledgers/ traces/.
    expect(task.relpath.startsWith('queue/')).toBe(true);

    const durable: Array<[ArtifactKind, unknown]> = [
      ['skill', { name: 'n', description: 'd', body: 'b' } satisfies SkillDraft],
      ['workflow', workflow({ filename: 'x.md', body: 'b' })],
      ['project', { name: 'proj', date: '2026-07-17' } satisfies ProjectDraft],
    ];
    for (const [kind, draft] of durable) {
      const plan = toDeploy(kind, draft as never);
      expect(plan.branchClass).toBe('durable');
      expect(plan.endpoint).toBe('save');
      // None of the durable relpaths fall under a coordination prefix.
      for (const prefix of ['queue/', 'ledgers/', 'traces/']) {
        expect(plan.relpath.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('skill_targets_learned_tier_never_curated', () => {
    const plan = toDeploy('skill', { name: 'Queue Watcher', description: 'd', body: 'b' });
    // Daniel's binding decision: Composer skills land in the LEARNED tier (never mirrored/synced by the
    // sync_skills hook); a human promotes to curated later. The path must be skills/learned/<slug>/SKILL.md.
    expect(plan.relpath).toMatch(/^skills\/learned\/[a-z0-9-]+\/SKILL\.md$/);
    expect(plan.relpath).not.toContain('curated');
    // Frontmatter the registry reads is present in the emitted content.
    expect(plan.content).toContain('name: Queue Watcher');
    expect(plan.content).toContain('description: d');
  });

  it('workflow deploy targets a canonical project workflow definition', () => {
    const plan = toDeploy('workflow', workflow({ body: 'the steps' }));
    expect(plan.relpath).toBe('orgs/kb/workflows/nightly.md');
    expect(plan.content).toContain('the steps');
    expect(plan.content).toContain('profile: "research"');
    expect(plan.content).toContain('workOrder: "Do the work"');
    expect(plan.content).not.toContain('workflow-v1');
    expect(plan.content).not.toContain('owner:');
    expect(parseWorkflowDef(plan.content, { knownProfiles: new Set(['research']) })).toMatchObject({
      ok: true,
      value: { id: 'nightly', project: 'kb', profile: 'research' },
    });
    expect(plan.branchClass).toBe('durable');
    expect(plan.endpoint).toBe('save');
  });

  it('workflow stage emits a logical agent/profile pair without raw executor routing fields', () => {
    const plan = toDeploy('workflow', workflow({
      stages: [{
        id: 'stage-1', action: 'research', target: 'orgs/kb', workOrder: 'Do the work', riskTier: 'T2', dependsOn: [],
        agentId: 'fyt-runner', profileId: 'worker:claude:claude-opus-4-8',
      }],
    }));

    expect(plan.content).toContain('agentId: "fyt-runner"');
    expect(plan.content).toContain('profileId: "worker:claude:claude-opus-4-8"');
    expect(plan.content).not.toContain('owner:');
    expect(plan.content).not.toContain('runtime:');
    expect(plan.content).not.toContain('model:');
  });

  it('workflow stage requires an all-or-nothing logical agent/profile pair', () => {
    const withAgentOnly = workflow({ stages: [{
      id: 'stage-1', action: 'research', target: 'orgs/kb', workOrder: 'Do the work', riskTier: 'T2', dependsOn: [],
      agentId: 'fyt-runner',
    }] });
    const withProfileOnly = workflow({ stages: [{
      id: 'stage-1', action: 'research', target: 'orgs/kb', workOrder: 'Do the work', riskTier: 'T2', dependsOn: [],
      profileId: 'worker:claude:claude-opus-4-8',
    }] });

    for (const draft of [withAgentOnly, withProfileOnly]) {
      expect(validateDraft('workflow', draft).map((problem) => problem.field)).toContain('stages[0].assignment');
      expect(() => toDeploy('workflow', draft)).toThrow();
    }
  });

  it('legacy workflow stage serialization remains byte-for-byte unchanged without an assignment pair', () => {
    expect(toDeploy('workflow', workflow()).content).toBe([
      '---',
      'id: "nightly"',
      'project: "kb"',
      'title: "nightly"',
      'profile: "research"',
      'stages:',
      '  - id: "stage-1"',
      '    title: "stage-1"',
      '    action: "research"',
      '    target: "orgs/kb"',
      '    workOrder: "Do the work"',
      '    riskTier: "T2"',
      '    dependsOn: []',
      '---',
      '',
      '# nightly',
      '',
      'steps',
      '',
    ].join('\n'));
  });
});

describe('composer/artifactTypes — F4 client-side path-traversal rejection', () => {
  // Workflow filenames are path segments under the canonical project workflows directory; slug-derived skill/project names could
  // collapse to an empty on-disk segment (`skills/learned//SKILL.md`). validateDraft must now REPORT
  // these and toDeploy must refuse them (defense-in-depth + honest preview; the server still owns real
  // confinement).
  it('rejects a workflow filename carrying path traversal', () => {
    for (const filename of ['../../x.md', '../secrets.md', 'a/b.md']) {
      const problems = validateDraft('workflow', workflow({ filename }));
      expect(problems.map((p) => p.field)).toContain('filename');
      expect(() => toDeploy('workflow', workflow({ filename }))).toThrow();
    }
  });

  it('rejects a skill name that would escape/empty its learned/<slug> segment', () => {
    for (const name of ['..', '../../etc', 'a/b']) {
      const problems = validateDraft('skill', { name, description: 'd', body: 'b' });
      expect(problems.map((p) => p.field)).toContain('name');
      expect(() => toDeploy('skill', { name, description: 'd', body: 'b' })).toThrow();
    }
  });

  it('rejects a project name that would escape/empty its orgs/<slug> segment', () => {
    for (const name of ['..', '../evil', 'x/y']) {
      const problems = validateDraft('project', { name, date: '2026-07-17' });
      expect(problems.map((p) => p.field)).toContain('name');
      expect(() => toDeploy('project', { name, date: '2026-07-17' })).toThrow();
    }
  });
});

describe('composer/artifactTypes — agent kind (C7.1)', () => {
  // The registered-vs-runnable reality (plan Flagged #2): the file DECLARES an identity; the client is an
  // honest preview only — the server owns the authoritative registry / impersonation checks (C7.6).
  const validAgent: AgentDraft = {
    id: 'research-worker',
    role: 'work',
    runtime: 'claude',
    model: 'claude-sonnet-5',
    projects: ['kb-ops'],
    description: 'Volume worker for kb-ops housekeeping cards.',
    body: '# Agent: research-worker\n',
  };

  it('agent is a member of ARTIFACT_KINDS', () => {
    expect(ARTIFACT_KINDS).toContain('agent');
  });

  it('valid_agent_draft_has_no_problems', () => {
    expect(validateDraft('agent', validAgent)).toEqual([]);
  });

  it('model is optional but must be non-empty when present', () => {
    expect(validateDraft('agent', { ...validAgent, model: undefined })).toEqual([]);
    expect(validateDraft('agent', { ...validAgent, model: '   ' }).map((p) => p.field)).toContain('model');
  });

  it('requires id + description and a valid role + runtime', () => {
    const bad: AgentDraft = {
      id: '',
      role: 'boss' as AgentDraft['role'],
      runtime: 'gpt' as AgentDraft['runtime'],
      description: '',
    };
    const fields = validateDraft('agent', bad).map((p) => p.field);
    expect(fields).toContain('id');
    expect(fields).toContain('role');
    expect(fields).toContain('runtime');
    expect(fields).toContain('description');
  });

  it('rejects an id carrying path traversal / separators / a leading dot (F4 guard)', () => {
    // id becomes agents/<slug>.md, the card owner, the routing-override key, and a git user.name — this is
    // the load-bearing check. Mirrors the existing skill/project traversal tests.
    for (const id of ['..', '../../etc', 'a/b', '.hidden', 'a\\b']) {
      const problems = validateDraft('agent', { ...validAgent, id });
      expect(problems.map((p) => p.field)).toContain('id');
      expect(() => toDeploy('agent', { ...validAgent, id })).toThrow();
    }
  });

  it('rejects an id that shadows a reserved runtime identity (anti-impersonation honest preview)', () => {
    // The AUTHORITATIVE humans.yaml / existing-agent collision check is SERVER-SIDE (C7.6) — this is only
    // the honest client preview over the small mirrored reserved set.
    for (const id of ['worker-desktop', 'codex-worker', 'Codex-Worker', 'CODEX-WORKER']) {
      expect(validateDraft('agent', { ...validAgent, id }).map((p) => p.field)).toContain('id');
    }
  });

  it('toDeploy emits a durable agents/<slug>.md save with runner-bound hard-coded false', () => {
    const plan = toDeploy('agent', validAgent);
    expect(plan.kind).toBe('agent');
    expect(plan.relpath).toBe('agents/research-worker.md');
    expect(plan.branchClass).toBe('durable');
    expect(plan.endpoint).toBe('save');
    // The registry NEVER writes runner-bound: true (plan Flagged #2 — a human binds a runner).
    expect(plan.content).toContain('runner-bound: false');
    expect(plan.content).not.toContain('runner-bound: true');
    // The declared identity + defaults land in the frontmatter.
    expect(plan.content).toContain('id: research-worker');
    expect(plan.content).toContain('role: work');
    expect(plan.content).toContain('runtime: claude');
    // agents/ is not a coordination prefix — durable, PR-to-main.
    for (const prefix of ['queue/', 'ledgers/', 'traces/']) {
      expect(plan.relpath.startsWith(prefix)).toBe(false);
    }
  });

  it('slugifies the id into the relpath segment', () => {
    const plan = toDeploy('agent', { ...validAgent, id: 'Nightly Auditor' });
    expect(plan.relpath).toBe('agents/nightly-auditor.md');
  });

  it('agent kind seed states the schema and the declare-vs-run (runner) reality', () => {
    const seed = seedTemplate('agent', 'a nightly ledger auditor');
    expect(seed).toContain('a nightly ledger auditor');
    expect(seed).toMatch(/agents\//); // names the agents/<id>.md home
    expect(seed.toLowerCase()).toMatch(/runner/); // registered-vs-runnable honesty
  });
});
