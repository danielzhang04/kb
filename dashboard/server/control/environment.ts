import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexSkills } from '../registry/skills.ts';
import { loadPolicy } from '../routing/policy.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import type { ExecutionProfile, PolicyEnvironment } from './policy.ts';

export interface RuntimeSkillRegistry {
  runtimes: Record<string, string[]>;
  skills: string[];
  /**
   * The closed workflow tool-allowlist profile ids a proposal may name. Optional only so registry
   * literals written before this field existed still typecheck; `loadRuntimeSkillRegistry` always
   * populates it, and a proposal declaring a profile is refused when it is absent (`proposal.ts`).
   */
  workflowProfiles?: string[];
}

/** Runtime/models and executable skills are read from server-owned registries, never browser input. */
export function loadRuntimeSkillRegistry(repoRoot: string): RuntimeSkillRegistry {
  const policy = loadPolicy(repoRoot);
  const runtimes = Object.fromEntries(Object.entries(policy.runtimes ?? {}).map(([runtime, spec]) => [
    runtime,
    [...new Set((spec.known_models ?? []).filter((model): model is string => typeof model === 'string' && model.length > 0))],
  ]));
  const skills = indexSkills(repoRoot).items
    .filter((skill) => skill.tier === 'curated')
    .flatMap((skill) => [skill.slug, skill.name])
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .sort();
  return { runtimes, skills, workflowProfiles: [...workflowProfileIds()].sort() };
}

/**
 * D13/D15 — named worker tool-allowlist profiles a workflow definition selects by name. These are the
 * forward-looking capability caps a spawned worker would be launched with; they are SERVER-OWNED data
 * (a code-reviewed change adds one) and a workflow definition can only NAME a profile, never widen it.
 *
 * INVARIANT: no default profile grants a publish/send capability — never `upload_video`, never a
 * send-mail tool. Gmail reach is read/search/label/DRAFT only; email is never sent from a workflow.
 */
export interface WorkflowExecutionProfile {
  id: string;
  /** The closed `--allowedTools` set a worker on this profile may use. */
  allowedTools: readonly string[];
}

/** Tools a workflow worker may NEVER be granted through any default profile (external publish/send). */
export const FORBIDDEN_WORKFLOW_TOOLS: readonly string[] = [
  'upload_video',
  'mcp__google-workspace__send_email',
  'mcp__google-workspace__gmail_send',
  'mcp__claude_ai_Gmail__send_message',
];

const WORKFLOW_EXECUTION_PROFILES: readonly WorkflowExecutionProfile[] = [
  {
    id: 'checker-readonly',
    allowedTools: ['Read', 'Glob', 'Grep'],
  },
  {
    id: 'research',
    allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'],
  },
  {
    id: 'gmail-triage',
    allowedTools: [
      'mcp__google-workspace__search_gmail_messages',
      'mcp__google-workspace__get_gmail_message_content',
      'mcp__google-workspace__list_gmail_labels',
      'mcp__google-workspace__modify_gmail_message_labels',
      'mcp__google-workspace__draft_gmail_message',
      'Read',
      'Write',
    ],
  },
  {
    id: 'drive-author',
    allowedTools: [
      'mcp__google-workspace__search_drive_files',
      'mcp__google-workspace__get_drive_file_content',
      'mcp__google-workspace__create_drive_file',
      'mcp__google-workspace__upload_to_drive',
      'Read',
      'Write',
    ],
  },
  {
    id: 'producer',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  },
];

/** The server-owned workflow tool-allowlist profiles. Frozen data; a definition names one by id. */
export function loadWorkflowProfiles(): WorkflowExecutionProfile[] {
  return WORKFLOW_EXECUTION_PROFILES.map((profile) => ({ id: profile.id, allowedTools: [...profile.allowedTools] }));
}

/** The set of valid workflow profile ids, for definition validation. */
export function workflowProfileIds(): Set<string> {
  return new Set(WORKFLOW_EXECUTION_PROFILES.map((profile) => profile.id));
}

/** Fixed capabilities are selected by server role; the proposal cannot add flags, tools, or permissions. */
export function loadExecutionProfiles(repoRoot: string): ExecutionProfile[] {
  const { runtimes } = loadRuntimeSkillRegistry(repoRoot);
  const profiles: ExecutionProfile[] = [];
  for (const [runtime, models] of Object.entries(runtimes)) {
    if (runtime !== 'claude' && runtime !== 'codex') continue;
    for (const model of models) {
      if (runtime === 'claude') {
        profiles.push({
          id: `manager:${runtime}:${model}`, role: 'manager', runtime, model,
          capabilities: ['read', 'emit-events'],
        });
      }
      profiles.push({
        id: `worker:${runtime}:${model}`, role: 'worker', runtime, model,
        capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
      });
    }
  }
  return profiles;
}

/**
 * The one server-owned input snapshot for workflow-definition compilation.
 *
 * Definitions may name an agent and execution profile, but neither a browser nor authored workflow
 * prose supplies the declaration, executable profile, runtime availability, model, or skill registry.
 * Keep these four authoritative loaders together so list preview, detail preview, and launch cannot
 * disagree about whether an assignment is currently launchable.
 */
export function loadWorkflowCompileEnvironment(repoRoot: string) {
  const registry = loadRuntimeSkillRegistry(repoRoot);
  const availableRuntimes = new Set<'claude' | 'codex'>();
  for (const runtime of Object.keys(registry.runtimes)) {
    if (runtime === 'claude' || runtime === 'codex') availableRuntimes.add(runtime);
  }
  return {
    registry,
    declaredAgents: readDeclaredAgentDetails(repoRoot),
    executionProfiles: loadExecutionProfiles(repoRoot),
    availableRuntimes,
  };
}

function allowedGovernanceRef(project: string, ref: string): boolean {
  return ref === 'CLAUDE.md' || ref === 'governance/agent-rules.md' || ref === 'governance/risk-tiers.md'
    || ref === `orgs/${project}/contract.md`;
}

/** Load only the closed executable trust anchors supported in v1. Unknown prose references fail closed. */
export function loadPolicyEnvironment(repoRoot: string, project: string, refs: string[]): PolicyEnvironment {
  const governanceContents: Record<string, string> = {};
  for (const ref of [...new Set(refs)]) {
    if (!allowedGovernanceRef(project, ref)) continue;
    const path = join(repoRoot, ...ref.split('/'));
    if (existsSync(path)) governanceContents[ref] = readFileSync(path, 'utf8');
  }
  const contractRef = `orgs/${project}/contract.md`;
  return {
    profiles: loadExecutionProfiles(repoRoot),
    curatedSkills: new Set(loadRuntimeSkillRegistry(repoRoot).skills),
    contractText: governanceContents[contractRef] ?? '',
    governanceContents,
  };
}
