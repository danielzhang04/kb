/**
 * `control/ownerTags.ts` — the launch-time derivation of a run's governing `publish`/`spend` tag set.
 *
 * MEDIUM-4 (adversarial security review, 2026-09-16). The predecessor of this derivation lived inline in
 * `control/routes.ts#resolveRunWorkflowTags` and read, for a non-workflow owner:
 *
 *     if (owner.type !== 'workflow') return WORKFLOW_TAGS_NONE;   // the EMPTY set
 *
 * Every other unresolvable case in that function returned the maximal `{publish, spend}`. The
 * agent-owned arm was the single exception and failed OPEN. It was safe by accident — an
 * `agents/*.md` declaration cannot carry a `publicationAuthorization`/`spendAuthorization` gate, since
 * those fields live on `WorkflowStageDef` — but it is the arm most likely to be reached the moment agent
 * declarations grow gates, and "fails open" is not a property to leave lying around in an authority rule.
 *
 * An agent-owned run is now DERIVED like any other: from what the declaration can actually say (a
 * `publish:`/`spend:` action in `tools`/`skills`, or a publish/spend-capable tool granted directly or by
 * a named profile), and it is UNTAGGED only when nothing in it publishes or spends. An owner that cannot
 * be pinned to a declaration at all fails closed.
 */
import { describe, expect, it } from 'vitest';
import {
  FAIL_CLOSED_RUN_TAGS, PUBLISH_CAPABLE_TOOLS, agentOwnerTags, deriveOwnerTags,
  type DeclaredAgentLike, type OwnerTagSources, type ScannedWorkflowDefLike,
} from './ownerTags.ts';
import { FORBIDDEN_WORKFLOW_TOOLS, WORKFLOW_EXECUTION_PROFILES } from './workflowProfiles.ts';
import { parseWorkflowDef } from '../workflows/defs.ts';
import type { RunnableRef } from './p2Contracts.ts';

const KNOWN_PROFILES = new Set(WORKFLOW_EXECUTION_PROFILES.map((profile) => profile.id));
const profileTools = (id: string): readonly string[] =>
  WORKFLOW_EXECUTION_PROFILES.find((profile) => profile.id === id)?.allowedTools ?? [];

function agent(overrides: Partial<DeclaredAgentLike> = {}): DeclaredAgentLike {
  return { id: 'grader', source: 'agents/grader.md', tools: [], skills: [], defaultProfile: null, allowedProfiles: [], ...overrides };
}

