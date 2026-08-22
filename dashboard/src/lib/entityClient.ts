import type { EntityBrief, EntityBuilderRequest, EntityDetail, EntityDetails, EntityGroup, EntityList } from '../../server/entities/contracts.ts';
import type { EntitySummary, OutputRef, RunRow, RunnableRef, ScheduleOccurrence } from '../../server/control/p2Contracts.ts';
import { RUN_LIFECYCLE_KINDS } from '../../server/control/runLifecycle.ts';
import { invalidateSessionOnGovernedAuthFailure } from './authClient.ts';

export type EntityCollection = 'agents' | 'workflows';
export type EntityRequestScope = 'list' | 'detail';

export class EntityClientFailure extends Error {
  constructor(readonly status: number, readonly scope: EntityRequestScope) {
    super(`entity ${scope} request failed (${status})`);
    this.name = 'EntityClientFailure';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function runnable(value: unknown): RunnableRef | null {
  const ref = record(value);
  if (!ref || typeof ref.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref.id)) return null;
  if (ref.type === 'agent' && exactKeys(ref, ['type', 'id', 'sourcePath']) && ref.sourcePath === `agents/${ref.id}.md`) {
    return { type: 'agent', id: ref.id, sourcePath: ref.sourcePath as `agents/${string}.md` };
  }
  if (ref.type === 'workflow' && exactKeys(ref, ['type', 'id', 'project', 'sourcePath'])
    && typeof ref.project === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref.project)
    && ref.sourcePath === `orgs/${ref.project}/workflows/${ref.id}.md`) {
    return { type: 'workflow', id: ref.id, project: ref.project, sourcePath: ref.sourcePath as `orgs/${string}/workflows/${string}.md` };
  }
  return null;
}

const OUTCOMES = ['ok', 'failed', 'stopped', 'interrupted', 'abandoned'] as const;

function occurrence(value: unknown): ScheduleOccurrence | null {
  const row = record(value);
  const owner = runnable(row?.owner);
  if (!row || !owner || !exactKeys(row, ['scheduleId', 'scheduledFor', 'nextAt', 'owner'])
    || typeof row.scheduleId !== 'string' || typeof row.scheduledFor !== 'string' || typeof row.nextAt !== 'string') return null;
  return { scheduleId: row.scheduleId, scheduledFor: row.scheduledFor, nextAt: row.nextAt, owner };
}

function runRow(value: unknown): RunRow | null {
  const row = record(value);
  if (!row || !exactKeys(row, ['runRef', 'title', 'owner', 'lifecycle', 'outcome', 'createdAt', 'completedAt', 'streamKind', 'elapsedMs', 'toolsCalled', 'lastLine', 'gateBadge'], ['sessionId'])) return null;
  const owner = runnable(row.owner);
  if (!owner || typeof row.runRef !== 'string' || typeof row.title !== 'string'
    || !RUN_LIFECYCLE_KINDS.includes(row.lifecycle as never)
    || (row.outcome !== null && !OUTCOMES.includes(row.outcome as never))
    || typeof row.createdAt !== 'string' || (row.completedAt !== null && typeof row.completedAt !== 'string')
    || (row.streamKind !== 'pty' && row.streamKind !== 'transcript')
    || typeof row.elapsedMs !== 'number' || row.elapsedMs < 0 || !Number.isSafeInteger(row.toolsCalled) || Number(row.toolsCalled) < 0
    || typeof row.lastLine !== 'string' || (row.gateBadge !== null && typeof row.gateBadge !== 'string')
    || (row.sessionId !== undefined && typeof row.sessionId !== 'string')) return null;
  return {
    runRef: row.runRef, title: row.title, owner, lifecycle: row.lifecycle as RunRow['lifecycle'], outcome: row.outcome as RunRow['outcome'],
    createdAt: row.createdAt, completedAt: row.completedAt as string | null, streamKind: row.streamKind,
    elapsedMs: row.elapsedMs, toolsCalled: row.toolsCalled as number, lastLine: row.lastLine, gateBadge: row.gateBadge as string | null,
    ...(typeof row.sessionId === 'string' ? { sessionId: row.sessionId } : {}),
  };
}

