import { loadWorkflowProfiles } from './environment.ts';
import { FORBIDDEN_WORKFLOW_TOOLS, WORKFLOW_PERMISSION_MODE } from './workflowProfiles.ts';

export interface ClaudeToolPolicy {
  /** The `--allowedTools` allowlist for this profile (publish tools never appear in a default profile). */
  allowedTools: readonly string[];
  /** The `--permission-mode` value for this profile (e.g. `default`, `plan`, `acceptEdits`). */
  permissionMode: string;
}

/** A fail-closed refusal to launch with an unresolved or malformed server-owned policy. */
export class ToolPolicyRefusal extends Error {}

/** Rejects anything that would corrupt the comma-joined `--allowedTools` value or smuggle a flag. */
export function isWellFormedToolName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && !/[\s,\0"']/.test(name)
    && !name.startsWith('-');
}

export function createWorkflowToolPolicyResolver(
  options: { permissionMode?: string; profiles?: readonly { id: string; allowedTools: readonly string[] }[] } = {},
): (workflowProfileId: string | null) => ClaudeToolPolicy {
  // The default lives in the importless profile leaf so the Linux broker's own recipe table reads
  // the SAME value; a second literal here would let the two sides launch one profile under two modes.
  const permissionMode = options.permissionMode ?? WORKFLOW_PERMISSION_MODE;
  return (workflowProfileId) => {
    if (typeof workflowProfileId !== 'string' || workflowProfileId.trim() === '') {
      throw new ToolPolicyRefusal(
        'refusing to spawn a worker: the proposal declares no workflow execution profile, so no tool cap can be resolved',
      );
    }
    const profiles = options.profiles ?? loadWorkflowProfiles();
    const profile = profiles.find((candidate) => candidate.id === workflowProfileId);
    if (!profile) {
      throw new ToolPolicyRefusal(
        `refusing to spawn a worker: workflow execution profile '${workflowProfileId}' is not server-owned`,
      );
    }
    if (profile.allowedTools.length === 0) {
      throw new ToolPolicyRefusal(
        `refusing to spawn a worker: workflow execution profile '${workflowProfileId}' grants no tools`,
      );
    }
    const malformed = profile.allowedTools.find((tool) => !isWellFormedToolName(tool));
    if (malformed !== undefined) {
      throw new ToolPolicyRefusal(
        `refusing to spawn a worker: workflow execution profile '${workflowProfileId}' names a malformed tool`,
      );
    }
    const forbidden = profile.allowedTools.find((tool) => FORBIDDEN_WORKFLOW_TOOLS.includes(tool));
    if (forbidden !== undefined) {
      throw new ToolPolicyRefusal(
        `refusing to spawn a worker: workflow execution profile '${workflowProfileId}' names forbidden tool '${forbidden}'`,
      );
    }
    return { allowedTools: [...profile.allowedTools], permissionMode };
  };
}

/**
 * The PRODUCTION `toolPolicyId` resolver ([C-S2]). The declaration may not carry argv, so the tool cap
 * reaches the child only as a NAME the broker's recipe table re-resolves on its own side
 * (`pty/launcherProfiles.ts` -> `resolveClaudePolicy` -> this same workflow resolver). The name is
 * therefore only legal if the table reproduces the dashboard-computed policy exactly; anything else
 * would launch the worker under a cap nobody approved, so it refuses instead of falling back.
 */
export function createAttemptToolPolicyIdResolver(
  resolveTablePolicy: (workflowProfileId: string | null) => ClaudeToolPolicy,
): (input: { workflowProfile: string; policy: ClaudeToolPolicy }) => string {
  return ({ workflowProfile, policy }) => {
    const reproduced = resolveTablePolicy(workflowProfile);
    if (reproduced.permissionMode !== policy.permissionMode
      || reproduced.allowedTools.length !== policy.allowedTools.length
      || reproduced.allowedTools.some((tool, index) => tool !== policy.allowedTools[index])) {
      throw new ToolPolicyRefusal(
        `refusing to launch: the broker recipe table does not reproduce the approved tool cap for '${workflowProfile}'`,
      );
    }
    return workflowProfile;
  };
}

export const READ_SCOPE_SENSITIVE_ROOTS: readonly string[] = ['dashboard', 'memory', 'scripts'];

/** The distinct top-level path segments of a repo-relative path list. */
function topLevelSegments(paths: readonly string[]): Set<string> {
  return new Set(paths.map((path) => path.split('/')[0]).filter((segment) => segment.length > 0));
}

function absoluteReadDenyRule(repoRoot: string, root: string): string {
  const forwardSlashed = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return `Read(//${forwardSlashed}/${root}/**)`;
}

export function buildReadScopeSettings(input: {
  allowedTools: readonly string[];
  readScope: readonly string[];
  writeScope: readonly string[];
  repoRoot?: string;
}): string | undefined {
  if (input.allowedTools.includes('Bash')) return undefined;
  const allowed = topLevelSegments([...input.readScope, ...input.writeScope]);
  const denyRoots = READ_SCOPE_SENSITIVE_ROOTS.filter((root) => !allowed.has(root));
  if (denyRoots.length === 0) return undefined;
  const repoRoot = input.repoRoot?.trim();
  const deny: string[] = [];
  for (const root of denyRoots) {
    deny.push(`Read(/${root}/**)`);
    if (repoRoot) deny.push(absoluteReadDenyRule(repoRoot, root));
  }
  return JSON.stringify({ permissions: { deny } });
}
