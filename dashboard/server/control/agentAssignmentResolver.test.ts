import { describe, expect, it } from 'vitest';
import type { DeclaredAgentDetail } from '../agents/roster.ts';
import type { ExecutionProfile } from './policy.ts';
import type { ResolvedAgentAssignment } from './proposal.ts';
import { AssignedAgentResolutionError, createAssignedAgentResolver } from './agentAssignmentResolver.ts';

const assignment: ResolvedAgentAssignment = {
  agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64),
  profileId: 'manager:claude:claude-opus', runtime: 'claude', model: 'claude-opus',
};
const profiles: ExecutionProfile[] = [
  { id: 'manager:claude:claude-opus', role: 'manager', runtime: 'claude', model: 'claude-opus', capabilities: ['read'] },
];

function declaration(overrides: Partial<DeclaredAgentDetail> = {}): DeclaredAgentDetail {
  return {
    id: 'fyt-runner', role: 'manager', runtime: 'claude', model: 'claude-opus',
    defaultProfile: 'manager:claude:claude-opus', allowedProfiles: ['manager:claude:claude-opus'],
    runnerBound: true, description: null, projects: ['faceless-youtube'], source: 'agents/fyt-runner.md',
    instructionMarkdown: '# FYT Runner\nNever publish or spend.', sourceHash: 'a'.repeat(64),
    codebasePaths: [], workflowPaths: [], ...overrides,
  };
}

function resolver(detail: DeclaredAgentDetail) {
  return createAssignedAgentResolver('/repo', { readDeclarations: () => new Map([[detail.id, detail]]) });
}

describe('assigned agent declaration resolver', () => {
  it('returns the exact verified assignment and declaration instructions', () => {
    const resolved = resolver(declaration()).resolve({ assignment, role: 'manager', project: 'faceless-youtube', profiles });
    expect(resolved).toEqual({ assignment, instructionMarkdown: '# FYT Runner\nNever publish or spend.' });
  });

  it.each([
    ['path', { source: 'agents/other.md' }],
    ['hash', { sourceHash: 'b'.repeat(64) }],
    ['project', { projects: ['kb-ops'] }],
    ['runner binding', { runnerBound: false }],
    ['allowed profile', { allowedProfiles: ['manager:claude:other'] }],
    ['default coherence', { runtime: 'codex' }],
  ])('fails closed for a changed declaration %s', (_label, overrides) => {
    expect(() => resolver(declaration(overrides)).resolve({ assignment, role: 'manager', project: 'faceless-youtube', profiles }))
      .toThrow(AssignedAgentResolutionError);
  });

  it.each(['bad\0text', '', ' \n\t '])('refuses unsafe or blank declaration instruction text', (instructionMarkdown) => {
    expect(() => resolver(declaration({ instructionMarkdown }))
      .resolve({ assignment, role: 'manager', project: 'faceless-youtube', profiles })).toThrow(/instructions are unsafe/);
  });
});