function summary(value: unknown): EntitySummary | null {
  const row = record(value);
  if (!row || !exactKeys(row, ['ref', 'humanName', 'status', 'modelLabel', 'temporalLabel', 'host', 'gatedRunCount', 'activeRuns', 'latestRun', 'nextSchedule'])) return null;
  const ref = runnable(row.ref);
  if (!ref || typeof row.humanName !== 'string' || !['running', 'needs-you', 'failed', 'idle', 'scheduled'].includes(String(row.status))
    || typeof row.modelLabel !== 'string' || typeof row.temporalLabel !== 'string' || (row.host !== 'vm' && row.host !== 'desktop')
    || !Number.isSafeInteger(row.gatedRunCount) || Number(row.gatedRunCount) < 0 || !Array.isArray(row.activeRuns)
    || (row.latestRun !== null && !OUTCOMES.includes(row.latestRun as never))) return null;
  const activeRuns = row.activeRuns.map(runRow);
  const nextSchedule = row.nextSchedule === null ? null : occurrence(row.nextSchedule);
  if (activeRuns.some((item) => item === null) || (row.nextSchedule !== null && nextSchedule === null)) return null;
  return {
    ref, humanName: row.humanName, status: row.status as EntitySummary['status'], modelLabel: row.modelLabel,
    temporalLabel: row.temporalLabel, host: row.host, gatedRunCount: row.gatedRunCount as number,
    activeRuns: activeRuns as RunRow[], latestRun: row.latestRun as EntitySummary['latestRun'], nextSchedule,
  };
}

function group(value: unknown): EntityGroup | null {
  const row = record(value);
  if (!row || !exactKeys(row, ['id', 'label', 'collapsed', 'items']) || typeof row.id !== 'string' || typeof row.label !== 'string'
    || typeof row.collapsed !== 'boolean' || !Array.isArray(row.items)) return null;
  const items = row.items.map(summary);
  return items.some((item) => item === null) ? null : { id: row.id, label: row.label, collapsed: row.collapsed, items: items as EntitySummary[] };
}

function output(value: unknown): OutputRef | null {
  const row = record(value);
  if (!row || typeof row.label !== 'string') return null;
  if ((row.kind === 'repository-file' || row.kind === 'artifact') && exactKeys(row, ['kind', 'label', 'path']) && typeof row.path === 'string') {
    return { kind: row.kind, label: row.label, path: row.path };
  }
  if (row.kind === 'external-pr' && exactKeys(row, ['kind', 'label', 'owner', 'repository', 'number'])
    && typeof row.owner === 'string' && typeof row.repository === 'string' && Number.isSafeInteger(row.number) && Number(row.number) > 0) {
    return { kind: 'external-pr', label: row.label, owner: row.owner, repository: row.repository, number: row.number as number };
  }
  return null;
}

function brief(value: unknown): EntityBrief | null {
  const row = record(value);
  if (!row || !exactKeys(row, ['purpose', 'doingNow', 'recentRuns', 'outputs', 'pendingGates', 'schedule', 'autonomyTier'])
    || typeof row.purpose !== 'string' || typeof row.doingNow !== 'string' || !Array.isArray(row.recentRuns) || !Array.isArray(row.outputs)
    || !Number.isSafeInteger(row.pendingGates) || Number(row.pendingGates) < 0 || typeof row.autonomyTier !== 'string') return null;
  const recentRuns = row.recentRuns.map(runRow);
  const outputs = row.outputs.map(output);
  const schedule = row.schedule === null ? null : occurrence(row.schedule);
  if (recentRuns.some((item) => item === null) || outputs.some((item) => item === null) || (row.schedule !== null && schedule === null)) return null;
  return { purpose: row.purpose, doingNow: row.doingNow, recentRuns: recentRuns as RunRow[], outputs: outputs as OutputRef[], pendingGates: row.pendingGates as number, schedule, autonomyTier: row.autonomyTier };
}

