import type { EntitySummary, OutputRef, RunRow, RunnableRef, ScheduleOccurrence } from '../control/p2Contracts.ts';

export type { EntitySummary } from '../control/p2Contracts.ts';

export const SYSTEM_ENTITY_GROUP_ID = 'System' as const;

/** Client-supplied identifier: declaration provenance is never trusted from this shape. */
export type RunnableSelector = { type: 'agent' | 'workflow'; id: string };

export interface EntityGroup {
  id: string;
  label: string;
  collapsed: boolean;
  items: EntitySummary[];
}

export interface EntityList {
  revision: string;
  groups: EntityGroup[];
  items: EntitySummary[];
}

export interface EntityBrief {
  purpose: string;
  doingNow: string;
  recentRuns: RunRow[];
  outputs: OutputRef[];
  pendingGates: number;
  schedule: ScheduleOccurrence | null;
  autonomyTier: string;
}

export interface EntityDetails {
  sourcePath: RunnableRef['sourcePath'];
  sourceRevision: string;
  tools: string[];
  declaredCeiling: string;
  replaces: string[];
  buildsOn: string[];
  knowledgeSources: string[];
  skills: string[];
  schemas: string[];
  lineage: string[];
  grades: string[];
  ids: string[];
  /** Workflow-only, server-projected definition data. Agents omit this member. */
  workflow?: {
    stepDag: {
      nodes: Array<{ stageRef: string; label: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    parameters: string[];
    runGraph: {
      runRef: string;
      stages: Array<{ stageRef: string; stageId: string; title: string; dependsOn: string[]; state: string }>;
      attempts: Array<{ attemptRef: string; stageRef: string; state: string }>;
      events: Array<{ cursor: number; stageRef: string | null; kind: string; summary: string | null; createdAt: string }>;
    } | null;
  };
  /** Closed display/policy choices for the form-first editor; values remain server-owned. */
  builder?: {
    models: string[];
    profiles: string[];
    tools: string[];
    skills: string[];
    connectors: ConnectorGrant[];
    filesystemRoots: string[];
    projects: string[];
    value: EntityBuilderRequest;
  };
}

export interface EntityDetail {
  revision: string;
  summary: EntitySummary;
  brief: EntityBrief;
  details: EntityDetails;
}

export interface EntityBuilderRequest {
  humanName: string;
  purpose: string;
  model: string;
  profile: string;
  tools: string[];
  skills: string[];
  connectors: ConnectorGrant[];
  filesystemRoots: string[];
}

export interface ConnectorGrant {
  server: string;
  tools: string[];
}

export interface CreateEntityRequest extends EntityBuilderRequest {
  selector: RunnableSelector;
  project?: string;
  expectedCollectionRevision: string;
  idempotencyKey: string;
}

export interface UpdateEntityRequest extends EntityBuilderRequest {
  expectedSourceRevision: string;
  idempotencyKey: string;
}
