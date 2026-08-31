export const CONTROL_PLANE_SCHEMA_VERSION = 4 as const;
export const ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = 3 as const;
export const CONTROL_PLANE_COLLECTIONS = ["proposals", "runs", "stages", "attempts", "sessions", "humanRequests", "events", "stageGenerations", "iterationLoops", "iterationRequests", "iterationReceipts", "generationSupersessions", "quarantine", "deployments", "schedules", "scheduleTombstones", "scheduleOccurrenceClaims", "scheduleSeedImports", "hostAdvertisements", "placementLeases", "v1Idempotency"] as const;
export type ControlPlaneCollection = typeof CONTROL_PLANE_COLLECTIONS[number];
export const CONTROL_PLANE_MIGRATIONS = [{"from":1,"to":2,"breaking":true,"down":"present"},{"from":2,"to":3,"breaking":true,"down":"present"},{"from":3,"to":4,"breaking":false,"down":"present"}] as const;
export const RELEASE_ATTESTATION_SCHEMA = "kb.release-attestation/v2" as const;
export const RELEASE_ATTESTATION_KEYS = ["archive", "schema", "sha256", "sourceCommit", "stateSchema", "rollbackStateSchema", "stateMigration", "workflow"] as const;
export const ACTIVATION_JOURNAL_PHASES = ["authorized", "service-stopped", "migrated", "current-swapped", "restart-issued", "activation-committed", "healthy", "rollback-authorized", "rollback-stopped", "down-migrated", "rollback-swapped", "rollback-committed", "rollback-healthy", "old-selected", "rollback-cancelled", "recovery-required"] as const;
export const STATE_SCHEMA = "4" as const;
export const ROLLBACK_STATE_SCHEMA = "3" as const;
export const STATE_MIGRATION = "breaking" as const;

export function emptyControlPlaneDocument() {
  return {
    version: 4,
    documentRevision: 0,
    nextEventCursor: 1,
    scheduleCollectionRevision: 0,
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
    schedules: [],
    scheduleTombstones: [],
    scheduleOccurrenceClaims: [],
    scheduleSeedImports: [],
    hostAdvertisements: [],
    placementLeases: [],
    v1Idempotency: [],
  };
}