function builderRequest(value: unknown): EntityBuilderRequest | null {
  const row = record(value);
  const connectors = Array.isArray(row?.connectors) ? row.connectors.map((entry) => {
    const grant = record(entry);
    return grant && exactKeys(grant, ['server', 'tools']) && typeof grant.server === 'string' && strings(grant.tools)
      ? { server: grant.server, tools: grant.tools } : null;
  }) : [];
  if (!row || !exactKeys(row, ['humanName', 'purpose', 'model', 'profile', 'tools', 'skills', 'connectors', 'filesystemRoots'])
    || typeof row.humanName !== 'string' || typeof row.purpose !== 'string' || typeof row.model !== 'string' || typeof row.profile !== 'string'
    || !strings(row.tools) || !strings(row.skills) || !Array.isArray(row.connectors) || connectors.some((grant) => grant === null) || !strings(row.filesystemRoots)) return null;
  return { humanName: row.humanName, purpose: row.purpose, model: row.model, profile: row.profile, tools: row.tools, skills: row.skills, connectors: connectors as EntityBuilderRequest['connectors'], filesystemRoots: row.filesystemRoots };
}

function details(value: unknown, ref: RunnableRef): EntityDetails | null {
  const row = record(value);
  const required = ['sourcePath', 'sourceRevision', 'tools', 'declaredCeiling', 'replaces', 'buildsOn', 'knowledgeSources', 'skills', 'schemas', 'lineage', 'grades', 'ids'];
  if (!row || !exactKeys(row, required, ['workflow', 'builder']) || row.sourcePath !== ref.sourcePath
    || typeof row.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceRevision) || !strings(row.tools)
    || typeof row.declaredCeiling !== 'string' || !strings(row.replaces) || !strings(row.buildsOn) || !strings(row.knowledgeSources)
    || !strings(row.skills) || !strings(row.schemas) || !strings(row.lineage) || !strings(row.grades) || !strings(row.ids)) return null;
  let workflow: EntityDetails['workflow'];
  if (row.workflow !== undefined) {
    const value = record(row.workflow); const dag = value ? record(value.stepDag) : null;
    if (!value || !exactKeys(value, ['stepDag', 'parameters', 'runGraph']) || !dag || !exactKeys(dag, ['nodes', 'edges']) || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges) || !strings(value.parameters)) return null;
    const nodes = dag.nodes.map(record); const edges = dag.edges.map(record);
    if (nodes.some((node) => !node || !exactKeys(node, ['stageRef', 'label']) || typeof node.stageRef !== 'string' || typeof node.label !== 'string')
      || edges.some((edge) => !edge || !exactKeys(edge, ['from', 'to']) || typeof edge.from !== 'string' || typeof edge.to !== 'string')) return null;
    let runGraph: NonNullable<EntityDetails['workflow']>['runGraph'] = null;
    if (value.runGraph !== null) {
      const graph = record(value.runGraph);
      if (!graph || !exactKeys(graph, ['runRef', 'stages', 'attempts', 'events']) || typeof graph.runRef !== 'string' || !Array.isArray(graph.stages) || !Array.isArray(graph.attempts) || !Array.isArray(graph.events)) return null;
      const stages = graph.stages.map(record); const attempts = graph.attempts.map(record); const events = graph.events.map(record);
      if (stages.some((stage) => !stage || !exactKeys(stage, ['stageRef', 'stageId', 'title', 'dependsOn', 'state']) || typeof stage.stageRef !== 'string' || typeof stage.stageId !== 'string' || typeof stage.title !== 'string' || !strings(stage.dependsOn) || typeof stage.state !== 'string')
        || attempts.some((attempt) => !attempt || !exactKeys(attempt, ['attemptRef', 'stageRef', 'state']) || typeof attempt.attemptRef !== 'string' || typeof attempt.stageRef !== 'string' || typeof attempt.state !== 'string')
        || events.some((event) => !event || !exactKeys(event, ['cursor', 'stageRef', 'kind', 'summary', 'createdAt']) || !Number.isSafeInteger(event.cursor) || (event.stageRef !== null && typeof event.stageRef !== 'string') || typeof event.kind !== 'string' || (event.summary !== null && typeof event.summary !== 'string') || typeof event.createdAt !== 'string')) return null;
      runGraph = { runRef: graph.runRef, stages: stages as NonNullable<typeof runGraph>['stages'], attempts: attempts as NonNullable<typeof runGraph>['attempts'], events: events as NonNullable<typeof runGraph>['events'] };
    }
    workflow = { stepDag: { nodes: nodes as Array<{ stageRef: string; label: string }>, edges: edges as Array<{ from: string; to: string }> }, parameters: value.parameters, runGraph };
  }
  let builder: EntityDetails['builder'];
  if (row.builder !== undefined) {
    const value = record(row.builder);
    if (!value || !exactKeys(value, ['models', 'profiles', 'tools', 'skills', 'connectors', 'filesystemRoots', 'projects', 'value'])
      || !strings(value.models) || !strings(value.profiles) || !strings(value.tools) || !strings(value.skills) || !Array.isArray(value.connectors)
      || !strings(value.filesystemRoots) || !strings(value.projects)) return null;
    const request = builderRequest(value.value);
    if (!request) return null;
    const connectorCatalog = value.connectors.map((entry) => {
      const grant = record(entry);
      return grant && exactKeys(grant, ['server', 'tools']) && typeof grant.server === 'string' && strings(grant.tools) ? { server: grant.server, tools: grant.tools } : null;
    });
    if (connectorCatalog.some((grant) => grant === null)) return null;
    builder = { models: value.models, profiles: value.profiles, tools: value.tools, skills: value.skills, connectors: connectorCatalog as NonNullable<EntityDetails['builder']>['connectors'], filesystemRoots: value.filesystemRoots, projects: value.projects, value: request };
  }
  return {
    sourcePath: ref.sourcePath, sourceRevision: row.sourceRevision, tools: row.tools, declaredCeiling: row.declaredCeiling,
    replaces: row.replaces, buildsOn: row.buildsOn, knowledgeSources: row.knowledgeSources, skills: row.skills,
    schemas: row.schemas, lineage: row.lineage, grades: row.grades, ids: row.ids,
    ...(workflow ? { workflow } : {}), ...(builder ? { builder } : {}),
  };
}

