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
    rollback = current
    path: list[dict[str, Any]] = []
    while rollback in incoming and incoming[rollback]["down"] == "present":
        edge = incoming[rollback]
        path.append(edge)
        rollback = edge["from"]
    if not path:
        fail("current version must have a present down migration")
    migration = "breaking" if any(edge["breaking"] for edge in path) else "compatible"
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
    lines.extend(f"    {collection}: []," for collection in collections)
    lines.extend(["  };", "}", ""])
    return "\n".join(lines)


def py_source(registry: dict[str, Any]) -> str:
    current_version, current, rollback, migration = derived_values(registry)
    versions = {entry["version"]: entry for entry in registry["versions"]}
    empty = {"version": current, "documentRevision": 0, "nextEventCursor": 1}
    empty.update({collection: [] for collection in current_version["collections"]})
    lines = [
        "import json",
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
        "    for key in ('nextEventCursor', 'documentRevision'):",
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
        "    return value",
        "",
    ]
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
