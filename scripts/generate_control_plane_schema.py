import argparse
import json
from pathlib import Path
from typing import Any


TOP_LEVEL_KEYS = {"schema", "versions", "migrations", "releaseAttestation", "activationJournal"}
VERSION_KEYS = {"version", "collections", "requiredCollections", "envelopeRequired"}
MIGRATION_KEYS = {"from", "to", "breaking", "down"}
ATTESTATION_KEYS = {"schema", "keys"}
ACTIVATION_JOURNAL_KEYS = {"phases"}


def fail(message: str) -> None:
    raise ValueError(f"invalid control-plane migration registry: {message}")


def exact_keys(value: Any, expected: set[str], name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{name} must be an object")
    actual = set(value)
    if actual != expected:
        fail(f"{name} keys must be exactly {sorted(expected)!r}")
    return value


def positive_safe_integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 9007199254740991:
        fail(f"{name} must be a positive safe integer")
    return value


def string_array(value: Any, name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        fail(f"{name} must be a nonempty string array")
    if len(set(value)) != len(value):
        fail(f"{name} must not contain duplicates")
    return value


def load_registry(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(str(error))
    registry = exact_keys(value, TOP_LEVEL_KEYS, "registry")
    if registry["schema"] != "kb.control-plane-migrations/v1":
        fail("schema must be kb.control-plane-migrations/v1")
    if not isinstance(registry["versions"], list) or not registry["versions"]:
        fail("versions must be a nonempty array")
    versions: list[dict[str, Any]] = []
    version_numbers: set[int] = set()
    for index, raw in enumerate(registry["versions"]):
        version = exact_keys(raw, VERSION_KEYS, f"versions[{index}]")
        number = positive_safe_integer(version["version"], f"versions[{index}].version")
        if number in version_numbers:
            fail("versions must not contain duplicate versions")
        version_numbers.add(number)
        collections = string_array(version["collections"], f"versions[{index}].collections")
        required = string_array(version["requiredCollections"], f"versions[{index}].requiredCollections")
        envelope = string_array(version["envelopeRequired"], f"versions[{index}].envelopeRequired")
        if not set(required).issubset(collections):
            fail(f"versions[{index}].requiredCollections must be a subset of collections")
        if "version" not in envelope or "nextEventCursor" not in envelope:
            fail(f"versions[{index}].envelopeRequired must include version and nextEventCursor")
        versions.append(version)
    if not isinstance(registry["migrations"], list):
        fail("migrations must be an array")
    migrations: list[dict[str, Any]] = []
    migration_pairs: set[tuple[int, int]] = set()
    for index, raw in enumerate(registry["migrations"]):
        migration = exact_keys(raw, MIGRATION_KEYS, f"migrations[{index}]")
        source = positive_safe_integer(migration["from"], f"migrations[{index}].from")
        target = positive_safe_integer(migration["to"], f"migrations[{index}].to")
        if source not in version_numbers or target not in version_numbers or source >= target:
            fail(f"migrations[{index}] must connect increasing declared versions")
        if not isinstance(migration["breaking"], bool) or migration["down"] not in {"present", "absent"}:
            fail(f"migrations[{index}] has invalid breaking or down")
        if (source, target) in migration_pairs:
            fail("migrations must not contain duplicate edges")
        migration_pairs.add((source, target))
        migrations.append(migration)
    attestation = exact_keys(registry["releaseAttestation"], ATTESTATION_KEYS, "releaseAttestation")
    if attestation["schema"] != "kb.release-attestation/v2":
        fail("releaseAttestation.schema must be kb.release-attestation/v2")
    if string_array(attestation["keys"], "releaseAttestation.keys") != [
        "archive", "schema", "sha256", "sourceCommit", "stateSchema", "rollbackStateSchema", "stateMigration", "workflow",
    ]:
        fail("releaseAttestation.keys must be the canonical v2 key order")
    activation_journal = exact_keys(registry["activationJournal"], ACTIVATION_JOURNAL_KEYS, "activationJournal")
    phases = string_array(activation_journal["phases"], "activationJournal.phases")
    if len(phases) != 16:
        fail("activationJournal.phases must contain exactly 16 phases")
    return registry


def derived_values(registry: dict[str, Any]) -> tuple[dict[str, Any], int, int, str]:
    versions = {version["version"]: version for version in registry["versions"]}
    current = max(versions)
    incoming = {edge["to"]: edge for edge in registry["migrations"]}
    upgrade_path: list[dict[str, Any]] = []
    upgrade = current
    while upgrade in incoming:
        edge = incoming[upgrade]
        upgrade_path.append(edge)
        upgrade = edge["from"]
    rollback_edge = incoming.get(current)
    if not rollback_edge or rollback_edge["down"] != "present":
        fail("current version must have a present down migration")
    rollback = rollback_edge["from"]
    migration = "breaking" if any(edge["breaking"] for edge in upgrade_path) else "compatible"
    return versions[current], current, rollback, migration


def ts_source(registry: dict[str, Any]) -> str:
    current_version, current, rollback, migration = derived_values(registry)
    collections = current_version["collections"]
    migrations = registry["migrations"]
    attestation = registry["releaseAttestation"]
    lines = [
        f"export const CONTROL_PLANE_SCHEMA_VERSION = {current} as const;",
        f"export const ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = {rollback} as const;",
        f"export const CONTROL_PLANE_COLLECTIONS = {json.dumps(collections)} as const;",
        "export type ControlPlaneCollection = typeof CONTROL_PLANE_COLLECTIONS[number];",
        f"export const CONTROL_PLANE_MIGRATIONS = {json.dumps(migrations, separators=(',', ':'))} as const;",
        f"export const RELEASE_ATTESTATION_SCHEMA = {json.dumps(attestation['schema'])} as const;",
        f"export const RELEASE_ATTESTATION_KEYS = {json.dumps(attestation['keys'])} as const;",
        f"export const ACTIVATION_JOURNAL_PHASES = {json.dumps(registry['activationJournal']['phases'])} as const;",
        f"export const STATE_SCHEMA = {json.dumps(str(current))} as const;",
        f"export const ROLLBACK_STATE_SCHEMA = {json.dumps(str(rollback))} as const;",
        f"export const STATE_MIGRATION = {json.dumps(migration)} as const;",
        "",
        "export function emptyControlPlaneDocument() {",
        "  return {",
        f"    version: {current},",
        "    documentRevision: 0,",
        "    nextEventCursor: 1,",
    ]
    if "scheduleCollectionRevision" in current_version["envelopeRequired"]:
        lines.append("    scheduleCollectionRevision: 0,")
    lines.extend(f"    {collection}: []," for collection in collections)
    lines.extend(["  };", "}", ""])
    return "\n".join(lines)


def py_source(registry: dict[str, Any]) -> str:
    current_version, current, rollback, migration = derived_values(registry)
    versions = {entry["version"]: entry for entry in registry["versions"]}
    empty = {"version": current, "documentRevision": 0, "nextEventCursor": 1}
    if "scheduleCollectionRevision" in current_version["envelopeRequired"]:
        empty["scheduleCollectionRevision"] = 0
    empty.update({collection: [] for collection in current_version["collections"]})
    lines = [
        "import base64",
        "import hashlib",
        "import json",
        "import re",
        "import sys",
        "import zlib",
        "from copy import deepcopy",
        "from datetime import datetime",
        "",
        f"CONTROL_PLANE_SCHEMA_VERSION = {current}",
        f"ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION = {rollback}",
        f"CONTROL_PLANE_COLLECTIONS = {tuple(current_version['collections'])!r}",
        f"CONTROL_PLANE_MIGRATIONS = {tuple(dict(edge) for edge in registry['migrations'])!r}",
        f"RELEASE_ATTESTATION_SCHEMA = {attestation_literal(registry['releaseAttestation']['schema'])}",
        f"RELEASE_ATTESTATION_KEYS = {tuple(registry['releaseAttestation']['keys'])!r}",
        f"ACTIVATION_JOURNAL_PHASES = {tuple(registry['activationJournal']['phases'])!r}",
        f"STATE_SCHEMA = {str(current)!r}",
        f"ROLLBACK_STATE_SCHEMA = {str(rollback)!r}",
        f"STATE_MIGRATION = {migration!r}",
        f"_SCHEMA_VERSIONS = {schema_versions_literal(versions)!r}",
        f"EMPTY_CONTROL_PLANE = {(json.dumps(empty, separators=(',', ':'), ensure_ascii=False) + chr(10)).encode('utf-8')!r}",
        "_MAX_ENVELOPE_COLLECTION_ROWS = 1_000_000",
        "_OPTIONAL_V1_COLLECTIONS = ('reviewLoops', 'reviewReceipts', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions')",
        "",
        "def assert_control_plane_schema(value):",
        "    if not isinstance(value, dict):",
        "        raise ValueError('control-plane document must be an object')",
        "    version = value.get('version')",
        "    if isinstance(version, bool) or not isinstance(version, int) or version not in _SCHEMA_VERSIONS:",
        "        raise ValueError('unsupported control-plane schema version')",
        "    envelope, required, collections = _SCHEMA_VERSIONS[version]",
        "    for key in envelope:",
        "        if key not in value:",
        "            raise ValueError(f'missing required control-plane envelope field: {key}')",
        "    for key in ('nextEventCursor', 'documentRevision', 'scheduleCollectionRevision'):",
        "        if key in envelope and (isinstance(value[key], bool) or not isinstance(value[key], int) or value[key] < 0 or value[key] > 9007199254740991):",
        "            raise ValueError(f'invalid control-plane envelope field: {key}')",
        "    if 'nextEventCursor' in envelope and value['nextEventCursor'] < 1:",
        "        raise ValueError('invalid control-plane envelope field: nextEventCursor')",
        "    for key in required:",
        "        if not isinstance(value.get(key), list) or len(value[key]) > _MAX_ENVELOPE_COLLECTION_ROWS:",
        "            raise ValueError(f'missing required control-plane collection: {key}')",
        "    optional = _OPTIONAL_V1_COLLECTIONS if version == 1 else ()",
        "    for key in (*collections, *optional):",
        "        if key in value and (not isinstance(value[key], list) or len(value[key]) > _MAX_ENVELOPE_COLLECTION_ROWS):",
        "            raise ValueError(f'invalid control-plane collection: {key}')",
        "    if version == 3:",
        "        _validate_v3_payload(value, envelope, collections)",
        "    return value",
        "",
    ]
    lines.extend('''
_P2_CARRIER_PREFIX = 'kb.control-plane-v3-down-carrier/v1:'
_P2_IDENTITY_KEYS = ('owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom')
_P2_SCHEDULE_KEYS = ('scheduleCollectionRevision', 'schedules', 'scheduleTombstones', 'scheduleOccurrenceClaims', 'scheduleSeedImports')
_SAFE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
_HASH = re.compile(r'^[a-f0-9]{64}$')
_RUN_REQUIRED_KEYS = {
    'subject', 'owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom',
    'runRef', 'predecessorRunRef', 'title', 'proposalRef', 'proposalRevision', 'proposalHash',
    'publicationState', 'lifecycle', 'version', 'managerSessionRef', 'managerGeneration',
    'managerAssignment', 'agentWorkspaceLaunch', 'createdAt', 'updatedAt',
}
_RUN_OPTIONAL_KEYS = {
    'launchOperationKey', 'launchOperationFingerprint', 'archiveOperationKey', 'archiveOperationFingerprint',
    'activationReceipts', 'authorizedFailedRunReconciliation',
}
_QUARANTINE_KEYS = {
    'subject', 'quarantinedAt', 'run', 'stages', 'attempts', 'sessions', 'humanRequests', 'events',
    'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions',
}
_SCHEDULE_KEYS = {
    'id', 'owner', 'cadence', 'nextAt', 'lastOutcome', 'armed', 'origin', 'mirroredAt', 'mirrorPath', 'version',
    'cadenceCanonical', 'seedBytes', 'seedDigest', 'seedAuthorized', 'launchPayload', 'operationReceipts',
    'emissionReceipts', 'mirrorMetadataRevision', 'tombstone',
}

def _exact(value, keys, name):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f'invalid control-plane v3 {name} keys')
    return value

def _iso(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        return False
    return parsed.isoformat(timespec='milliseconds').replace('+00:00', 'Z') == value

def _owner(value):
    if not isinstance(value, dict) or not isinstance(value.get('id'), str) or not _SAFE_ID.fullmatch(value['id']):
        return False
    if value.get('type') == 'agent':
        return set(value) == {'type', 'id', 'sourcePath'} and value.get('sourcePath') == f"agents/{value['id']}.md"
    if value.get('type') == 'workflow':
        project = value.get('project')
        return (set(value) == {'type', 'id', 'project', 'sourcePath'} and isinstance(project, str)
                and _SAFE_ID.fullmatch(project) is not None
                and value.get('sourcePath') == f"orgs/{project}/workflows/{value['id']}.md")
    return False

def _identity(value):
    outcome = value.get('terminalOutcome')
    completed = value.get('completedAt')
    archived = value.get('archivedFrom')
    return (_owner(value.get('owner')) and value.get('executionHost') in ('vm', 'desktop')
            and outcome in (None, 'ok', 'failed', 'stopped', 'interrupted', 'abandoned')
            and (completed is None or _iso(completed)) and (outcome is None) == (completed is None)
            and archived in (None, 'succeeded', 'failed', 'stopped', 'interrupted', 'waiting-human')
            and not (archived is not None and outcome is None))

def _nullable_text(value):
    return value is None or (isinstance(value, str) and 0 < len(value) <= 512 and '\\x00' not in value)

def _assignment(value):
    if value is None:
        return True
    return (isinstance(value, dict)
            and set(value) == {'agentId', 'declarationPath', 'declarationHash', 'profileId', 'runtime', 'model'}
            and isinstance(value.get('agentId'), str) and _SAFE_ID.fullmatch(value['agentId']) is not None
            and value.get('declarationPath') == f"agents/{value['agentId']}.md"
            and isinstance(value.get('declarationHash'), str) and _HASH.fullmatch(value['declarationHash']) is not None
            and isinstance(value.get('profileId'), str) and bool(value['profileId'])
            and value.get('runtime') in ('claude', 'codex') and isinstance(value.get('model'), str) and bool(value['model']))

def _workspace_launch(value):
    if value is None:
        return True
    return (isinstance(value, dict) and set(value) == {'composerRef', 'agentId', 'declarationPath', 'declarationHash'}
            and isinstance(value.get('composerRef'), str) and bool(value['composerRef']) and '\\x00' not in value['composerRef']
            and isinstance(value.get('agentId'), str) and _SAFE_ID.fullmatch(value['agentId']) is not None
            and value.get('declarationPath') == f"agents/{value['agentId']}.md"
            and isinstance(value.get('declarationHash'), str) and _HASH.fullmatch(value['declarationHash']) is not None)

def _lifecycle(value):
    if not isinstance(value, dict) or set(value) != {'kind', 'deployPause'}:
        return False
    kinds = {'planned', 'recovering', 'running', 'waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted', 'archived'}
    if value.get('kind') in kinds:
        return value.get('deployPause') is None
    if value.get('kind') != 'paused-for-deploy':
        return False
    pause = value.get('deployPause')
    if not isinstance(pause, dict) or set(pause) != {'deploymentRef', 'pausedAt', 'priorKind', 'resumeStreak', 'lastResumeAttemptCursor', 'resumeClaim'}:
        return False
    return (isinstance(pause.get('deploymentRef'), str) and bool(pause['deploymentRef']) and _iso(pause.get('pausedAt'))
            and pause.get('priorKind') in kinds and isinstance(pause.get('resumeStreak'), int) and not isinstance(pause['resumeStreak'], bool)
            and pause['resumeStreak'] >= 0 and (pause.get('lastResumeAttemptCursor') is None
            or (isinstance(pause['lastResumeAttemptCursor'], int) and not isinstance(pause['lastResumeAttemptCursor'], bool)
                and pause['lastResumeAttemptCursor'] >= 0)))

def _stored_run(value):
    if not isinstance(value, dict) or not _RUN_REQUIRED_KEYS.issubset(value) or not set(value).issubset(_RUN_REQUIRED_KEYS | _RUN_OPTIONAL_KEYS):
        return False
    if (not _identity(value) or not isinstance(value.get('subject'), str) or not _SAFE_ID.fullmatch(value['subject'])
            or not isinstance(value.get('runRef'), str) or not _SAFE_ID.fullmatch(value['runRef'])
            or not _nullable_text(value.get('predecessorRunRef')) or not isinstance(value.get('title'), str) or not value['title']
            or not isinstance(value.get('proposalRef'), str) or not _SAFE_ID.fullmatch(value['proposalRef'])
            or not isinstance(value.get('proposalRevision'), int) or isinstance(value['proposalRevision'], bool) or value['proposalRevision'] < 1
            or not isinstance(value.get('proposalHash'), str) or not _HASH.fullmatch(value['proposalHash'])
            or value.get('publicationState') not in ('pending', 'waiting-human', 'publishing', 'published', 'reconcile-required')
            or not _lifecycle(value.get('lifecycle')) or not isinstance(value.get('version'), int) or isinstance(value['version'], bool) or value['version'] < 1
            or not isinstance(value.get('managerSessionRef'), str) or not _SAFE_ID.fullmatch(value['managerSessionRef'])
            or not isinstance(value.get('managerGeneration'), int) or isinstance(value['managerGeneration'], bool) or value['managerGeneration'] < 0
            or not _assignment(value.get('managerAssignment')) or not _workspace_launch(value.get('agentWorkspaceLaunch'))
            or not _iso(value.get('createdAt')) or not _iso(value.get('updatedAt'))):
        return False
    for key in ('launchOperationKey', 'archiveOperationKey'):
        if key in value and not _nullable_text(value[key]):
            return False
    for key in ('launchOperationFingerprint', 'archiveOperationFingerprint'):
        if key in value and value[key] is not None and (not isinstance(value[key], str) or not _HASH.fullmatch(value[key])):
            return False
    return isinstance(value.get('activationReceipts', []), list)

def _schedule(value):
    return (isinstance(value, dict) and set(value) == _SCHEDULE_KEYS and isinstance(value.get('id'), str)
            and _HASH.fullmatch(value['id']) is not None and _owner(value.get('owner'))
            and isinstance(value.get('cadence'), dict) and set(value['cadence']) == {'source', 'words'}
            and all(isinstance(value['cadence'].get(key), str) and value['cadence'][key] for key in ('source', 'words'))
            and (value.get('nextAt') is None or _iso(value['nextAt']))
            and value.get('lastOutcome') in (None, 'ok', 'failed', 'stopped', 'interrupted', 'abandoned')
            and isinstance(value.get('armed'), bool) and value.get('origin') in ('seed', 'operator')
            and (value.get('mirroredAt') is None or _iso(value['mirroredAt']))
            and (value.get('mirrorPath') == 'HEARTBEAT.md' or (isinstance(value.get('mirrorPath'), str)
                and re.fullmatch(r'orgs/[A-Za-z0-9._-]+/HEARTBEAT\\.md', value['mirrorPath'])))
            and isinstance(value.get('version'), int) and not isinstance(value['version'], bool) and value['version'] >= 1
            and isinstance(value.get('cadenceCanonical'), str) and isinstance(value.get('seedAuthorized'), bool)
            and isinstance(value.get('operationReceipts'), list) and isinstance(value.get('emissionReceipts'), list)
            and isinstance(value.get('mirrorMetadataRevision'), int) and not isinstance(value['mirrorMetadataRevision'], bool)
            and value['mirrorMetadataRevision'] >= 0)

def _validate_v3_payload(value, envelope, collections):
    if set(value) != set(envelope) | set(collections):
        raise ValueError('invalid control-plane v3 document keys')
    if any(not _stored_run(run) for run in value['runs']):
        raise ValueError('invalid control-plane v3 stored run')
    for bundle in value['quarantine']:
        if not isinstance(bundle, dict) or set(bundle) != _QUARANTINE_KEYS or not _iso(bundle.get('quarantinedAt')):
            raise ValueError('invalid control-plane v3 quarantine row')
        if bundle.get('subject') != bundle.get('run', {}).get('subject') or not _stored_run(bundle.get('run')):
            raise ValueError('invalid control-plane v3 quarantine run')
        if any(not isinstance(bundle.get(key), list) for key in _QUARANTINE_KEYS - {'subject', 'quarantinedAt', 'run'}):
            raise ValueError('invalid control-plane v3 quarantine collections')
    if any(not _schedule(row) for row in value['schedules']):
        raise ValueError('invalid control-plane v3 schedule row')

def _canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def _run_identity(run):
    fields = {key: deepcopy(run.get(key)) for key in _P2_IDENTITY_KEYS}
    if any(key not in run for key in _P2_IDENTITY_KEYS) or not _identity(run):
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
        if (_canonical_json(payload).encode('utf-8') != canonical or set(payload) != {'documentRevision', 'nextEventCursor', 'runIdentity', *_P2_SCHEDULE_KEYS}
                or not isinstance(payload.get('runIdentity'), dict) or set(payload['runIdentity']) != {'runs', 'quarantine'}
                or carrier.get('cursor') != payload['nextEventCursor']):
            raise ValueError()
    except Exception as error:
        raise ValueError('invalid control-plane v3 down carrier') from error
    def restore(runs, rows):
        if len(runs) != len(rows):
            raise ValueError('invalid control-plane v3 down carrier run set')
        for run, row in zip(runs, rows, strict=True):
            if (run.get('runRef') != row.get('runRef') or not isinstance(row, dict)
                    or set(row) != {'runRef', *_P2_IDENTITY_KEYS} or not _identity(row)):
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

def _main(argv):
    if argv != ['--round-trip-v3']:
        return 2
    try:
        value = json.load(sys.stdin)
        restored = restore_v3_down_carrier(down_migrate_v3_to_v2(value))
        sys.stdout.write(json.dumps(restored, separators=(',', ':'), ensure_ascii=False))
        return 0
    except Exception as error:
        sys.stderr.write(str(error))
        return 1

if __name__ == '__main__':
    raise SystemExit(_main(sys.argv[1:]))
'''.strip('\n').splitlines())
    lines.append("")
    return "\n".join(lines)


def attestation_literal(value: str) -> str:
    return repr(value)


def schema_versions_literal(versions: dict[int, dict[str, Any]]) -> dict[int, tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]]:
    return {
        version: (tuple(entry["envelopeRequired"]), tuple(entry["requiredCollections"]), tuple(entry["collections"]))
        for version, entry in versions.items()
    }


def generate(registry: Path, ts_output: Path, py_output: Path) -> None:
    value = load_registry(registry)
    ts_output.parent.mkdir(parents=True, exist_ok=True)
    py_output.parent.mkdir(parents=True, exist_ok=True)
    ts_output.write_bytes(ts_source(value).encode("utf-8"))
    py_output.write_bytes(py_source(value).encode("utf-8"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    registry = root / "schemas/control-plane-migrations.json"
    ts_output = root / "dashboard/server/control/generated/controlPlaneSchema.ts"
    py_output = root / "deploy/control_plane_schema.py"
    if arguments.check:
        value = load_registry(registry)
        if ts_output.read_bytes() != ts_source(value).encode("utf-8") or py_output.read_bytes() != py_source(value).encode("utf-8"):
            raise SystemExit("generated control-plane schema modules are out of date")
    else:
        generate(registry, ts_output, py_output)