export function decodeEntityList(value: unknown): EntityList {
  const row = record(value);
  if (!row || !exactKeys(row, ['revision', 'groups', 'items']) || typeof row.revision !== 'string' || !Array.isArray(row.groups) || !Array.isArray(row.items)) throw new Error('Invalid Entity list response');
  const groups = row.groups.map(group); const items = row.items.map(summary);
  if (groups.some((item) => item === null) || items.some((item) => item === null)) throw new Error('Invalid Entity list response');
  return { revision: row.revision, groups: groups as EntityGroup[], items: items as EntitySummary[] };
}

export function decodeEntityDetail(value: unknown): EntityDetail {
  const row = record(value);
  if (!row || !exactKeys(row, ['revision', 'summary', 'brief', 'details']) || typeof row.revision !== 'string') throw new Error('Invalid Entity detail response');
  const projectedSummary = summary(row.summary); const projectedBrief = brief(row.brief);
  const projectedDetails = projectedSummary ? details(row.details, projectedSummary.ref) : null;
  if (!projectedSummary || !projectedBrief || !projectedDetails) throw new Error('Invalid Entity detail response');
  return { revision: row.revision, summary: projectedSummary, brief: projectedBrief, details: projectedDetails };
}

async function readEntity<T>(url: string, scope: EntityRequestScope, decode: (value: unknown) => T, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    await invalidateSessionOnGovernedAuthFailure(response);
    throw new EntityClientFailure(response.status, scope);
  }
  return decode(await response.json());
}

export function fetchEntityList(collection: EntityCollection, fetchImpl: typeof fetch = fetch): Promise<EntityList> {
  return readEntity(`/api/${collection}`, 'list', decodeEntityList, fetchImpl);
}

export function fetchEntityDetail(collection: EntityCollection, id: string, fetchImpl: typeof fetch = fetch): Promise<EntityDetail> {
  return readEntity(`/api/${collection}/${encodeURIComponent(id)}`, 'detail', decodeEntityDetail, fetchImpl);
}
