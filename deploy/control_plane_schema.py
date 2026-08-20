import json

CONTROL_PLANE_SCHEMA_VERSION = 2
ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = 1
CONTROL_PLANE_COLLECTIONS = ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments')
CONTROL_PLANE_MIGRATIONS = ({'from': 1, 'to': 2, 'breaking': True, 'down': 'present'},)
RELEASE_ATTESTATION_SCHEMA = 'kb.release-attestation/v2'
RELEASE_ATTESTATION_KEYS = ('archive', 'schema', 'sha256', 'sourceCommit', 'stateSchema', 'rollbackStateSchema', 'stateMigration', 'workflow')
ACTIVATION_JOURNAL_PHASES = ('authorized', 'service-stopped', 'migrated', 'current-swapped', 'restart-issued', 'activation-committed', 'healthy', 'rollback-authorized', 'rollback-stopped', 'down-migrated', 'rollback-swapped', 'rollback-committed', 'rollback-healthy', 'old-selected', 'rollback-cancelled', 'recovery-required')
STATE_SCHEMA = '2'
ROLLBACK_STATE_SCHEMA = '1'
STATE_MIGRATION = 'breaking'
_SCHEMA_VERSIONS = {1: (('version', 'nextEventCursor'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'quarantine'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine')), 2: (('version', 'documentRevision', 'nextEventCursor'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments'))}
EMPTY_CONTROL_PLANE = b'{"version":2,"documentRevision":0,"nextEventCursor":1,"proposals":[],"runs":[],"stages":[],"attempts":[],"sessions":[],"humanRequests":[],"events":[],"stageGenerations":[],"iterationLoops":[],"iterationRequests":[],"iterationReceipts":[],"generationSupersessions":[],"quarantine":[],"deployments":[]}\n'
_MAX_ENVELOPE_COLLECTION_ROWS = 1_000_000
_OPTIONAL_V1_COLLECTIONS = ('reviewLoops', 'reviewReceipts', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions')

def assert_control_plane_schema(value):
    if not isinstance(value, dict):
        raise ValueError('control-plane document must be an object')
    version = value.get('version')
    if isinstance(version, bool) or not isinstance(version, int) or version not in _SCHEMA_VERSIONS:
        raise ValueError('unsupported control-plane schema version')
    envelope, required, collections = _SCHEMA_VERSIONS[version]
    for key in envelope:
        if key not in value:
            raise ValueError(f'missing required control-plane envelope field: {key}')
    for key in ('nextEventCursor', 'documentRevision'):
        if key in envelope and (isinstance(value[key], bool) or not isinstance(value[key], int) or value[key] < 0 or value[key] > 9007199254740991):
            raise ValueError(f'invalid control-plane envelope field: {key}')
    if 'nextEventCursor' in envelope and value['nextEventCursor'] < 1:
        raise ValueError('invalid control-plane envelope field: nextEventCursor')
    for key in required:
        if not isinstance(value.get(key), list) or len(value[key]) > _MAX_ENVELOPE_COLLECTION_ROWS:
            raise ValueError(f'missing required control-plane collection: {key}')
    optional = _OPTIONAL_V1_COLLECTIONS if version == 1 else ()
    for key in (*collections, *optional):
        if key in value and (not isinstance(value[key], list) or len(value[key]) > _MAX_ENVELOPE_COLLECTION_ROWS):
            raise ValueError(f'invalid control-plane collection: {key}')
    return value
