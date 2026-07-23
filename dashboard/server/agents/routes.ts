/**
 * Agents roster HTTP route (read-only). Exposes `GET /api/agents` — the full fleet roster unioned
 * across queue-card owners, ledger writers, and the `routines/roles/` catalog, each annotated with
 * effective routing (`buildRoster`). Pure read; no write surface, no session (same posture as the
 * other Plane-A / registry reads). `repoRoot` defaults to the kb repo this dashboard lives in;
 * tests inject a fixture root.
 */
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { indexRepo } from '../planeA/indexer.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';
import { taskForOwner } from '../runner/trigger.ts';
import {
  buildRoster,
  isContainedRepoPath,
  readAgentDeclarationProblems,
  readDeclaredAgentDetails,
} from './roster.ts';

/** Inspectable declaration detail consumed by the Agents screen; no referenced file contents are exposed. */
export interface AgentDetailResponse {
  id: string;
  declaration: {
    path: string;
    instructions: string;
    sourceHash: string;
    source: 'agents-declaration';
    defaultProfile: string | null;
    allowedProfiles: string[] | null;
  };
  codebases: Array<{ project: string; path: string }>;
  workflows: Array<{
    ref: string;
    title: string | null;
    path: string;
    governsWorkflow: boolean;
    relationship: 'governor' | 'stage-governor' | 'governor-and-stage-governor' | 'declared-workflow';
    stages: Array<{
      id: string;
      title: string;
      action: string;
      target: string;
      riskTier: string;
      dependsOn: string[];
      review: { subjectStageId: string; maxCreatorReworks: number } | null;
      completionGate: { id: string; kind: 'approval'; requiresReview: 'pass' } | null;
    }>;
  }>;
  howItRuns: { runner: string | null; command: null; summary: string };
}

/** Build the safe, truthful declaration projection for one declared agent, or null when absent. */
export function readAgentDetail(repoRoot: string, id: string): AgentDetailResponse | null {
  const declaration = readDeclaredAgentDetails(repoRoot).get(id);
  if (!declaration) return null;
  const workflows = scanWorkflowDefs(repoRoot)
    .filter(({ entry }) => declaration.projects.includes(entry.project))
    .flatMap(({ entry }) => {
      const governsWorkflow = entry.governedBy === declaration.id;
      const stages = entry.stages.filter((stage) => stage.governedBy === declaration.id).map((stage) => ({
        id: stage.id,
        title: stage.title,
        action: stage.action,
        target: stage.target,
        riskTier: stage.riskTier,
        dependsOn: [...stage.dependsOn],
        review: stage.review ? { ...stage.review } : null,
        completionGate: stage.completionGate ? { ...stage.completionGate } : null,
      }));
      const declaredWorkflow = declaration.workflowPaths.includes(entry.path);
      if (!governsWorkflow && stages.length === 0 && !declaredWorkflow) return [];
      const relationship = governsWorkflow && stages.length > 0
        ? 'governor-and-stage-governor' as const
        : governsWorkflow
          ? 'governor' as const
          : stages.length > 0
            ? 'stage-governor' as const
            : 'declared-workflow' as const;
      return [{ ref: entry.ref, title: entry.title, path: entry.path, governsWorkflow, relationship, stages }];
    });
  const runner = declaration.runnerBound ? declaration.runtime : null;
  const codebases = declaration.projects.flatMap((project) => {
    const path = join(repoRoot, 'orgs', project);
    const relativePath = `orgs/${project}`;
    try {
      // lstat rejects the final project-root symlink; realpath containment rejects a symlinked
      // parent which resolves outside the checked-out repository. Never advertise an external tree
      // as an agent's codebase.
      const stat = existsSync(path) ? lstatSync(path) : null;
      return stat && !stat.isSymbolicLink() && stat.isDirectory() && isContainedRepoPath(repoRoot, relativePath)
        ? [{ project, path: relativePath }]
        : [];
    } catch {
      return [];
    }
  });
  return {
    id: declaration.id,
    declaration: {
      path: declaration.source,
      instructions: declaration.instructionMarkdown,
      sourceHash: declaration.sourceHash,
      source: 'agents-declaration',
      defaultProfile: declaration.defaultProfile,
      allowedProfiles: declaration.allowedProfiles === null ? null : [...declaration.allowedProfiles],
    },
    codebases,
    workflows,
    howItRuns: {
      runner,
      command: null,
      summary: declaration.runnerBound
        ? `The declaration reports a bound ${declaration.runtime ?? 'unspecified'} runner; this read API does not execute it.`
        : 'Declared only: no runner currently claims this agent. Use the existing Composer planning session for interactive discussion; it cannot execute this declaration autonomously.',
    },
  };
}

export interface SystemWorkerResponse {
  id: string;
  runtime: string;
  addressable: true;
  dashboardTriggerable: boolean;
  registrationSource: 'runtime-default';
}

/** Runtime defaults are the canonical system-worker registry; observations never create workers. */
export function readSystemWorkers(repoRoot: string): SystemWorkerResponse[] {
  const policy = loadPolicy(repoRoot);
  return Object.entries(policy.runtimes ?? {})
    .flatMap(([runtime, config]) => config?.default_worker ? [{
      id: config.default_worker,
      runtime,
      addressable: true as const,
      dashboardTriggerable: taskForOwner(config.default_worker) !== null,
      registrationSource: 'runtime-default' as const,
    }] : [])
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** dashboard/server/agents/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only agents roster route on the Fastify app. */
export function registerAgents(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/agents', async () => {
    const policy = loadPolicy(repoRoot);
    const override = loadOverride(repoRoot);
    const index = indexRepo(repoRoot);
    return buildRoster(index, repoRoot, policy, override);
  });
  app.get('/api/agents/system-workers', async () => readSystemWorkers(repoRoot));
  app.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = readAgentDetail(repoRoot, id);
    if (detail) return reply.send(detail);
    const problem = readAgentDeclarationProblems(repoRoot).get(id);
    return problem
      ? reply.code(422).send({ error: 'agent-declaration-invalid', declaration: problem })
      : reply.code(404).send({ error: 'not-found' });
  });
}
