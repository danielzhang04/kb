/**
 * Server-owned runtime verification for compiler-resolved agent assignments.
 *
 * The compiler snapshot is immutable provenance, not present-day authority: immediately before a
 * Claude-path manager or worker receives declaration instructions, this resolver re-reads the
 * canonical declaration and proves that its identity, source hash, project membership, runner binding,
 * and selected execution profile still agree. Nothing browser-authored selects a file or supplies text.
 */
import { readDeclaredAgentDetails, type DeclaredAgentDetail } from '../agents/roster.ts';
import type { ExecutionProfile } from './policy.ts';
import type { ResolvedAgentAssignment } from './proposal.ts';

const MAX_INSTRUCTION_CHARS = 64 * 1024;

export class AssignedAgentResolutionError extends Error {}

export interface ResolvedAssignedAgent {
  assignment: ResolvedAgentAssignment;
  instructionMarkdown: string;
}

export interface AssignedAgentResolver {
  resolve(input: {
    assignment: ResolvedAgentAssignment;
    role: 'manager' | 'worker';
    project: string;
    profiles: readonly ExecutionProfile[];
  }): ResolvedAssignedAgent;
}

export interface AssignedAgentResolverOptions {
  /** Injectable only for hermetic tests; production reads the canonical agents directory. */
  readDeclarations?: (repoRoot: string) => ReadonlyMap<string, DeclaredAgentDetail>;
}

function refusal(detail: string): never {
  throw new AssignedAgentResolutionError(`assigned agent resolution refused: ${detail}`);
}

/** Create the only production resolver: declarations are re-read from `<repoRoot>/agents`. */
export function createAssignedAgentResolver(repoRoot: string, options: AssignedAgentResolverOptions = {}): AssignedAgentResolver {
  const readDeclarations = options.readDeclarations ?? readDeclaredAgentDetails;
  return {
    resolve(input) {
      const { assignment, role, project } = input;
      const declaration = readDeclarations(repoRoot).get(assignment.agentId);
      if (!declaration || declaration.id !== assignment.agentId) refusal(`agent '${assignment.agentId}' is not declared`);
      if (declaration.source !== assignment.declarationPath || declaration.source !== `agents/${assignment.agentId}.md`) {
        refusal(`agent '${assignment.agentId}' declaration path changed`);
      }
      if (declaration.sourceHash !== assignment.declarationHash) refusal(`agent '${assignment.agentId}' declaration hash changed`);
      if (!declaration.projects.includes(project)) refusal(`agent '${assignment.agentId}' is not declared for project '${project}'`);
      if (!declaration.runnerBound) refusal(`agent '${assignment.agentId}' is not runner-bound`);
      if (!declaration.defaultProfile || !declaration.allowedProfiles
        || !declaration.allowedProfiles.includes(declaration.defaultProfile)
        || !declaration.allowedProfiles.includes(assignment.profileId)) {
        refusal(`agent '${assignment.agentId}' does not allow assignment profile '${assignment.profileId}'`);
      }
      const selected = input.profiles.find((profile) => profile.id === assignment.profileId);
      if (!selected || selected.role !== role || selected.runtime !== assignment.runtime || selected.model !== assignment.model) {
        refusal(`assignment profile '${assignment.profileId}' no longer matches ${role} routing`);
      }
      const declaredDefault = input.profiles.find((profile) => profile.id === declaration.defaultProfile);
      if (!declaredDefault || declaration.runtime === null || declaration.model === null
        || declaredDefault.role !== role || declaredDefault.runtime !== declaration.runtime || declaredDefault.model !== declaration.model) {
        refusal(`agent '${assignment.agentId}' default profile is incoherent`);
      }
      if (typeof declaration.instructionMarkdown !== 'string' || declaration.instructionMarkdown.trim() === ''
        || declaration.instructionMarkdown.length > MAX_INSTRUCTION_CHARS || declaration.instructionMarkdown.includes('\0')) {
        refusal(`agent '${assignment.agentId}' declaration instructions are unsafe`);
      }
      return {
        assignment: { ...assignment },
        instructionMarkdown: declaration.instructionMarkdown,
      };
    },
  };
}
