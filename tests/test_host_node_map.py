import json
import subprocess
from pathlib import Path

import pytest

from deploy import bootstrap_vm


VALID = {
    "schema": "kb.host-node-map/v1",
    "revision": 3,
    "hosts": {"vm": {"nodeId": "nodeVM01"}, "desktop": {"nodeId": "nodeDESK9"}},
    "revoked": [{"nodeId": "oldNODE7", "revokedAt": "2026-08-01T00:00:00.000Z"}],
}


def test_validate_accepts_a_well_formed_map():
    assert bootstrap_vm.validate_host_node_map(dict(VALID)) == VALID


@pytest.mark.parametrize("mutate", [
    lambda m: m.__setitem__("schema", "kb.host-node-map/v2"),
    lambda m: m.__setitem__("revision", 0),
    lambda m: m.__setitem__("revision", -1),
    lambda m: m.__setitem__("revision", 1.5),
    lambda m: m.__setitem__("revision", True),
    lambda m: m.__setitem__("extra", 1),
    lambda m: m.__setitem__("hosts", {"vm": {"nodeId": "nodeVM01"}}),
    lambda m: m.__setitem__("hosts", {"vm": {"nodeId": "nodeVM01"}, "desktop": {"nodeId": "nodeDESK9"}, "laptop": {"nodeId": "nodeLAP1"}}),
    lambda m: m.__setitem__("hosts", {"vm": {"nodeId": "bad id!"}, "desktop": {"nodeId": "nodeDESK9"}}),
    lambda m: m.__setitem__("hosts", {"vm": {"nodeId": "abcd"}, "desktop": {"nodeId": "nodeDESK9"}}),
    lambda m: m.__setitem__("hosts", {"vm": {"nodeId": "sameID1"}, "desktop": {"nodeId": "sameID1"}}),
    lambda m: m.__setitem__("revoked", [{"nodeId": "nodeVM01", "revokedAt": "2026-08-01T00:00:00.000Z"}]),
    lambda m: m.__setitem__("revoked", [{"nodeId": "oldNODE7", "revokedAt": "not-a-date"}]),
    lambda m: m.__setitem__("revoked", [{"nodeId": "oldNODE7", "revokedAt": "2026-08-01T00:00:00Z"}, {"nodeId": "oldNODE7", "revokedAt": "2026-08-02T00:00:00Z"}]),
    lambda m: m.__setitem__("revoked", "not-an-array"),
])
def test_validate_refuses_every_malformation(mutate):
    bad = json.loads(json.dumps(VALID))
    mutate(bad)
    with pytest.raises(ValueError):
        bootstrap_vm.validate_host_node_map(bad)


def test_validate_refuses_a_non_object():
    with pytest.raises(ValueError):
        bootstrap_vm.validate_host_node_map([1, 2, 3])


def test_install_writes_a_root_owned_0444_map_after_validating_the_source(tmp_path):
    source = tmp_path / "host-nodes.json"
    source.write_text(json.dumps(VALID), encoding="utf-8")
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    bootstrap_vm.install_host_node_map(source, run=run)
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0755", bootstrap_vm.HOST_NODE_MAP_DIR] in commands
    assert ["install", "-o", "root", "-g", "root", "-m", "0444", str(source), bootstrap_vm.HOST_NODE_MAP_PATH] in commands


def test_install_refuses_a_malformed_source_before_writing_anything(tmp_path):
    source = tmp_path / "host-nodes.json"
    source.write_text(json.dumps({**VALID, "schema": "wrong"}), encoding="utf-8")
    commands = []

    with pytest.raises(ValueError):
        bootstrap_vm.install_host_node_map(source, run=lambda argv, **k: commands.append(argv))
    assert commands == []


def test_map_schema_literal_matches_the_typescript_decoder():
    # The Python and TypeScript decoders must agree on the schema literal and node-id charset.
    ts = (Path(__file__).resolve().parents[1] / "dashboard/server/auth/hostNodeMapContracts.ts").read_text(encoding="utf-8")
    assert f"'{bootstrap_vm.HOST_NODE_MAP_SCHEMA}'" in ts
    assert "[A-Za-z0-9]{5,32}" in bootstrap_vm.NODE_ID_PATTERN.pattern
    assert "[A-Za-z0-9]{5,32}" in ts
