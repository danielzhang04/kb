export const CONTROL_PLANE_SCHEMA_VERSION = 2 as const;
export const ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = 1 as const;
export const CONTROL_PLANE_COLLECTIONS = ["proposals", "runs", "stages", "attempts", "sessions", "humanRequests", "events", "stageGenerations", "iterationLoops", "iterationRequests", "iterationReceipts", "generationSupersessions", "quarantine", "deployments"] as const;
export type ControlPlaneCollection = typeof CONTROL_PLANE_COLLECTIONS[number];
export const CONTROL_PLANE_MIGRATIONS = [{"from":1,"to":2,"breaking":true,"down":"present"}] as const;
export const RELEASE_ATTESTATION_SCHEMA = "kb.release-attestation/v2" as const;
export const RELEASE_ATTESTATION_KEYS = ["archive", "schema", "sha256", "sourceCommit", "stateSchema", "rollbackStateSchema", "stateMigration", "workflow"] as const;
export const STATE_SCHEMA = "2" as const;
export const ROLLBACK_STATE_SCHEMA = "1" as const;
export const STATE_MIGRATION = "breaking" as const;

export function emptyControlPlaneDocument() {
  return {
    version: 2,
    documentRevision: 0,
    nextEventCursor: 1,
    proposals: [],
    runs: [],
    stages: [],
    attempts: [],
    sessions: [],
    humanRequests: [],
    events: [],
    stageGenerations: [],
    iterationLoops: [],
    iterationRequests: [],
    iterationReceipts: [],
    generationSupersessions: [],
    quarantine: [],
    deployments: [],
  };
}