const AGENT_OWNER: RunnableRef = { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' };
const WORKFLOW_OWNER: RunnableRef = {
  type: 'workflow', id: 'pubflow', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/pubflow.md',
};

function workflowDef(lines: string[]): ScannedWorkflowDefLike {
  const parsed = parseWorkflowDef(`---\n${lines.join('\n')}\n---\n\nBody.\n`, { knownProfiles: KNOWN_PROFILES });
  if (!parsed.ok) throw new Error(parsed.detail);
  return { entry: { path: 'orgs/kb-ops/workflows/pubflow.md', valid: true }, def: parsed.value };
}

function sources(over: Partial<OwnerTagSources> = {}): OwnerTagSources {
  return {
    workflowDefs: () => [],
    agentDeclarations: () => new Map<string, DeclaredAgentLike>(),
    profileTools,
    ...over,
  };
}

const PUBFLOW = [
  'id: pubflow', 'project: kb-ops', 'title: Pub flow', 'profile: scanner', 'stages:',
  '  - id: report', '    title: Report', '    action: report:self-lint',
  '    target: orgs/kb-ops/output', '    riskTier: T1',
];

describe('the publish-capable tool list does not drift from the profile table', () => {
  it('is exactly `FORBIDDEN_WORKFLOW_TOOLS` — the closed list of external publish/send tools', () => {
    expect([...PUBLISH_CAPABLE_TOOLS].sort()).toEqual([...FORBIDDEN_WORKFLOW_TOOLS].sort());
  });

  it('is disjoint from every server-owned profile, so no shipped profile tags a run `publish`', () => {
    // The invariant `workflowProfiles.ts` states in prose ("no default profile grants a publish/send
    // capability"), asserted. If a profile ever gains one, this goes red AND the derivation below starts
    // tagging every agent that names it — both of which are the intended alarms.
    for (const profile of WORKFLOW_EXECUTION_PROFILES) {
      expect(profile.allowedTools.filter((tool) => PUBLISH_CAPABLE_TOOLS.includes(tool))).toEqual([]);
    }
  });
});

describe('agent-owned runs are derived, not assumed untagged', () => {
  it('is untagged when the declaration neither publishes nor spends', () => {
    expect(agentOwnerTags(agent({ tools: ['Read', 'Glob'], skills: ['research-brief'] }), profileTools)).toEqual([]);
    expect(deriveOwnerTags(AGENT_OWNER, sources({
      agentDeclarations: () => new Map([['grader', agent({ tools: ['Read'] })]]),
    }))).toEqual([]);
  });

  it('tags publish from a declared `publish:` action, in tools or in skills', () => {
    expect(agentOwnerTags(agent({ tools: ['publish:private-upload'] }), profileTools)).toEqual(['publish']);
    expect(agentOwnerTags(agent({ skills: ['publish:queue'] }), profileTools)).toEqual(['publish']);
  });

  it('tags spend from a declared `spend:` action, in tools or in skills', () => {
    expect(agentOwnerTags(agent({ tools: ['spend:paid-render'] }), profileTools)).toEqual(['spend']);
    expect(agentOwnerTags(agent({ skills: ['spend:gpu-hours'] }), profileTools)).toEqual(['spend']);
  });

  it('tags publish from a publish-capable tool the declaration grants directly', () => {
    for (const tool of PUBLISH_CAPABLE_TOOLS) {
      expect(agentOwnerTags(agent({ tools: ['Read', tool] }), profileTools)).toEqual(['publish']);
    }
  });

  it('tags publish from a publish-capable tool a NAMED PROFILE grants, not only a declared one', () => {
    // No shipped profile grants one (asserted above), so this uses an injected table — the point is that
    // the profile reach is consulted at all, which is what closes "the declaration lists no tool, but the
    // profile it names hands the worker an uploader".
    const publishing = (id: string) => (id === 'uploader' ? ['upload_video', 'Read'] : profileTools(id));
    expect(agentOwnerTags(agent({ defaultProfile: 'uploader' }), publishing)).toEqual(['publish']);
    expect(agentOwnerTags(agent({ allowedProfiles: ['scanner', 'uploader'] }), publishing)).toEqual(['publish']);
    expect(agentOwnerTags(agent({ allowedProfiles: ['scanner'] }), publishing)).toEqual([]);
  });

  it('tolerates a declaration that omits every list', () => {
    expect(agentOwnerTags({ id: 'grader', source: 'agents/grader.md' }, profileTools)).toEqual([]);
  });

  it('FAILS CLOSED when the agent owner cannot be pinned to a declaration', () => {
    // Unknown id...
    expect(deriveOwnerTags(AGENT_OWNER, sources())).toEqual([...FAIL_CLOSED_RUN_TAGS]);
    // ...and a declaration whose source path is not the one the run's owner names.
    expect(deriveOwnerTags(AGENT_OWNER, sources({
      agentDeclarations: () => new Map([['grader', agent({ source: 'agents/other.md' })]]),
    }))).toEqual([...FAIL_CLOSED_RUN_TAGS]);
  });
});

describe('workflow-owned runs derive from the definition, and fail closed when they cannot', () => {
  it('returns the definition\'s effective tags, sorted', () => {
    const tagged = workflowDef([
      ...PUBFLOW,
      '    humanGates:', '      - id: g-pub', '        kind: approval',
      '        prompt: Approve the upload.', '        publicationAuthorization: true',
      '      - id: g-spend', '        kind: approval',
      '        prompt: Approve the spend.', '        spendAuthorization: true',
    ]);
    expect(deriveOwnerTags(WORKFLOW_OWNER, sources({ workflowDefs: () => [tagged] }))).toEqual(['publish', 'spend']);
  });

  it('is untagged for an ordinary definition', () => {
    expect(deriveOwnerTags(WORKFLOW_OWNER, sources({ workflowDefs: () => [workflowDef(PUBFLOW)] }))).toEqual([]);
  });

  it('fails closed on a missing, mismatched, or invalid definition', () => {
    const def = workflowDef(PUBFLOW);
    expect(deriveOwnerTags(WORKFLOW_OWNER, sources())).toEqual([...FAIL_CLOSED_RUN_TAGS]);
    expect(deriveOwnerTags(WORKFLOW_OWNER, sources({
      workflowDefs: () => [{ ...def, entry: { ...def.entry, valid: false } }],
    }))).toEqual([...FAIL_CLOSED_RUN_TAGS]);
    expect(deriveOwnerTags(WORKFLOW_OWNER, sources({
      workflowDefs: () => [{ ...def, entry: { path: 'orgs/kb-ops/workflows/elsewhere.md', valid: true } }],
    }))).toEqual([...FAIL_CLOSED_RUN_TAGS]);
    expect(deriveOwnerTags({ ...WORKFLOW_OWNER, project: 'other-project' }, sources({
      workflowDefs: () => [def],
    }))).toEqual([...FAIL_CLOSED_RUN_TAGS]);
  });

  it('an iteration group cannot introduce a publish signal the derivation does not see', () => {
    // MEDIUM-3's second half: `effectiveWorkflowTags` walks `def.stages` only. A
    // `WorkflowIterationGroupDef` carries its own `completionGate`/`terminalAuthorities`, and those
    // cannot carry `publicationAuthorization`/`spendAuthorization` today — the schema refuses the field
    // outright. This pins that: if the schema ever admits one, this goes red and the derivation has to
    // learn to walk iteration groups too.
    const withGroupAuthorization = parseWorkflowDef(
      `---\n${[
        ...PUBFLOW,
        '  - id: second', '    title: Second', '    action: report:self-lint',
        '    target: orgs/kb-ops/output', '    riskTier: T1',
        'iterationGroups:',
        '  - id: loop', '    participants: [report, second]',
        '    completionGate:', '      publicationAuthorization: true',
      ].join('\n')}\n---\n\nBody.\n`,
      { knownProfiles: KNOWN_PROFILES },
    );
    expect(withGroupAuthorization.ok).toBe(false);
  });
});
