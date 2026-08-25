"""Cross-language contract test for the dashboard-v3 P5 desktop-helper protocol (movement spec §3).

The TypeScript client (`dashboard/server/deploy/helperClient.ts`) and the movement helper build (out of
P5 scope) both read `dashboard/server/deploy/helper/protocol.schema.json`. This test pins that schema as
the faithful transcription of movement:235 (the closed request verb union) and movement:237 (the receipt
record), and validates the shared contract vectors — the same fixture the TypeScript suite consumes —
against it, so a drift in either language is caught here.
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "dashboard" / "server" / "deploy" / "helper" / "protocol.schema.json"
VECTORS_PATH = REPO_ROOT / "tests" / "fixtures" / "dashboard-v3-p5-contract-vectors.json"

SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))


def subschema_validator(pointer: str) -> Draft202012Validator:
    """A validator over one `$defs` member that still resolves internal `#/$defs/...` refs."""
    doc = {"$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{pointer}"}
    Draft202012Validator.check_schema(doc)
    return Draft202012Validator(doc)


REQUEST = subschema_validator("request")
RECEIPT = subschema_validator("receipt")


def test_schema_id_is_versioned_v1():
    assert SCHEMA["$id"] == "https://schemas.kb.local/deploy-helper/v1"


def test_request_union_is_exactly_the_three_movement_235_verbs():
    branches = SCHEMA["$defs"]["request"]["oneOf"]
    verbs = {SCHEMA["$defs"][ref["$ref"].split("/")[-1]]["properties"]["verb"]["const"] for ref in branches}
    assert verbs == {"deploy", "pull-assets", "deployment-result"}


@pytest.mark.parametrize(
    "verb_def, required",
    [
        ("deployRequest", {"verb", "sourceCommit", "attestationDigest", "requestRef"}),
        ("pullAssetsRequest", {"verb", "intentRef", "runRef", "manifestDigest"}),
        ("deploymentResultRequest", {"verb", "deploymentRef", "outcome"}),
    ],
)
def test_each_request_verb_has_exactly_its_movement_235_fields_and_no_other(verb_def, required):
    definition = SCHEMA["$defs"][verb_def]
    # additionalProperties:false is the "no verb accepts paths, hosts, commands, or keys" wall.
    assert definition["additionalProperties"] is False
    assert set(definition["required"]) == required
    assert set(definition["properties"]) == required


def test_receipt_is_exactly_the_movement_237_fields_and_forbids_extras():
    receipt = SCHEMA["$defs"]["receipt"]
    fields = {"time", "requestRef", "shortSha", "callerNode", "outcome"}
    # additionalProperties:false is the design 527 "never secrets or signatures" guarantee.
    assert receipt["additionalProperties"] is False
    assert set(receipt["required"]) == fields
    assert set(receipt["properties"]) == fields


def test_valid_request_vectors_pass():
    for case in VECTORS["helperRequests"]["valid"]:
        assert REQUEST.is_valid(case["value"]), case["name"]


def test_invalid_request_vectors_fail():
    for case in VECTORS["helperRequests"]["invalid"]:
        assert not REQUEST.is_valid(case["value"]), case["name"]


def test_valid_receipt_vectors_pass():
    for case in VECTORS["helperReceipts"]["valid"]:
        assert RECEIPT.is_valid(case["value"]), case["name"]


def test_invalid_receipt_vectors_fail():
    for case in VECTORS["helperReceipts"]["invalid"]:
        assert not RECEIPT.is_valid(case["value"]), case["name"]


def test_receipt_rejects_a_signature_field():
    accepted = dict(VECTORS["helperReceipts"]["valid"][0]["value"])
    accepted["signature"] = "deadbeef"
    assert not RECEIPT.is_valid(accepted)


def test_request_rejects_a_key_or_command_field():
    deploy = dict(VECTORS["helperRequests"]["valid"][0]["value"])
    deploy["signingKey"] = "x"
    assert not REQUEST.is_valid(deploy)
