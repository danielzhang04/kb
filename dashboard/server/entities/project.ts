import { SYSTEM_ENTITY_GROUP_ID, type EntityBrief, type EntityGroup, type EntityList } from './contracts.ts';
import type { EntityStatus, EntitySummary, OutputRef, RunRow, RunnableRef, ScheduleOccurrence } from '../control/p2Contracts.ts';
import type { HostKind } from '../control/p2Contracts.ts';
import { humanizeEntityId } from '../../src/entity/humanizeEntityId.ts';

export interface EntityProjectionInput {
  ref: RunnableRef;
  modelLabel: string;
  temporalLabel: string;
  host: EntitySummary['host'];
  activeRuns: RunRow[];
  gatedRunCount: number;
  latestRun: EntitySummary['latestRun'];
  nextSchedule: ScheduleOccurrence | null;
  hasFailure: boolean;
}

export interface EntityGroupProjectionInput extends EntityProjectionInput {
  projects: string[];
  group?: 'system';
}

export interface EntityBriefProjectionInput {
  purpose: string;
  doingNow: string;
  recentRuns: RunRow[];
  outputs: OutputRef[];
  pendingGates: number;
  schedule: ScheduleOccurrence | null;
  autonomyTier: string;
}

export interface StepDefinition {
  stageRef: string;
  label: string;
  dependsOn: string[];
}

export interface StepEvent {
  stageRef: string | null;
  cursor?: number;
}

export interface StepDagNode {
  stageRef: string;
  label: string;
}

export interface StepDagEdge {
  from: string;
  to: string;
}

export interface StepDag {
  nodes: StepDagNode[];
  edges: StepDagEdge[];
  eventsFor(stageRef: string | null): StepEvent[];
}

/** P2's deterministic current-routing preview; P6 replaces the tier resolver, not this HostKind seam. */
export function resolveExecutionHost(tier: 'cloud' | 'desktop'): HostKind {
  return tier === 'cloud' ? 'vm' : 'desktop';
}

export function selectEntityHostRun<T extends {
  runRef: string;
  createdAt: string;
  completedAt: string | null;
}>(runs: readonly T[], activeRunRefs: ReadonlySet<string>): T | null {
  const active = runs
    .filter((run) => activeRunRefs.has(run.runRef))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.runRef.localeCompare(right.runRef));
  if (active[0]) return active[0];
  return runs
    .filter((run): run is T & { completedAt: string } => run.completedAt !== null)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.runRef.localeCompare(right.runRef))[0] ?? null;
}

function statusFor(input: EntityProjectionInput): EntityStatus {
  if (input.gatedRunCount > 0) return 'needs-you';
  if (input.activeRuns.length > 0) return 'running';
  if (input.hasFailure || input.latestRun === 'failed' || input.latestRun === 'interrupted' || input.latestRun === 'abandoned') return 'failed';
  if (input.nextSchedule !== null) return 'scheduled';
  return 'idle';
}

export function projectEntitySummary(input: EntityProjectionInput): EntitySummary {
  return {
    ref: input.ref,
    humanName: humanizeEntityId(input.ref.id),
    status: statusFor(input),
    modelLabel: input.ref.type === 'workflow' ? 'varies' : input.modelLabel,
    temporalLabel: input.temporalLabel,
    host: input.host,
    gatedRunCount: input.gatedRunCount,
    activeRuns: [...input.activeRuns].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.runRef.localeCompare(right.runRef)),
    latestRun: input.latestRun,
    nextSchedule: input.nextSchedule,
  };
}

/** Exact Live empty copy; callers pass already formatted Eastern-relative values. */
export function projectLiveEmpty(lastRan: string | null, nextAt: string | null): string {
  if (lastRan === null && nextAt === null) return 'Never run · no schedule';
  if (lastRan !== null && nextAt === null) return `Last ran ${lastRan}`;
  if (lastRan === null && nextAt !== null) return `next ${nextAt}`;
  return `Last ran ${lastRan} · next ${nextAt}`;
}

export function projectEntityBrief(input: EntityBriefProjectionInput): EntityBrief {
  return {
    purpose: input.purpose,
    doingNow: input.doingNow,
    recentRuns: [...input.recentRuns]
      .sort((left, right) => (right.completedAt ?? right.createdAt).localeCompare(left.completedAt ?? left.createdAt) || left.runRef.localeCompare(right.runRef))
      .slice(0, 5),
    outputs: [...input.outputs],
    pendingGates: input.pendingGates,
    schedule: input.schedule,
    autonomyTier: input.autonomyTier,
  };
}

function groupFor(kind: 'agent' | 'workflow', input: EntityGroupProjectionInput): string {
  if (kind === 'agent' && input.group === 'system') return SYSTEM_ENTITY_GROUP_ID;
  if (kind === 'workflow' && input.ref.type === 'workflow') return input.ref.project;
  const normalized = input.projects.map((project) => project.trim().toLowerCase());
  if (normalized.some((project) => !/^[a-z0-9][a-z0-9-]*$/.test(project))) throw new Error('invalid-project');
  const projects = [...new Set(normalized)].sort();
  if (projects.length === 0) throw new Error('project-required');
  return projects[0];
}

function groupLabel(group: string): string {
  return group === SYSTEM_ENTITY_GROUP_ID ? group : humanizeEntityId(group);
}

export function projectEntityList(revision: string, kind: 'agent' | 'workflow', inputs: EntityGroupProjectionInput[]): EntityList {
  const byGroup = new Map<string, EntitySummary[]>();
  for (const input of inputs) {
    if (input.ref.type !== kind) throw new Error('runnable-type-mismatch');
    const group = groupFor(kind, input);
    const items = byGroup.get(group) ?? [];
    items.push(projectEntitySummary(input));
    byGroup.set(group, items);
  }
  const groups: EntityGroup[] = [...byGroup.entries()]
    .sort(([left], [right]) => left === SYSTEM_ENTITY_GROUP_ID ? 1 : right === SYSTEM_ENTITY_GROUP_ID ? -1 : left.localeCompare(right))
    .map(([id, items]) => ({
      id,
      label: groupLabel(id),
      collapsed: id === SYSTEM_ENTITY_GROUP_ID,
      items: items.sort((left, right) => left.humanName.localeCompare(right.humanName) || left.ref.id.localeCompare(right.ref.id)),
    }));
  return { revision, groups, items: groups.flatMap((group) => group.items) };
}

export function projectStepDag(input: { stages: StepDefinition[]; events: StepEvent[] }): StepDag {
  const known = new Set(input.stages.map((stage) => stage.stageRef));
  return {
    nodes: input.stages.map(({ stageRef, label }) => ({ stageRef, label })),
    edges: input.stages.flatMap((stage) => stage.dependsOn
      .filter((dependency) => known.has(dependency))
      .map((dependency) => ({ from: dependency, to: stage.stageRef }))),
    eventsFor: (stageRef) => stageRef === null ? [...input.events] : input.events.filter((event) => event.stageRef === stageRef),
  };
}
