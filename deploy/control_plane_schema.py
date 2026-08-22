import base64
import hashlib
import json
import zlib
from copy import deepcopy

CONTROL_PLANE_SCHEMA_VERSION = 3
ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = 2
CONTROL_PLANE_COLLECTIONS = ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments', 'schedules', 'scheduleTombstones', 'scheduleOccurrenceClaims', 'scheduleSeedImports')
CONTROL_PLANE_MIGRATIONS = ({'from': 1, 'to': 2, 'breaking': True, 'down': 'present'}, {'from': 2, 'to': 3, 'breaking': True, 'down': 'present'})
RELEASE_ATTESTATION_SCHEMA = 'kb.release-attestation/v2'
RELEASE_ATTESTATION_KEYS = ('archive', 'schema', 'sha256', 'sourceCommit', 'stateSchema', 'rollbackStateSchema', 'stateMigration', 'workflow')
ACTIVATION_JOURNAL_PHASES = ('authorized', 'service-stopped', 'migrated', 'current-swapped', 'restart-issued', 'activation-committed', 'healthy', 'rollback-authorized', 'rollback-stopped', 'down-migrated', 'rollback-swapped', 'rollback-committed', 'rollback-healthy', 'old-selected', 'rollback-cancelled', 'recovery-required')
STATE_SCHEMA = '3'
ROLLBACK_STATE_SCHEMA = '2'
STATE_MIGRATION = 'breaking'
_SCHEMA_VERSIONS = {1: (('version', 'nextEventCursor'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'quarantine'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine')), 2: (('version', 'documentRevision', 'nextEventCursor'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments')), 3: (('version', 'documentRevision', 'nextEventCursor', 'scheduleCollectionRevision'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments', 'schedules', 'scheduleTombstones', 'scheduleOccurrenceClaims', 'scheduleSeedImports'), ('proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions', 'quarantine', 'deployments', 'schedules', 'scheduleTombstones', 'scheduleOccurrenceClaims', 'scheduleSeedImports'))}
EMPTY_CONTROL_PLANE = b'{"version":3,"documentRevision":0,"nextEventCursor":1,"scheduleCollectionRevision":0,"proposals":[],"runs":[],"stages":[],"attempts":[],"sessions":[],"humanRequests":[],"events":[],"stageGenerations":[],"iterationLoops":[],"iterationRequests":[],"iterationReceipts":[],"generationSupersessions":[],"quarantine":[],"deployments":[],"schedules":[],"scheduleTombstones":[],"scheduleOccurrenceClaims":[],"scheduleSeedImports":[]}\n'
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
    for key in ('nextEventCursor', 'documentRevision', 'scheduleCollectionRevision'):
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

_P2_CARRIER_PREFIX = 'kb.control-plane-v3-down-carrier/v1:'
_P2_IDENTITY_KEYS = ('owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom')
_P2_SCHEDULE_KEYS = ('scheduleCollectionRevision', 'schedules', 'scheduleTombstones', 'scheduleOccurrenceClaims', 'scheduleSeedImports')

def _canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def _run_identity(run):
    fields = {key: deepcopy(run.get(key)) for key in _P2_IDENTITY_KEYS}
    if any(key not in run for key in _P2_IDENTITY_KEYS):
        raise ValueError('control-plane v3 run identity is incomplete')
    return {'runRef': run.get('runRef'), **fields}

def down_migrate_v3_to_v2(value):
    document = deepcopy(assert_control_plane_schema(value))
    if document['version'] != 3:
        raise ValueError('control-plane down migration requires schema v3')
    payload = {
        'documentRevision': document['documentRevision'],
        'nextEventCursor': document['nextEventCursor'],
        'runIdentity': {
            'runs': [_run_identity(run) for run in document['runs']],
            'quarantine': [_run_identity(bundle['run']) for bundle in document['quarantine']],
        },
        **{key: deepcopy(document[key]) for key in _P2_SCHEDULE_KEYS},
    }
    canonical = _canonical_json(payload).encode('utf-8')
    digest = hashlib.sha256(canonical).hexdigest()
    encoded = base64.urlsafe_b64encode(zlib.compress(canonical)).rstrip(b'=').decode('ascii')
    document['events'].append({
        'subject': 'system', 'cursor': document['nextEventCursor'], 'runRef': '__control-plane-v3-migration__',
        'kind': 'lifecycle', 'source': 'system', 'stageRef': None, 'attemptRef': None, 'sessionRef': None,
        'status': 'success', 'summary': f'{_P2_CARRIER_PREFIX}{digest}:{encoded}', 'command': None,
        'toolName': None, 'path': None, 'diff': None, 'checkpoint': None, 'createdAt': '1970-01-01T00:00:00.000Z',
    })
    document['nextEventCursor'] += 1
    for run in [*document['runs'], *(bundle['run'] for bundle in document['quarantine'])]:
        for key in _P2_IDENTITY_KEYS:
            run.pop(key, None)
    for key in _P2_SCHEDULE_KEYS:
        document.pop(key, None)
    document['version'] = 2
    return document

def restore_v3_down_carrier(value):
    document = deepcopy(assert_control_plane_schema(value))
    if document['version'] != 2 or not document['events']:
        raise ValueError('control-plane v3 down carrier is unavailable')
    carrier = document['events'][-1]
    summary = carrier.get('summary') if isinstance(carrier, dict) else None
    if not isinstance(summary, str) or not summary.startswith(_P2_CARRIER_PREFIX):
        raise ValueError('control-plane v3 down carrier is unavailable')
    try:
        digest, encoded = summary[len(_P2_CARRIER_PREFIX):].split(':')
        padded = encoded + '=' * (-len(encoded) % 4)
        decompressor = zlib.decompressobj()
        canonical = decompressor.decompress(base64.urlsafe_b64decode(padded), 64 * 1024 * 1024 + 1)
        if len(canonical) > 64 * 1024 * 1024 or decompressor.unconsumed_tail or not decompressor.eof:
            raise ValueError()
        if hashlib.sha256(canonical).hexdigest() != digest:
            raise ValueError()
        payload = json.loads(canonical)
        if _canonical_json(payload).encode('utf-8') != canonical or carrier.get('cursor') != payload['nextEventCursor']:
            raise ValueError()
    except Exception as error:
        raise ValueError('invalid control-plane v3 down carrier') from error
    def restore(runs, rows):
        if len(runs) != len(rows):
            raise ValueError('invalid control-plane v3 down carrier run set')
        for run, row in zip(runs, rows, strict=True):
            if run.get('runRef') != row.get('runRef') or any(key not in row for key in _P2_IDENTITY_KEYS):
                raise ValueError('invalid control-plane v3 down carrier run identity')
            run.update({key: deepcopy(row[key]) for key in _P2_IDENTITY_KEYS})
    restore(document['runs'], payload['runIdentity']['runs'])
    restore([bundle['run'] for bundle in document['quarantine']], payload['runIdentity']['quarantine'])
    document['events'].pop()
    document['documentRevision'] = payload['documentRevision']
    document['nextEventCursor'] = payload['nextEventCursor']
    for key in _P2_SCHEDULE_KEYS:
        document[key] = payload[key]
    document['version'] = 3
    return assert_control_plane_schema(document)
