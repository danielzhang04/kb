import type { HostKind, RunIdentityFields, RunnableRef } from './p2Contracts.ts';

export interface LegacyAgentDeclaration {
  id: string;
  sourcePath: `agents/${string}.md`;
  declarationHash: string;
}

export interface LegacyWorkflowDefinition {
  id: string;
  project: string;
  sourcePath: `orgs/${string}/workflows/${string}.md`;
  declarationHash: string;
  proposalRef: string;
  proposalRevision: number;
  proposalHash: string;
}

export interface LegacyWorkflowLaunchAudit {
  runRef: string;
  workflowId: string;
  project: string;
  sourcePath: `orgs/${string}/workflows/${string}.md`;
  declarationHash: string;
}

export interface LegacyRunIdentityInput {
  runRef: string;
  location: string;
  executionHost: HostKind;
  agentWorkspaceLaunch: { agentId: string; declarationPath: string; declarationHash: string } | null;
  proposal: { proposalRef: string; proposalRevision: number; proposalHash: string } | null;
  agentDeclarations: readonly LegacyAgentDeclaration[];
  workflowDefinitions: readonly LegacyWorkflowDefinition[];
  workflowLaunchAudits: readonly LegacyWorkflowLaunchAudit[];
}

export type RunIdentityResolution =
  | { ok: true; value: RunIdentityFields }
  | { ok: false; reason: 'agent-provenance-required' | 'workflow-launch-audit-required' | 'ambiguous-workflow-provenance' | 'run-owner-migration-required'; candidates: RunnableRef[] };

export interface RunIdentityMigrationError {
  runRef: string;
  location: string;
  candidates: RunnableRef[];
  reason: 'run-owner-migration-required';
}

export interface RunIdentityMigrationReport {
  migration: 'migrateRunIdentityV1';
  total: number;
  migrated: number;
  errors: RunIdentityMigrationError[];
  truncated: boolean;
}

export interface RunIdentityMigrationResult {
  items: Array<{ runRef: string; location: string; value: RunIdentityFields }>;
  report: RunIdentityMigrationReport;
}

function asAgentRef(candidate: LegacyAgentDeclaration): RunnableRef {
  return { type: 'agent', id: candidate.id, sourcePath: candidate.sourcePath };
}

function asWorkflowRef(candidate: LegacyWorkflowDefinition): RunnableRef {
  return { type: 'workflow', id: candidate.id, project: candidate.project, sourcePath: candidate.sourcePath };
}

function sortedRefs(refs: readonly RunnableRef[]): RunnableRef[] {
  return [...refs].sort((left, right) => `${left.type}:${left.id}:${left.sourcePath}`.localeCompare(`${right.type}:${right.id}:${right.sourcePath}`));
}

export function resolveLegacyRunIdentity(input: LegacyRunIdentityInput): RunIdentityResolution {
  if (input.agentWorkspaceLaunch !== null) {
    const provenance = input.agentWorkspaceLaunch;
    const matches = input.agentDeclarations
      .filter((candidate) => candidate.id === provenance.agentId
        && candidate.sourcePath === provenance.declarationPath
        && candidate.declarationHash === provenance.declarationHash)
      .map(asAgentRef);
    if (matches.length === 1) return { ok: true, value: identityFields(matches[0], input.executionHost) };
    return { ok: false, reason: 'agent-provenance-required', candidates: sortedRefs(matches) };
  }

  if (input.proposal === null) return { ok: false, reason: 'run-owner-migration-required', candidates: [] };
  const definitions = input.workflowDefinitions.filter((candidate) => candidate.proposalRef === input.proposal?.proposalRef
    && candidate.proposalRevision === input.proposal?.proposalRevision
    && candidate.proposalHash === input.proposal?.proposalHash);
  const matches = definitions.filter((definition) => input.workflowLaunchAudits.some((audit) => audit.runRef === input.runRef
    && audit.workflowId === definition.id
    && audit.project === definition.project
    && audit.sourcePath === definition.sourcePath
    && audit.declarationHash === definition.declarationHash));
  const refs = sortedRefs(matches.map(asWorkflowRef));
  if (refs.length === 1) return { ok: true, value: identityFields(refs[0], input.executionHost) };
  return { ok: false, reason: refs.length > 1 ? 'ambiguous-workflow-provenance' : 'workflow-launch-audit-required', candidates: refs };
}

function identityFields(owner: RunnableRef, executionHost: HostKind): RunIdentityFields {
  return { owner, executionHost, terminalOutcome: null, completedAt: null, archivedFrom: null };
}

export function migrateRunIdentities(inputs: readonly LegacyRunIdentityInput[], limit = 100): RunIdentityMigrationResult {
  const items: RunIdentityMigrationResult['items'] = [];
  const errors: RunIdentityMigrationError[] = [];
  for (const input of inputs) {
    const resolved = resolveLegacyRunIdentity(input);
    if (resolved.ok) items.push({ runRef: input.runRef, location: input.location, value: resolved.value });
    else errors.push({ runRef: input.runRef, location: input.location, candidates: resolved.candidates, reason: 'run-owner-migration-required' });
  }
  errors.sort((left, right) => left.runRef.localeCompare(right.runRef) || left.location.localeCompare(right.location));
  return {
    items,
    report: {
      migration: 'migrateRunIdentityV1', total: inputs.length, migrated: items.length,
      errors: errors.slice(0, limit), truncated: errors.length > limit,
    },
  };
}
