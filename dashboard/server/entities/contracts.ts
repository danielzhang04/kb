import type { EntitySummary, OutputRef, RunRow, RunnableRef, ScheduleOccurrence } from '../control/p2Contracts.ts';

export type { EntitySummary } from '../control/p2Contracts.ts';

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
  connectors: string[];
  filesystemRoots: string[];
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
